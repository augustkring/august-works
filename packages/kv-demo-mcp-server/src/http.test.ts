import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { createKvDemoHttpServer, type KvDemoHttpServer } from "./http.js";
import type { KvStateSnapshot } from "./store.js";

const servers: KvDemoHttpServer[] = [];

async function startServer(token?: string, bindHost = "127.0.0.1") {
  const instance = createKvDemoHttpServer({ token });
  const port = await instance.listen(0, bindHost);
  servers.push(instance);
  return { instance, base: `http://127.0.0.1:${port}` };
}

async function mcpClient(base: string, headers?: Record<string, string>) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: headers ? { headers } : undefined,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function readRpcBody(response: Response): Promise<unknown> {
  const body = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? body.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice("data:".length).trim()
    : body;
  return JSON.parse(data ?? "{}");
}

afterEach(async () => {
  while (servers.length) {
    const instance = servers.pop();
    if (instance) await instance.close();
  }
});

describe("kv demo HTTP server", () => {
  it("serves an explicitly negotiated 2025 protocol client through the SDK v2 legacy path", async () => {
    const { base } = await startServer();
    const send = (payload: Record<string, unknown>, protocolVersion?: string) => fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
      },
      body: JSON.stringify(payload),
    });

    const initialized = await send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy-fixture", version: "1" } },
    });
    expect(initialized.status).toBe(200);
    const initBody = await readRpcBody(initialized) as { result?: { protocolVersion?: string } };
    expect(initBody.result?.protocolVersion).toBe("2025-06-18");

    const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "2025-06-18");
    expect(listed.status).toBe(200);
    expect((await readRpcBody(listed) as { result?: { tools?: Array<{ name: string }> } }).result?.tools?.map((tool) => tool.name)).toContain("kv_get");
  });

  it("keeps the loopback Origin guard in front of the v2 HTTP handler", async () => {
    const { base } = await startServer();
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(403);
  });

  it("keeps remote-bind host behavior behind bearer auth and same-origin checks", async () => {
    const token = "remote-bind-token";
    const { base } = await startServer(token, "0.0.0.0");
    const rejected = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(rejected.status).toBe(403);

    const client = await mcpClient(base, {
      authorization: `Bearer ${token}`,
      origin: base,
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("kv_get");
    await client.close();
  });

  it("reflects an MCP tool write in GET /api/state (shared process state)", async () => {
    const { base } = await startServer();
    const client = await mcpClient(base);

    await client.callTool({ name: "kv_set", arguments: { key: "color", value: "blue" } });

    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as KvStateSnapshot;
    expect(state.count).toBe(1);
    expect(state.entries).toEqual([
      expect.objectContaining({ key: "color", value: "blue" }),
    ]);

    await client.close();
  });

  it("serves an HTML values table at GET / that includes written keys", async () => {
    const { base } = await startServer();
    const client = await mcpClient(base);
    await client.callTool({ name: "kv_set", arguments: { key: "fruit", value: "mango" } });
    await client.close();

    const res = await fetch(`${base}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("fruit");
    expect(html).toContain("mango");
  });

  it("requires KV_DEMO_TOKEN on data routes without exposing it in URLs", async () => {
    const token = "s3cret-demo-token";
    const { base } = await startServer(token);

    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/api/state?token=${token}`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(200);

    const page = await (await fetch(`${base}/`)).text();
    expect(page).not.toContain(token);
    expect(page).toContain("#token=YOUR_TOKEN");

    const client = await mcpClient(base, { authorization: `Bearer ${token}` });
    await client.callTool({ name: "kv_set", arguments: { key: "k", value: "v" } });
    const stateResponse = await fetch(`${base}/api/state`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const state = (await stateResponse.json()) as KvStateSnapshot;
    expect(state.count).toBe(1);
    await client.close();
  });
});
