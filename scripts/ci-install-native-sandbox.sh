#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" ]]; then
  echo 'Native sandbox installation is only supported on Linux GitHub Actions runners.' >&2
  exit 1
fi

# A stalled runner package mirror must not consume the whole test job. Keep
# downloads bounded and fail normally if the native prerequisite cannot install.
aw_apt_options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
timeout --kill-after=10s 180s sudo apt-get "${aw_apt_options[@]}" update
timeout --kill-after=10s 180s sudo apt-get "${aw_apt_options[@]}" install --yes --no-install-recommends bubblewrap

# Ubuntu restricts capabilities in unprivileged user namespaces unless the
# executable has an explicit AppArmor grant. Keep the host policy enabled and
# grant namespaces only to the native sandbox binary, on this CI runner.
if [[ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]] &&
   [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" == "1" ]]; then
  timeout --kill-after=10s 180s sudo apt-get "${aw_apt_options[@]}" install --yes --no-install-recommends apparmor
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
