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
 * preceded by the same process-generation check used by the monitor, and a
 * zombie, exited process, or reused PID is treated as already stopped.
 */
export const REMOTE_RUNNER_FAILED_IDENTITY_CLEANUP_SCRIPT =
  'set -eu; identity_path=$1; expected_nonce=$2; expected_runner_id=$3; identity_check=$4; marker_wait=0; while { test ! -f "$identity_path" || test -L "$identity_path"; } && test "$marker_wait" -lt 50; do marker_wait=$((marker_wait + 1)); sleep 0.1; done; test -f "$identity_path" && test ! -L "$identity_path" || exit 3; { IFS= read -r nonce; IFS= read -r pid; IFS= read -r started_at; IFS= read -r runner_id; } < "$identity_path"; test "$nonce" = "$expected_nonce" && test "$runner_id" = "$expected_runner_id" && test -n "$started_at" || exit 4; case "$pid" in ""|*[!0-9]*) exit 4 ;; esac; test "$pid" -gt 0 || exit 4; command -v ps >/dev/null 2>&1 || exit 4; session_id=$(ps -o sid= -p "$pid" 2>/dev/null | tr -d " ") || true; test "$session_id" = "$pid" || exit 4; check_runner() { sh -c "$identity_check" paperclip-runner-failure-check "$identity_path" "$nonce" "$runner_id" "$pid" require-fingerprint >/dev/null 2>&1; }; if check_runner; then kill -TERM "-$pid" 2>/dev/null || exit 5; term_wait=0; while check_runner && test "$term_wait" -lt 50; do term_wait=$((term_wait + 1)); sleep 0.1; done; if check_runner; then kill -KILL "-$pid" 2>/dev/null || exit 5; kill_wait=0; while check_runner && test "$kill_wait" -lt 50; do kill_wait=$((kill_wait + 1)); sleep 0.1; done; fi; if check_runner; then exit 5; else check_status=$?; test "$check_status" -eq 3 || exit 4; fi; else check_status=$?; test "$check_status" -eq 3 || exit 4; fi; group_live=$(ps -o pid=,stat= -g "$pid" 2>/dev/null | awk \'$2 !~ /^Z/ { print $1 }\') || exit 4; test -z "$group_live" || exit 5; test -f "$identity_path" && test ! -L "$identity_path" || exit 4; { IFS= read -r final_nonce; IFS= read -r final_pid; IFS= read -r final_started_at; IFS= read -r final_runner_id; } < "$identity_path"; test "$final_nonce" = "$nonce" && test "$final_pid" = "$pid" && test "$final_started_at" = "$started_at" && test "$final_runner_id" = "$runner_id" || exit 4; rm -f -- "$identity_path"';

/** Fixed, server-issued remote erasure command. It binds the current durable
 * runner state and process-generation marker to the exact session directory,
 * serializes erasers, stops only that recorded process, then removes only that
 * one direct child of the managed `sessions` directory. */
export const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT =
  String.raw`set -eu
remote_cwd=$1; session_digest=$2; expected_run_id=$3; expected_runner_id=$4; expected_lease_id=$5; expected_provider_lease_id=$6; expected_session_digest=$7
test "$session_digest" = "$expected_session_digest"
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac
test "$(printf %s "$session_digest" | wc -c)" -eq 64
runtime_root="$remote_cwd/.paperclip-runtime/paperclip-runner"; sessions_root="$runtime_root/sessions"; session_root="$sessions_root/$session_digest"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root" "$session_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
test "$(dirname -- "$session_root")" = "$sessions_root"
lock_dir="$sessions_root/."$session_digest".lock"; umask 077; mkdir -m 0700 -- "$lock_dir" || exit 6; trap 'rmdir -- "$lock_dir" 2>/dev/null || true' EXIT; test -d "$lock_dir" && test ! -L "$lock_dir"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root" "$session_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
state="$session_root/runner/runner-state.json"; identity="$session_root/runner/runner-process.identity"
test -d "$session_root/runner" && test ! -L "$session_root/runner" && test -f "$state" && test ! -L "$state" && test -f "$identity" && test ! -L "$identity" || exit 4
check_state() { node -e 'const fs=require("node:fs"),c=require("node:crypto");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(s.runId!==process.argv[2]||s.runnerInstanceId!==process.argv[3]||s.environmentLeaseId!==process.argv[4]||typeof s.normalizedSessionId!=="string"||c.createHash("sha256").update(s.normalizedSessionId).digest("hex")!==process.argv[5])process.exit(4)' "$state" "$expected_run_id" "$expected_runner_id" "$expected_lease_id" "$expected_session_digest"; }
check_state
marker=$(cat -- "$identity"); nonce=$(sed -n '1p' "$identity"); pid=$(sed -n '2p' "$identity"); started_at=$(sed -n '3p' "$identity"); runner_id=$(sed -n '4p' "$identity"); fingerprint=$(sed -n '5p' "$identity")
case "$nonce" in ""|*[!A-Za-z0-9_-]*) exit 4 ;; esac; case "$pid" in ""|*[!0-9]*) exit 4 ;; esac
test "$pid" -gt 1 && test "$runner_id" = "$expected_runner_id" && test -n "$started_at"
case "$fingerprint" in linux:[0-9a-f-]*:[0-9]*) ;; *) exit 4 ;; esac
identity_digest=$(sha256sum "$identity" | cut -d " " -f 1); fingerprint_digest=$(printf %s "$fingerprint" | sha256sum | cut -d " " -f 1)
sh -c "$8" paperclip-runtime-asset-erasure "$identity" "$nonce" "$expected_runner_id" "$9"
test ! -e "$identity" && test ! -L "$identity"; check_state
stopped_at=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"); rm -rf -- "$session_root"
test ! -e "$session_root" && test ! -L "$session_root"
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$pid" "$started_at" "$identity_digest" "$fingerprint_digest" "$stopped_at" "$expected_run_id" "$expected_provider_lease_id"`;

/** Admission-time nonsecret test for the exact remote storage profile. It
 * creates/removes one probe child while proving a neighboring child survives,
 * under the same stable session lock used by launches and erasure. */
export const REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_PROBE_SCRIPT = String.raw`set -eu
remote_cwd=$1; session_digest=$2; run_id=$3; probe_nonce=$4
case "$session_digest" in *[!a-f0-9]*|"") exit 4 ;; esac; test "$(printf %s "$session_digest" | wc -c)" -eq 64
case "$run_id" in *[!a-f0-9-]*|"") exit 4 ;; esac; case "$probe_nonce" in *[!a-f0-9-]*|"") exit 4 ;; esac
test -d "$remote_cwd" && test ! -L "$remote_cwd" || exit 4
runtime_root="$remote_cwd/.paperclip-runtime/paperclip-runner"; sessions_root="$runtime_root/sessions"; umask 077
mkdir -p -- "$sessions_root"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
lock_dir="$sessions_root/."$session_digest".lock"; umask 077; mkdir -m 0700 -- "$lock_dir" || exit 6; trap 'rmdir -- "$lock_dir" 2>/dev/null || true' EXIT; test -d "$lock_dir" && test ! -L "$lock_dir"
for directory in "$remote_cwd" "$remote_cwd/.paperclip-runtime" "$runtime_root" "$sessions_root"; do test -d "$directory" && test ! -L "$directory" || exit 4; done
probe="$sessions_root/.asset-erasure-probe-$run_id-$probe_nonce"; neighbor="$sessions_root/.asset-erasure-neighbor-$run_id-$probe_nonce"
test ! -e "$probe" && test ! -L "$probe" && test ! -e "$neighbor" && test ! -L "$neighbor"
cleanup() { rm -rf -- "$probe" "$neighbor"; }; trap cleanup EXIT
mkdir -m 0700 -- "$probe" "$neighbor"; printf '%s' "$probe_nonce" > "$neighbor/retained"
test -f "$neighbor/retained" && test ! -L "$neighbor/retained" && test "$(cat -- "$neighbor/retained")" = "$probe_nonce"
rm -rf -- "$probe"; test ! -e "$probe" && test ! -L "$probe"
test -d "$neighbor" && test ! -L "$neighbor" && test "$(cat -- "$neighbor/retained")" = "$probe_nonce"
rm -rf -- "$neighbor"; test ! -e "$neighbor" && test ! -L "$neighbor"
trap - EXIT; printf 'qualified\n'`;
