import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@paperclipai/shared/portability-hash";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
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
import { companyImportJobService } from "../services/company-import-jobs.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const workerPath = fileURLToPath(new URL("./fixtures/company-import-crash-worker.ts", import.meta.url));
const tsxLoaderPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../cli/node_modules/tsx/dist/loader.mjs");

function buildImportBody(companyId: string) {
  return {
    source: { type: "inline", files: {
      "COMPANY.md": ["---", "name: Recovery Fixture", "includes:", "  - agents/worker/AGENTS.md", "---", ""].join("\n"),
      "agents/worker/AGENTS.md": ["---", "name: Worker", "slug: worker", "kind: agent", "---", "", "# Worker", ""].join("\n"),
      ".paperclip.yaml": ["schema: paperclip/v1", "agents:", "  worker:", "    adapter:", "      type: codex_local",
        "      config: {}", ""].join("\n"),
    } },
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
      if (value.type === "domain_returned") {
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
      membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId,
      principalType: "user" as const, principalId: userId, ...grant })));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });

    const originalBody = buildImportBody(companyId);
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
    const idempotencyKey = `process-recovery:${randomUUID()}`;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-import-child-home-"));
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
          PAPERCLIP_TEST_IMPORT_JSON: JSON.stringify(body),
          PAPERCLIP_TEST_IMPORT_KEY: idempotencyKey,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const domainReturned = await waitForWorkerStage(child, 45_000);
      expect(domainReturned).toMatchObject({ type: "domain_returned", companyId, agentCount: 1 });
      expect(typeof domainReturned.jobId).toBe("string");
      expect(typeof domainReturned.attemptId).toBe("string");
      expect(typeof domainReturned.importedWorkerId).toBe("string");

      const exit = once(child, "exit");
      child.kill("SIGKILL");
      const [exitCode, exitSignal] = await exit as [number | null, NodeJS.Signals | null];
      expect(exitCode).toBeNull();
      expect(exitSignal).toBe("SIGKILL");

      const originalId = String(domainReturned.jobId);
      const originalAttemptId = String(domainReturned.attemptId);
      const actorKey = `board:${userId}`;
      const recoveredRows = await companyImportJobService(db).recoverInterrupted();
      expect(recoveredRows).toContainEqual({ id: originalId });
      const recovered = await companyImportJobService(db).get(originalId, actorKey);
      expect(recovered).toMatchObject({ id: originalId, attemptId: originalAttemptId, status: "needs_reconciliation",
        errorCode: "import_outcome_unknown" });

      const imported = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, String(domainReturned.importedWorkerId))));
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({ id: domainReturned.importedWorkerId, status: "paused" });

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
        eq(agents.companyId, companyId), eq(agents.id, String(domainReturned.importedWorkerId)),
      ));
      expect(retainedAgent).toHaveLength(1);
      expect((await companyImportJobService(db).get(originalId, actorKey))?.attemptId).toBe(originalAttemptId);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 90_000);
});
