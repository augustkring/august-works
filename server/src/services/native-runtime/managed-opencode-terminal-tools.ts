import { isDeepStrictEqual } from "node:util";
import { codexSemanticToolSpecs } from "../../vendor/paperclip-runner/index.js";

/** The runner's own completion protocol: runnerd's OpenCode MCP bridge appends
 * exactly these two terminal tools to every managed OpenCode session. */
export const MANAGED_OPENCODE_TERMINAL_TOOL_NAMES = Object.freeze(["paperclip_finish", "paperclip_block"] as const);

/** CONF15-W7. The tool-result text the pinned OpenCode (opencode-ai 1.18.32)
 * writes for a tool call that was still running when its turn was
 * interrupted. Its session processor sets the part to
 * `{ status: "error", error: "Tool execution aborted", metadata: { interrupted: true } }`,
 * and its model-message conversion replays an error part with no interrupted
 * `metadata.output` as an `output-error` with that text, which the Anthropic
 * conversion sends as `{ type: "tool_result", is_error: true, content: "Tool execution aborted" }`
 * (both in the pinned `opencode-ai/bin/opencode.exe` of the provider pack;
 * the same text is in `packages/paperclip-runner/src/provider-events.test.ts`).
 * A managed terminal tool always ends that way: once the server accepts the
 * semantic result, runnerd's OpenCode driver interrupts the turn
 * (`opencode-server-driver.ts`, "Semantic completion accepted."). */
export const MANAGED_OPENCODE_ABORTED_TOOL_RESULT_TEXT = "Tool execution aborted";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Provider-visible tool name to catalog name. OpenCode's bridge prefixes each
 * MCP tool with `paperclip_`, so `paperclip_paperclip_finish` is the catalog's
 * `paperclip_finish`. */
export function managedOpenCodeToolName(value: string): string {
  for (const prefix of ["paperclip__", "paperclip_", "paperclip."]) {
    if (value.startsWith(prefix)) {
      const stripped = value.slice(prefix.length);
      return stripped === "self_read_context" ? "read_context" : stripped;
    }
  }
  return value;
}

/** The two terminal definitions as the pinned OpenCode sends them to the
 * provider, in catalog shape (`name`, `description`, `inputSchema`). Pinned
 * OpenCode 1.18.32's Anthropic conversion sets the root `additionalProperties`
 * of these schemas to false; server-side terminal parsing still enforces the
 * complete completion contract after a call returns. This is the one
 * definition used by the Native catalog, the blocked-interaction catalog hash
 * and the provider-conformance lane. */
export function managedOpenCodeTerminalToolSchemas(): Array<Record<string, unknown>> {
  const tools = codexSemanticToolSpecs().map(tool => {
    const providerTool = structuredClone(tool) as Record<string, unknown>;
    const inputSchema = record(providerTool.inputSchema);
    if (inputSchema.type !== "object" || inputSchema.additionalProperties !== true)
      throw new Error("managed_opencode_terminal_tool_schema_invalid");
    providerTool.inputSchema = { ...inputSchema, additionalProperties: false };
    return providerTool;
  });
  const names = tools.map(tool => tool.name);
  if (names.length !== MANAGED_OPENCODE_TERMINAL_TOOL_NAMES.length ||
      !MANAGED_OPENCODE_TERMINAL_TOOL_NAMES.every(name => names.includes(name)))
    throw new Error("managed_opencode_terminal_tool_schema_invalid");
  return tools;
}

/** Exact provider-visible tool list check against a catalog: the same names
 * (after `managedOpenCodeToolName`), descriptions and input schemas, nothing
 * extra and nothing missing. Order is not significant. */
export function managedOpenCodeProviderToolsMatchCatalog(requestTools: unknown, catalog: readonly unknown[]): boolean {
  const expected = catalog.map(value => {
    const tool = record(value);
    return { name: typeof tool.name === "string" ? tool.name : "",
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      input_schema: tool.inputSchema };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const actual = (Array.isArray(requestTools) ? requestTools : []).map(value => {
    const tool = record(value);
    return { name: typeof tool.name === "string" ? managedOpenCodeToolName(tool.name) : "",
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      input_schema: tool.input_schema };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return isDeepStrictEqual(actual, expected);
}

/** Provider-conformance tool surface (CONF8). A probe request is either
 * tool-free, or carries exactly the runner's two terminal definitions with
 * `tool_choice` absent or `{ type: "auto" }`. Any other tool, name, schema or
 * choice is refused. Tool-use history and tool-bearing responses are refused
 * separately by the conformance gateway. */
export function managedOpenCodeConformanceToolSurfaceAllowed(request: { tools?: unknown; tool_choice?: unknown }): boolean {
  if (request.tools === undefined) return request.tool_choice === undefined;
  return Array.isArray(request.tools) && request.tools.length === MANAGED_OPENCODE_TERMINAL_TOOL_NAMES.length &&
    managedOpenCodeProviderToolsMatchCatalog(request.tools, managedOpenCodeTerminalToolSchemas()) &&
    (request.tool_choice === undefined || isDeepStrictEqual(request.tool_choice, { type: "auto" }));
}

/** The conformance gateway's pre-spend tool predicate: the allowed tool
 * surface above, and no `tool_use` or `tool_result` block anywhere in the
 * history. */
export function managedOpenCodeConformanceRequestToolsAllowed(request: {
  tools?: unknown; tool_choice?: unknown; messages: ReadonlyArray<{ content: unknown }>;
}): boolean {
  return managedOpenCodeConformanceToolSurfaceAllowed(request) && request.messages.every(message =>
    !Array.isArray(message.content) || message.content.every(block =>
      record(block).type !== "tool_use" && record(block).type !== "tool_result"));
}

/** The conformance gateway's post-settlement check: a provider response that
 * uses any tool, the runner's terminal tools included, is never forwarded. */
export function managedOpenCodeConformanceResponseToolFree(content: ReadonlyArray<{ type: string }>): boolean {
  return content.every(block => block.type !== "tool_use");
}
