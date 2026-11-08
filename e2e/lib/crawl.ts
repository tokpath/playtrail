import { spawnSync } from "node:child_process";
import path from "node:path";
import { BACKEND_DIR, DSN, FAKE } from "./api";

/** Run one crawler task with the e2e-built binary against the fake server. */
export function crawl(task: string, timeoutMs = 240_000) {
  const res = spawnSync(path.join(BACKEND_DIR, "bin", "playtrail-e2e"), ["crawl", "--task", task], {
    cwd: BACKEND_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
    ...process.env,
    DATABASE_URL: DSN,
    CRAWLER_BASE_URL: FAKE,
    CRAWLER_ENABLED: "true",
    INTERNAL_SECRET: process.env.E2E_INTERNAL_SECRET ?? "e2e-internal-secret-0123456789abcdef0123456789",
  },
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
