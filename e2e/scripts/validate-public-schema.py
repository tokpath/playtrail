"""Check the actual OpenAPI contract against a captured public detail response.

Run with Python's isolated mode (-I). Requires PyYAML and jsonschema.
"""
import argparse
import copy
import json
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    document = yaml.safe_load(args.schema.read_text())
    detail = json.loads(args.detail.read_text())

    def validator(name):
        # Keep local #/components references and allOf intact, not a simplified
        # reconstruction of the constraints we intend to check.
        return Draft202012Validator({
            "$ref": f"#/components/schemas/{name}",
            "components": document["components"],
        })

    card_validator = validator("GameCard")
    detail_validator = validator("GameDetail")
    results = []

    def check(name, instance, schema, expected):
        errors = [error.message for error in schema.iter_errors(instance)]
        results.append({"name": name, "expectedValid": expected,
                        "valid": not errors, "passed": (not errors) == expected,
                        "errors": errors})

    check("actual-detail", detail, detail_validator, True)
    for count, expected in [(3, True), (4, False)]:
        card = copy.deepcopy(detail)
        card["tags"] = [{"slug": f"tag-{i}", "name": f"Tag {i}"} for i in range(count)]
        check(f"card-tags-{count}", card, card_validator, expected)
    for count, expected in [(8, True), (9, False)]:
        sample = copy.deepcopy(detail)
        sample["tags"] = [{"slug": f"tag-{i}", "name": f"Tag {i}"} for i in range(count)]
        check(f"detail-tags-{count}", sample, detail_validator, expected)
    for reason, expected in [(None, True), ("link_unavailable", True), ("unknown", False)]:
        sample = copy.deepcopy(detail)
        sample["outboundBlockedReason"] = reason
        check(f"blocked-reason-{reason}", sample, detail_validator, expected)
    args.output.write_text(json.dumps(results, indent=2) + "\n")
    failures = [result["name"] for result in results if not result["passed"]]
    if failures:
        raise SystemExit("Unexpected schema results: " + ", ".join(failures))
    print(f"{len(results)}/{len(results)} schema checks passed")


if __name__ == "__main__":
    main()
