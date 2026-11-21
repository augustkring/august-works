import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { createConnection, Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createManagedModelTunnelAssociations, type ModelChannel } from "./managed-native-model-transport.js";

// Software channel/table mechanics only. Controlled channel strings below are
// not JWTs, Host admissions, profile qualifications or SDK execution evidence.
const route = "/runtime-tools/model/v1/messages";
function channel(id: string): ModelChannel {
  return { runId: id, leaseId: `lease-${id}`, sessionKey: `session-${id}`,
    authorization: vi.fn(async () => `Bearer controlled-${id}`), close: vi.fn() };
}
function tupleSocket(reverse = false) {
  const socket = new Socket();
  const values = { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1",
    localPort: reverse ? 24444 : 23333, remotePort: reverse ? 23333 : 24444 };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(socket, key, { value });
  return socket;
}
const request = { method: "POST", path: route, url: route, host: "broker.invalid:24444" };

describe("actual managed fixture tunnel association owner", () => {
  it("never retags a retired or originally unbound TLS object when a TCP tuple is reused", async () => {
    const owner = createManagedModelTunnelAssociations("https://broker.invalid:24444");
    const a = channel("A"), b = channel("B");
    const unbound = tupleSocket(true); owner.observeTls(unbound);
    const entryA = owner.register(new Socket(), tupleSocket(), a);
    const tlsA = tupleSocket(true); owner.observeTls(tlsA);
    expect(await owner.authorization(tlsA, request)).toMatchObject({ runId: "A" });
    owner.retire(entryA);
    const entryB = owner.register(new Socket(), tupleSocket(), b);
    const tlsB = tupleSocket(true); owner.observeTls(tlsB);
    owner.observeTls(tlsA); owner.observeTls(unbound);
    await expect(owner.authorization(tlsA, request)).rejects.toThrow("serial_model_channel_not_current");
    expect(await owner.authorization(unbound, request)).toBeNull();
    owner.retire(entryA); // Late A close cannot erase B's same-key entry.
    expect(await owner.authorization(tlsB, request)).toMatchObject({ runId: "B" });
    expect(b.authorization).toHaveBeenCalledTimes(1);
    expect(a.close).toHaveBeenCalledTimes(1);
    owner.retire(entryB); unbound.destroy(); tlsA.destroy(); tlsB.destroy();
  });

  it("denies an in-flight authorization retired by Stop rather than substituting a successor", async () => {
    const owner = createManagedModelTunnelAssociations("https://broker.invalid:24444");
    let release!: (header: string) => void;
    const a = channel("A"); a.authorization = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const entry = owner.register(new Socket(), tupleSocket(), a);
    const tlsA = tupleSocket(true); owner.observeTls(tlsA);
    const pending = owner.authorization(tlsA, request);
    owner.retire(entry);
    const b = channel("B"), entryB = owner.register(new Socket(), tupleSocket(), b);
    release("Bearer controlled-A");
    await expect(pending).rejects.toThrow("serial_model_channel_not_current");
    expect(b.authorization).not.toHaveBeenCalled();
    owner.retire(entryB); tlsA.destroy();
  });

  it("binds real CONNECT upstream tuples to real TLS sockets and denies direct, conflicting and stopped channels", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-tunnel-tls-"));
    const sockets = new Set<Socket>();
    const remember = (socket: Socket) => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); };
    let owner!: ReturnType<typeof createManagedModelTunnelAssociations>;
    let nextChannel = channel("A");
    let current = true;
    const a = nextChannel;
    a.authorization = vi.fn(async () => { if (!current) throw new Error("controlled_stop"); return "Bearer controlled-A"; });
    const applied: string[] = [];
    const broker = httpsServer({ key: await makeKey(), cert: await readFile(join(directory, "cert.pem")) }, async (req, res) => {
      try {
        const result = await owner.authorization(req.socket, { method: req.method!, path: req.url!, url: req.url!, host: req.headers.host, authorization: req.headers.authorization });
        if (result) applied.push(result.runId);
        const body = JSON.stringify(result ?? { unbound: true });
        res.writeHead(result ? 200 : 401, { "content-length": Buffer.byteLength(body) }); res.end(body);
      } catch { res.destroy(); }
    });
    async function makeKey() {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=broker.invalid", "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "ignore", timeout: 10_000, env: { PATH: "/usr/bin:/bin" } });
      return readFile(join(directory, "key.pem"));
    }
    broker.on("connection", remember);
    broker.on("secureConnection", socket => owner.observeTls(socket));
    broker.listen(0, "127.0.0.1"); await once(broker, "listening");
    const address = broker.address(); if (!address || typeof address === "string") throw new Error("controlled_listener_missing");
    const brokerPort = address.port;
    const host = `broker.invalid:${brokerPort}`; owner = createManagedModelTunnelAssociations(`https://${host}`);
    const proxy = httpServer(); proxy.on("connection", remember);
    proxy.on("connect", (req, client, head) => {
      if (req.url !== host) { client.destroy(); return; }
      const upstream = createConnection(address.port, "127.0.0.1"); remember(upstream);
      upstream.once("connect", () => {
        const entry = owner.register(client as Socket, upstream, nextChannel);
        const close = () => owner.retire(entry);
        upstream.once("close", close); client.once("close", close);
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
    });
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    const proxyAddress = proxy.address(); if (!proxyAddress || typeof proxyAddress === "string") throw new Error("controlled_proxy_missing");
    const proxyPort = proxyAddress.port;
    async function connect(tunnel: boolean) {
      const raw = createConnection(tunnel ? proxyPort : brokerPort, "127.0.0.1"); remember(raw); await once(raw, "connect");
      if (tunnel) {
        const ready = once(raw, "data"); raw.write(`CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
        const [response] = await ready; expect(response.toString()).toContain("200 Connection Established");
      }
      const tls = tlsConnect({ socket: raw, servername: "broker.invalid", rejectUnauthorized: false }); remember(tls); await once(tls, "secureConnect"); return tls;
    }
    function send(socket: TLSSocket, authorization?: string): Promise<{ status: number; body: Record<string, string> }> {
      return new Promise((resolve, reject) => {
        let received = "";
        const cleanup = () => { socket.off("data", data); socket.off("close", closed); socket.off("error", failed); };
        const closed = () => { cleanup(); reject(new Error("controlled_channel_closed")); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const data = (chunk: Buffer) => {
          received += chunk.toString(); const end = received.indexOf("\r\n\r\n"); if (end < 0) return;
          const length = Number(/content-length: (\d+)/i.exec(received.slice(0, end))?.[1]);
          if (received.length < end + 4 + length) return;
          cleanup(); resolve({ status: Number(received.split(" ")[1]), body: JSON.parse(received.slice(end + 4, end + 4 + length)) });
        };
        socket.on("data", data); socket.once("close", closed); socket.once("error", failed);
        socket.write(`POST ${route} HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 0\r\n${authorization === undefined ? "" : `Authorization: ${authorization}\r\n`}\r\n`);
      });
    }
    try {
      const direct = await connect(false);
      expect(await send(direct)).toMatchObject({ status: 401, body: { unbound: true } });
      expect(applied).toEqual([]);
      const tlsA = await connect(true);
      expect(await send(tlsA)).toMatchObject({ status: 200, body: { runId: "A", authorization: "Bearer controlled-A" } });
      current = false;
      await expect(send(tlsA)).rejects.toThrow();
      expect(a.close).toHaveBeenCalledTimes(1);
      nextChannel = channel("B");
      const conflicting = await connect(true);
      await expect(send(conflicting, "Bearer controlled-A")).rejects.toThrow();
      expect(applied).toEqual(["A"]);
      nextChannel = channel("B");
      const tlsB = await connect(true);
      expect(await send(tlsB)).toMatchObject({ status: 200, body: { runId: "B", authorization: "Bearer controlled-B" } });
      expect(applied).toEqual(["A", "B"]);
    } finally {
      owner.retireAll(); for (const socket of sockets) socket.destroy();
      await Promise.all([new Promise<void>(resolve => proxy.close(() => resolve())), new Promise<void>(resolve => broker.close(() => resolve()))]);
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
