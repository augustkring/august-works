import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createKvDemoMcpServer } from "./index.js";
import { renderStatePage } from "./render.js";
import { KvStore, type KvStateSnapshot } from "./store.js";

export interface KvDemoHttpOptions {
  store?: KvStore;
  /** Optional shared secret required on every route when provided. */
  token?: string | null;
}

export interface KvDemoHttpServer {
  server: Server;
  store: KvStore;
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

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  res.end(html);
}

function presentedToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return null;
}

export function createKvDemoHttpServer(options: KvDemoHttpOptions = {}): KvDemoHttpServer {
  const store = options.store ?? new KvStore();
  const requiredToken = options.token?.trim() || null;
  const mcpHandler = createMcpHandler(() => createKvDemoMcpServer(store).server, { legacy: "stateless" });
  const handleMcp = toNodeHandler(mcpHandler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  let loopbackBind = true;

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          const snapshot = requiredToken
            ? { entries: [], count: 0, revision: 0 }
            : store.snapshot();
          sendHtml(res, 200, renderStatePage(snapshot, { tokenRequired: Boolean(requiredToken) }));
          return;
        }

        if (requiredToken && presentedToken(req) !== requiredToken) {
          sendJson(res, 401, { error: "Unauthorized. Provide the KV_DEMO_TOKEN." });
          return;
        }

        if (url.pathname === MCP_PATH) {
          if (loopbackBind) {
            if (!validateHost(req, res) || !validateOrigin(req, res)) return;
          } else if (!originMatchesHost(req, res)) {
            return;
          }
          await handleMcp(req, res);
          return;
        }

        if (req.method === "GET" && url.pathname === "/api/state") {
          const snapshot: KvStateSnapshot = store.snapshot();
          sendJson(res, 200, snapshot);
          return;
        }

        sendJson(res, 404, { error: "Not found." });
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
    store,
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
