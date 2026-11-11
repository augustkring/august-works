#!/usr/bin/env bash
set -euo pipefail

apt_mirrors_file="${1:-/etc/apt/apt-mirrors.txt}"
if [[ ! -f "$apt_mirrors_file" || ! -r "$apt_mirrors_file" ]] ||
   ! grep -qF '://azure.archive.ubuntu.com/' "$apt_mirrors_file"; then
  exit 0
fi

if [[ -w "$apt_mirrors_file" ]]; then
  sed -i 's#://azure\.archive\.ubuntu\.com/#://archive.ubuntu.com/#g' "$apt_mirrors_file"
else
  sudo sed -i 's#://azure\.archive\.ubuntu\.com/#://archive.ubuntu.com/#g' "$apt_mirrors_file"
fi
