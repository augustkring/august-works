import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, lstatSync, readFileSync, readdirSync, readlinkSync, readSync, realpathSync, statSync } from "node:fs";
import type { ReadStream } from "node:fs";
import type { Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

export type ModelProviderObservation = { token: string; capabilityHash: string; expiresAt: string;
  imageSha256: string; imageBytes: number; manifestDigest: string; runPid: number | null; runStartedAt: string | null };
export type SignedModelOrigin = { runId: string; leaseId: string; sessionKey: string; markerPath: string;
  nonce: string; runnerInstanceId: string; currentProvider: () => Promise<ModelProviderObservation> };
export type ModelChannel = { readonly runId: string; readonly leaseId: string; readonly sessionKey: string;
  authorization: () => Promise<string>; close: () => void };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const transient = (error: unknown) => ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");
const checked = (condition: unknown) => { if (!condition) throw new Error("model_channel_observation_unavailable"); };
const identityFailurePhases = ["pid_invalid", "status_read", "status_shape", "uid_mismatch", "stat_read", "stat_shape",
  "zombie", "parent_invalid", "start_invalid"] as const;
const identityObservationRoles = ["runner", "socket_ancestry", "ancestry_recheck"] as const;
const identityFailures = new WeakMap<object, { phase: typeof identityFailurePhases[number];
  role: typeof identityObservationRoles[number] }>();
const socketOwnerObserverStages = ["table_open", "table_read", "tuple", "proc_list", "process_directory_stat", "process_state_read",
  "fd_directory_list", "fd_readlink", "owner_count", "memory_bound"] as const;
const socketOwnerFailurePhases = ["input_endpoint", "self_image", "helpers_before", "invoke", "response_status", "response_decode",
  "response_shape", "observer_incomplete", "complete_shape", "helpers_after", "socket_recheck"] as const;
const socketOwnerObserverFailures = new WeakMap<object, { phase: typeof socketOwnerFailurePhases[number];
  stage?: typeof socketOwnerObserverStages[number]; deadlineExpired: boolean }>();
function modelIdentityFailureFacts(error: unknown) {
  const identityFailure = error && typeof error === "object" ? identityFailures.get(error) : undefined;
  const observerFailure = error && typeof error === "object" ? socketOwnerObserverFailures.get(error) : undefined;
  return {
    ...(identityFailure && identityFailurePhases.some(value => value === identityFailure.phase) &&
      identityObservationRoles.some(value => value === identityFailure.role)
      ? { identityFailurePhase: identityFailure.phase, identityObservationRole: identityFailure.role } : {}),
    ...(observerFailure && socketOwnerFailurePhases.some(value => value === observerFailure.phase)
      ? { socketOwnerFailurePhase: observerFailure.phase, socketOwnerDeadlineExpired: observerFailure.deadlineExpired,
        ...(observerFailure.stage && socketOwnerObserverStages.some(value => value === observerFailure.stage)
          ? { socketOwnerObserverStage: observerFailure.stage } : {}) } : {}),
  };
}
/** /proc directory ownership can change with dumpability. Credential UID
 * fields remain the authority; all four must match the current observer. */
function processUidStatus(status: string, pid: number, uid: number | undefined) {
  checked(typeof status === "string" && Buffer.byteLength(status) > 0 && Buffer.byteLength(status) <= 64 * 1024 && status.endsWith("\n"));
  const pidRows = status.match(/^Pid:[^\n]*$/gm) ?? [], uidRows = status.match(/^Uid:[^\n]*$/gm) ?? [];
  checked(pidRows.length === 1 && uidRows.length === 1);
  const actualPid = /^Pid:[ \t]+([0-9]+)$/.exec(pidRows[0]!);
  const values = /^Uid:[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+([0-9]+)$/.exec(uidRows[0]!);
  checked(actualPid && Number.isSafeInteger(Number(actualPid[1])) && Number(actualPid[1]) === pid && values);
  checked(Number.isSafeInteger(uid) && uid! >= 0 && values!.slice(1).every(value =>
    Number.isSafeInteger(Number(value)) && Number(value) === uid));
}

function processIdentity(pid: number, role: typeof identityObservationRoles[number]) {
  let phase: typeof identityFailurePhases[number] = "pid_invalid";
  try {
    checked(Number.isSafeInteger(pid) && pid > 0);
    phase = "status_read";
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    phase = "status_shape";
    // Validate the same requested PID and all real/effective/saved/fs UIDs.
    // No root-owned proc directory or partial credential row grants a match.
    const uidRows = status.match(/^Uid:[^\n]*$/gm) ?? [];
    if (uidRows.length === 1 && /^Uid:[ \t]+[0-9]+[ \t]+[0-9]+[ \t]+[0-9]+[ \t]+[0-9]+$/.test(uidRows[0]!)) phase = "uid_mismatch";
    processUidStatus(status, pid, process.getuid?.());
    phase = "stat_read";
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8"), end = raw.lastIndexOf(") ");
    phase = "stat_shape";
    checked(end > 0); const fields = raw.slice(end + 2).trim().split(/\s+/);
    phase = fields[0] === "Z" ? "zombie" : !/^\d+$/.test(fields[1] ?? "") ? "parent_invalid" : "start_invalid";
    checked(fields[0] !== "Z" && /^\d+$/.test(fields[1] ?? "") && /^\d+$/.test(fields[19] ?? ""));
    return { pid, parent: Number(fields[1]), start: fields[19]! };
  } catch (error) {
    if (error && typeof error === "object") identityFailures.set(error, { phase, role });
    throw error;
  }
}
/** Kernel primitive controls only; no model, Run or caller authority. */
export const managedModelProcessIdentityControls = Object.freeze({ processIdentity, processUidStatus });

function endpoint(address: string | undefined, port: number | undefined) {
  checked(address === "127.0.0.1" && Number.isInteger(port) && port! > 0 && port! <= 65535);
  return `0100007F:${port!.toString(16).padStart(4, "0").toUpperCase()}`;
}
// CI-only fixed operation; a live model origin is still authorized by observation() below.
function privilegedSocketOwner(client: Socket, until: number) {
  let phase: typeof socketOwnerFailurePhases[number] = "input_endpoint";
  let observerStage: typeof socketOwnerObserverStages[number] | undefined;
  try {
  const launcher = "/usr/local/libexec/paperclip-fixture-observers/native-model-socket-v1";
  const scanner = `${launcher}.mjs`;
  const node = "/usr/local/libexec/paperclip-erasure-test-node/node";
  const observerUid = process.getuid?.();
  checked(!client.destroyed && Number.isSafeInteger(observerUid) && (observerUid ?? 0) > 0 && Date.now() < until);
  const local = endpoint(client.remoteAddress, client.remotePort), remote = endpoint(client.localAddress, client.localPort);
  phase = "self_image";
  const fileHash = (file: string, limit: number) => {
    const fd = openSync(file, "r");
    try {
      const before = fstatSync(fd); checked(before.isFile() && before.size > 0 && before.size <= limit);
      const digest = createHash("sha256"), chunk = Buffer.allocUnsafe(64 * 1024); let total = 0;
      while (true) {
        checked(Date.now() < until);
        const bytes = readSync(fd, chunk, 0, chunk.length, null); if (bytes === 0) break;
        total += bytes; checked(total <= limit); digest.update(chunk.subarray(0, bytes));
      }
      const after = fstatSync(fd);
      checked(total === before.size && before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
        before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs);
      return digest.digest("hex");
    } finally { closeSync(fd); }
  };
  // Bind the fixed root-owned Node to the actual trusted fixture process image, not an ambient path/hash variable.
  const expectedNodeHash = fileHash("/proc/self/exe", 256 * 1024 * 1024);
  const qualification = () => {
    const identities: unknown[] = [];
    for (const [file, expectedHash] of [[launcher, "ef02d5bc28b9886840627269d2bd5aa29bdc7b0582b939556c469db785461079"], [scanner, "5907972e9bd2b8269142c04d38ab3e713df92d5e8bbeee9930fae1d4605389f2"],
      [node, expectedNodeHash], ["/usr/bin/sudo", null], ["/usr/bin/env", null], ["/usr/bin/id", null], ["/bin/sh", null]] as const) {
      const resolved = realpathSync(file), entry = lstatSync(file), metadata = lstatSync(resolved);
      checked(entry.uid === 0 && (entry.isSymbolicLink() || (entry.mode & 0o22) === 0));
      for (let parent = dirname(file); ; parent = dirname(parent)) {
        const ancestor = lstatSync(parent); checked(ancestor.uid === 0 && (ancestor.isSymbolicLink() || (ancestor.mode & 0o6022) === 0));
        if (parent === "/") break;
      }
      const forbidden = file === "/usr/bin/sudo" ? 0o2022 : 0o6022;
      checked(metadata.isFile() && !metadata.isSymbolicLink() && metadata.uid === 0 && (metadata.mode & forbidden) === 0 &&
        (file === scanner || (metadata.mode & 0o111) !== 0));
      if (file === launcher || file === scanner || file === node) checked(resolved === file);
      for (let current = resolved; ; current = dirname(current)) {
        const ancestor = lstatSync(current);
        checked(!ancestor.isSymbolicLink() && ancestor.uid === 0 && (ancestor.mode & (current === resolved ? forbidden : 0o6022)) === 0);
        if (current === "/") break;
      }
      if (expectedHash) checked(fileHash(file, file === node ? 256 * 1024 * 1024 : 32 * 1024) === expectedHash);
      identities.push({ file, resolved, dev: metadata.dev, ino: metadata.ino, size: metadata.size,
        mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs, mode: metadata.mode, uid: metadata.uid, gid: metadata.gid });
    }
    return JSON.stringify(identities);
  };
  phase = "helpers_before";
  const before = qualification();
  phase = "invoke";
  const request = JSON.stringify({ schema: "paperclip.fixture.native-model-socket.v1", observerUid,
    localPort: client.remotePort, remotePort: client.localPort, deadlineAt: until });
  checked(Buffer.byteLength(request) <= 4096 && !client.destroyed && Date.now() < until);
  const result = spawnSync("/usr/bin/sudo", ["-n", "--", launcher], { input: request, encoding: "utf8", cwd: "/",
    env: { PATH: "/usr/bin:/bin" }, timeout: Math.max(1, until - Date.now()), maxBuffer: 8192 });
  phase = "response_status";
  checked(!result.error && !result.signal && result.status === 0 && result.stderr === "" &&
    typeof result.stdout === "string" && Buffer.byteLength(result.stdout) <= 8192 && Date.now() < until);
  phase = "response_decode";
  const response: unknown = JSON.parse(result.stdout);
  phase = "response_shape";
  checked(response && typeof response === "object" && !Array.isArray(response));
  const value = response as Record<string, unknown>;
  checked(Number.isSafeInteger(value.observerMaxRssBytes) && (value.observerMaxRssBytes as number) > 0 &&
    (value.observerMaxRssBytes as number) <= 80 * 1024 * 1024);
  if (value.complete === false) {
    phase = "observer_incomplete";
    const errnos = ["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL", "OTHER"];
    checked(Object.keys(value).sort().join(",") === "complete,errno,observerMaxRssBytes,stage" && typeof value.stage === "string" && socketOwnerObserverStages.includes(value.stage as typeof socketOwnerObserverStages[number]) &&
      (value.errno === null || typeof value.errno === "string" && errnos.includes(value.errno)));
    observerStage = value.stage as typeof socketOwnerObserverStages[number];
    throw Object.assign(new Error("model_channel_observation_unavailable"), { code: value.errno ?? "OTHER" });
  }
  phase = "complete_shape";
  checked(value.complete === true && Object.keys(value).sort().join(",") === "complete,inode,local,observerMaxRssBytes,pid,remote" &&
    Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && typeof value.inode === "string" && /^[1-9]\d*$/.test(value.inode) &&
    value.local === local && value.remote === remote);
  phase = "helpers_after";
  checked(qualification() === before && !client.destroyed && Date.now() < until);
  phase = "socket_recheck";
  checked(endpoint(client.remoteAddress, client.remotePort) === local && endpoint(client.localAddress, client.localPort) === remote);
  return { pid: value.pid as number, inode: value.inode as string, local, remote };
  } catch (error) {
    if (error && typeof error === "object") socketOwnerObserverFailures.set(error, { phase, deadlineExpired: Date.now() >= until, ...(observerStage ? { stage: observerStage } : {}) });
    throw error;
  }
}

function socketOwner(client: Socket, until: number) {
  if (process.env.PAPERCLIP_TEST_PRIVILEGED_MODEL_SOCKET_OBSERVER === "1") return privilegedSocketOwner(client, until);
  checked(!client.destroyed);
  const local = endpoint(client.remoteAddress, client.remotePort), remote = endpoint(client.localAddress, client.localPort);
  const fd = openSync("/proc/net/tcp", "r"), chunks: Buffer[] = []; let total = 0;
  try {
    while (true) {
      checked(Date.now() < until && total <= 8 * 1024 * 1024);
      const chunk = Buffer.allocUnsafe(64 * 1024), bytes = readSync(fd, chunk, 0, chunk.length, null);
      if (bytes === 0) break; total += bytes; checked(total <= 8 * 1024 * 1024); chunks.push(chunk.subarray(0, bytes));
    }
  } finally { closeSync(fd); }
  const rows = Buffer.concat(chunks, total).toString("utf8").split("\n").slice(1).map(row => row.trim().split(/\s+/))
    .filter(fields => fields[1] === local && fields[2] === remote && fields[3] === "01");
  checked(rows.length === 1 && /^[1-9]\d*$/.test(rows[0]?.[9] ?? "")); const inode = rows[0]![9]!;
  const owners = new Set<number>(); let visited = 0;
  for (const pidText of readdirSync("/proc")) {
    if (!/^\d+$/.test(pidText)) continue;
    checked(Date.now() < until && ++visited <= 8192);
    const pid = Number(pidText);
    try {
      if (statSync(`/proc/${pid}`).uid !== process.getuid?.()) continue;
      const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (raw.slice(raw.lastIndexOf(") ") + 2).split(/\s+/)[0] === "Z") continue;
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        checked(Date.now() < until && ++visited <= 131072);
        try { if (readlinkSync(`/proc/${pid}/fd/${fd}`) === `socket:[${inode}]`) owners.add(pid); }
        catch (error) { if (!transient(error)) throw error; }
      }
    } catch (error) { if (!transient(error)) throw error; }
  }
  checked(owners.size === 1); return { pid: [...owners][0]!, inode, local, remote };
}
type ImageHandle = { fd: number; stream: ReadStream; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
async function observation(client: Socket, origin: SignedModelOrigin, image: ModelProviderObservation, until: number,
  imageHandle?: ImageHandle) {
  checked(Date.now() < until && /^[a-f0-9]{64}$/.test(image.imageSha256) &&
    Number.isSafeInteger(image.imageBytes) && image.imageBytes > 0 && image.imageBytes <= 512 * 1024 * 1024);
  const markerStat = lstatSync(origin.markerPath);
  checked(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.size > 0 && markerStat.size <= 2048);
  const marker = readFileSync(origin.markerPath, "utf8").split(/\r?\n/);
  // The caller separately binds this exact path/nonce to its actual signed start.
  checked(markerStat.isFile() && marker[0] === origin.nonce && marker[3] === origin.runnerInstanceId &&
    /^[1-9]\d*$/.test(marker[1] ?? "") && /^linux:[a-f0-9-]+:\d+$/.test(marker[4] ?? ""));
  const root = processIdentity(Number(marker[1]), "runner");
  const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  checked(marker[4] === `linux:${boot}:${root.start}`);
  checked((image.runPid === null || image.runPid === root.pid) &&
    (image.runStartedAt === null || image.runStartedAt === marker[2]));
  const argv = readFileSync(`/proc/${root.pid}/cmdline`, "utf8").split("\0");
  checked(argv.includes("--runner-id") && argv.includes(origin.runnerInstanceId));
  const owner = socketOwner(client, until), ancestry: Array<ReturnType<typeof processIdentity>> = [];
  let pid = owner.pid;
  for (let depth = 0; depth < 32; depth++) {
    checked(Date.now() < until && !ancestry.some(item => item.pid === pid));
    const observed = processIdentity(pid, "socket_ancestry");
    const entry = pid === root.pid ? { ...observed, parent: 0 } : observed; ancestry.push(entry);
    if (pid === root.pid) break;
    pid = entry.parent;
  }
  checked(ancestry.at(-1)?.pid === root.pid);
  const ownsImageHandle = imageHandle === undefined;
  const executable = imageHandle?.fd ?? openSync(`/proc/${owner.pid}/exe`, "r");
  let ownedStream: ReadStream | undefined;
  try {
    checked(!imageHandle?.stream.destroyed);
    const before = fstatSync(executable); checked(before.isFile() && before.size === image.imageBytes);
    if (!imageHandle) {
      const digest = createHash("sha256");
      const stream = createReadStream("/proc/self/fd/" + executable, { fd: executable, autoClose: false,
        start: 0, end: before.size - 1, highWaterMark: 1024 * 1024 });
      ownedStream = stream;
      let bytes = 0;
      for await (const chunk of stream) { checked(Date.now() < until); digest.update(chunk); bytes += chunk.length; }
      checked(!stream.destroyed);
      checked(bytes === before.size && digest.digest("hex") === image.imageSha256);
    } else checked(before.dev === imageHandle.dev && before.ino === imageHandle.ino && before.size === imageHandle.size &&
      before.mtimeMs === imageHandle.mtimeMs && before.ctimeMs === imageHandle.ctimeMs);
    const after = fstatSync(executable), current = statSync(`/proc/${owner.pid}/exe`);
    checked(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
      current.dev === before.dev && current.ino === before.ino && current.size === before.size);
    imageHandle ??= { fd: executable, stream: ownedStream!, dev: before.dev, ino: before.ino, size: before.size,
      mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs };
  checked(JSON.stringify(ancestry.map(item => {
    const observed = processIdentity(item.pid, "ancestry_recheck"); return item.pid === root.pid ? { ...observed, parent: 0 } : observed;
  })) === JSON.stringify(ancestry));
  checked(JSON.stringify(socketOwner(client, until)) === JSON.stringify(owner));
  const markerAfter = lstatSync(origin.markerPath);
  checked(markerAfter.dev === markerStat.dev && markerAfter.ino === markerStat.ino && markerAfter.size === markerStat.size &&
    markerAfter.isFile() && !markerAfter.isSymbolicLink());
  checked(readFileSync(origin.markerPath, "utf8").split(/\r?\n/).slice(0, 5).join("\n") === marker.slice(0, 5).join("\n"));
  return { proof: { root: { pid: root.pid, start: root.start }, owner, ancestry,
    executableIdentity: { dev: imageHandle.dev, ino: imageHandle.ino, size: imageHandle.size }, fingerprint: marker[4] }, imageHandle };
  } catch (error) { if (ownsImageHandle) { if (ownedStream) ownedStream.destroy(); else closeSync(executable); } throw error; }
}
/** Connection observation only. It never issues a JWT or accepts a body Run. */
export async function attestNativeModelClient(client: Socket, origin: SignedModelOrigin): Promise<ModelChannel | null> {
  let handle: ImageHandle | undefined;
  let closed = false;
  const close = () => { if (closed) return; closed = true; if (handle) handle.stream.destroy(); };
  try {
    const initial = await origin.currentProvider();
    checked(hash(initial.token) === initial.capabilityHash && Date.parse(initial.expiresAt) > Date.now());
    const first = await observation(client, origin, initial, Date.now() + 10_000); handle = first.imageHandle;
    const channel = Object.freeze({ runId: origin.runId, leaseId: origin.leaseId, sessionKey: origin.sessionKey, close,
      authorization: async () => {
        try {
          checked(!closed);
          const current = await origin.currentProvider();
          checked(current.capabilityHash === initial.capabilityHash && current.expiresAt === initial.expiresAt &&
            current.manifestDigest === initial.manifestDigest && current.imageSha256 === initial.imageSha256 &&
            current.imageBytes === initial.imageBytes && hash(current.token) === initial.capabilityHash && Date.parse(current.expiresAt) > Date.now());
          const observed = await observation(client, origin, current, Date.now() + 3000, handle);
          checked(!closed && JSON.stringify(observed.proof) === JSON.stringify(first.proof));
          // Observation can yield while a real Stop/refresh/expiry commits.
          // Read the SAME origin again after it and immediately before return.
          const final = await origin.currentProvider();
          checked(!closed && final.capabilityHash === initial.capabilityHash && final.expiresAt === initial.expiresAt &&
            final.manifestDigest === initial.manifestDigest && final.imageSha256 === initial.imageSha256 &&
            final.imageBytes === initial.imageBytes && hash(final.token) === initial.capabilityHash && Date.parse(final.expiresAt) > Date.now());
          return `Bearer ${final.token}`;
        } catch (error) { close(); throw error; }
      } });
    await channel.authorization();
    return channel;
  } catch (error) {
    close();
    try {
      if (process.env.PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS === "1") {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        const errno = typeof code === "string" &&
          ["ENOENT", "ESRCH", "EACCES", "EPERM", "EBADF", "EIO", "ENOTDIR", "ELOOP", "EMFILE", "ENFILE", "EINVAL", "ETIMEDOUT", "EPIPE"].includes(code)
          ? code : "OTHER";
        const stack = error instanceof Error ? error.stack : undefined;
        const frameClass = typeof stack === "string"
          ? stack.split("\n").slice(1).map(line => /^\s*at (?:async )?(socketOwner|processIdentity|observation)(?:\s|\()/.exec(line)?.[1])
            .find(frame => frame !== undefined) ?? "other"
          : "other";
        console.info("managed_native_model_transport_observation_failed", JSON.stringify({ errno, frameClass, ...modelIdentityFailureFacts(error) }));
      }
    } catch { /* Diagnostics cannot change the closed, unauthorized result. */ }
    return null;
  }
}

export type ManagedModelTunnel = { channel: ModelChannel; client: Socket; upstream: Socket; retired: boolean; tuple: string };
/** The existing fixture's ephemeral TCP/TLS association owner, factored so its
 * actual stale-socket/key-reuse behavior is tested without a Host admission. */
export function createManagedModelTunnelAssociations(expectedOrigin: string) {
  const expectedHost = new URL(expectedOrigin).host;
  const tunnels = new Map<string, ManagedModelTunnel>();
  const tlsOrigins = new WeakMap<object, ManagedModelTunnel | null>();
  const tuple = (sourceAddress?: string, sourcePort?: number, destinationAddress?: string, destinationPort?: number) =>
    sourceAddress === "127.0.0.1" && destinationAddress === "127.0.0.1" &&
      Number.isInteger(sourcePort) && sourcePort! > 0 && sourcePort! <= 65535 &&
      Number.isInteger(destinationPort) && destinationPort! > 0 && destinationPort! <= 65535
      ? `${sourceAddress}:${sourcePort}>${destinationAddress}:${destinationPort}` : null;
  const retire = (entry: ManagedModelTunnel) => {
    if (entry.retired) return; entry.retired = true;
    if (tunnels.get(entry.tuple) === entry) tunnels.delete(entry.tuple);
    entry.channel.close(); entry.client.destroy(); entry.upstream.destroy();
  };
  return {
    register: (client: Socket, upstream: Socket, channel: ModelChannel) => {
      const key = tuple(upstream.localAddress, upstream.localPort, upstream.remoteAddress, upstream.remotePort);
      if (!key || tunnels.has(key)) throw new Error("serial_model_duplicate_or_unknown_tuple");
      const entry = { channel, client, upstream, retired: false, tuple: key };
      tunnels.set(key, entry); return entry;
    },
    observeTls: (socket: Socket) => {
      // Even an unbound TLS object is permanently classified. Never retag it
      // when a later connection reuses its former network tuple.
      if (tlsOrigins.has(socket)) return;
      const key = tuple(socket.remoteAddress, socket.remotePort, socket.localAddress, socket.localPort);
      const entry = key ? tunnels.get(key) ?? null : null;
      tlsOrigins.set(socket, entry);
      if (entry) socket.once("close", () => retire(entry));
    },
    authorization: async (socket: Socket, request: { method: string; path: string; url: string; host?: string; authorization?: string }) => {
      if (request.method !== "POST" || request.path !== "/runtime-tools/model/v1/messages") return null;
      const entry = tlsOrigins.get(socket); if (!entry) return null;
      try {
        if (entry.retired || request.host !== expectedHost || request.url !== "/runtime-tools/model/v1/messages")
          throw new Error("serial_model_channel_retired_or_origin_changed");
        const authorization = await entry.channel.authorization();
        if (entry.retired || entry.client.destroyed || entry.upstream.destroyed ||
            (request.authorization !== undefined && request.authorization !== authorization))
          throw new Error("serial_model_channel_caller_changed");
        return { authorization, runId: entry.channel.runId, leaseId: entry.channel.leaseId, sessionKey: entry.channel.sessionKey };
      } catch { retire(entry); throw new Error("serial_model_channel_not_current"); }
    },
    retire,
    retireAll: () => { for (const entry of [...tunnels.values()]) retire(entry); },
  };
}
