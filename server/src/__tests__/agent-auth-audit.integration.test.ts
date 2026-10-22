import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog, agents, companies, createDb, heartbeatRuns,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, type Db,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";

describe("agent JWT mismatch audit against migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("blentera-auth-audit-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  beforeEach(() => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "auth-audit-postgres-fixture");
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "3600");
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function seed(kind: "missing" | "foreign company" | "other agent" | "owned") {
    const companyId = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Audit fixture", issuePrefix: `AU${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Authenticated agent", status: "active" });
    if (kind !== "missing") {
      let runCompanyId = companyId, runAgentId = agentId;
      if (kind === "foreign company") {
        runCompanyId = randomUUID();
        await db.insert(companies).values({ id: runCompanyId, name: "Other company", issuePrefix: `AU${runCompanyId.slice(0, 6)}` });
      }
      if (kind === "foreign company" || kind === "other agent") {
        runAgentId = randomUUID();
        await db.insert(agents).values({ id: runAgentId, companyId: runCompanyId, name: "Other agent" });
      }
      await db.insert(heartbeatRuns).values({ id: runId, companyId: runCompanyId, agentId: runAgentId });
    }
    return { companyId, agentId, runId, headerRunId: randomUUID() };
  }

  function rejectMismatch(source: Db, fixture: Awaited<ReturnType<typeof seed>>) {
    const app = express();
    app.use(actorMiddleware(source, { deploymentMode: "local_trusted", resolveSession: async () => null }));
    app.get("/protected", (_req, res) => { res.json({ reachedProtectedRoute: true }); });
    app.use(errorHandler);
    const token = createLocalAgentJwt(fixture.agentId, fixture.companyId, "codex_local", fixture.runId, null);
    return request(app).get("/protected").set("Authorization", `Bearer ${token}`)
      .set("X-Paperclip-Run-Id", fixture.headerRunId).then(response => response);
  }

  async function auditFor(fixture: Awaited<ReturnType<typeof seed>>) {
    return db.select().from(activityLog).where(and(eq(activityLog.companyId, fixture.companyId),
      eq(activityLog.action, "auth.agent_jwt_run_header_mismatch"), eq(activityLog.entityId, fixture.runId)));
  }

  it.each(["missing", "foreign company", "other agent", "owned"] as const)(
    "persists a rejected mismatch with only an eligible run FK: %s", async kind => {
      const fixture = await seed(kind);
      const response = await rejectMismatch(db, fixture);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe("agent_jwt_run_id_mismatch");
      const rows = await auditFor(fixture);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: fixture.agentId, agentId: fixture.agentId,
        runId: kind === "owned" ? fixture.runId : null,
        details: { claimRunId: fixture.runId, headerRunId: fixture.headerRunId, method: "GET", url: "/protected" } });
    },
  );

  it("holds the run FK through audit commit while an overlapping DELETE waits", async () => {
    const fixture = await seed("owned");
    let atAuditInsert = false, auditBackend = 0;
    let releaseAudit!: () => void;
    const held = new Promise<void>(resolve => { releaseAudit = resolve; });
    // Delay only the insert's scheduling. The middleware SELECT, key-share
    // lock, transaction, INSERT and competing DELETE all execute in PostgreSQL.
    const gatedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") return (operation: Parameters<Db["transaction"]>[0]) =>
          target.transaction(async tx => {
            const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`) as unknown as Array<{ pid: number }>;
            auditBackend = backend.pid;
            return operation(new Proxy(tx, {
              get(transaction, key, transactionReceiver) {
                if (key === "insert") return (table: typeof activityLog) => {
                  if (table !== activityLog) return transaction.insert(table);
                  return { values: async (values: typeof activityLog.$inferInsert) => {
                    atAuditInsert = true;
                    await held;
                    return transaction.insert(activityLog).values(values);
                  } };
                };
                const value = Reflect.get(transaction, key, transactionReceiver);
                return typeof value === "function" ? value.bind(transaction) : value;
              },
            }));
          });
        return Reflect.get(target, property, receiver);
      },
    });
    const response = rejectMismatch(gatedDb, fixture);
    let reserved: Awaited<ReturnType<Db["$client"]["reserve"]>> | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => { expect(atAuditInsert).toBe(true); }, { timeout: 10_000 });
      reserved = await db.$client.reserve();
      const [backend] = await reserved<{ pid: number }[]>`select pg_backend_pid() as pid`;
      deletion = reserved`delete from heartbeat_runs where id = ${fixture.runId}`.then(() => null, error => error);
      await vi.waitFor(async () => {
        const [state] = await db.execute(sql`select ${auditBackend} = any(pg_blocking_pids(${backend.pid})) as blocked`) as unknown as Array<{ blocked: boolean }>;
        expect(state.blocked).toBe(true);
      }, { timeout: 10_000 });
      releaseAudit();
      expect((await response).status).toBe(422);
      // The existing NO ACTION FK rejects deletion after audit commit. The
      // audit insert itself must succeed and retain the linked security event.
      expect(await deletion).toMatchObject({ code: "23503" });
      expect(await auditFor(fixture)).toMatchObject([{ runId: fixture.runId }]);
    } finally {
      releaseAudit();
      await response;
      await deletion;
      reserved?.release();
    }
  });
});
