#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
target="${1:?usage: apply-patch.sh CLEAN_OPENSHELL_CHECKOUT}"
revision="6648bd0c290efbc41ba131ee9831ee45cd431f94"
bundle="$repo_root/third_party/openshell/rt01"
patch_name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["patch"]["path"].split("/")[-1])' "$bundle/source-pins.json")
patch="$bundle/$patch_name"
[[ "$(git -C "$target" rev-parse HEAD)" == "$revision" ]] || { echo "wrong upstream base" >&2; exit 65; }
[[ -z "$(git -C "$target" status --porcelain)" ]] || { echo "checkout must be clean" >&2; exit 65; }
patch_sha=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["patch"]["sha256"])' "$bundle/source-pins.json")
printf '%s  %s\n' "$patch_sha" "$patch" | sha256sum --check --status
git -C "$target" apply --check "$patch"
git -C "$target" apply "$patch"
git -C "$target" diff --check
