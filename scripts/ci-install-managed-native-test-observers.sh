#!/usr/bin/env bash
set -euo pipefail
trusted_node_dir=/usr/local/libexec/paperclip-erasure-test-node
observer_dir=/usr/local/libexec/paperclip-fixture-observers
# Keep the hosted image's known root-owned PATH directory inside the same
# immutable-chain profile that the erasure tests require.
if [[ "${ERASER_TEST_RUNNER_ENVIRONMENT:-}" == github-hosted ]]; then
  eraser_image_bin=/usr/local/bin
  test "$(/usr/bin/readlink -f -- "$eraser_image_bin")" = "$eraser_image_bin"
  test "$(/usr/bin/stat -Lc %u -- "$eraser_image_bin")" = 0
  eraser_image_bin_mode=$(/usr/bin/stat -Lc %a -- "$eraser_image_bin")
  if [[ "$eraser_image_bin_mode" == 777 ]]; then sudo chmod 0755 -- "$eraser_image_bin"; fi
  eraser_image_bin_mode=$(/usr/bin/stat -Lc %a -- "$eraser_image_bin")
  (( (8#$eraser_image_bin_mode & 8#6022) == 0 ))
fi
node_source="$(command -v node)"
node_real="$(/usr/bin/readlink -f -- "$node_source")"
case "$node_real" in
  "$RUNNER_TOOL_CACHE"/node/*/bin/node) ;;
  *) echo "setup-node executable is outside RUNNER_TOOL_CACHE" >&2; exit 1 ;;
esac
expected_version="v$(/usr/bin/tr -d '\r\n' < .nvmrc)"
source_version="$("$node_real" --version)"
test "$source_version" = "$expected_version"
source_sha="$(/usr/bin/sha256sum -- "$node_real" | /usr/bin/cut -d ' ' -f 1)"
# Check every existing target/ancestor BEFORE any privileged install.
# Missing descendants may be installed; existing different bytes are never replaced.
observer_check_chain() {
  local current="$1" observer_mode
  while [[ ! -e "$current" && ! -L "$current" ]]; do current=${current%/*}; done
  while :; do
    test "$(/usr/bin/readlink -f -- "$current")" = "$current"
    test "$(/usr/bin/stat -Lc %u -- "$current")" = 0
    observer_mode=$(/usr/bin/stat -Lc %a -- "$current")
    (( (8#$observer_mode & 8#6022) == 0 ))
    test "$current" = / && break
    current=${current%/*}
    test -n "$current" || current=/
  done
}
for observer_target in "$trusted_node_dir/node" "$observer_dir/native-session-handles-v1" "$observer_dir/native-session-handles-v1.mjs" "$observer_dir/native-model-socket-v1" "$observer_dir/native-model-socket-v1.mjs"; do
  if [[ -e "$observer_target" || -L "$observer_target" ]]; then test -f "$observer_target"; fi
  observer_check_chain "$observer_target"
done
test ! -e "$trusted_node_dir/node" || /usr/bin/cmp -s -- "$node_real" "$trusted_node_dir/node"
echo "9045f8998cfe2fd12b706b58b459d1271815c37175a8017d1d958a3afbc009e8  scripts/fixtures/native-session-handle-observer" | /usr/bin/sha256sum --check --strict
echo "7a092f75132698d5e43c0424fc103b100f0dd62353e80ca5c5d3d71969462f55  scripts/fixtures/native-session-handle-observer.mjs" | /usr/bin/sha256sum --check --strict
for observer_name in native-session-handles-v1 native-session-handles-v1.mjs; do
  observer_expected=9045f8998cfe2fd12b706b58b459d1271815c37175a8017d1d958a3afbc009e8
  [[ "$observer_name" != *.mjs ]] || observer_expected=7a092f75132698d5e43c0424fc103b100f0dd62353e80ca5c5d3d71969462f55
  if [[ -e "$observer_dir/$observer_name" ]]; then
    echo "$observer_expected  $observer_dir/$observer_name" | /usr/bin/sha256sum --check --strict
  fi
done
# Separate fixed read-only live socket observer; no Stop/erasure authority.
echo "ef02d5bc28b9886840627269d2bd5aa29bdc7b0582b939556c469db785461079  scripts/fixtures/native-model-socket-observer" | /usr/bin/sha256sum --check --strict
echo "a2f1183beaa1594c452bb17956e29f53030dc3de36ef59f830e82b3e186c08f4  scripts/fixtures/native-model-socket-observer.mjs" | /usr/bin/sha256sum --check --strict
# Unprivileged injected-I/O regression before any privileged observer install.
observer_test_node="$node_real"
/usr/bin/timeout --kill-after=1s 5s /usr/bin/env -i PATH=/usr/bin:/bin "$observer_test_node" --no-addons --disable-proto=throw --test scripts/fixtures/native-model-socket-observer.test.mjs
for observer_name in native-model-socket-v1 native-model-socket-v1.mjs; do
  observer_expected=ef02d5bc28b9886840627269d2bd5aa29bdc7b0582b939556c469db785461079
  [[ "$observer_name" != *.mjs ]] || observer_expected=a2f1183beaa1594c452bb17956e29f53030dc3de36ef59f830e82b3e186c08f4
  if [[ -e "$observer_dir/$observer_name" ]]; then
    echo "$observer_expected  $observer_dir/$observer_name" | /usr/bin/sha256sum --check --strict
  fi
done
for observer_directory in "$trusted_node_dir" "$observer_dir"; do
  if [[ ! -e "$observer_directory" ]]; then sudo install -d -o root -g root -m 0755 "$observer_directory"; fi
done
if [[ ! -e "$trusted_node_dir/node" ]]; then
  sudo install -o root -g root -m 0755 -- "$node_real" "$trusted_node_dir/node"
fi
if [[ ! -e "$observer_dir/native-session-handles-v1" ]]; then
  sudo install -o root -g root -m 0555 scripts/fixtures/native-session-handle-observer "$observer_dir/native-session-handles-v1"
fi
if [[ ! -e "$observer_dir/native-session-handles-v1.mjs" ]]; then
  sudo install -o root -g root -m 0444 scripts/fixtures/native-session-handle-observer.mjs "$observer_dir/native-session-handles-v1.mjs"
fi
if [[ ! -e "$observer_dir/native-model-socket-v1" ]]; then
  sudo install -o root -g root -m 0555 scripts/fixtures/native-model-socket-observer "$observer_dir/native-model-socket-v1"
fi
if [[ ! -e "$observer_dir/native-model-socket-v1.mjs" ]]; then
  sudo install -o root -g root -m 0444 scripts/fixtures/native-model-socket-observer.mjs "$observer_dir/native-model-socket-v1.mjs"
fi
/usr/bin/cmp -s -- "$node_real" "$trusted_node_dir/node"
test "$(/usr/bin/stat -Lc %u -- "$trusted_node_dir/node")" = 0
test "$(/usr/bin/stat -Lc %a -- "$trusted_node_dir/node")" = 755
test "$("$trusted_node_dir/node" --version)" = "$source_version"
test "$(/usr/bin/sha256sum -- "$trusted_node_dir/node" | /usr/bin/cut -d ' ' -f 1)" = "$source_sha"
echo "9045f8998cfe2fd12b706b58b459d1271815c37175a8017d1d958a3afbc009e8  $observer_dir/native-session-handles-v1" | /usr/bin/sha256sum --check --strict
echo "7a092f75132698d5e43c0424fc103b100f0dd62353e80ca5c5d3d71969462f55  $observer_dir/native-session-handles-v1.mjs" | /usr/bin/sha256sum --check --strict
echo "ef02d5bc28b9886840627269d2bd5aa29bdc7b0582b939556c469db785461079  $observer_dir/native-model-socket-v1" | /usr/bin/sha256sum --check --strict
echo "a2f1183beaa1594c452bb17956e29f53030dc3de36ef59f830e82b3e186c08f4  $observer_dir/native-model-socket-v1.mjs" | /usr/bin/sha256sum --check --strict
for observer_target in "$trusted_node_dir/node" "$observer_dir/native-session-handles-v1" "$observer_dir/native-session-handles-v1.mjs" "$observer_dir/native-model-socket-v1" "$observer_dir/native-model-socket-v1.mjs"; do
  observer_check_chain "$observer_target"
done
# Run ONLY the finite unprivileged kernel control; the observer itself cannot signal/write.
echo "a6fba302c87c6eaefe0c0a10b625cb3f14ae2959956900eeeb314c7912dfdfab  scripts/fixtures/native-session-handle-observer-check.mjs" | /usr/bin/sha256sum --check --strict
/usr/bin/timeout --kill-after=2s 12s /usr/bin/env -i PATH=/usr/bin:/bin "$trusted_node_dir/node" --no-addons --disable-proto=throw scripts/fixtures/native-session-handle-observer-check.mjs
echo "PAPERCLIP_TEST_ERASER_NODE_PATH=$trusted_node_dir/node" >> "$GITHUB_ENV"
echo "PAPERCLIP_TEST_PRIVILEGED_SESSION_OBSERVER=1" >> "$GITHUB_ENV"
# Qualify actual same-UID nondumpable completeness and socket ownership before enabling this distinct lane.
echo "1f7081f83a2dfe63b4c76e80e9e83e8852d6b3ec94856542554cf4f8f2541a6a  scripts/fixtures/native-model-socket-observer-check.mjs" | /usr/bin/sha256sum --check --strict
/usr/bin/timeout --kill-after=2s 12s /usr/bin/env -i PATH=/usr/bin:/bin "$trusted_node_dir/node" --no-addons --disable-proto=throw scripts/fixtures/native-model-socket-observer-check.mjs
echo "PAPERCLIP_TEST_PRIVILEGED_MODEL_SOCKET_OBSERVER=1" >> "$GITHUB_ENV"
echo "eraser-profile original-path=/usr/local/bin uid=0 mode=$(/usr/bin/stat -Lc %a -- /usr/local/bin)"
# Report the exact fixed binary profile when a hosted runner refuses it.
# These are public path/owner/mode facets; no environment values or file bodies.
for executable in "$trusted_node_dir/node" /bin/sh /usr/bin/env /usr/bin/readlink /usr/bin/stat /usr/bin/sha256sum /usr/bin/cut /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
  current_binary=$(/usr/bin/readlink -f -- "$executable")
  while :; do
    /usr/bin/stat -Lc 'eraser-profile path=%n uid=%u mode=%a' -- "$current_binary"
    test "$current_binary" = / && break
    current_binary=${current_binary%/*}
    test -n "$current_binary" || current_binary=/
  done
done
