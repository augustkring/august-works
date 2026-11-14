import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeToolsToken } from "../../runtime-tools-token.js";
import { attestNativeModelClient, type ModelProviderObservation, type SignedModelOrigin } from "./managed-native-model-transport.js";

// Kernel-observation primitive tests only. No DB Run/Plan/attempt/source receipt,
// Host admission or actual SDK/provider operation is created or qualified.
const rootScript = String.raw`
const fs=require('node:fs'),cp=require('node:child_process');
const [marker,nonce,id,port]=process.argv.slice(1);
const raw=fs.readFileSync('/proc/'+process.pid+'/stat','utf8');
const ticks=raw.slice(raw.lastIndexOf(') ')+2).trim().split(/\s+/)[19];
const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
fs.writeFileSync(marker,[nonce,process.pid,new Date().toISOString(),id,'linux:'+boot+':'+ticks].join('\n')+'\n',{mode:0o600});
const child=cp.spawn(process.execPath,['-e',"const s=require('node:net').connect(Number(process.argv[1]),'127.0.0.1');setInterval(()=>{},1000);",String(port)],{env:{},stdio:'ignore'});
child.on('error',()=>process.exit(1));child.once('close',()=>process.exit(0));
process.send?.({pid:child.pid});
process.on('SIGTERM',()=>{child.kill('SIGKILL');});
setInterval(()=>{},1000);
`;
async function withKernelClient(work: (context: { client: Socket; port: number; sdkPid: number; marker: string;
  origin: SignedModelOrigin; observed: ModelProviderObservation; setObserved: (value: ModelProviderObservation) => void }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "model-origin-unit-"));
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("unit_listener_missing");
  const accepted = once(server, "connection"); const marker = join(directory, "runner.identity"), nonce = randomUUID(), runnerId = randomUUID();
  // Both controlled processes have closed envs; no JWT or signing secret is
  // handed to either child. The real OS socket/image/ancestry is observed.
  const root = spawn(process.execPath, ["-e", rootScript, "--", marker, nonce, runnerId, String(address.port), "--runner-id", runnerId],
    { env: {}, detached: false, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const stopped = new Promise<void>(resolve => root.once("close", () => resolve()));
  let client: Socket | undefined;
  try {
    const prematureExit = stopped.then(() => { throw new Error("controlled_child_exited_before_socket"); });
    const [message] = await Promise.race([once(root, "message"), prematureExit]) as [{ pid: number }];
    [client] = await Promise.race([accepted, prematureExit]) as [Socket];
    const digest = createHash("sha256"); for await (const chunk of createReadStream(process.execPath)) digest.update(chunk);
    const token = createRuntimeToolsToken({ companyId: randomUUID(), agentId: randomUUID(), runId: randomUUID(), responsibleUserId: randomUUID(),
      scope: "worker_model", workerModelBinding: { planId: randomUUID(), workerId: randomUUID(), workerAttemptId: randomUUID(),
        executionManifestId: randomUUID(), expectedPlanVersion: 1 } });
    if (!token) throw new Error("unit_issuer_missing");
    let observed: ModelProviderObservation = { token: token.token, capabilityHash: createHash("sha256").update(token.token).digest("hex"),
      expiresAt: token.expiresAt, imageSha256: digest.digest("hex"), imageBytes: statSync(process.execPath).size,
      manifestDigest: "unit-image-observation-not-a-provider-qualification", runPid: root.pid!,
      runStartedAt: readFileSync(marker, "utf8").split("\n")[2]! };
    const origin: SignedModelOrigin = { runId: randomUUID(), leaseId: randomUUID(), sessionKey: "unit-kernel-observation",
      markerPath: marker, nonce, runnerInstanceId: runnerId, currentProvider: async () => observed };
    expect(readFileSync(`/proc/${message.pid}/environ`, "utf8")).not.toContain(token.token);
    await work({ client, port: address.port, sdkPid: message.pid, marker, origin, observed, setObserved: value => { observed = value; } });
  } finally {
    client?.destroy();
    if (root.exitCode === null && root.signalCode === null) root.kill("SIGTERM"); await stopped;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

describe("actual model-client kernel observation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("binds one real child socket/image/ancestry and denies wrong nonce, image and current capability", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "model-observer-unit-only");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    await withKernelClient(async ({ client, origin, observed, setObserved }) => {
      expect(await attestNativeModelClient(client, { ...origin, nonce: randomUUID() })).toBeNull();
      expect(await attestNativeModelClient(client, { ...origin, currentProvider: async () => ({ ...observed, imageSha256: "0".repeat(64) }) })).toBeNull();
      const bound = await attestNativeModelClient(client, origin);
      expect(bound).not.toBeNull();
      try {
        expect(await bound!.authorization()).toBe(`Bearer ${observed.token}`);
        setObserved({ ...observed, capabilityHash: "f".repeat(64) });
        await expect(bound!.authorization()).rejects.toThrow("model_channel_observation_unavailable");
        setObserved(observed);
        await expect(bound!.authorization()).rejects.toThrow("model_channel_observation_unavailable");
      } finally { bound?.close(); }
    });
  }, 30_000);
  it("rechecks expiry or Stop that commits during the asynchronous observation boundary", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "model-observer-unit-only");
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    await withKernelClient(async ({ client, origin, observed }) => {
      for (const transition of ["expiry", "stop"] as const) {
        let armed = false, changed = false;
        const currentProvider = async () => {
          if (changed && transition === "stop") throw new Error("unit_origin_stopped");
          const snapshot = changed ? { ...observed, expiresAt: new Date(Date.now() - 1).toISOString() } : { ...observed };
          if (armed) {
            armed = false;
            // First microtask precedes the authorization continuation; the
            // nested one runs as that continuation awaits observation().
            queueMicrotask(() => queueMicrotask(() => { changed = true; }));
          }
          return snapshot;
        };
        const bound = await attestNativeModelClient(client, { ...origin, currentProvider });
        expect(bound).not.toBeNull();
        try { armed = true; await expect(bound!.authorization()).rejects.toThrow(); }
        finally { bound?.close(); }
      }
    });
  }, 30_000);
  it("does not assign the same binary's unrelated parent socket, changed marker or expired observation", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "model-observer-unit-only");
    await withKernelClient(async ({ client, port, origin, observed, marker }) => {
      // A second local caller is the test parent, not the original marked
      // runner's descendant. Same UID/executable/endpoint is insufficient.
      const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
      const address = server.address(); if (!address || typeof address === "string") throw new Error("unit_listener_missing");
      const accepted = once(server, "connection"), caller = createConnection(address.port, "127.0.0.1");
      const [foreign] = await accepted as [Socket];
      try { expect(await attestNativeModelClient(foreign, origin)).toBeNull(); }
      finally { caller.destroy(); foreign.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
      expect(await attestNativeModelClient(client, { ...origin,
        currentProvider: async () => ({ ...observed, expiresAt: new Date(Date.now() - 1000).toISOString() }) })).toBeNull();
      const content = readFileSync(marker, "utf8");
      writeFileSync(marker, content.replace(/^linux:[^\n]+/m, "linux:00000000-0000-0000-0000-000000000000:1"));
      expect(await attestNativeModelClient(client, origin)).toBeNull();
      expect(port).toBeGreaterThan(0);
    });
  }, 30_000);
});


import { managedModelProcessIdentityControls, managedModelSocketOwnerResponseControls } from "./managed-native-model-transport.js";

async function withNondumpableUidProcess(work: (value: { pid: number; start: string; status: string; directoryUid: number }) => Promise<void>) {
  const script = String.raw`import ctypes,json,os,sys
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(4,0,0,0,0)!=0: sys.exit(126)
s=open('/proc/self/stat').read()
print(json.dumps({'pid':os.getpid(),'start':s[s.rfind(') ')+2:].split()[19],'dumpable':libc.prctl(3,0,0,0,0)}),flush=True)
sys.stdin.buffer.read()
`;
  const child = spawn("/usr/bin/python3", ["-I", "-c", script], { env: { PATH: "/usr/bin:/bin" }, stdio: ["pipe", "pipe", "pipe"] });
  const stopped = new Promise<void>(resolve => child.once("close", () => resolve()));
  try {
    const ready = await new Promise<{ pid: number; start: string; dumpable: number }>((resolve, reject) => {
      let text = "";
      child.once("error", reject); child.once("close", () => reject(new Error("uid_child_exited_before_ready")));
      child.stdout.on("data", bytes => { text += bytes.toString("utf8");
        if (Buffer.byteLength(text) > 4096) { reject(new Error("uid_child_output_bound")); return; }
        if (text.includes("\n")) { try { resolve(JSON.parse(text.split("\n", 1)[0]!)); } catch (error) { reject(error); } }
      });
    });
    expect(ready.pid).toBe(child.pid); expect(ready.dumpable).toBe(0);
    const status = readFileSync(`/proc/${ready.pid}/status`, "utf8"), directoryUid = statSync(`/proc/${ready.pid}`).uid;
    await work({ pid: ready.pid, start: ready.start, status, directoryUid });
  } finally { child.stdin.end(); await stopped; }
}

describe("actual process credential identity", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts a live same-UID nondumpable process using its four actual credential UIDs", async () => {
    expect(process.getuid?.()).toBeGreaterThan(0);
    await withNondumpableUidProcess(async ({ pid, start, status, directoryUid }) => {
      expect(status.match(/^Uid:[^\n]*$/m)?.[0].trim().split(/\s+/).slice(1).map(Number))
        .toEqual(Array(4).fill(process.getuid!()));
      expect(managedModelProcessIdentityControls.processIdentity(pid, "socket_ancestry"))
        .toEqual({ pid, parent: process.pid, start });
      // Directory ownership is observed, never accepted as credential proof.
      expect(Number.isSafeInteger(directoryUid)).toBe(true);
    });
  });
  it("rejects a real foreign-UID process and partial, mixed or wrong-PID status observations", async () => {
    expect(process.getuid?.()).toBeGreaterThan(0);
    const foreignPid = readdirSync("/proc").filter(value => /^[0-9]+$/.test(value)).map(Number).find(pid => {
      try {
        const status = readFileSync(`/proc/${pid}/status`, "utf8");
        const uids = status.match(/^Uid:[^\n]*$/m)?.[0].trim().split(/\s+/).slice(1).map(Number);
        return uids?.length === 4 && uids.every(uid => Number.isSafeInteger(uid) && uid !== process.getuid!());
      } catch { return false; }
    });
    expect(foreignPid, "real foreign-UID process must exist for the kernel negative control").toBeDefined();
    expect(() => managedModelProcessIdentityControls.processIdentity(foreignPid!, "socket_ancestry")).toThrow();
    await withNondumpableUidProcess(async ({ pid, status }) => {
      const uid = process.getuid!();
      for (const changed of [status.replace(/^Uid:[^\n]*\n/m, ""),
        status.replace(/^Uid:[^\n]*/m, `Uid:\t${uid}\t${uid}\t${uid}`),
        status.replace(/^Uid:[^\n]*/m, `Uid:\t${uid}\t${uid}\t${uid}\t${uid + 1}`),
        status.replace(/^Pid:[^\n]*/m, `Pid:\t${pid + 1}`), status + `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`])
        expect(() => managedModelProcessIdentityControls.processUidStatus(changed, pid, uid)).toThrow();
    });
  });
  it("rejects a reused-PID marker expectation when the actual live process start identity differs", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "model-observer-reuse-control-only");
    await withKernelClient(async ({ client, origin, marker }) => {
      const text = readFileSync(marker, "utf8"), lines = text.split("\n"), parts = lines[4]!.split(":");
      const pid = Number(lines[1]), observed = managedModelProcessIdentityControls.processIdentity(pid, "runner");
      expect(observed.start).toBe(parts[2]);
      lines[4] = `${parts[0]}:${parts[1]}:${BigInt(observed.start) + 1n}`;
      writeFileSync(marker, lines.join("\n"));
      expect(await attestNativeModelClient(client, origin)).toBeNull();
      expect(managedModelProcessIdentityControls.processIdentity(pid, "runner").start).toBe(observed.start);
    });
  }, 30000);
});

describe("privileged socket-owner observer response shape", () => {
  const { socketOwnerResponseShape: shape, observerImageRssLimitBytes: limit } = managedModelSocketOwnerResponseControls;
  const complete = { complete: true, pid: 4242, inode: "987654321", local: "0100007F:04D2", remote: "0100007F:162E" };
  it("classifies the observer's own over-bound memory_bound report instead of an unknown shape", () => {
    expect(shape({ complete: false, stage: "memory_bound", errno: null, observerMaxRssBytes: limit + 1 })).toBe(true);
    expect(shape({ complete: false, stage: "tuple", errno: null, observerMaxRssBytes: limit })).toBe(true);
    expect(shape({ ...complete, observerMaxRssBytes: limit })).toBe(true);
  });
  it("never admits an over-bound peak as a complete or ordinary observation", () => {
    expect(shape({ ...complete, observerMaxRssBytes: limit + 1 })).toBe(false);
    expect(shape({ complete: false, stage: "owner_count", errno: null, observerMaxRssBytes: limit + 1 })).toBe(false);
    expect(shape({ complete: false, stage: "memory_bound", errno: "EIO", observerMaxRssBytes: limit + 1 })).toBe(false);
    expect(shape({ complete: false, stage: "memory_bound", errno: null, observerMaxRssBytes: limit })).toBe(false);
    for (const observerMaxRssBytes of [0, -1, 1.5, "1", null, undefined, Number.MAX_SAFE_INTEGER + 1])
      expect(shape({ ...complete, observerMaxRssBytes })).toBe(false);
    for (const response of [null, [], "x", 1]) expect(shape(response)).toBe(false);
  });
});
