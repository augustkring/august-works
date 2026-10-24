import { createHash } from "node:crypto";
import { canonicalJson } from "@paperclipai/shared/portability-hash";
import { eq } from "drizzle-orm";
import { agents, createDb } from "@paperclipai/db";
import { companyImportJobService } from "../../services/company-import-jobs.js";
import { companyPortabilityService } from "../../services/company-portability.js";
import type { AuthorizationActor } from "../../services/authorization.js";

function safeFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const details = value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : {};
  const rawCode = typeof details.code === "string" ? details.code : typeof value.code === "string" ? value.code : "native_import_failed";
  const code = /^[a-zA-Z0-9_:-]{1,80}$/.test(rawCode) ? rawCode : "native_import_failed";
  const status = typeof value.status === "number" && Number.isInteger(value.status) ? value.status : undefined;
  return { code, ...(status ? { status } : {}), message: "Native portability import did not return." };
}

async function main() {
  const connectionString = process.env.PAPERCLIP_TEST_DATABASE_URL;
  const companyId = process.env.PAPERCLIP_TEST_COMPANY_ID;
  const userId = process.env.PAPERCLIP_TEST_USER_ID;
  const sessionId = process.env.PAPERCLIP_TEST_SESSION_ID;
  const importJson = process.env.PAPERCLIP_TEST_IMPORT_JSON;
  const idempotencyKey = process.env.PAPERCLIP_TEST_IMPORT_KEY;
  if (!connectionString || !companyId || !userId || !sessionId || !importJson || !idempotencyKey) {
    throw new Error("Worker test configuration is incomplete");
  }
  const body = JSON.parse(importJson) as Record<string, unknown>;
  const db = createDb(connectionString, { maxConnections: 4 });
  try {
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false };
    const jobs = companyImportJobService(db);
    const actorKey = `board:${userId}`;
    const inputHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
    const admitted = await jobs.admit({ actorKey, userId, actorKind: "board", inputHash,
      scopeKey: `company:${companyId}`, companyId, idempotencyKey }, actor);
    if (!await jobs.start(admitted.job, actor)) throw new Error("Native import job did not enter its original running attempt");
    const portability = companyPortabilityService(db);
    const result = await portability.importBundle(body as Parameters<typeof portability.importBundle>[0], userId, {
      actor, privateWorkAdmission: "closed", pauseAutomations: true,
    });
    const worker = result.agents.find(agent => agent.slug === "worker");
    if (worker?.id) {
      const [stored] = await db.select().from(agents).where(eq(agents.id, worker.id));
      if (!stored || stored.status !== "paused") throw new Error("Imported worker Agent was not persisted paused");
    }
    if (!process.send) throw new Error("Child test process has no IPC channel");
    await new Promise<void>((resolve, reject) => process.send!({ type: "domain_returned", jobId: admitted.job.id,
      attemptId: admitted.job.attemptId, companyId: result.company.id, agentCount: result.agents.length,
      importedWorkerId: worker?.id ?? null }, error => error ? reject(error) : resolve()));
    // The parent SIGKILLs here: real native domain writes returned, but the
    // operation receipt was deliberately not committed.
    setInterval(() => undefined, 60_000);
  } catch (error) {
    if (process.send) process.send({ type: "worker_error", ...safeFailure(error) });
    await db.$client.end({ timeout: 1 }).catch(() => undefined);
    process.exitCode = 1;
  }
}

void main();
