#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" ]]; then
  echo 'Native sandbox installation is only supported on Linux GitHub Actions runners.' >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install --yes --no-install-recommends bubblewrap

# Ubuntu restricts capabilities in unprivileged user namespaces unless the
# executable has an explicit AppArmor grant. Keep the host policy enabled and
# grant namespaces only to the native sandbox binary, on this CI runner.
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] &&
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == "1" ]]; then
  sudo apt-get install --yes --no-install-recommends apparmor
  aw_profile=$(mktemp "$RUNNER_TEMP/aw-ci-bwrap-XXXXXX")
  trap 'rm -f "$aw_profile"' EXIT
  cat > "$aw_profile" <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
PROFILE
  sudo apparmor_parser -r "$aw_profile"
fi

command -v bwrap
command -v prlimit
env -i PATH=/usr/bin:/bin bwrap --die-with-parent --new-session \
  --unshare-pid --unshare-ipc --unshare-uts --unshare-net \
  --tmpfs / --proc /proc --dev /dev --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  -- /bin/true
