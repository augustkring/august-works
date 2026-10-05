import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { runtimeGatewayRelay } from "../services/runtime/gateway-relay.js";
const hostId = "11111111-1111-4111-8111-111111111111",
  cellId = "22222222-2222-4222-8222-222222222222",
  companyId = "33333333-3333-4333-8333-333333333333";
const proof = {
  hostId,
  epoch: 1,
  timestamp: Date.now().toString(),
  nonce: "a".repeat(43),
  signature: "a".repeat(512),
};
const resources: {
  relay: ReturnType<typeof runtimeGatewayRelay>;
  server: Server;
  sockets: WebSocket[];
}[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    for (const ws of r.sockets) ws.terminate();
    await r.relay.stop();
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
  }
});
async function setup() {
  let authorized = true,
    current = true;
  const relay = runtimeGatewayRelay({
    async authenticateHost(value, raw) {
      expect(value).toEqual(proof);
      expect(JSON.parse(raw.toString())).toEqual({ hostId, epoch: 1 });
      return { id: hostId, credentialVersion: 1 };
    },
    async authorizeCell(id, generation, token) {
      if (
        !authorized ||
        id !== cellId ||
        generation !== "1" ||
        token !== "private-token"
      )
        throw Error("denied");
      return { runtimeHostId: hostId, companyId, generation };
    },
    async hostCurrent() {
      return current;
    },
    async cellCurrent() {
      return authorized;
    },
  });
  const server = createServer();
  relay.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = await relay.listen(0),
    publicPort = (server.address() as AddressInfo).port,
    sockets: WebSocket[] = [];
  resources.push({ relay, server, sockets });
  const host = new WebSocket(
    `ws://127.0.0.1:${publicPort}/api/internal/runtime/relay`,
  );
  sockets.push(host);
  await once(host, "open");
  host.send(JSON.stringify({ type: "hello", proof }));
  // Observe admission through an open request; retries only before the tunnel has registered.
  async function client(headers = { "x-aw-relay-token": "private-token" }) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/cells/${cellId}/1`, {
      headers,
    });
    sockets.push(ws);
    ws.on("error", () => {});
    return ws;
  }
  return {
    host,
    client,
    setAuthorized: (value: boolean) => {
      authorized = value;
    },
    setCurrent: (value: boolean) => {
      current = value;
    },
  };
}
describe("V6 private Gateway relay", () => {
  it("does not allocate a verification timer for transaction-scoped control services", async () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const cleared = vi.spyOn(globalThis, "clearInterval");
    const relay = runtimeGatewayRelay({
      authenticateHost: async () => ({ id: hostId, credentialVersion: 1 }),
      authorizeCell: async () => ({
        runtimeHostId: hostId,
        companyId,
        generation: "1",
      }),
      hostCurrent: async () => true,
      cellCurrent: async () => true,
    });
    try {
      expect(intervals).not.toHaveBeenCalled();
      const server = createServer();
      relay.attach(server);
      await relay.listen(0);
      expect(intervals).toHaveBeenCalledTimes(1);
      const timer = intervals.mock.results[0]!.value;
      await relay.stop();
      expect(cleared).toHaveBeenCalledWith(timer);
    } finally {
      intervals.mockRestore();
      cleared.mockRestore();
    }
  });
  it("multiplexes ordered Gateway frames and closes the channel when cell ownership changes", async () => {
    const fixture = await setup();
    const opening = once(fixture.host, "message");
    // Give the async machine verification a turn before the private socket opens.
    await new Promise((resolve) => setImmediate(resolve));
    const client = await fixture.client();
    await once(client, "open");
    const [raw] = await opening;
    const opened = JSON.parse(raw.toString());
    expect(opened).toMatchObject({
      type: "open",
      cellId,
      companyId,
      generation: "1",
    });
    const received: string[] = [];
    client.on("message", (data) => received.push(data.toString()));
    fixture.host.send(
      JSON.stringify({ type: "opened", channelId: opened.channelId }),
    );
    for (let i = 0; i < 30; i++)
      fixture.host.send(
        JSON.stringify({
          type: "data",
          channelId: opened.channelId,
          text: String(i),
        }),
      );
    await new Promise<void>((resolve) => {
      client.on("message", () => {
        if (received.length === 30) resolve();
      });
    });
    expect(received).toEqual(Array.from({ length: 30 }, (_, i) => String(i)));
    const outgoing = once(fixture.host, "message");
    client.send("Gateway request");
    expect(JSON.parse((await outgoing)[0].toString())).toEqual({
      type: "data",
      channelId: opened.channelId,
      text: "Gateway request",
    });
    const closed = once(client, "close");
    fixture.setAuthorized(false);
    await closed;
  });
  it("rejects browser cookies and credentials from another cell", async () => {
    const fixture = await setup();
    for (const headers of [
      { "x-aw-relay-token": "wrong" },
      { "x-aw-relay-token": "private-token", cookie: "session=browser" },
    ]) {
      const client = await fixture.client(headers);
      const [, response] = await once(client, "unexpected-response");
      expect(response.statusCode).toBe(403);
      client.terminate();
    }
  });
  it("closes the host tunnel after credential revocation", async () => {
    const fixture = await setup();
    await new Promise((resolve) => setImmediate(resolve));
    const closing = once(fixture.host, "close");
    fixture.setCurrent(false);
    expect((await closing)[0]).toBe(1008);
  });
});
