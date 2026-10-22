import { createHash } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentApiKeys, authSessions, authUsers, companyMemberships, instanceUserRoles } from "@paperclipai/db";
import type { AwDeploymentProfile, DeploymentMode } from "@paperclipai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "../middleware/logger.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import type { AuthorizationActor } from "../services/authorization.js";

interface WsSocket {
  readyState: number;
  ping(): void;
  send(data: string): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: "pong", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

interface WsServer {
  clients: Set<WsSocket>;
  close(callback?: () => void): void;
  on(event: "connection", listener: (socket: WsSocket, req: IncomingMessage) => void): void;
  on(event: "close", listener: () => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsSocket) => void,
  ): void;
  emit(event: "connection", ws: WsSocket, req: IncomingMessage): boolean;
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

interface UpgradeContext {
  companyId: string;
  actorType: "board" | "agent";
  actorId: string;
  actor: AuthorizationActor;
}

/** Cloud-proxied browser identity resolved from trusted x-paperclip-cloud-* headers. */
export interface CloudUpgradeActor {
  userId: string;
  /** Companies this actor may subscribe to (primary stack company + real memberships). */
  companyIds: string[];
}

interface IncomingMessageWithContext extends IncomingMessage {
  paperclipWebSocketHandled?: boolean;
  paperclipUpgradeContext?: UpgradeContext;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isWritableUpgradeSocket(socket: Duplex) {
  const maybeWritableState = socket as Duplex & { writable?: boolean; writableEnded?: boolean; writableDestroyed?: boolean };
  return !socket.destroyed && maybeWritableState.writable !== false && !maybeWritableState.writableEnded && !maybeWritableState.writableDestroyed;
}

function closeUpgradeSocket(socket: Duplex) {
  if (!socket.destroyed) {
    socket.destroy();
  }
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  if (!isWritableUpgradeSocket(socket)) {
    closeUpgradeSocket(socket);
    return;
  }

  try {
    socket.once("finish", () => closeUpgradeSocket(socket));
    socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  } catch (err) {
    logger.warn({ err }, "failed to reject live websocket upgrade");
    closeUpgradeSocket(socket);
  }
}

function parseCompanyId(pathname: string) {
  const match = pathname.match(/^\/api\/companies\/([^/]+)\/events\/ws$/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
}

function parseBearerToken(rawAuth: string | string[] | undefined) {
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (!auth) return null;
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice("bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function headersFromIncomingMessage(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(req.headers)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

async function authorizeUpgrade(
  db: Db,
  req: IncomingMessage,
  companyId: string,
  url: URL,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentProfile?: AwDeploymentProfile;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
    resolveCloudActor?: (req: IncomingMessage) => Promise<CloudUpgradeActor | null>;
  },
): Promise<UpgradeContext | null> {
  const queryToken = url.searchParams.get("token")?.trim() ?? "";
  const authToken = parseBearerToken(req.headers.authorization);
  const token = authToken ?? (queryToken.length > 0 ? queryToken : null);

  // Browser board context has no bearer token in local_trusted and authenticated modes.
  if (!token) {
    if (opts.deploymentMode === "local_trusted") {
      return {
        companyId,
        actorType: "board",
        actorId: "local-board",
        actor: { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true },
      };
    }

    // Cloud-managed deployments authenticate proxied browsers with trusted
    // x-paperclip-cloud-* headers, never a local Better Auth session — the
    // session fallback below can only 403 them, which left the live-events
    // socket permanently unreachable behind the Cloud front door. A resolved
    // cloud actor is authoritative: authorize against its membership scope.
    // Absent/invalid cloud headers fall through to the session path, so
    // self-hosted behavior is unchanged.
    if (opts.resolveCloudActor && opts.deploymentProfile !== "saas") {
      const cloudActor = await opts.resolveCloudActor(req);
      if (cloudActor) {
        if (!cloudActor.companyIds.includes(companyId)) return null;
        return {
          companyId,
          actorType: "board",
          actorId: cloudActor.userId,
          actor: { type: "board", userId: cloudActor.userId, source: "cloud_tenant", companyIds: cloudActor.companyIds },
        };
      }
    }

    if (opts.deploymentMode !== "authenticated" || !opts.resolveSessionFromHeaders) {
      return null;
    }

    const session = await opts.resolveSessionFromHeaders(headersFromIncomingMessage(req));
    const userId = session?.user?.id;
    if (!userId || !session.session?.id || session.session.userId !== userId) return null;

    // A cached session resolver cannot keep a deleted/expired login alive.
    // Read the actual account, session and current company authority together.
    const [access] = await db.select({
      sessionId: authSessions.id,
      companyIds: sql<string[]>`array(select m.company_id::text from ${companyMemberships} m
        where m.principal_type='user' and m.principal_id=${userId} and m.status='active')`,
      isInstanceAdmin: opts.deploymentProfile === "saas" ? sql<boolean>`false`
        : sql<boolean>`exists(select 1 from ${instanceUserRoles} r where r.user_id=${userId} and r.role='instance_admin')`,
    }).from(authSessions).innerJoin(authUsers,eq(authUsers.id,authSessions.userId)).where(and(
      eq(authSessions.id,session.session.id),eq(authSessions.userId,userId),gt(authSessions.expiresAt,new Date()),
    )).limit(1);
    if (!access || (!access.isInstanceAdmin && !access.companyIds.includes(companyId))) return null;

    return {
      companyId,
      actorType: "board",
      actorId: userId,
      actor: { type: "board", userId, sessionId: access.sessionId, source: "session", companyIds: access.companyIds, isInstanceAdmin: access.isInstanceAdmin, ignoreInstanceAdmin: opts.deploymentProfile === "saas" },
    };
  }

  const tokenHash = hashToken(token);
  const key = await db
    .select()
    .from(agentApiKeys)
    .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
    .then((rows) => rows[0] ?? null);

  if (!key || key.companyId !== companyId) {
    return null;
  }

  await db
    .update(agentApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentApiKeys.id, key.id));

  return {
    companyId,
    actorType: "agent",
    actorId: key.agentId,
    actor: { type: "agent", source: "agent_key", agentId: key.agentId, companyId: key.companyId, keyId: key.id, keyScope: key.scopeConfig, onBehalfOfUserId: key.responsibleUserId },
  };
}

export function setupLiveEventsWebSocketServer(
  server: HttpServer,
  db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentProfile?: AwDeploymentProfile;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
    /**
     * Resolves a Cloud-proxied browser's identity from the trusted
     * x-paperclip-cloud-* headers on the upgrade request. Wired by managed
     * deployments; self-hosted instances leave it unset.
     */
    resolveCloudActor?: (req: IncomingMessage) => Promise<CloudUpgradeActor | null>;
  },
) {
  const wss = new WebSocketServer({ noServer: true });
  const cleanupByClient = new Map<WsSocket, () => void>();
  const aliveByClient = new Map<WsSocket, boolean>();

  const pingInterval = setInterval(() => {
    for (const socket of wss.clients) {
      if (!aliveByClient.get(socket)) {
        socket.terminate();
        continue;
      }
      aliveByClient.set(socket, false);
      socket.ping();
    }
  }, 30000);

  wss.on("connection", (socket: WsSocket, req: IncomingMessage) => {
    const context = (req as IncomingMessageWithContext).paperclipUpgradeContext;
    if (!context) {
      socket.close(1008, "missing context");
      return;
    }

    let delivery = Promise.resolve();
    let pending = 0;
    const unsubscribe = subscribeCompanyLiveEvents(context.companyId, (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      // ponytail: bounded serial delivery; reconnect uses native REST snapshots
      // if a slow source review accumulates more than 64 events.
      if (++pending > 64) {
        socket.close(1013, "live delivery backlog");
        return;
      }
      delivery = delivery.then(async () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const current = await authorizeUpgrade(db, req, context.companyId, new URL(req.url!, "http://localhost"), opts);
        if (!current || current.actorType !== context.actorType || current.actorId !== context.actorId
          || current.actor.source !== context.actor.source
          || (current.actor.type === "board" && context.actor.type === "board" && current.actor.sessionId !== context.actor.sessionId)
          || (current.actor.type === "agent" && context.actor.type === "agent" && current.actor.keyId !== context.actor.keyId)) {
          socket.close(1008, "live access changed");
          return;
        }
        const admitted = await analyticalLiveEventForReader(db, event, current.actor);
        if (admitted && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(admitted));
      }).catch((err) => {
        logger.warn({ err, companyId: context.companyId }, "live event admission failed");
        socket.close(1011, "live admission unavailable");
      }).finally(() => { pending -= 1; });
    });

    cleanupByClient.set(socket, unsubscribe);
    aliveByClient.set(socket, true);

    socket.on("pong", () => {
      aliveByClient.set(socket, true);
    });

    socket.on("close", () => {
      const cleanup = cleanupByClient.get(socket);
      if (cleanup) cleanup();
      cleanupByClient.delete(socket);
      aliveByClient.delete(socket);
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err, companyId: context.companyId }, "live websocket client error");
    });
  });

  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  server.on("upgrade", (req, socket, head) => {
    if ((req as IncomingMessageWithContext).paperclipWebSocketHandled) {
      return;
    }

    const onRawSocketError = (err: Error) => {
      logger.warn({ err, path: req.url }, "live websocket upgrade socket error");
    };
    const cleanupRawSocketListeners = () => {
      socket.off("error", onRawSocketError);
      socket.off("close", cleanupRawSocketListeners);
    };

    socket.on("error", onRawSocketError);
    socket.once("close", cleanupRawSocketListeners);

    if (!req.url) {
      rejectUpgrade(socket, "400 Bad Request", "missing url");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const companyId = parseCompanyId(url.pathname);
    if (!companyId) {
      closeUpgradeSocket(socket);
      return;
    }

    void authorizeUpgrade(db, req, companyId, url, {
      deploymentMode: opts.deploymentMode,
      deploymentProfile: opts.deploymentProfile,
      resolveSessionFromHeaders: opts.resolveSessionFromHeaders,
      resolveCloudActor: opts.resolveCloudActor,
    })
      .then((context) => {
        if (!context) {
          rejectUpgrade(socket, "403 Forbidden", "forbidden");
          return;
        }

        if (!isWritableUpgradeSocket(socket)) {
          cleanupRawSocketListeners();
          return;
        }

        const reqWithContext = req as IncomingMessageWithContext;
        reqWithContext.paperclipUpgradeContext = context;

        cleanupRawSocketListeners();
        wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
          wss.emit("connection", ws, reqWithContext);
        });
      })
      .catch((err) => {
        logger.error({ err, path: req.url }, "failed websocket upgrade authorization");
        rejectUpgrade(socket, "500 Internal Server Error", "upgrade failed");
      });
  });

  return wss;
}
