"""
Compare detect-secrets scan output against the committed baseline.
Exits with code 1 if new secrets are found that are not in the baseline.

Usage:
    python3 .github/scripts/check-secrets.py /tmp/scan.json .secrets.baseline
"""
import json
import sys


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def main():
    scan_file = sys.argv[1] if len(sys.argv) > 1 else "/tmp/scan.json"
    baseline_file = sys.argv[2] if len(sys.argv) > 2 else ".secrets.baseline"

    scan = load_json(scan_file, {})
    baseline = load_json(baseline_file, {})

    known = set()
    for fp, findings in baseline.get("results", {}).items():
        for finding in findings:
            known.add((fp, finding.get("line_number"), finding.get("type")))

    new_secrets = []
    for fp, findings in scan.get("results", {}).items():
        for finding in findings:
            key = (fp, finding.get("line_number"), finding.get("type"))
            if key not in known:
                new_secrets.append(
                    "  {}:{} [{}]".format(
                        fp,
                        finding.get("line_number", "?"),
                        finding.get("type", "unknown"),
                    )
                )

    if new_secrets:
        print("New potential secrets found (not in baseline):")
        for item in new_secrets:
            print(item)
        print()
        print("To update the baseline:")
        print("  pip install detect-secrets")
        print("  detect-secrets scan > .secrets.baseline")
        print("  git add .secrets.baseline && git commit -m 'chore: update secrets baseline'")
        sys.exit(1)

    print("No new secrets detected. OK.")


if __name__ == "__main__":
    main()
