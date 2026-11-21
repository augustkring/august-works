// Fixed read-only CI observer; no tenant modules, subprocesses, signals or writes.
import { readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const stages = new Set(["initial_deadline", "uid_api_unavailable", "process_deadline", "process_directory_stat",
  "process_state_read", "cwd_readlink", "fd_directory_list", "fd_deadline", "fd_readlink", "proc_list_or_outer"]);
const errnos = new Set(["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL"]);
function validInput(input, transportUid, now) {
  const absolute = value => typeof value === "string" && value.length <= 1024 && value !== "/" &&
    !value.includes("\0") && !value.includes("\n") && !value.includes("\r") &&
    posix.isAbsolute(value) && posix.normalize(value) === value;
  return input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).sort().join(",") === "deadlineAt,observerUid,schema,sessionDigest,taskRoot,upperDir" &&
    input.schema === "paperclip.fixture.native-session-handles.v1" && absolute(input.taskRoot) && absolute(input.upperDir) &&
    typeof input.sessionDigest === "string" && /^[a-f0-9]{64}$/.test(input.sessionDigest) && Number.isSafeInteger(transportUid) && transportUid > 0 &&
    input.observerUid === transportUid && Number.isSafeInteger(input.deadlineAt) && input.deadlineAt > now;
}
function scanSessionHandles(input, trustedUid, io = { readFileSync, readdirSync, readlinkSync, statSync }, now = Date.now) {
  const startedAt = now(), deadlineMs = input.deadlineAt;
  const source = join(input.taskRoot, ".paperclip-runtime", "paperclip-runner", "sessions", input.sessionDigest);
  const upper = join(input.upperDir, source.slice(1));
  let numericPidsScanned = 0, sameUidProcesses = 0, nonZombieProcesses = 0, fdEntriesScanned = 0;
  const failed = (stage, error) => {
    const code = error && typeof error === "object" ? error.code : null;
    const time = now();
    return { holders: null, complete: false, failure: { stage: stages.has(stage) ? stage : "proc_list_or_outer",
      errno: code == null ? null : errnos.has(code) ? code : "OTHER", elapsedMs: Math.max(0, time - startedAt),
      deadlineRemainingMs: Math.trunc(deadlineMs - time), numericPidsScanned, sameUidProcesses, nonZombieProcesses, fdEntriesScanned } };
  };
  if (now() >= deadlineMs) return failed("initial_deadline");
  let holders = 0;
  const within = value => value === source || value.startsWith(`${source}/`) || value === upper || value.startsWith(`${upper}/`);
  try {
    for (const entry of io.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      if (now() >= deadlineMs) return failed("process_deadline");
      numericPidsScanned++;
      const proc = join("/proc", entry);
      let metadata;
      try { metadata = io.statSync(proc); } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") continue;
        return failed("process_directory_stat", error);
      }
      if (metadata.uid !== trustedUid) continue;
      sameUidProcesses++;
      let state;
      try {
        const text = io.readFileSync(join(proc, "stat"), "utf8"), close = text.lastIndexOf(") ");
        state = close >= 0 ? text.slice(close + 2).trim().split(/\s+/)[0] ?? "" : "";
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") continue;
        return failed("process_state_read", error);
      }
      if (state === "Z") continue;
      nonZombieProcesses++;
      try { if (within(io.readlinkSync(join(proc, "cwd")))) holders++; } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") return failed("cwd_readlink", error);
      }
      let fds;
      try { fds = io.readdirSync(join(proc, "fd")); } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") continue;
        return failed("fd_directory_list", error);
      }
      for (const fd of fds) {
        if (now() >= deadlineMs) return failed("fd_deadline");
        fdEntriesScanned++;
        try { if (within(io.readlinkSync(join(proc, "fd", fd)))) holders++; } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ESRCH") return failed("fd_readlink", error);
        }
      }
    }
    return { holders, complete: true };
  } catch (error) { return failed("proc_list_or_outer", error); }
}
// Only bounded stdin is parsed; no paths or exception text are returned.
let bytes = 0, chunks = [];
process.stdin.on("data", chunk => {
  bytes += chunk.length;
  if (bytes > 4096) { process.exitCode = 126; process.stdin.destroy(); return; }
  chunks.push(chunk);
});
process.stdin.on("error", () => { process.exitCode = 126; });
process.stdin.on("end", () => {
  if (process.exitCode) return;
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const transport = process.env.PAPERCLIP_FIXTURE_ORIGINAL_UID;
    const trustedUid = typeof transport === "string" && /^[1-9][0-9]{0,9}$/.test(transport) ? Number(transport) : NaN;
    if (process.argv.length !== 2 || typeof process.getuid !== "function" || process.getuid() !== 0 ||
        !validInput(input, trustedUid, Date.now())) { process.exitCode = 126; return; }
    const output = JSON.stringify(scanSessionHandles(input, trustedUid));
    if (Buffer.byteLength(output) > 8192) { process.exitCode = 126; return; }
    process.stdout.write(output + "\n");
  } catch { process.exitCode = 126; }
});
