#!/usr/bin/env python3
"""
Create a local n8n workflow export with TEST_KEYS filled from environment vars.

This is for local UI testing only. The output filename is gitignored by default.

Usage:
  OPENROUTER_KEY=... FAL_KEY=... ELEVENLABS_API_KEY=... \\
    python3 tools/make_workflow_local.py \\
      --in dignitate-workflow-v3-stable.json \\
      --out dignitate-workflow-v3-stable.local.json
"""

import argparse
import json
import os
import sys


KEY_MAP = {
    "openrouterKey": "OPENROUTER_KEY",
    "falKey": "FAL_KEY",
    "elevenLabsKey": "ELEVENLABS_API_KEY",
    "githubPat": "GITHUB_PAT",
    "composioKey": "COMPOSIO_API_KEY",
}


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def inject_test_keys(workflow: dict) -> int:
    nodes = workflow.get("nodes") or []
    for n in nodes:
        if n.get("name") != "TEST_KEYS":
            continue
        params = n.setdefault("parameters", {})
        values = params.setdefault("values", {})
        strings = values.get("string")
        if not isinstance(strings, list):
            raise RuntimeError("TEST_KEYS.values.string is missing or not a list")

        updated = 0
        for entry in strings:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if not name:
                continue
            env_name = KEY_MAP.get(name)
            if not env_name:
                continue
            v = os.environ.get(env_name, "")
            if v:
                entry["value"] = v
                updated += 1
        return updated

    raise RuntimeError('Node named "TEST_KEYS" not found in workflow JSON')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    args = ap.parse_args()

    wf = load_json(args.inp)
    updated = inject_test_keys(wf)
    save_json(args.out, wf)

    missing = [env for env in KEY_MAP.values() if not os.environ.get(env)]
    print(f"Wrote {args.out}. Updated {updated} TEST_KEYS field(s).")
    if missing:
        print("Missing env vars (left blank): " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

