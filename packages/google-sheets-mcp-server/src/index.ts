import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readConfigFromEnv, type GoogleSheetsMcpConfig } from "./config.js";
import { createGoogleSheetsClient, type GoogleSheetsClient } from "./google-client.js";
import { createToolDefinitions } from "./tools.js";

export interface CreateGoogleSheetsMcpServerOptions {
  client?: GoogleSheetsClient;
}

export function createGoogleSheetsMcpServer(
  config: GoogleSheetsMcpConfig = readConfigFromEnv(),
  options: CreateGoogleSheetsMcpServerOptions = {},
) {
  const server = new McpServer({
    name: "paperclip-google-sheets",
    version: "0.1.0",
  });

  const client = options.client ?? createGoogleSheetsClient(config.serviceAccount);
  const tools = createToolDefinitions({
    client,
    allowedSpreadsheetIds: config.allowedSpreadsheetIds,
    secretRedactions: config.secretRedactions,
  });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
      },
      tool.execute,
    );
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: GoogleSheetsMcpConfig = readConfigFromEnv()) {
  serveStdio(() => createGoogleSheetsMcpServer(config).server, { legacy: "serve" });
}

export { createGoogleSheetsClient } from "./google-client.js";
export { createToolDefinitions } from "./tools.js";
export type { GoogleSheetsMcpConfig } from "./config.js";
export type { GoogleSheetsClient } from "./google-client.js";
