import { describe, expect, it } from "vitest";
import { nativeSha256 } from "./canonical.js";
import {
  MANAGED_OPENCODE_TERMINAL_TOOL_NAMES,
  managedOpenCodeConformanceRequestToolsAllowed,
  managedOpenCodeConformanceResponseToolFree,
  managedOpenCodeConformanceToolSurfaceAllowed,
  managedOpenCodeProviderToolsMatchCatalog,
  managedOpenCodeTerminalToolSchemas,
} from "./managed-opencode-terminal-tools.js";

// CONF8. Runnerd's OpenCode bridge appends its two terminal tools to every
// managed session, including a provider-conformance probe whose catalog is
// otherwise empty, so the probe's request carried `paperclip_paperclip_finish`
// and `paperclip_paperclip_block` with tool_choice auto and the conformance
// gateway refused it before spend. The conformance lane now accepts exactly
// that pair (the same definitions the Native catalog uses) and nothing else.

/** The tools exactly as pinned OpenCode serializes them to the provider. */
function providerTerminalTools() {
  return managedOpenCodeTerminalToolSchemas().map(tool => ({ name: `paperclip_${String(tool.name)}`,
    description: tool.description as string, input_schema: structuredClone(tool.inputSchema) as Record<string, unknown> }));
}
const userText = [{ role: "user" as const, content: "Output exactly AW_PROBE_x. Use no tools." }];

describe("managed OpenCode terminal tools", () => {
  it("pins the two runner terminal definitions (names and canonical schema hash)", () => {
    const tools = managedOpenCodeTerminalToolSchemas();
    expect(MANAGED_OPENCODE_TERMINAL_TOOL_NAMES).toEqual(["paperclip_finish", "paperclip_block"]);
    expect(tools.map(tool => tool.name).sort()).toEqual(["paperclip_block", "paperclip_finish"]);
    expect(tools.every(tool => (tool.inputSchema as Record<string, unknown>).additionalProperties === false)).toBe(true);
    // A runner or OpenCode projection change must be reviewed here and in the
    // pinned provider pack before the conformance lane accepts it.
    expect(nativeSha256(tools)).toBe(PINNED_TERMINAL_TOOLS_SHA256);
    // Each call returns a fresh copy.
    (tools[0]!.inputSchema as Record<string, unknown>).additionalProperties = true;
    expect(nativeSha256(managedOpenCodeTerminalToolSchemas())).toBe(PINNED_TERMINAL_TOOLS_SHA256);
  });

  describe("conformance tool surface", () => {
    it("accepts a tool-free request", () => {
      expect(managedOpenCodeConformanceToolSurfaceAllowed({})).toBe(true);
      expect(managedOpenCodeConformanceRequestToolsAllowed({ messages: userText })).toBe(true);
    });

    it.each([
      ["without tool_choice", undefined],
      ["with tool_choice auto", { type: "auto" }],
    ])("accepts exactly the runner's terminal pair %s, in either order", (_label, toolChoice) => {
      const tools = providerTerminalTools();
      for (const ordered of [tools, [...tools].reverse()]) {
        const request = { tools: ordered, ...(toolChoice ? { tool_choice: toolChoice } : {}), messages: userText };
        expect(managedOpenCodeConformanceToolSurfaceAllowed(request)).toBe(true);
        expect(managedOpenCodeConformanceRequestToolsAllowed(request)).toBe(true);
      }
    });

    const changed = (mutate: (tools: ReturnType<typeof providerTerminalTools>) => unknown[]) => () => mutate(providerTerminalTools());
    it.each([
      ["an extra tool", changed(tools => [...tools, { name: "paperclip_paperclip_read_document", description: "Read", input_schema: { type: "object" } }])],
      ["a duplicate terminal tool", changed(tools => [...tools, tools[0]])],
      ["only finish", changed(tools => tools.filter(tool => tool.name === "paperclip_paperclip_finish"))],
      ["only block", changed(tools => tools.filter(tool => tool.name === "paperclip_paperclip_block"))],
      ["another tool instead of block", changed(tools => tools.map(tool => tool.name === "paperclip_paperclip_block"
        ? { ...tool, name: "paperclip_paperclip_create_task" } : tool))],
      ["the catalog name instead of the provider name", changed(tools => tools.map(tool => ({ ...tool, name: tool.name.replace(/^paperclip_/, "") })))],
      ["a renamed finish", changed(tools => tools.map(tool => tool.name === "paperclip_paperclip_finish"
        ? { ...tool, name: "paperclip_paperclip_finish_v2" } : tool))],
      ["a changed description", changed(tools => tools.map((tool, index) => index === 0 ? { ...tool, description: `${tool.description} ` } : tool))],
      ["a missing description", changed(tools => tools.map((tool, index) => index === 0 ? { name: tool.name, input_schema: tool.input_schema } : tool))],
      ["an open schema", changed(tools => tools.map((tool, index) => index === 0
        ? { ...tool, input_schema: { ...tool.input_schema, additionalProperties: true } } : tool))],
      ["an added schema property", changed(tools => tools.map((tool, index) => index === 0
        ? { ...tool, input_schema: { ...tool.input_schema, properties: { ...(tool.input_schema.properties as object), extra: { type: "string" } } } } : tool))],
      ["a swapped schema", changed(tools => [{ ...tools[0]!, input_schema: tools[1]!.input_schema }, { ...tools[1]!, input_schema: tools[0]!.input_schema }])],
      ["an empty tool list", changed(() => [])],
    ])("refuses %s", (_label, tools) => {
      const request = { tools: tools(), tool_choice: { type: "auto" }, messages: userText };
      expect(managedOpenCodeConformanceToolSurfaceAllowed(request)).toBe(false);
      expect(managedOpenCodeConformanceRequestToolsAllowed(request)).toBe(false);
      expect(managedOpenCodeConformanceToolSurfaceAllowed({ tools: tools() })).toBe(false);
    });

    it.each([
      ["any", { type: "any" }],
      ["none", { type: "none" }],
      ["a named finish", { type: "tool", name: "paperclip_paperclip_finish" }],
      ["auto with an extra member", { type: "auto", disable_parallel_tool_use: true }],
    ])("refuses tool_choice %s", (_label, toolChoice) => {
      expect(managedOpenCodeConformanceToolSurfaceAllowed({ tools: providerTerminalTools(), tool_choice: toolChoice })).toBe(false);
    });

    it("refuses tool_choice without the terminal pair", () => {
      expect(managedOpenCodeConformanceToolSurfaceAllowed({ tool_choice: { type: "auto" } })).toBe(false);
    });

    it.each([
      ["a tool_use block", { role: "assistant" as const, content: [{ type: "tool_use", id: "toolu_1", name: "paperclip_paperclip_finish", input: {} }] }],
      ["a tool_result block", { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] }],
    ])("refuses %s in the history, with or without the terminal pair", (_label, message) => {
      const messages = [...userText, message, ...userText];
      expect(managedOpenCodeConformanceRequestToolsAllowed({ messages })).toBe(false);
      expect(managedOpenCodeConformanceRequestToolsAllowed({ tools: providerTerminalTools(), tool_choice: { type: "auto" }, messages })).toBe(false);
    });

    it("refuses a provider response that uses any tool, finish and block included", () => {
      expect(managedOpenCodeConformanceResponseToolFree([{ type: "text" }])).toBe(true);
      for (const name of ["paperclip_paperclip_finish", "paperclip_paperclip_block", "other"])
        expect(managedOpenCodeConformanceResponseToolFree([{ type: "text" }, { type: "tool_use", name } as { type: string }])).toBe(false);
    });
  });

  describe("Native catalog match (worker and conversation gateway, unchanged)", () => {
    const readDocument = { name: "read_document", description: "Read one document.", inputSchema: { type: "object", properties: { id: { type: "string" } } } };
    const catalog = [readDocument, ...managedOpenCodeTerminalToolSchemas()];
    const providerRead = { name: "paperclip_read_document", description: readDocument.description, input_schema: readDocument.inputSchema };

    it("matches the exact provider-visible catalog in any order", () => {
      expect(managedOpenCodeProviderToolsMatchCatalog([providerRead, ...providerTerminalTools()], catalog)).toBe(true);
      expect(managedOpenCodeProviderToolsMatchCatalog([...providerTerminalTools(), providerRead], catalog)).toBe(true);
      expect(managedOpenCodeProviderToolsMatchCatalog(undefined, [])).toBe(true);
    });

    it("refuses a missing, extra or changed tool", () => {
      expect(managedOpenCodeProviderToolsMatchCatalog(providerTerminalTools(), catalog)).toBe(false);
      expect(managedOpenCodeProviderToolsMatchCatalog([providerRead, providerRead, ...providerTerminalTools()], catalog)).toBe(false);
      expect(managedOpenCodeProviderToolsMatchCatalog([{ ...providerRead, description: "Other." }, ...providerTerminalTools()], catalog)).toBe(false);
      expect(managedOpenCodeProviderToolsMatchCatalog([{ ...providerRead, input_schema: { type: "object" } }, ...providerTerminalTools()], catalog)).toBe(false);
      expect(managedOpenCodeProviderToolsMatchCatalog(undefined, catalog)).toBe(false);
    });

    it("still requires the terminal pair in a worker catalog request", () => {
      expect(managedOpenCodeProviderToolsMatchCatalog([providerRead], catalog)).toBe(false);
    });
  });
});

const PINNED_TERMINAL_TOOLS_SHA256 = "d240286c6651d4ec81ff09f776f3ee051b7cddea85b159f4e08bb12a744933fb";
