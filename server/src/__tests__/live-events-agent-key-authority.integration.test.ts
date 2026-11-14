import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import express from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { agentApiKeys, agents, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { agentApiKeyScopeSchema, normalizeAgentApiKeyScope, type AgentApiKeyScope } from "@paperclipai/shared";
import { authorizationService } from "../services/authorization.js";
import { publishLiveEvent } from "../services/live-events.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native Agent-key live admission follows current company authority", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-live-agent-authority-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seed(scope: AgentApiKeyScope = { kind: "standard" }) {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), keyId = randomUUID(), token = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Current native Agent-key authority", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Actual accountable Human", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values([{ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "admin" },
      { companyId, principalType: "agent", principalId: agentId, status: "active", membershipRole: "member" }]);
    await db.insert(agents).values({ id: agentId, companyId, name: "Actual local presence", role: "engineer", status: "idle", adapterType: "paperclip_runner" });
    await db.insert(agentApiKeys).values({ id: keyId, companyId, agentId, name: "Actual native key", keyHash: createHash("sha256").update(token).digest("hex"), responsibleUserId: userId, scopeConfig: scope });
    const actor = { type: "agent" as const, source: "agent_key" as const, agentId, companyId, keyId, keyScope: scope, onBehalfOfUserId: userId };
    return { companyId, userId, agentId, keyId, token, actor };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  async function server(fixture: Seed) {
    const http = createServer(), wss = setupLiveEventsWebSocketServer(http, db, { deploymentMode: "authenticated", deploymentProfile: "saas" });
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${fixture.companyId}/events/ws`, { headers: { Authorization: `Bearer ${fixture.token}` } });
    socket.on("error", () => {});
    return { socket, close: async () => {
      if (socket.readyState !== WebSocket.CLOSED) { const closed = new Promise<void>(resolve => socket.once("close", () => resolve())); socket.terminate(); await closed; }
      await new Promise<void>(resolve => wss.close(resolve));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    } };
  }
  const companyDecision = (fixture: Seed) => authorizationService(db).decide({ actor: fixture.actor,
    action: "company_scope:read", resource: { type: "company", companyId: fixture.companyId }, enforceResponsibleUserIntersection: true });

  it.each(["human_membership", "human_account"] as const)("closes an existing key socket after %s withdrawal although the actual key remains active", async change => {
    const fixture = await seed();
    expect((await companyDecision(fixture)).allowed).toBe(true);
    const live = await server(fixture);
    try {
      await once(live.socket, "open");
      const initial = once(live.socket, "message");
      publishLiveEvent({ companyId: fixture.companyId, type: "agent.status", payload: { marker: "current Agent and Human positive" } });
      expect(JSON.parse((await initial)[0].toString()).payload.marker).toBe("current Agent and Human positive");
      if (change === "human_membership") {
        // The original HTTP key-auth contract permits paused read access.
        await db.update(agents).set({ status: "paused" }).where(eq(agents.id, fixture.agentId));
        expect((await companyDecision(fixture)).allowed).toBe(true);
        const paused = once(live.socket, "message");
        publishLiveEvent({ companyId: fixture.companyId, type: "agent.status", payload: { marker: "paused read remains canonical" } });
        expect(JSON.parse((await paused)[0].toString()).payload.marker).toBe("paused read remains canonical");
      }
      if (change === "human_membership") await db.update(companyMemberships).set({ status: "suspended" }).where(and(
        eq(companyMemberships.companyId, fixture.companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, fixture.userId)));
      else await db.delete(authUsers).where(eq(authUsers.id, fixture.userId));
      expect((await companyDecision(fixture)).allowed).toBe(false);
      expect(await db.select({ id: agentApiKeys.id }).from(agentApiKeys).where(and(eq(agentApiKeys.id, fixture.keyId), isNull(agentApiKeys.revokedAt)))).toEqual([{ id: fixture.keyId }]);
      const outcome = Promise.race([once(live.socket, "close").then(([code]) => ({ kind: "closed", code })), once(live.socket, "message").then(() => ({ kind: "message" }))]);
      publishLiveEvent({ companyId: fixture.companyId, type: "agent.status", payload: { marker: "withdrawn Human must not receive" } });
      expect(await outcome).toEqual({ kind: "closed", code: 1008 });
    } finally { await live.close(); }
  });

  async function readerServer(fixture: Seed) {
    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/reader", async (req, res) => {
      const decision = await authorizationService(db).decide({ actor: req.actor,
        action: "company_scope:read", resource: { type: "company", companyId: fixture.companyId },
        enforceResponsibleUserIntersection: true });
      res.status(decision.allowed ? 200 : 403).end();
    });
    app.use(errorHandler);
    const http = createServer(app);
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native HTTP listener");
    return { read: () => fetch(`http://127.0.0.1:${address.port}/reader`, {
      headers: { Authorization: `Bearer ${fixture.token}` },
    }), close: () => new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())) };
  }

  it("rejects malformed persisted key scope at the original HTTP authentication boundary", async () => {
    const fixture = await seed();
    const http = await readerServer(fixture);
    try {
      expect((await http.read()).status).toBe(200);
      await db.execute(sql`update ${agentApiKeys} set scope_config=${JSON.stringify({ kind: "skill_test", issueId: "invalid-uuid" })}::jsonb where id=${fixture.keyId}::uuid`);
      expect((await http.read()).status).toBe(401);
    } finally { await http.close(); }
  });

  it.each(["revoke", "delete"] as const)("rejects a key after actual HTTP last-used update wait and %s", async change => {
    const fixture = await seed();
    const http = await readerServer(fixture);
    expect((await http.read()).status).toBe(200);
    let release!: () => void, markReady!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { markReady = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      await tx.select().from(agentApiKeys).where(eq(agentApiKeys.id, fixture.keyId)).for("update");
      const [physical] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = physical!.pid; markReady(); await gate;
      if (change === "delete") await tx.delete(agentApiKeys).where(eq(agentApiKeys.id, fixture.keyId));
      else await tx.update(agentApiKeys).set({ revokedAt: new Date() }).where(eq(agentApiKeys.id, fixture.keyId));
    });
    try {
      await ready;
      const pending = http.read();
      let waiter: { pid: number; query: string } | undefined;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        [waiter] = await db.execute<{ pid: number; query: string }>(sql`select pid,query from pg_stat_activity
          where datname=current_database() and ${holderPid}=any(pg_blocking_pids(pid)) limit 1`);
        if (waiter) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiter?.query).toMatch(/update "agent_api_keys"/i);
      release(); await holder;
      expect((await pending).status).toBe(401);
    } finally { release(); await holder; await http.close(); }
  });

  it.each(["http", "socket"] as const)("preserves the original scoped credential across an actual %s key-row wait", async transport => {
    const fixture = await seed({ kind: "skill_test", issueId: randomUUID() });
    expect((await companyDecision(fixture)).allowed).toBe(false);
    let release!: () => void, markReady!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { markReady = resolve; });
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      await tx.select().from(agentApiKeys).where(eq(agentApiKeys.id, fixture.keyId)).for("update");
      const [physical] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = physical!.pid; markReady(); await gate;
      await tx.update(agentApiKeys).set({ scopeConfig: { kind: "standard" } }).where(eq(agentApiKeys.id, fixture.keyId));
    });
    let close: (() => Promise<void>) | undefined;
    try {
      await ready;
      let outcome: Promise<{ status: number }>;
      if (transport === "http") {
        const http = await readerServer(fixture); close = http.close;
        outcome = http.read().then(response => ({ status: response.status }));
      } else {
        const live = await server(fixture); close = live.close;
        outcome = Promise.race([
          once(live.socket, "open").then(() => ({ status: 101 })),
          once(live.socket, "unexpected-response").then(([, response]) => { response.resume(); return { status: response.statusCode! }; }),
        ]);
      }
      let waiter: { pid: number; query: string } | undefined;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        [waiter] = await db.execute<{ pid: number; query: string }>(sql`select pid,query from pg_stat_activity
          where datname=current_database() and ${holderPid}=any(pg_blocking_pids(pid)) limit 1`);
        if (waiter) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiter?.query).toMatch(/update "agent_api_keys"/i);
      release(); await holder;
      expect(await outcome).toEqual({ status: transport === "http" ? 401 : 403 });
      // A genuinely new request may use the now-current standard key.
      const fresh = await readerServer(fixture);
      try { expect((await fresh.read()).status).toBe(200); } finally { await fresh.close(); }
    } finally { release(); await holder; await close?.(); }
  });

  it("rejects an actually persisted malformed scoped key instead of broadening it to standard", async () => {
    const fixture = await seed();
    await db.execute(sql`update ${agentApiKeys} set scope_config=${JSON.stringify({ kind: "task_bridge", parentIssueId: "invalid-source-uuid" })}::jsonb where id=${fixture.keyId}::uuid`);
    const [stored] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, fixture.keyId));
    expect(stored?.revokedAt).toBeNull();
    expect(agentApiKeyScopeSchema.safeParse(stored?.scopeConfig).success).toBe(false);
    expect.soft(normalizeAgentApiKeyScope(stored?.scopeConfig)).toBeNull();
    const live = await server(fixture);
    try {
      const outcome = await Promise.race([
        once(live.socket, "open").then(() => ({ kind: "open" })),
        once(live.socket, "unexpected-response").then(([, response]) => { response.resume(); return { kind: "denied", status: response.statusCode }; }),
      ]);
      expect(outcome).toEqual({ kind: "denied", status: 403 });
    } finally { await live.close(); }
  });

  it.each<AgentApiKeyScope>([{ kind: "skill_test", issueId: randomUUID() }, { kind: "task_bridge", parentIssueId: randomUUID() }])("rejects canonical scoped-key company subscription for $kind", async scope => {
    const fixture = await seed(scope);
    expect((await companyDecision(fixture)).allowed).toBe(false);
    const live = await server(fixture);
    try {
      const outcome = await Promise.race([
        once(live.socket, "open").then(() => ({ kind: "open" })),
        once(live.socket, "unexpected-response").then(([, response]) => { response.resume(); return { kind: "denied", status: response.statusCode }; }),
      ]);
      expect(outcome).toEqual({ kind: "denied", status: 403 });
    } finally { await live.close(); }
  });
});
