import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPaperclipMcpServer } from "./index.js";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";
const config = {
  apiUrl: "http://localhost:3100/api",
  apiKey: "fixture-token",
  companyId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  runId: "33333333-3333-4333-8333-333333333333",
};
const request = {
  schemaVersion: 1,
  component: "TaskCard",
  companyId: config.companyId,
  cardId: "task:44444444-4444-4444-8444-444444444444",
  source: {
    domain: "task",
    resourceId: "44444444-4444-4444-8444-444444444444",
    companyId: config.companyId,
    version: "2026-10-10T12:00:00.000Z",
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function tool() {
  const found = createToolDefinitions(new PaperclipApiClient(config)).find(
    (value) => value.name === "aw_experience_card",
  );
  expect(found).toBeTruthy();
  return found!;
}
describe("V9 card display tool", () => {
  it("registers and calls the exact card tool through the installed MCP SDK without an effect or API fetch", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected API effect");
    });
    vi.stubGlobal("fetch", fetch);
    const { server } = createPaperclipMcpServer(config),
      client = new Client({ name: "v9-display-proof", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      const definition = listed.tools.find(
        (value) => value.name === "aw_experience_card",
      );
      expect(definition).toBeTruthy();
      expect(definition!.inputSchema.additionalProperties).toBe(false);
      const result = await client.callTool({
        name: "aw_experience_card",
        arguments: request,
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.type).toBe("text");
      expect(JSON.parse(content[0]!.text)).toEqual({
        schemaVersion: 1,
        displayReference: request,
        authority: "none",
      });
      expect(definition!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const extra = await client.callTool({ name: "aw_experience_card", arguments: { ...request, html: "PRIVATE-TOOL-CANARY" } });
      expect(extra.isError).toBe(true);
      const foreign = await client.callTool({ name: "aw_experience_card", arguments: { ...request, companyId: "99999999-9999-4999-8999-999999999999" } });
      expect(foreign.isError).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
  it.each([
    { ...request, companyId: "99999999-9999-4999-8999-999999999999" },
    { ...request, component: "ArbitraryHTML" },
    { ...request, html: "PRIVATE-TOOL-CANARY" },
    {
      ...request,
      source: {
        ...request.source,
        href: "https://outside.invalid/PRIVATE-TOOL-CANARY",
      },
    },
    { ...request, cardId: "PRIVATE-TOOL-CANARY".repeat(1000) },
  ])(
    "rejects untrusted or oversized references with content-free failure",
    async (input) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const result = await tool().execute(input);
      expect(JSON.parse(result.content[0]!.text)).toEqual({
        error: "Card request unavailable",
        authority: "none",
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE-TOOL-CANARY");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("does not invoke getters supplied to the direct definition", async () => {
    const getter = vi.fn(() => "PRIVATE-TOOL-CANARY");
    const input = Object.defineProperty({ ...request }, "cardId", {
      enumerable: true,
      get: getter,
    });
    const result = await tool().execute(input);
    expect(getter).not.toHaveBeenCalled();
    expect(result.content[0]!.text).not.toContain("PRIVATE-TOOL-CANARY");
    expect(JSON.parse(result.content[0]!.text).error).toBe(
      "Card request unavailable",
    );
  });
});
