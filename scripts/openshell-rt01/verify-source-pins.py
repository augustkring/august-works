#!/usr/bin/env python3
"""Fail-closed verification for the private OpenShell RT-01 source pin."""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"source pin verification failed: {message}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: verify-source-pins.py PATCHED_OPENSHELL_CHECKOUT")
    checkout = Path(sys.argv[1]).resolve()
    repo_root = Path(__file__).resolve().parents[2]
    bundle = repo_root / "third_party/openshell/rt01"
    pins = json.loads((bundle / "source-pins.json").read_text())
    upstream = pins["upstream"]
    actual_commit = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual_commit != upstream["commit"]:
        fail(f"expected base {upstream['commit']}, got {actual_commit}")
    patch = repo_root / pins["patch"]["path"]
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    if digest != pins["patch"]["sha256"]:
        fail("patch hash differs from source-pins.json")
    changed = subprocess.check_output(
        ["git", "-C", str(checkout), "diff", "--name-only", upstream["commit"]],
        text=True,
    ).splitlines()
    expected = pins["expectedPatchedPaths"]
    if sorted(changed) != sorted(expected) or len(changed) != len(set(changed)):
        fail(f"patched path set differs: actual={sorted(changed)!r}")
    untracked = subprocess.check_output(
        ["git", "-C", str(checkout), "ls-files", "--others", "--exclude-standard"],
        text=True,
    ).splitlines()
    if untracked:
        fail(f"unexpected non-ignored untracked files: {untracked!r}")
    for relative, expected_hash in pins["files"].items():
        path = checkout / relative
        if not path.is_file():
            fail(f"pinned file missing: {relative}")
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            fail(f"pinned file hash mismatch: {relative}")
    print(f"OpenShell RT-01 source pins verified at {actual_commit}; {len(changed)} patched files")


if __name__ == "__main__":
    main()
