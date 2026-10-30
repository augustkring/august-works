import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { runtimeSandboxExecRelayRequestSchema } from "@paperclipai/shared";
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
const execRequest = () => ({
  requestId: "44444444-4444-4444-8444-444444444444",
  bindingId: "55555555-5555-4555-8555-555555555555",
  hostEpoch: 1,
  runId: "66666666-6666-4666-8666-666666666666",
  attemptId: null,
  attempt: 1,
  manifestId: "77777777-7777-4777-8777-777777777777",
  manifestHash: "a".repeat(64),
  policySnapshotId: "88888888-8888-4888-8888-888888888888",
  policyHash: "b".repeat(64),
  commandDigest: "c".repeat(64),
  deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  sandboxRef: "aw-v7-55555555-5555-4555-8555-555555555555",
  imageDigest: "example.invalid/sandbox@sha256:" + "d".repeat(64),
  argv: ["node", "-e", "process.stdout.write('x')"],
  cwd: "/workspace",
  env: {},
  stdinBase64: "",
});

it("accepts only the exact nonsecret managed-model bounds tied to the typed broker credential", () => {
  const request = execRequest();
  const modelBrokerCredential = {
    capabilityToken: "typed-capability-token",
    profileId: "managed-model",
    profileHash: "e".repeat(64),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    inputTokensUpperBound: 100_000,
    maxOutputTokens: 1024,
  };
  const valid = { ...request, env: {
    PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://broker.example.test",
    PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: "100000",
    PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: "1024",
  }, modelBrokerCredential };
  expect(runtimeSandboxExecRelayRequestSchema.safeParse(valid).success).toBe(true);
  expect(runtimeSandboxExecRelayRequestSchema.safeParse({
    ...valid,
    env: { ...valid.env, PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: "100001" },
  }).success).toBe(false);
  expect(runtimeSandboxExecRelayRequestSchema.safeParse({
    ...valid,
    env: { ...valid.env, PAPERCLIP_PROVIDER_API_KEY: "must-stay-rejected" },
  }).success).toBe(false);
  expect(runtimeSandboxExecRelayRequestSchema.safeParse({
    ...request,
    env: { PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: "100000" },
  }).success).toBe(false);
});

it("rejects oversized relay stdin before running the base64 validator", () => {
  expect(() => runtimeSandboxExecRelayRequestSchema.safeParse({
    ...execRequest(),
    stdinBase64: "A".repeat(5 * 1024 * 1024),
  })).not.toThrow();
  expect(runtimeSandboxExecRelayRequestSchema.safeParse({
    ...execRequest(),
    stdinBase64: "A".repeat(5 * 1024 * 1024),
  }).success).toBe(false);
});

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
  it("streams only one authorized run-scoped OpenShell command and rejects replay", async () => {
    let consumed = false;
    const request = execRequest();
    const relay = runtimeGatewayRelay({
      authenticateHost: async () => ({ id: hostId, credentialVersion: 1 }),
      authorizeCell: async () => ({ runtimeHostId: hostId, companyId, generation: "1" }),
      async authorizeExec(input) {
        expect(input.capabilityToken).toBe("signed-run-capability");
        expect(input.request).toEqual(request);
        if (consumed) throw new Error("already_consumed");
        consumed = true;
        return { runtimeHostId: hostId, companyId, generation: "1" };
      },
      hostCurrent: async () => true,
      cellCurrent: async () => true,
    });
    const server = createServer();
    relay.attach(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const privatePort = await relay.listen(0);
    const port = (server.address() as AddressInfo).port;
    const host = new WebSocket(`ws://127.0.0.1:${port}/api/internal/runtime/relay`);
    const sockets = [host];
    const waitForMessage = (predicate: (message: Record<string, any>) => boolean) => new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("relay_message_timeout")), 2000);
      const onMessage = (raw: Buffer) => {
        const message = JSON.parse(raw.toString());
        if (predicate(message)) { clearTimeout(timer); host.off("message", onMessage); resolve(message); }
      };
      host.on("message", onMessage);
    });
    await once(host, "open");
    host.send(JSON.stringify({ type: "hello", proof }));
    const privateClient = new WebSocket(`ws://127.0.0.1:${privatePort}/cells/${cellId}/1`, { headers: { "x-aw-relay-token": "private-token" } });
    await once(privateClient, "open");
    privateClient.close();
    await once(privateClient, "close");
    const outputs: string[] = [];
    const execution = relay.executeOpenShell({
      cellId, generation: "1", request, capabilityToken: "signed-run-capability",
      onOutput: (_stream, chunk) => outputs.push(chunk.toString()),
    });
    const command = await waitForMessage(message => message.type === "exec_open");
    expect(command).toMatchObject({
      type: "exec_open", cellId, companyId, generation: "1",
      request, capabilityToken: "signed-run-capability",
    });
    host.send(JSON.stringify({ type: "exec_output", channelId: command.channelId, stream: "stdout", base64: Buffer.from("result").toString("base64") }));
    host.send(JSON.stringify({ type: "exec_exit", channelId: command.channelId, exitCode: 0, timedOut: false }));
    await expect(execution).resolves.toEqual({ exitCode: 0, timedOut: false });
    expect(outputs).toEqual(["result"]);
    await expect(relay.executeOpenShell({
      cellId, generation: "1", request, capabilityToken: "signed-run-capability", onOutput: () => {},
    })).rejects.toThrow("already_consumed");
    for (const ws of sockets) ws.terminate();
    await relay.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("treats host disconnect after exec dispatch as unknown and never reports success", async () => {
    const request = { ...execRequest(), requestId: "99999999-9999-4999-8999-999999999999" };
    const relay = runtimeGatewayRelay({
      authenticateHost: async () => ({ id: hostId, credentialVersion: 1 }),
      authorizeCell: async () => ({ runtimeHostId: hostId, companyId, generation: "1" }),
      authorizeExec: async () => ({ runtimeHostId: hostId, companyId, generation: "1" }),
      hostCurrent: async () => true,
      cellCurrent: async () => true,
    });
    // Use an independent host connection because the shared fixture's relay does
    // not install the exec authorizer.
    const server = createServer();
    relay.attach(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const privatePort = await relay.listen(0);
    const port = (server.address() as AddressInfo).port;
    const host = new WebSocket(`ws://127.0.0.1:${port}/api/internal/runtime/relay`);
    await once(host, "open");
    host.send(JSON.stringify({ type: "hello", proof }));
    const privateClient = new WebSocket(`ws://127.0.0.1:${privatePort}/cells/${cellId}/1`, { headers: { "x-aw-relay-token": "private-token" } });
    await once(privateClient, "open");
    privateClient.close();
    await once(privateClient, "close");
    const command = new Promise<Record<string, any>>(resolve => host.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "exec_open") resolve(message);
    }));
    const execution = relay.executeOpenShell({ cellId, generation: "1", request, capabilityToken: "signed-run-capability", onOutput: () => {} });
    await command;
    const hostClosed = once(host, "close");
    host.terminate();
    await hostClosed;
    await expect(execution).rejects.toThrow("runtime_unavailable");
    await relay.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
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
