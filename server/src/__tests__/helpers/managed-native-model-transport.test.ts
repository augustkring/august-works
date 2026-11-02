import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
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
