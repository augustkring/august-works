#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
target="${1:?usage: fetch-and-apply.sh DESTINATION_PATH}"
repository="https://github.com/NVIDIA/OpenShell.git"
revision="6648bd0c290efbc41ba131ee9831ee45cd431f94"
if [[ -e "$target" ]]; then
  echo "refusing fetch: destination already exists: $target" >&2
  exit 73
fi
mkdir -p "$(dirname -- "$target")"
git clone --filter=blob:none --no-checkout "$repository" "$target"
git -C "$target" checkout --detach "$revision"
[[ "$(git -C "$target" rev-parse HEAD)" == "$revision" ]]
"$repo_root/scripts/openshell-rt01/apply-patch.sh" "$target"
python3 "$repo_root/scripts/openshell-rt01/verify-source-pins.py" "$target"
