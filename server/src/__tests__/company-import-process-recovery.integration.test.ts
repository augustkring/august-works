import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@paperclipai/shared/portability-hash";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  customerOperations,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  principalPermissionGrants,
} from "@paperclipai/db";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { companyPortabilityService } from "../services/company-portability.js";
import { ImportSourceChangedError } from "../errors.js";
import { companyImportJobService, type CompanyImportJob } from "../services/company-import-jobs.js";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const workerPath = fileURLToPath(new URL("./fixtures/company-import-crash-worker.ts", import.meta.url));
const tsxLoaderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cli/node_modules/tsx/dist/loader.mjs");

function buildImportBody(companyId: string, agentSlugs = ["worker"]) {
  const files: Record<string, string> = {
    "COMPANY.md": ["---", "name: Recovery Fixture", "includes:", ...agentSlugs.map(slug => `  - agents/${slug}/AGENTS.md`), "---", ""].join("\n"),
    ".paperclip.yaml": ["schema: paperclip/v1", "agents:", ...agentSlugs.flatMap(slug => [
      `  ${slug}:`, "    adapter:", "      type: codex_local", "      config: {}",
    ]), ""].join("\n"),
  };
  for (const slug of agentSlugs) {
    files[`agents/${slug}/AGENTS.md`] = ["---", `name: ${slug}`, `slug: ${slug}`, "kind: agent", "---", "", `# ${slug}`, ""].join("\n");
  }
  return {
    source: { type: "inline", files },
    include: { company: false, agents: true, projects: false, issues: false, skills: false },
    target: { mode: "existing_company", companyId },
    collisionStrategy: "rename",
  };
}

async function waitForWorkerStage(child: ChildProcess, timeoutMs: number) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for the native import child process")), timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const value = message as Record<string, unknown>;
      if (value.type === "ready") {
        clearTimeout(timer);
        resolve(value);
      } else if (value.type === "worker_error") {
        clearTimeout(timer);
        reject(new Error(`Native import child error ${String(value.code)}${value.status ? ` (${String(value.status)})` : ""}: ${String(value.message)}`));
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      reject(new Error(`Native import child exited before domain-return stage (${code ?? signal})`));
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
}

describeEmbeddedPostgres("company import process recovery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("company-import-process-recovery-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  it("preserves one real imported Agent and the original unknown job after child death before receipt", async () => {
    const companyId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Process recovery target", issuePrefix: `CIR${companyId.slice(0, 5)}`,
      requireBoardApprovalForNewAgents: false });
    await db.insert(authUsers).values({ id: userId, name: "Process recovery owner", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active", permissionsInitializedAt: now });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId,
      principalType: "user" as const, principalId: userId, ...grant })));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });

    // Block the second native target write after the first Agent and its effect
    // receipt have committed. The parent kills the HTTP worker and terminates
    // only the blocked PostgreSQL statement, so the first write remains while
    // the second one rolls back and the durable attempt becomes recoverable.
    const crashBarrier = `aw_test_import_crash_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION ${crashBarrier}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.company_id = '${companyId}'::uuid
          AND (SELECT count(*) FROM agents WHERE company_id = NEW.company_id) >= 1 THEN
          PERFORM pg_sleep(120);
        END IF;
        RETURN NEW;
      END;
      $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${crashBarrier}
      BEFORE INSERT ON agents
      FOR EACH ROW EXECUTE FUNCTION ${crashBarrier}();
    `));

    const originalBody = buildImportBody(companyId, ["worker", "worker-two"]);
    const portability = companyPortabilityService(db);
    const preview = await portability.previewImport(originalBody as Parameters<typeof portability.previewImport>[0]);
    expect(preview.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    const reordered = await portability.previewImport({ ...originalBody, source: { type: "inline",
      files: Object.fromEntries(Object.entries(originalBody.source.files).reverse()) } } as Parameters<typeof portability.previewImport>[0]);
    expect(reordered.sourceFingerprint).toBe(preview.sourceFingerprint);
    const body = { ...originalBody, expectedSourceFingerprint: preview.sourceFingerprint };
    const changed = { ...body, source: { ...body.source, files: { ...body.source.files,
      "agents/worker/AGENTS.md": body.source.files["agents/worker/AGENTS.md"] + "Changed after preview\n" } } };
    await expect(portability.importBundle(changed as Parameters<typeof portability.importBundle>[0], userId))
      .rejects.toBeInstanceOf(ImportSourceChangedError);
    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId))).toHaveLength(0);
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false };
    const idempotencyKey = `process-recovery:${randomUUID()}`;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-import-child-home-"));
    let child: ChildProcess | null = null;
    let blockedBackendPid: number | null = null;
    try {
      child = fork(workerPath, [], {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
        execArgv: ["--import", tsxLoaderPath],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          TMPDIR: os.tmpdir(),
          PAPERCLIP_HOME: home,
          PAPERCLIP_TEST_DATABASE_URL: database!.connectionString,
          PAPERCLIP_TEST_COMPANY_ID: companyId,
          PAPERCLIP_TEST_USER_ID: userId,
          PAPERCLIP_TEST_SESSION_ID: sessionId,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const ready = await waitForWorkerStage(child, 45_000);
      expect(typeof ready.port).toBe("number");
      const accepted = await fetch(`http://127.0.0.1:${String(ready.port)}/api/companies/import?async=1`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      expect(accepted.status).toBe(202);
      const acceptedBody = await accepted.json() as { job: { id: string }; statusUrl: string };
      expect(acceptedBody.job.id).toMatch(/^import-[0-9a-f-]{36}$/i);

      const originalId = acceptedBody.job.id;
      let originalAttemptId: string | null = null;
      let importedWorkerId: string | null = null;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const job = await companyImportJobService(db).get(originalId, `board:${userId}`);
        const workerRows = await db.select().from(agents).where(eq(agents.companyId, companyId));
        if (job?.attemptId && job.status === "running" && workerRows.length === 1
          && job.effectCheckpoint?.state === "applying"
          && job.effectCheckpoint.idMap.some(effect => effect.kind === "agent")) {
          const sleeping = await db.execute<{ pid: number }>(sql`
            select pid from pg_stat_activity where datname = current_database()
              and wait_event = 'PgSleep' and query ilike '%agent%'
          `);
          if (sleeping.length > 0) {
            originalAttemptId = job.attemptId;
            importedWorkerId = workerRows[0]!.id;
            blockedBackendPid = sleeping[0]!.pid;
            break;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(originalAttemptId, "route never reached post-effect settlement barrier").toBeTruthy();
      expect(importedWorkerId).toBeTruthy();

      const exit = once(child, "exit");
      child.kill("SIGKILL");
      expect(blockedBackendPid).toBeTruthy();
      const terminated = await db.execute<{ terminated: boolean }>(sql`
        select pg_terminate_backend(${blockedBackendPid}) as terminated
      `);
      expect(terminated[0]?.terminated, "database statement fault injection did not terminate the in-flight effect").toBe(true);
      const [exitCode, exitSignal] = await exit as [number | null, NodeJS.Signals | null];
      expect(exitCode).toBeNull();
      expect(exitSignal).toBe("SIGKILL");
      expect((await companyImportJobService(db).get(originalId, `board:${userId}`))?.status).toBe("running");

      const actorKey = `board:${userId}`;
      expect(await companyImportJobService(db).recoverInterrupted()).toEqual([]);
      // Shorten the crashed worker's lease into the future, then let the real
      // expiry condition pass before the original scheduler owner recovers it.
      await db.update(customerOperations).set({ leaseExpiresAt: new Date(Date.now() + 150) })
        .where(eq(customerOperations.id, originalId));
      await new Promise(resolve => setTimeout(resolve, 200));
      const recoveredRows = await companyImportJobService(db).recoverInterrupted();
      expect(recoveredRows).toContainEqual({ id: originalId });
      const recovered = await companyImportJobService(db).get(originalId, actorKey);
      expect(recovered).toMatchObject({ id: originalId, attemptId: originalAttemptId, status: "needs_reconciliation",
        errorCode: "import_outcome_unknown" });

      const imported = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, importedWorkerId!)));
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({ id: importedWorkerId, status: "idle" });

      const restartedApp = express();
      restartedApp.use(express.json());
      restartedApp.use((req, _res, next) => { req.actor = actor; next(); });
      restartedApp.use("/api/companies", companyRoutes(db));
      restartedApp.use(errorHandler);
      const statusAfterRestart = await request(restartedApp).get(acceptedBody.statusUrl).expect(200);
      expect(statusAfterRestart.body).toMatchObject({ job: { id: originalId, status: "needs_reconciliation" },
        operation: { id: originalId, status: "inconclusive", unknownOutcome: true } });
      const duplicateHttp = await request(restartedApp).post("/api/companies/import")
        .set("idempotency-key", idempotencyKey).send(body).expect(409);
      expect(duplicateHttp.body).toMatchObject({ code: "import_outcome_unknown" });

      const inputHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
      await expect(companyImportJobService(db).admit({ actorKey, userId, actorKind: "board", inputHash,
        scopeKey: `company:${companyId}`, companyId, idempotencyKey })).rejects.toMatchObject({
        status: 409, details: { code: "import_outcome_unknown" },
      });
      await expect(companyImportJobService(db).admit({ actorKey, userId, actorKind: "board", inputHash,
        scopeKey: `company:${companyId}`, companyId, idempotencyKey: `new-attempt:${randomUUID()}` })).rejects.toMatchObject({
        status: 409, details: { code: "import_outcome_unknown" },
      });
      expect(await db.select({ id: customerOperations.id }).from(customerOperations)
        .where(eq(customerOperations.requestedByUserId, userId))).toHaveLength(1);
      const retainedAgent = await db.select().from(agents).where(and(
        eq(agents.companyId, companyId), eq(agents.id, importedWorkerId!),
      ));
      expect(retainedAgent).toHaveLength(1);
      expect((await companyImportJobService(db).get(originalId, actorKey))?.attemptId).toBe(originalAttemptId);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      if (blockedBackendPid) {
        const stillActive = await db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where pid=${blockedBackendPid}`);
        if (stillActive.length) await db.execute(sql`select pg_terminate_backend(${blockedBackendPid})`);
      }
      await fs.rm(home, { recursive: true, force: true });
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${crashBarrier} ON agents;`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${crashBarrier}();`));
    }
  }, 90_000);

  it("returns the original succeeded receipt when the HTTP worker dies during settlement", async () => {
    const companyId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Settled import target", issuePrefix: `CIR${companyId.slice(0, 5)}`,
      requireBoardApprovalForNewAgents: false });
    await db.insert(authUsers).values({ id: userId, name: "Settled import owner", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active", permissionsInitializedAt: now });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId,
      principalType: "user" as const, principalId: userId, ...grant })));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });

    const settlementBarrier = `aw_test_import_settlement_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION ${settlementBarrier}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.operation_type = 'company_import' AND NEW.status = 'succeeded' THEN
          PERFORM pg_sleep(30);
        END IF;
        RETURN NEW;
      END;
      $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${settlementBarrier}
      BEFORE UPDATE OF status ON customer_operations
      FOR EACH ROW EXECUTE FUNCTION ${settlementBarrier}();
    `));

    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false };
    const input = buildImportBody(companyId);
    const portability = companyPortabilityService(db);
    const preview = await portability.previewImport(input as Parameters<typeof portability.previewImport>[0]);
    const body = { ...input, expectedSourceFingerprint: preview.sourceFingerprint };
    const idempotencyKey = `settled-process-recovery:${randomUUID()}`;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-import-settled-home-"));
    let child: ChildProcess | null = null;
    let settlementBackendPid: number | null = null;
    try {
      child = fork(workerPath, [], {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
        execArgv: ["--import", tsxLoaderPath],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          TMPDIR: os.tmpdir(),
          PAPERCLIP_HOME: home,
          PAPERCLIP_TEST_DATABASE_URL: database!.connectionString,
          PAPERCLIP_TEST_COMPANY_ID: companyId,
          PAPERCLIP_TEST_USER_ID: userId,
          PAPERCLIP_TEST_SESSION_ID: sessionId,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const ready = await waitForWorkerStage(child, 45_000);
      const accepted = await fetch(`http://127.0.0.1:${String(ready.port)}/api/companies/import?async=1`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
      expect(accepted.status).toBe(202);
      const acceptedBody = await accepted.json() as { job: { id: string }; statusUrl: string };
      const deadline = Date.now() + 20_000;
      let attemptId: string | null = null;
      let importedAgentId: string | null = null;
      while (Date.now() < deadline) {
        const job = await companyImportJobService(db).get(acceptedBody.job.id, `board:${userId}`);
        const targetAgents = await db.select().from(agents).where(eq(agents.companyId, companyId));
        const sleeping = await db.execute<{ pid: number }>(sql`
          select pid from pg_stat_activity where datname = current_database()
            and wait_event = 'PgSleep' and query ilike '%customer_operations%'
        `);
        if (job?.attemptId && job.status === "running" && targetAgents.length === 1 && sleeping.length > 0) {
          attemptId = job.attemptId;
          importedAgentId = targetAgents[0]!.id;
          settlementBackendPid = sleeping[0]!.pid;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(attemptId, "route did not enter settlement with the original effect persisted").toBeTruthy();
      expect(importedAgentId).toBeTruthy();

      const exit = once(child, "exit");
      child.kill("SIGKILL");
      const [exitCode, exitSignal] = await exit as [number | null, NodeJS.Signals | null];
      expect(exitCode).toBeNull();
      expect(exitSignal).toBe("SIGKILL");

      const settleDeadline = Date.now() + 40_000;
      let settled: CompanyImportJob | null = null;
      while (Date.now() < settleDeadline) {
        settled = await companyImportJobService(db).get(acceptedBody.job.id, `board:${userId}`);
        if (settled?.status === "succeeded") break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(settled).toMatchObject({ id: acceptedBody.job.id, attemptId, status: "succeeded",
        resultRef: { companyId, agentCount: 1, companyAction: "unchanged" } });
      expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId)))
        .toEqual([{ id: importedAgentId }]);

      const restartedApp = express();
      restartedApp.use(express.json());
      restartedApp.use((req, _res, next) => { req.actor = actor; next(); });
      restartedApp.use("/api/companies", companyRoutes(db));
      restartedApp.use(errorHandler);
      const receipt = await request(restartedApp).get(acceptedBody.statusUrl).expect(200);
      expect(receipt.body).toMatchObject({ job: { id: acceptedBody.job.id, status: "succeeded",
        result: { companyId, agentCount: 1 } }, operation: { id: acceptedBody.job.id, status: "succeeded", attempt: 1 } });
      const duplicate = await request(restartedApp).post("/api/companies/import")
        .set("idempotency-key", idempotencyKey).send(body).expect(409);
      expect(duplicate.body).toMatchObject({ code: "import_already_completed" });
      expect(await db.select({ id: customerOperations.id }).from(customerOperations)
        .where(eq(customerOperations.requestedByUserId, userId))).toHaveLength(1);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      if (settlementBackendPid) {
        const stillActive = await db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where pid=${settlementBackendPid}`);
        if (stillActive.length) await db.execute(sql`select pg_terminate_backend(${settlementBackendPid})`);
      }
      await fs.rm(home, { recursive: true, force: true });
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${settlementBarrier} ON customer_operations;`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${settlementBarrier}();`));
    }
  }, 90_000);

  it("rechecks the current Human after an HTTP import effect and stops before the next target write", async () => {
    const companyId = randomUUID();
    const userId = `user-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Revoked import target", issuePrefix: `CIR${companyId.slice(0, 5)}`,
      requireBoardApprovalForNewAgents: false });
    await db.insert(authUsers).values({ id: userId, name: "Revoked import owner", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active", permissionsInitializedAt: now });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId,
      principalType: "user" as const, principalId: userId, ...grant })));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });

    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false };
    const input = buildImportBody(companyId, ["worker", "worker-two"]);
    const portability = companyPortabilityService(db);
    const preview = await portability.previewImport(input as Parameters<typeof portability.previewImport>[0]);
    expect(preview.plan.agentPlans.map(agent => agent.slug)).toEqual(expect.arrayContaining(["worker", "worker-two"]));
    expect(preview.plan.agentPlans).toHaveLength(2);
    const body = { ...input, expectedSourceFingerprint: preview.sourceFingerprint };
    const revocationTrigger = `aw_test_revoke_import_human_${randomUUID().replaceAll("-", "")}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION ${revocationTrigger}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM "session" WHERE user_id = '${userId}';
        RETURN NEW;
      END;
      $$;
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${revocationTrigger}
      AFTER INSERT ON agents
      FOR EACH ROW EXECUTE FUNCTION ${revocationTrigger}();
    `));

    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-import-revoke-home-"));
    let child: ChildProcess | null = null;
    try {
      child = fork(workerPath, [], {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
        execArgv: ["--import", tsxLoaderPath],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          TMPDIR: os.tmpdir(),
          PAPERCLIP_HOME: home,
          PAPERCLIP_TEST_DATABASE_URL: database!.connectionString,
          PAPERCLIP_TEST_COMPANY_ID: companyId,
          PAPERCLIP_TEST_USER_ID: userId,
          PAPERCLIP_TEST_SESSION_ID: sessionId,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const ready = await waitForWorkerStage(child, 45_000);
      const accepted = await fetch(`http://127.0.0.1:${String(ready.port)}/api/companies/import?async=1`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `session-revoke:${randomUUID()}` },
        body: JSON.stringify(body),
      });
      expect(accepted.status).toBe(202);
      const acceptedBody = await accepted.json() as { job: { id: string } };
      const deadline = Date.now() + 45_000;
      let recoveredJob: CompanyImportJob | null = null;
      let targetAgents: Array<typeof agents.$inferSelect> = [];
      let remainingSessions: Array<{ id: string }> = [];
      while (Date.now() < deadline) {
        recoveredJob = await companyImportJobService(db).get(acceptedBody.job.id, `board:${userId}`);
        targetAgents = await db.select().from(agents).where(eq(agents.companyId, companyId));
        remainingSessions = await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, userId));
        if (recoveredJob?.status === "needs_reconciliation" && targetAgents.length === 1 && remainingSessions.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(remainingSessions).toEqual([]);
      expect(targetAgents).toHaveLength(1);
      expect(targetAgents[0]).toMatchObject({ status: "idle" });
      expect(["worker", "worker-two"]).toContain(targetAgents[0]!.name);
      expect(recoveredJob).toMatchObject({ id: acceptedBody.job.id, status: "needs_reconciliation",
        errorCode: "import_outcome_unknown" });
      expect(recoveredJob?.effectCheckpoint?.idMap.some(item => item.kind === "agent")).toBe(true);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await fs.rm(home, { recursive: true, force: true });
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${revocationTrigger} ON agents;`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${revocationTrigger}();`));
    }
  }, 90_000);
});
