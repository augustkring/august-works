import { EXPERIENCE_CARD_TOOL } from "@paperclipai/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperclipApiClient } from "./client.js";
import { readConfigFromEnv, type PaperclipMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createPaperclipMcpServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "paperclip",
    version: "0.1.0",
  });

  const client = new PaperclipApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    if (tool.name === EXPERIENCE_CARD_TOOL) {
      // Preserve the strict object and cross-company refinement at this new
      // boundary. An annotation is an SDK hint, never an authorization grant.
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, tool.execute);
    } else {
      server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
    }
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: PaperclipMcpConfig = readConfigFromEnv()) {
  const { server } = createPaperclipMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
