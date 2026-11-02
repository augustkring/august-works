import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, lstatSync, readFileSync, readdirSync, readlinkSync, readSync, statSync } from "node:fs";
import type { ReadStream } from "node:fs";
import type { Socket } from "node:net";

export type ModelProviderObservation = { token: string; capabilityHash: string; expiresAt: string;
  imageSha256: string; imageBytes: number; manifestDigest: string; runPid: number | null; runStartedAt: string | null };
export type SignedModelOrigin = { runId: string; leaseId: string; sessionKey: string; markerPath: string;
  nonce: string; runnerInstanceId: string; currentProvider: () => Promise<ModelProviderObservation> };
export type ModelChannel = { readonly runId: string; readonly leaseId: string; readonly sessionKey: string;
  authorization: () => Promise<string>; close: () => void };
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const transient = (error: unknown) => ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");
const checked = (condition: unknown) => { if (!condition) throw new Error("model_channel_observation_unavailable"); };
function processIdentity(pid: number) {
  checked(Number.isSafeInteger(pid) && pid > 0 && statSync(`/proc/${pid}`).uid === process.getuid?.());
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8"), end = raw.lastIndexOf(") ");
  checked(end > 0); const fields = raw.slice(end + 2).trim().split(/\s+/);
  checked(fields[0] !== "Z" && /^\d+$/.test(fields[1] ?? "") && /^\d+$/.test(fields[19] ?? ""));
  return { pid, parent: Number(fields[1]), start: fields[19]! };
}
function endpoint(address: string | undefined, port: number | undefined) {
  checked(address === "127.0.0.1" && Number.isInteger(port) && port! > 0 && port! <= 65535);
  return `0100007F:${port!.toString(16).padStart(4, "0").toUpperCase()}`;
}
function socketOwner(client: Socket, until: number) {
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
  const root = processIdentity(Number(marker[1]));
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
    const observed = processIdentity(pid);
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
    const observed = processIdentity(item.pid); return item.pid === root.pid ? { ...observed, parent: 0 } : observed;
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
        console.info("managed_native_model_transport_observation_failed", JSON.stringify({ errno, frameClass }));
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
