#!/bin/bash
set -euo pipefail
# Run on the reviewed control-plane VM as an operator. No configured secret values are printed.
test "$(id -u)" = 0
apt-get update
apt-get install -y --no-install-recommends ca-certificates docker.io docker-compose-v2
install -d -m 0700 /etc/august-works
install -d -m 0750 /opt/august-works
systemctl enable --now docker
printf '%s\n' 'Control host prepared. Install reviewed digest references and root-only platform.env before deployment.'
