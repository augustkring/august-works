import type { IncomingMessage, Server } from "node:http";
import type { RequestHandler } from "express";

type TrustPeer = (address: string, hop: number) => boolean;
type OriginRequest = Pick<IncomingMessage, "headers" | "socket" | "method">;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function oneHeader(req: OriginRequest, key: string): string | undefined {
  const value = req.headers[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url.origin : null;
  } catch { return null; }
}

/** Shared HTTP/WS ingress policy. The allowlist is configuration, never request authority. */
export function publicOriginRejection(req: OriginRequest, allowedOrigins: readonly string[], trustPeer?: TrustPeer): string | null {
  if (["host", "origin", "x-forwarded-host", "x-forwarded-proto"].some((key) => Array.isArray(req.headers[key]))) {
    return "Ambiguous app host or origin";
  }
  const trusted = Boolean(req.socket.remoteAddress && trustPeer?.(req.socket.remoteAddress, 0));
  const host = trusted ? oneHeader(req, "x-forwarded-host") ?? oneHeader(req, "host") : oneHeader(req, "host");
  const protocol = trusted
    ? oneHeader(req, "x-forwarded-proto") ?? ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http")
    : (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
  if (!host || /[\s,\/\\?#@]/.test(host) || protocol !== "https") return "Untrusted app host or protocol";
  const target = exactOrigin(`${protocol}://${host}`);
  if (!target || !allowedOrigins.includes(target)) return "Untrusted app host or protocol";
  const origin = oneHeader(req, "origin");
  if (origin !== undefined) {
    if (exactOrigin(origin) !== target) return "Browser origin must match the app origin";
  } else if (oneHeader(req, "cookie") && !SAFE_METHODS.has(req.method ?? "GET")) {
    // Origin-less browser form submissions still need a same-origin Referer.
    try {
      if (new URL(oneHeader(req, "referer") ?? "").origin !== target) return "Browser mutation requires a trusted origin";
    } catch { return "Browser mutation requires a trusted origin"; }
  }
  return null;
}

function discardUntrustedProxyHeaders(req: OriginRequest, trustPeer?: TrustPeer): void {
  if (req.socket.remoteAddress && trustPeer?.(req.socket.remoteAddress, 0)) return;
  for (const key of ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip"]) {
    delete req.headers[key];
  }
}

export function publicOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const trustPeer = req.app.get("trust proxy fn") as TrustPeer | undefined;
    const rejection = publicOriginRejection(req, allowedOrigins, trustPeer);
    if (rejection) { res.status(403).json({ error: rejection }); return; }
    discardUntrustedProxyHeaders(req, trustPeer);
    next();
  };
}

/** Register before every WebSocket handler; upgrade bypasses Express middleware. */
export function setupPublicOriginUpgradeGuard(server: Server, allowedOrigins: readonly string[], trustPeer?: TrustPeer): void {
  server.prependListener("upgrade", (req, socket) => {
    const rejection = publicOriginRejection(req, allowedOrigins, trustPeer)
      ?? (req.headers.cookie && !req.headers.origin ? "Browser WebSocket requires a trusted origin" : null);
    if (!rejection) { discardUntrustedProxyHeaders(req, trustPeer); return; }
    (req as IncomingMessage & { paperclipWebSocketHandled?: boolean }).paperclipWebSocketHandled = true;
    socket.once("error", () => socket.destroy());
    // End immediately so no following upgrade handler can authorize this socket.
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.once("finish", () => socket.destroy());
  });
}
