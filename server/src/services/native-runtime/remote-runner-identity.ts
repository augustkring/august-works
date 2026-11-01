import { createHash } from "node:crypto";
import path from "node:path";
import type { SandboxPolicy } from "@paperclipai/shared";

/** Shared exact process check used by the server launcher and relay owner. */
export const REMOTE_RUNNER_PROCESS_FINGERPRINT_SCRIPT =
  "process_fingerprint=$(node -e 'const fs=require(\"node:fs\");try{const stat=fs.readFileSync(\"/proc/\"+process.argv[1]+\"/stat\",\"utf8\");const end=stat.lastIndexOf(\") \");const ticks=stat.slice(end+2).trim().split(/\\s+/)[19];const boot=fs.readFileSync(\"/proc/sys/kernel/random/boot_id\",\"utf8\").trim();if(end<0||!/^\\d+$/.test(ticks||\"\")||!/^[-a-fA-F0-9]+$/.test(boot))process.exit(4);process.stdout.write(\"linux:\"+boot+\":\"+ticks)}catch{process.exit(4)}' \"$pid\")";

export const REMOTE_RUNNER_CHILD_LAUNCH_SCRIPT =
  'set -eu; identity_path=$1; identity_nonce=$2; runner_instance_id=$3; diagnostics_directory=$4; shift 4; umask 077; identity_dir=$(dirname -- "$identity_path"); session_root=$(dirname -- "$identity_dir"); session_digest=$(basename -- "$session_root"); sessions_root=$(dirname -- "$session_root"); test "${#session_digest}" -eq 64; case "$session_digest" in *[!a-f0-9]*) exit 4 ;; esac; test "$(dirname -- "$session_root")" = "$sessions_root" && test ! -L "$sessions_root"; lock_dir="$sessions_root/.$session_digest.lock"; mkdir -m 0700 -- "$lock_dir" || exit 6; trap \'rmdir -- "$lock_dir" 2>/dev/null || true\' EXIT; test -d "$lock_dir" && test ! -L "$lock_dir" && test -d "$sessions_root" && test ! -L "$sessions_root" && test -d "$session_root" && test ! -L "$session_root" && test -d "$identity_dir" && test ! -L "$identity_dir"; test ! -L "$diagnostics_directory"; if test -e "$diagnostics_directory"; then test -d "$diagnostics_directory"; else mkdir -p -- "$diagnostics_directory"; fi; chmod 0700 "$diagnostics_directory"; started_at=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"); pid=$$; process_fingerprint=""; if ' +
  REMOTE_RUNNER_PROCESS_FINGERPRINT_SCRIPT +
  '; then :; else process_fingerprint=""; fi; identity_tmp="${identity_path}.tmp.$$"; printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$identity_nonce" "$$" "$started_at" "$runner_instance_id" "$process_fingerprint" > "$identity_tmp"; chmod 0600 "$identity_tmp"; mv -f -- "$identity_tmp" "$identity_path"; rmdir -- "$lock_dir"; trap - EXIT; exec "$@"';

export const REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT =
  'set -eu; identity_path=$1; expected_nonce=$2; expected_runner_id=$3; expected_pid=$4; test -f "$identity_path" && test ! -L "$identity_path" || exit 3; { IFS= read -r nonce; IFS= read -r pid; IFS= read -r started_at; IFS= read -r runner_id; IFS= read -r process_fingerprint || true; } < "$identity_path"; test "$nonce" = "$expected_nonce" && test "$runner_id" = "$expected_runner_id" && test "$pid" = "$expected_pid" && test -n "$started_at" || exit 4; if test "${5-}" = require-fingerprint; then test -n "$process_fingerprint" || exit 4; fi; kill -0 "$pid" 2>/dev/null || exit 3; if test -r "/proc/$pid/stat"; then process_state=$(awk \'{ sub(/^.*\\) /, ""); print $1 }\' "/proc/$pid/stat") || exit 3; test "$process_state" = Z && exit 3; if test -n "$process_fingerprint"; then process_ticks=$(awk \'{ sub(/^.*\\) /, ""); print $20 }\' "/proc/$pid/stat") || exit 3; boot_id=$(cat /proc/sys/kernel/random/boot_id) || exit 3; case "$process_fingerprint" in linux:"$boot_id":"$process_ticks") : ;; *) exit 3 ;; esac; fi; else exit 3; fi; if test -r "/proc/$pid/cmdline"; then command_line=$(tr "\\000" "\\n" < "/proc/$pid/cmdline") || exit 3; printf "%s\\n" "$command_line" | grep -Fqx -- "--runner-id" || exit 4; printf "%s\\n" "$command_line" | grep -Fqx -- "$expected_runner_id" || exit 4; else exit 3; fi';

/** Session-root writes, resume state reads, and erasure all take this stable
 * sibling lock. The nonce makes release prove it still owns the lock. */
export const REMOTE_NATIVE_SESSION_FENCE_ACQUIRE_SCRIPT = String.raw`set -eu
task_root=$1; session_digest=$2; fence_nonce=$3
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac; test "$(printf %s "$session_digest" | wc -c)" -eq 64
case "$fence_nonce" in *[!a-f0-9-]*|"") exit 4 ;; esac
sessions_root="$task_root/.paperclip-runtime/paperclip-runner/sessions"
for directory in "$task_root" "$task_root/.paperclip-runtime" "$task_root/.paperclip-runtime/paperclip-runner" "$sessions_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
lock_dir="$sessions_root/.$session_digest.lock"; umask 077; mkdir -m 0700 -- "$lock_dir" || exit 6
printf '%s\n' "$fence_nonce" > "$lock_dir/owner"; chmod 0600 "$lock_dir/owner"
test -d "$lock_dir" && test ! -L "$lock_dir" && test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$fence_nonce"`;

export const REMOTE_NATIVE_SESSION_FENCE_RELEASE_SCRIPT = String.raw`set -eu
task_root=$1; session_digest=$2; fence_nonce=$3
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac; test "$(printf %s "$session_digest" | wc -c)" -eq 64
case "$fence_nonce" in *[!a-f0-9-]*|"") exit 4 ;; esac
sessions_root="$task_root/.paperclip-runtime/paperclip-runner/sessions"; lock_dir="$sessions_root/.$session_digest.lock"
for directory in "$task_root" "$task_root/.paperclip-runtime" "$task_root/.paperclip-runtime/paperclip-runner" "$sessions_root" "$lock_dir"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$fence_nonce"
rm -- "$lock_dir/owner"; rmdir -- "$lock_dir"`;

/** Cleanup only a launch whose exact marker remains current. Every signal is
 * preceded by the same process-generation check used by the monitor. An absent
 * process needs no signal; live or reused PIDs still fail closed.
 */
export const REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT =
  String.raw`set -eu
failure_guard=marker_wait; trap 'rc=$?; if test "$rc" -ne 0; then printf "remote_identity_cleanup_failed:%s:%s\n" "$failure_guard" "$rc" >&2; fi' 0
identity_path=$1; expected_nonce=$2; expected_runner_id=$3; identity_check=$4; marker_wait=0
while { test ! -f "$identity_path" || test -L "$identity_path"; } && test "$marker_wait" -lt 50; do marker_wait=$((marker_wait + 1)); sleep 0.1; done
failure_guard=marker_present; test -f "$identity_path" && test ! -L "$identity_path" || exit 3
failure_guard=marker_fields
{ IFS= read -r nonce; IFS= read -r pid; IFS= read -r started_at; IFS= read -r runner_id; IFS= read -r fingerprint || true; } < "$identity_path"
test "$nonce" = "$expected_nonce" && test "$runner_id" = "$expected_runner_id" && test -n "$started_at" || exit 4
case "$pid" in ""|*[!0-9]*) exit 4 ;; esac; test "$pid" -gt 0 || exit 4; test -n "$fingerprint" || exit 4
command -v ps >/dev/null 2>&1 || exit 4
check_runner() { sh -c "$identity_check" paperclip-runner-failure-check "$identity_path" "$nonce" "$runner_id" "$pid" require-fingerprint >/dev/null 2>&1; }
failure_guard=process_observation
if check_runner; then
  failure_guard=process_session; session_id=$(ps -o sid= -p "$pid" 2>/dev/null | tr -d " ") || true; test "$session_id" = "$pid" || exit 4
  failure_guard=term_signal; kill -TERM "-$pid" 2>/dev/null || exit 5
  failure_guard=term_wait; term_wait=0; while check_runner && test "$term_wait" -lt 50; do term_wait=$((term_wait + 1)); sleep 0.1; done
  if check_runner; then
    failure_guard=kill_signal; kill -KILL "-$pid" 2>/dev/null || exit 5
    failure_guard=kill_wait; kill_wait=0; while check_runner && test "$kill_wait" -lt 50; do kill_wait=$((kill_wait + 1)); sleep 0.1; done
  fi
  if check_runner; then exit 5; else check_status=$?; test "$check_status" -eq 3 || exit 4; fi
else
  check_status=$?; failure_guard=dead_process_classification; test "$check_status" -eq 3 || exit 4
  if kill -0 "$pid" 2>/dev/null; then
    failure_guard=dead_process_state; process_state=$(awk '{ sub(/^.*\) /, ""); print $1 }' "/proc/$pid/stat") || exit 4
    test "$process_state" = Z || exit 4
  fi
fi
failure_guard=process_group; group_live=$(ps -o pid=,stat= -g "$pid" 2>/dev/null | awk '$2 !~ /^Z/ { print $1 }') || exit 4; test -z "$group_live" || exit 5
failure_guard=marker_recheck; test -f "$identity_path" && test ! -L "$identity_path" || exit 4
{ IFS= read -r final_nonce; IFS= read -r final_pid; IFS= read -r final_started_at; IFS= read -r final_runner_id; } < "$identity_path"
test "$final_nonce" = "$nonce" && test "$final_pid" = "$pid" && test "$final_started_at" = "$started_at" && test "$final_runner_id" = "$runner_id" || exit 4
failure_guard=marker_remove; rm -f -- "$identity_path"`;

/** Fixed, server-issued remote erasure command. It binds the current durable
 * runner state and process-generation marker to the exact session directory,
 * serializes erasers, stops only that recorded process, then removes only that
 * one direct child of the managed `sessions` directory. */
const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_BODY =
  String.raw`set -eu
failure_guard=target_arguments; trap 'rc=$?; if test "$rc" -ne 0; then printf "remote_erasure_failed:%s:%s\n" "$failure_guard" "$rc" >&2; fi' 0
remote_cwd=$1; session_digest=$2; expected_run_id=$3; expected_runner_id=$4; expected_lease_id=$5; expected_provider_lease_id=$6; expected_session_digest=$7; expected_pid=$8; expected_started_at=$9
cleanup_script=${"$"}{10}; identity_check=${"$"}{11}
test "$session_digest" = "$expected_session_digest"
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac
test "$(printf %s "$session_digest" | wc -c)" -eq 64
case "$expected_pid" in ""|*[!0-9]*) exit 4 ;; esac; test "$expected_pid" -gt 1; test -n "$expected_started_at"
runtime_root="$remote_cwd/.paperclip-runtime/paperclip-runner"; sessions_root="$runtime_root/sessions"; session_root="$sessions_root/$session_digest"
failure_guard=target_directories
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root" "$session_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
test "$(dirname -- "$session_root")" = "$sessions_root"
lock_dir="$sessions_root/."$session_digest".lock"; probe_nonce=$(safe_node -e 'process.stdout.write(require("node:crypto").randomUUID())'); case "$probe_nonce" in ""|*[!a-f0-9-]*) exit 4 ;; esac
failure_guard=lock_acquire; umask 077; mkdir -m 0700 -- "$lock_dir" || exit 6
cleanup() { if test -d "$lock_dir" && test ! -L "$lock_dir" && test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$probe_nonce"; then rm -- "$lock_dir/owner"; rmdir -- "$lock_dir" 2>/dev/null || true; fi; }; trap 'rc=$?; cleanup; if test "$rc" -ne 0; then printf "remote_erasure_failed:%s:%s\n" "$failure_guard" "$rc" >&2; fi' 0
printf '%s\n' "$probe_nonce" > "$lock_dir/owner"; chmod 0600 "$lock_dir/owner"; test -d "$lock_dir" && test ! -L "$lock_dir" && test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$probe_nonce"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root" "$session_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
exec 8< "$session_root"
session_handle="/proc/$$/fd/8"; test "$(readlink -f -- "$session_handle")" = "$session_root" || exit 4
state="$session_handle/runner/runner-state.json"; identity="$session_handle/runner/runner-process.identity"
failure_guard=state_files
test -d "$session_handle/runner" && test ! -L "$session_handle/runner" && test -f "$state" && test ! -L "$state" && test -f "$identity" && test ! -L "$identity" || exit 4
failure_guard=state_binding
check_state() { safe_node -e 'const fs=require("node:fs"),c=require("node:crypto");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(s.runId!==process.argv[2]||s.runnerInstanceId!==process.argv[3]||s.environmentLeaseId!==process.argv[4]||typeof s.normalizedSessionId!=="string"||c.createHash("sha256").update(s.normalizedSessionId).digest("hex")!==process.argv[5])process.exit(4)' "$state" "$expected_run_id" "$expected_runner_id" "$expected_lease_id" "$expected_session_digest"; }
check_state
failure_guard=process_marker
marker=$(cat -- "$identity"); nonce=$(sed -n '1p' "$identity"); pid=$(sed -n '2p' "$identity"); started_at=$(sed -n '3p' "$identity"); runner_id=$(sed -n '4p' "$identity"); fingerprint=$(sed -n '5p' "$identity")
case "$nonce" in ""|*[!A-Za-z0-9_-]*) exit 4 ;; esac; case "$pid" in ""|*[!0-9]*) exit 4 ;; esac
test "$pid" -gt 1 && test "$pid" = "$expected_pid" && test "$runner_id" = "$expected_runner_id" && test "$started_at" = "$expected_started_at"
case "$fingerprint" in linux:[0-9a-f-]*:[0-9]*) ;; *) exit 4 ;; esac
identity_digest=$(sha256sum "$identity" | cut -d " " -f 1); fingerprint_digest=$(printf %s "$fingerprint" | sha256sum | cut -d " " -f 1)
failure_guard=process_stop
if sh -c "$cleanup_script" paperclip-runtime-asset-erasure "$identity" "$nonce" "$expected_runner_id" "$identity_check"; then :; else stop_rc=$?; exit "$stop_rc"; fi
failure_guard=process_marker_absence
test ! -e "$identity" && test ! -L "$identity"
failure_guard=state_recheck
check_state
stopped_at=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
failure_guard=session_delete
# Immutable skill bundles may leave owner-readonly directories. Match the
# controller's scope, with no-follow directory descriptors anchored to the
# selected root. Device/mount/inode checks reject mounts and replacement races.
# The bounded walk fails closed on oversized or unexpectedly deep trees.
safe_node -e 'const fs=require("node:fs"),p=require("node:path"),root=p.resolve(process.argv[1]),C=fs.constants,held=[];
const flags=C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW;let count=0,device,mount;
const fdpath=fd=>"/proc/self/fd/"+fd;
const mountId=fd=>{const m=/^mnt_id:\s+(\d+)$/m.exec(fs.readFileSync("/proc/self/fdinfo/"+fd,"utf8"));if(!m)throw Error();return m[1]};
function openDirectory(name){const fd=fs.openSync(name,flags);held.push(fd);return fd}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino}
function visit(fd,depth){if(depth>128||++count>50000)throw Error();const stat=fs.fstatSync(fd);if(stat.dev!==device||mountId(fd)!==mount)throw Error();fs.fchmodSync(fd,(stat.mode&0o777)|0o700);
 for(const name of fs.readdirSync(fdpath(fd))){if(name==="."||name===".."||name.includes("/"))throw Error();if(++count>50000)throw Error();const entry=fdpath(fd)+"/"+name,before=fs.lstatSync(entry);if(before.dev!==device)throw Error();if(before.isDirectory()){const child=openDirectory(entry),opened=fs.fstatSync(child);if(!same(before,opened))throw Error();visit(child,depth+1);if(!same(opened,fs.lstatSync(entry)))throw Error();fs.rmdirSync(entry);fs.closeSync(child);held.splice(held.indexOf(child),1)}else{fs.unlinkSync(entry)}}}
try{let parent=openDirectory("/");const parts=root.split("/").filter(Boolean);for(const name of parts.slice(0,-1)){parent=openDirectory(fdpath(parent)+"/"+name)}const entry=fdpath(parent)+"/"+parts.at(-1),before=fs.lstatSync(entry),fd=fs.openSync(process.argv[2],C.O_RDONLY|C.O_DIRECTORY),opened=fs.fstatSync(fd);held.push(fd);if(!same(before,opened))throw Error();device=opened.dev;mount=mountId(fd);if(mountId(parent)!==mount)throw Error();visit(fd,0);if(!same(opened,fs.lstatSync(entry)))throw Error();fs.rmdirSync(entry)}catch{process.exitCode=1}finally{for(const fd of held.reverse())try{fs.closeSync(fd)}catch{}}' "$session_root" "$session_handle"
failure_guard=post_delete_check
test ! -e "$session_root" && test ! -L "$session_root"
failure_guard=receipt
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$pid" "$started_at" "$identity_digest" "$fingerprint_digest" "$stopped_at" "$expected_run_id" "$expected_provider_lease_id"`;

/** Admission-time nonsecret test for the exact remote storage profile. It
 * creates/removes one probe child while proving a neighboring child survives,
 * under the same stable session lock used by launches and erasure. */
const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_BODY = String.raw`set -eu
remote_cwd=$1; session_digest=$2; run_id=$3; probe_nonce=$4
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac; test "$(printf %s "$session_digest" | wc -c)" -eq 64
case "$run_id" in *[!a-f0-9-]*|"") exit 4 ;; esac; case "$probe_nonce" in *[!a-f0-9-]*|"") exit 4 ;; esac
test -d "$remote_cwd" && test ! -L "$remote_cwd" || exit 4
runtime_root="$remote_cwd/.paperclip-runtime/paperclip-runner"; sessions_root="$runtime_root/sessions"; umask 077
mkdir -p -- "$sessions_root"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
lock_dir="$sessions_root/."$session_digest".lock"; umask 077; mkdir -m 0700 -- "$lock_dir" || exit 6; printf '%s\n' "$probe_nonce" > "$lock_dir/owner"; chmod 0600 "$lock_dir/owner"; test -d "$lock_dir" && test ! -L "$lock_dir" && test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$probe_nonce"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
probe="$sessions_root/.asset-erasure-probe-$run_id-$probe_nonce"; neighbor="$sessions_root/.asset-erasure-neighbor-$run_id-$probe_nonce"
test ! -e "$probe" && test ! -L "$probe" && test ! -e "$neighbor" && test ! -L "$neighbor"
cleanup() { rm -rf -- "$probe" "$neighbor"; if test -d "$lock_dir" && test ! -L "$lock_dir" && test -f "$lock_dir/owner" && test ! -L "$lock_dir/owner" && test "$(cat -- "$lock_dir/owner")" = "$probe_nonce"; then rm -- "$lock_dir/owner"; rmdir -- "$lock_dir" 2>/dev/null || true; fi; }; trap cleanup EXIT
mkdir -m 0700 -- "$probe" "$neighbor"; printf '%s' "$probe_nonce" > "$neighbor/retained"
test -f "$neighbor/retained" && test ! -L "$neighbor/retained" && test "$(cat -- "$neighbor/retained")" = "$probe_nonce"
rm -rf -- "$probe"; test ! -e "$probe" && test ! -L "$probe"
test -d "$neighbor" && test ! -L "$neighbor" && test "$(cat -- "$neighbor/retained")" = "$probe_nonce"
rm -rf -- "$neighbor"; test ! -e "$neighbor" && test ! -L "$neighbor"
cleanup; trap - EXIT; printf 'qualified\n'`;

/** Image-owned executables, dynamic libraries, and startup configuration must
 * remain outside every tenant write projection. These are checked against the
 * exact signed policy as well as the current protected image/mechanism. */
export const REMOTE_NATIVE_ERASER_IMAGE_ROOTS = ["/bin", "/sbin", "/usr", "/opt", "/lib", "/lib64", "/etc"] as const;
export const REMOTE_NATIVE_ERASER_ENV = Object.freeze({
  ENV: "", BASH_ENV: "", NODE_OPTIONS: "", NODE_PATH: "", LD_PRELOAD: "", LD_LIBRARY_PATH: "",
  PYTHONPATH: "", PYTHONSTARTUP: "",
});
export function nativeRuntimeErasurePolicyIsolated(policy: SandboxPolicy): boolean {
  const within = (value: string, root: string) => root === "/" || value === root || value.startsWith(root + "/");
  return policy.process.uid > 0 && policy.process.noNewPrivileges === true && policy.process.capabilities.length === 0 &&
    policy.credentials.mode === "none" && policy.credentials.bindings.length === 0 &&
    policy.filesystem.writePaths.every(root => root === path.posix.normalize(root) &&
      !REMOTE_NATIVE_ERASER_IMAGE_ROOTS.some(image => within(root, image) || within(image, root)));
}
export function nativeRuntimeErasureEnvironmentExact(env: Record<string, string>): boolean {
  return Object.keys(env).length === Object.keys(REMOTE_NATIVE_ERASER_ENV).length &&
    Object.entries(REMOTE_NATIVE_ERASER_ENV).every(([key, value]) => env[key] === value);
}

/** Erasure executes only fixed local code in a clean environment. Resolve the
 * image's Node before clearing PATH, then accept only a root-owned executable
 * and root-owned, non-writable ancestors outside the tenant workspace. The
 * current protected image digest pins those binaries; no SDK/plugin is loaded. */
const REMOTE_NATIVE_ERASER_BINARY_GUARD = String.raw`set -eu
failure_guard=binary_profile; trap 'rc=$?; if test "$rc" -ne 0; then printf "remote_erasure_failed:%s:%s\n" "$failure_guard" "$rc" >&2; fi' 0
node_binary=$(/usr/bin/readlink -f -- "$PAPERCLIP_ERASER_NODE")
case "$node_binary" in /bin/*|/sbin/*|/usr/*|/opt/*) ;; *) exit 4 ;; esac
case "$node_binary" in "${"$"}{1-}"|"${"$"}{1-}"/*) exit 4 ;; esac
test -f "$node_binary" && test -x "$node_binary" && test ! -L "$node_binary" || exit 4
for executable in "$node_binary" /bin/sh /usr/bin/env /usr/bin/readlink /usr/bin/stat /usr/bin/sha256sum /usr/bin/cut /usr/local/sbin /usr/local/bin /usr/sbin /usr/bin /sbin /bin; do
current_binary=$(/usr/bin/readlink -f -- "$executable")
while :; do
  owner=$(/usr/bin/stat -Lc %u -- "$current_binary"); mode=$(/usr/bin/stat -Lc %a -- "$current_binary")
  test "$owner" = 0 || exit 4; case "$mode" in ""|*[!0-7]*) exit 4 ;; esac
  test "$((0$mode & 06022))" -eq 0 || exit 4
  test "$current_binary" = / && break
  current_binary=${"$"}{current_binary%/*}; test -n "$current_binary" || current_binary=/
done
done
node_binary_hash=$(/usr/bin/sha256sum -- "$node_binary" | /usr/bin/cut -d ' ' -f 1)
safe_node() {
  test "$(/usr/bin/sha256sum -- "$node_binary" | /usr/bin/cut -d ' ' -f 1)" = "$node_binary_hash" || exit 4
  "$node_binary" --no-addons --disable-proto=throw "$@"
}
`;
function isolatedRemoteEraser(body:string):string {
 const quote=(value:string)=>"'"+value.replaceAll("'",`'"'"'`)+"'";
 return `set -eu
node_binary=$(command -v node)
test -n "$node_binary"
exec /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin PAPERCLIP_ERASER_NODE="$node_binary" /bin/sh -c ${quote(REMOTE_NATIVE_ERASER_BINARY_GUARD+body.split("\n").filter(line=>!line.startsWith("#")).join("\n"))} "$0" "$@"`;
}
export const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT=isolatedRemoteEraser(REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_BODY);
export const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT=isolatedRemoteEraser(REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_BODY);
export const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROFILE_HASH=createHash("sha256").update(JSON.stringify({
 purpose:"native_runtime_asset_erasure",executionProfile:"fixed_local_eraser_v1",shell:"/bin/sh",
 script:REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT,identityCleanup:REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT,
 identityCheck:REMOTE_RUNNER_IDENTITY_CHECK_SCRIPT,stdin:"",env:REMOTE_NATIVE_ERASER_ENV,imageRoots:REMOTE_NATIVE_ERASER_IMAGE_ROOTS,
})).digest("hex");
