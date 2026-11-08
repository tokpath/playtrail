#!/usr/bin/env python3
"""Repeatable crawler E2E checks against a running fake-crazygames fixture.

Requires an e2e-tagged PLAYTRAIL_BIN, CRAWLER_BASE_URL on loopback, and an
already migrated DATABASE_URL whose database name ends with _e2e. Only that
isolated database is changed. Writes machine-readable evidence, including
SyncRun rows and fixture request logs, to --artifact (default /tmp).
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--artifact", default="/tmp/playtrail-crawler-evidence.json")
args = parser.parse_args()
env = os.environ.copy()
base = env.get("CRAWLER_BASE_URL", "")
dsn = urllib.parse.urlparse(env.get("DATABASE_URL", ""))
assert urllib.parse.urlparse(base).hostname in {"localhost", "127.0.0.1"}, "fake server must be loopback"
assert dsn.path.endswith("_e2e"), "refusing to change a non-e2e database"
assert dsn.hostname in {"localhost", "127.0.0.1"}, "database must be local"
binary = env["PLAYTRAIL_BIN"]
container = env.get("POSTGRES_CONTAINER", "playtrail-dev-db")
env["CRAWLER_ENABLED"] = "true"
backend = Path(__file__).resolve().parents[2] / "backend"
evidence = {"startedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "checks": []}


def sql(query):
    result = subprocess.run(
        ["docker", "exec", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", dsn.username,
         "-d", dsn.path[1:], "-tA", "-c", query],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def request(path, method="GET", value=None):
    data = json.dumps(value).encode() if value is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def control(**value):
    request("/_control", "POST", {"reset": True, **value})
    request("/_log", "DELETE")


def reenable():
    sql("UPDATE crawler_settings SET enabled=true, auto_disabled=false, "
        "auto_disabled_reason='', consecutive_aborts=0, daily_cap=500, min_interval_ms=2000")


def run(task):
    started = time.monotonic()
    result = subprocess.run([binary, "crawl", "--task", task], cwd=backend,
                            env=env, text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    row = json.loads(sql("SELECT row_to_json(s) FROM sync_runs s ORDER BY started_at DESC LIMIT 1"))
    log = request("/_log")["items"]
    evidence["checks"][-1].setdefault("runs", []).append({
        "run": row, "requests": log, "elapsedSeconds": round(time.monotonic() - started, 3),
    })
    return row, log


def fresh(slugs):
    names = ",".join("'" + slug + "'" for slug in slugs)
    sql("UPDATE source_games SET parser_version=0, last_fetched_at=NULL, last_fetch_result='' "
        "WHERE slug IN (" + names + ")")


def check(name, fn):
    evidence["checks"].append({"name": name, "passed": False})
    try:
        fn()
        evidence["checks"][-1]["passed"] = True
        print("PASS " + name, flush=True)
    except Exception as exc:
        evidence["checks"][-1]["error"] = str(exc)
        print("FAIL " + name + ": " + str(exc), flush=True)


def baseline():
    control()
    row, log = run("sitemap")
    assert row["outcome"] == "ok", row
    assert len(log) == 2 and row["requests"] == 2, row
    assert [item["path"] for item in log] == ["/robots.txt", "/en/sitemap"]
    stamps = [dt.datetime.fromisoformat(item["time"].replace("Z", "+00:00")) for item in log]
    assert (stamps[1] - stamps[0]).total_seconds() >= 2
    assert all(item["ua"].startswith("PlayTrailBot/1.0 (+") for item in log)


def robots():
    control(**{"global": {"type": "robots_disallow", "times": 1}})
    row, log = run("sitemap")
    assert row["outcome"] == "failed" and row["requests"] == 1
    assert len(log) == 1 and "disallowed" in row["abort_reason"]


def retry():
    control(**{"global": {"type": "rate_limit", "retryAfterSec": 2, "times": 2}})
    row, log = run("sitemap")
    assert row["outcome"] == "ok", row
    assert row["requests"] == len(log) == 4, row
    assert row["status_counts"]["429"] == 2, row
    times = [dt.datetime.fromisoformat(i["time"].replace("Z", "+00:00")) for i in log]
    assert all((b-a).total_seconds() >= 2 for a, b in zip(times, times[1:]))


def aborts():
    reenable()
    for _ in range(3):
        fresh(["bloxdhop-io", "bloxity-io"])
        control(games={slug: {"type": "rate_limit", "retryAfterSec": 1}
                       for slug in ["bloxdhop-io", "bloxity-io"]})
        row, log = run("backfill")
        assert row["outcome"] == "aborted", row
        assert row["status_counts"]["429"] == 5, row
        assert row["requests"] == len(log), (row, len(log))
    assert sql("SELECT auto_disabled AND consecutive_aborts=3 FROM crawler_settings") == "t"
    result = subprocess.run([binary, "crawl", "--task", "sitemap"], cwd=backend,
                            env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode != 0 and "auto-disabled" in result.stderr
    reenable()


def captcha():
    control(**{"global": {"type": "captcha", "times": 1}})
    row, log = run("hot")
    assert row["outcome"] == "aborted" and "verification" in row["abort_reason"]
    assert len(log) == row["requests"] == 2


def redirect():
    reenable()
    fresh(["bloxdhop-io"])
    control(games={"bloxdhop-io": {"type": "redirect"}})
    row, log = run("backfill")
    assert sql("SELECT last_fetch_result FROM source_games WHERE slug='bloxdhop-io'") == "redirected"
    assert row["status_counts"].get("redirect", 0) == 1
    assert sum(item["path"] == "/game/bloxdhop-io" for item in log) == 1


def bodies():
    reenable()
    control(**{"global": {"type": "huge_body", "padBytes": 15 << 20, "times": 1}})
    row, _ = run("sitemap")
    assert row["outcome"] == "ok", row
    control(**{"global": {"type": "huge_body", "padBytes": 33 << 20, "times": 1}})
    row, _ = run("sitemap")
    assert row["outcome"] == "failed" and "body exceeded" in row["abort_reason"], row


def quota():
    control()
    sql("UPDATE crawler_settings SET daily_cap=0")
    row, log = run("hot")
    assert row["outcome"] == "partial" and row["requests"] == len(log) == 0, row
    reenable()


def paused():
    control()
    sql("UPDATE crawler_settings SET enabled=false")
    result = subprocess.run([binary, "crawl", "--task", "hot"], cwd=backend,
                            env=env, capture_output=True, text=True, timeout=15)
    assert result.returncode != 0 and "paused" in result.stderr
    assert request("/_log")["items"] == []
    reenable()


def maintenance():
    # Use an already collected fixture game from the API collect/publish flow.
    gid = sql("SELECT game_id FROM source_games WHERE slug='bloxdhop-io'")
    assert gid, "collect bloxdhop-io in this e2e database first"
    # Seed a successful normalized detail before measuring later changes;
    # the breaker scenarios intentionally reset parser_version to zero.
    control()
    run("tracked")
    published_name = sql("SELECT r.name FROM game_revisions r JOIN games g "
                         "ON r.id=g.published_revision_id WHERE g.id='" + gid + "'")
    for scenario, expected in [("not_found", "not_found"), ("unpublished", "unpublished"),
                               ("canonical_mismatch", "unpublished")]:
        sql("UPDATE games SET link_status='valid' WHERE id='" + gid + "'")
        control(games={"bloxdhop-io": {"type": scenario}})
        row, _ = run("tracked")
        assert row["outcome"] == "ok", row
        assert sql("SELECT link_status FROM games WHERE id='" + gid + "'") == "suspect"
        assert sql("SELECT last_fetch_result FROM source_games WHERE slug='bloxdhop-io'") == expected
        assert sql("SELECT bool_and(NOT outbound_allowed) FROM public_games WHERE game_id='" + gid + "'") == "t"
    control(games={"bloxdhop-io": {"type": "renamed", "newName": "Evidence Rename"}})
    run("tracked")
    assert sql("SELECT r.name FROM game_revisions r JOIN games g "
               "ON r.id=g.published_revision_id WHERE g.id='" + gid + "'") == published_name
    assert int(sql("SELECT count(*) FROM source_changes WHERE game_id='" + gid + "' AND state='pending'")) > 0
    control(games={"bloxdhop-io": {"type": "server_error"}})
    run("tracked")
    assert sql("SELECT link_status FROM games WHERE id='" + gid + "'") == "suspect"
    assert sql("SELECT consecutive_fail_days FROM source_games WHERE slug='bloxdhop-io'") == "1"
    control(games={"bloxdhop-io": {"type": "malformed"}})
    run("tracked")
    assert sql("SELECT link_status FROM games WHERE id='" + gid + "'") == "suspect"
    assert sql("SELECT consecutive_fail_days FROM source_games WHERE slug='bloxdhop-io'") == "1"


def hot():
    control()
    sql("UPDATE crawler_settings SET hot_auto_publish=true")
    row, _ = run("hot")
    assert row["outcome"] == "ok" and row["stats"]["mapped"] >= 1, row
    assert sql("SELECT review_state FROM hot_snapshots ORDER BY created_at DESC LIMIT 1") == "approved"
    assert sql("SELECT position FROM hot_snapshot_items WHERE snapshot_id="
               "(SELECT id FROM hot_snapshots ORDER BY created_at DESC LIMIT 1) AND game_id IS NOT NULL LIMIT 1") == "1"
    sql("UPDATE crawler_settings SET hot_auto_publish=false")
    control()
    run("hot")
    assert sql("SELECT review_state FROM hot_snapshots ORDER BY created_at DESC LIMIT 1") == "pending"


try:
    reenable()
    for name, fn in [("E24 discovery/spacing/UA", baseline), ("robots fail-closed", robots),
                     ("Retry-After/wire quota counts", retry), ("E25 fifth-response abort/auto-disable", aborts),
                     ("captcha", captcha), ("cross-host redirect", redirect), ("15MB/33MB limits", bodies),
                     ("quota exhausted before robots", quota), ("pause", paused),
                     ("E26 suspect/CTA/changes/failure days", maintenance), ("E27 hot mapping/review", hot)]:
        check(name, fn)
finally:
    control()
    reenable()
    evidence["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    evidence["passed"] = all(item["passed"] for item in evidence["checks"])
    Path(args.artifact).write_text(json.dumps(evidence, indent=2) + "\n")
    print("Evidence: " + args.artifact, flush=True)
sys.exit(0 if evidence["passed"] else 1)
