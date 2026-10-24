import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authUsers, companies, createDb, customerOperations, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, projects } from "@paperclipai/db";
import type { CompanyPortabilityImportResult } from "@paperclipai/shared";
import { companyImportJobService } from "../services/company-import-jobs.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

describeEmbeddedPostgres("native company import job ledger", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("company-import-jobs-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function seedAuthority() {
    const userId = `user-${randomUUID()}`;
    const companyId = randomUUID();
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Import job operator", email: `${userId}@test.invalid`,
      createdAt: now, updatedAt: now });
    await db.insert(companies).values({ id: companyId, name: "Import target", issuePrefix: `IJ${companyId.slice(0, 6)}` });
    return { userId, companyId, actorKey: `board:${userId}` };
  }

  function admission(authority: Awaited<ReturnType<typeof seedAuthority>>, changes: Partial<{
    inputHash: string; idempotencyKey: string; scopeKey: string;
  }> = {}) {
    return {
      actorKey: authority.actorKey,
      userId: authority.userId,
      actorKind: "board" as const,
      inputHash: createHash("sha256").update("same import input").digest("hex"),
      scopeKey: `company:${authority.companyId}`,
      companyId: authority.companyId,
      idempotencyKey: "import-request-1",
      ...changes,
    };
  }

  it("scopes status reads to the original actor and serializes identical admissions", async () => {
    const authority = await seedAuthority();
    const other = await seedAuthority();
    const firstService = companyImportJobService(db);
    const secondService = companyImportJobService(db);
    const input = admission(authority);
    const [first, second] = await Promise.all([firstService.admit(input), secondService.admit(input)]);
    expect(first.job.id).toBe(second.job.id);
    expect([first.replay, second.replay].sort()).toEqual([false, true]);
    expect(await firstService.get(first.job.id, authority.actorKey)).toMatchObject({ id: first.job.id, status: "running" });
    expect(await secondService.get(first.job.id, other.actorKey)).toBeNull();

    await expect(firstService.admit(admission(authority, {
      inputHash: createHash("sha256").update("changed import input").digest("hex"),
    }))).rejects.toMatchObject({ status: 409, details: { code: "import_request_changed" } });
    expect(await db.select({ id: customerOperations.id }).from(customerOperations)
      .where(eq(customerOperations.requestedByUserId, authority.userId))).toHaveLength(1);
    await firstService.fail(first.job, false);
  }, 90_000);

  it("allows one start winner and preserves interrupted work as unknown without a new admission", async () => {
    const authority = await seedAuthority();
    const originalService = companyImportJobService(db);
    const admitted = await originalService.admit(admission(authority));
    const freshService = companyImportJobService(db);
    const starts = await Promise.all([originalService.start(admitted.job), freshService.start(admitted.job)]);
    expect(starts.sort()).toEqual([false, true]);

    const recovered = await freshService.recoverInterrupted();
    expect(recovered).toEqual([{ id: admitted.job.id }]);
    const stored = await freshService.get(admitted.job.id, authority.actorKey);
    expect(stored).toMatchObject({ status: "needs_reconciliation", progressStage: "needs_reconciliation",
      errorCode: "import_outcome_unknown", attempt: admitted.job.attempt, attemptId: admitted.job.attemptId });
    expect(await freshService.start(stored!)).toBe(false);
    await expect(freshService.admit(admission(authority, { idempotencyKey: "different-request" })))
      .rejects.toMatchObject({ status: 409, details: { code: "import_outcome_unknown" } });
    expect(await db.select({ id: customerOperations.id }).from(customerOperations)
      .where(eq(customerOperations.requestedByUserId, authority.userId))).toHaveLength(1);
  }, 90_000);

  it("fences settlement to the original attempt and stores only a compact result after a native effect", async () => {
    const authority = await seedAuthority();
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority));
    expect(await service.start(admitted.job)).toBe(true);
    await companyImportJobService(db).recoverInterrupted();

    // Structural native-domain effect fixture only: no portability import is
    // executed here. The project row is real persisted domain state, while
    // the operation result remains a sanitized settlement input.
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId: authority.companyId,
      name: "SENTINEL_PROJECT_NAME_NOT_FOR_RESULT_REF" });
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId))).toHaveLength(1);

    const result: CompanyPortabilityImportResult = {
      company: { id: authority.companyId, name: "SENTINEL_COMPANY_NAME_NOT_FOR_RESULT_REF", action: "updated" },
      agents: [{ slug: "ceo", id: randomUUID(), action: "created", name: "SENTINEL_AGENT_NAME_NOT_FOR_RESULT_REF", reason: null }],
      skills: [],
      projects: [{ slug: "sentinel-project", id: projectId, action: "created", name: "SENTINEL_PROJECT_RESULT_NAME", reason: null }],
      routines: [],
      envInputs: [{ key: "SENTINEL_ENV_KEY", description: "SENTINEL_ENV_DESCRIPTION", agentSlug: "ceo", projectSlug: null,
        kind: "secret", requirement: "optional", defaultValue: "SENTINEL_SECRET_DEFAULT", portability: "portable" }],
      warnings: ["SENTINEL_WARNING_TEXT"],
    };
    const forgedAttempt = { ...admitted.job, attemptId: randomUUID() };
    expect(await service.succeed(forgedAttempt, result)).toBeNull();
    expect((await service.get(admitted.job.id, authority.actorKey))!.status).toBe("needs_reconciliation");

    const settled = await companyImportJobService(db).succeed(admitted.job, result);
    expect(settled).toMatchObject({ id: admitted.job.id, status: "succeeded", attemptId: admitted.job.attemptId,
      resultRef: { companyId: authority.companyId, agentCount: 1, warningCount: 1, companyAction: "updated" } });
    expect(settled?.resultRef).toEqual({ companyId: authority.companyId, agentCount: 1, warningCount: 1, companyAction: "updated" });
    const persisted = JSON.stringify(settled);
    for (const secret of ["SENTINEL_COMPANY_NAME_NOT_FOR_RESULT_REF", "SENTINEL_AGENT_NAME_NOT_FOR_RESULT_REF",
      "SENTINEL_PROJECT_RESULT_NAME", "SENTINEL_PROJECT_NAME_NOT_FOR_RESULT_REF", "SENTINEL_WARNING_TEXT",
      "SENTINEL_ENV_KEY", "SENTINEL_ENV_DESCRIPTION", "SENTINEL_SECRET_DEFAULT"]) {
      expect(persisted).not.toContain(secret);
    }
  }, 90_000);
});
