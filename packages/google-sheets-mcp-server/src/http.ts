import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createGoogleSheetsMcpServer } from "./index.js";
import type { GoogleSheetsMcpConfig } from "./config.js";
import { createGoogleSheetsClient, type GoogleSheetsClient } from "./google-client.js";

export interface GoogleSheetsMcpHttpOptions {
  config: GoogleSheetsMcpConfig;
  client?: GoogleSheetsClient;
  /** Optional shared secret required on the MCP route when provided. */
  token?: string | null;
}

export interface GoogleSheetsMcpHttpServer {
  server: Server;
  /** Resolves to the bound port once listening. */
  listen: (port: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

const MCP_PATH = "/mcp";

function originMatchesHost(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).hostname.toLowerCase() === new URL(`http://${req.headers.host ?? ""}`).hostname.toLowerCase()) return true;
  } catch {
    // Reject malformed Origin or Host values.
  }
  res.writeHead(403, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Origin does not match request host." }));
  return false;
}

function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return value === "localhost" || value === "::1" || (isIP(value) === 4 && value.startsWith("127."));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function presentedToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return null;
}

export function createGoogleSheetsMcpHttpServer(
  options: GoogleSheetsMcpHttpOptions,
): GoogleSheetsMcpHttpServer {
  const requiredToken = options.token?.trim() || null;
  const client = options.client ?? createGoogleSheetsClient(options.config.serviceAccount);
  const mcpHandler = createMcpHandler(
    () => createGoogleSheetsMcpServer(options.config, { client }).server,
    { legacy: "stateless" },
  );
  const handleMcp = toNodeHandler(mcpHandler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  let loopbackBind = true;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname !== MCP_PATH) {
          sendJson(res, 404, { error: "Not found." });
          return;
        }

        if (requiredToken && presentedToken(req) !== requiredToken) {
          sendJson(res, 401, { error: "Unauthorized. Provide GOOGLE_SHEETS_MCP_TOKEN." });
          return;
        }

        if (loopbackBind) {
          if (!validateHost(req, res) || !validateOrigin(req, res)) return;
        } else if (!originMatchesHost(req, res)) return;
        await handleMcp(req, res);
      } catch (error) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal error." });
        } else {
          res.end();
        }
      }
    })();
  });

  return {
    server,
    listen: (port, host = "127.0.0.1") => {
      loopbackBind = isLoopbackHost(host);
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await mcpHandler.close();
    },
  };
}
