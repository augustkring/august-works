import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authSessions, authUsers, companies, companyMemberships, createDb, customerOperations, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, projects } from "@paperclipai/db";
import type { CompanyPortabilityImportResult } from "@paperclipai/shared";
import type { AuthorizationActor } from "../services/authorization.js";
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

  async function seedAuthority(withSession = false) {
    const userId = `user-${randomUUID()}`;
    const companyId = randomUUID();
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Import job operator", email: `${userId}@test.invalid`,
      createdAt: now, updatedAt: now });
    await db.insert(companies).values({ id: companyId, name: "Import target", issuePrefix: `IJ${companyId.slice(0, 6)}` });
    if (!withSession) return { userId, companyId, actorKey: `board:${userId}` };
    const sessionId = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      membershipRole: "owner", status: "active" });
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) });
    const actor: AuthorizationActor = { type: "board", source: "session", userId, sessionId,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }],
      isInstanceAdmin: false };
    return { userId, companyId, actorKey: `board:${userId}`, actor, sessionId };
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

    await db.update(customerOperations).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(customerOperations.id, admitted.job.id));
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

  it("reconciles expired imports in bounded batches and never returns checkpoint payloads", async () => {
    const past = new Date(Date.now() - 1000);
    const rows = Array.from({ length: 101 }, (_, index) => {
      const attemptId = randomUUID();
      const key = `expired-${index}-${randomUUID()}`;
      return { id: `import-${randomUUID()}`, operationType: "company_import", domain: "company_portability",
        requesterKeyHash: createHash("sha256").update(key).digest("hex"), requestedByUserId: null,
        scopeKey: "new_company", idempotencyKey: createHash("sha256").update(key).digest("hex"),
        inputHash: createHash("sha256").update(`input-${key}`).digest("hex"), status: "running",
        attempt: 1, attemptId, leaseOwnerId: attemptId, leaseExpiresAt: past };
    });
    await db.insert(customerOperations).values(rows);

    const first = await companyImportJobService(db).recoverInterrupted();
    expect(first).toHaveLength(100);
    expect(first.every(row => Object.keys(row).join(",") === "id")).toBe(true);
    const ids = rows.map(row => row.id);
    const remaining = await db.select({ id: customerOperations.id, status: customerOperations.status })
      .from(customerOperations).where(inArray(customerOperations.id, ids));
    expect(remaining.filter(row => row.status === "running")).toHaveLength(1);

    const second = await companyImportJobService(db).recoverInterrupted();
    expect(second).toHaveLength(1);
    expect((await db.select({ status: customerOperations.status }).from(customerOperations)
      .where(inArray(customerOperations.id, ids))).every(row => row.status === "needs_reconciliation")).toBe(true);
  }, 90_000);

  it("keeps a live owner's lease and atomically rolls back a domain effect with its receipt", async () => {
    const authority = await seedAuthority();
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority));
    expect(await service.start(admitted.job)).toBe(true);
    expect(await service.recoverInterrupted()).toEqual([]);

    await service.checkpointEffect(admitted.job, { phase: "started", key: "project:atomic", kind: "project",
      sourceSlug: "atomic-project" });
    const projectId = randomUUID();
    await expect(db.transaction(async tx => {
      await tx.insert(projects).values({ id: projectId, companyId: authority.companyId, name: "Atomic receipt test" });
      await service.checkpointEffect(admitted.job, { phase: "completed", key: "project:atomic", kind: "project",
        sourceSlug: "atomic-project", targetIds: [projectId] }, tx);
      throw new Error("rollback owner effect and receipt");
    })).rejects.toThrow("rollback owner effect and receipt");

    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId))).toEqual([]);
    expect((await service.get(admitted.job.id, authority.actorKey))?.effectCheckpoint).toMatchObject({ state: "applying",
      activeEffect: { key: "project:atomic", kind: "project", sourceSlug: "atomic-project" }, idMap: [] });
    expect(await service.succeed(admitted.job, { company: { id: authority.companyId, name: "x", action: "updated" },
      agents: [], skills: [], projects: [], routines: [], envInputs: [], warnings: [] })).toBeNull();

    await db.update(customerOperations).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(customerOperations.id, admitted.job.id));
    expect(await service.recoverInterrupted()).toEqual([{ id: admitted.job.id }]);
  }, 90_000);

  it("persists a safe accepted selection and per-effect target ID map", async () => {
    const authority = await seedAuthority();
    const actor: AuthorizationActor = { type: "board", source: "local_implicit", userId: authority.userId,
      isInstanceAdmin: true };
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority));
    expect(await service.start(admitted.job)).toBe(true);
    await service.acceptPlan(admitted.job, { previewFingerprint: "a".repeat(64),
      selectedPayloadFingerprint: "b".repeat(64), targetMode: "existing_company", targetCompanyId: authority.companyId,
      selected: [{ kind: "issue", slug: "task-1", action: "create" }], acceptedByUserId: authority.userId,
      acceptedAt: new Date().toISOString() }, actor);
    await service.checkpointEffect(admitted.job, { phase: "started", key: "task:task-1", kind: "task",
      sourceId: randomUUID(), sourceSlug: "task-1" });
    const targetId = randomUUID();
    await service.checkpointEffect(admitted.job, { phase: "completed", key: "task:task-1", kind: "task",
      targetIds: [targetId] });
    const stored = await service.get(admitted.job.id, authority.actorKey);
    expect(stored?.acceptedPlan).toMatchObject({ version: 1, targetMode: "existing_company",
      selected: [{ kind: "issue", slug: "task-1", action: "create" }], acceptedByUserId: authority.userId });
    expect(stored?.effectCheckpoint).toMatchObject({ state: "idle", activeEffect: null,
      idMap: [{ key: "task:task-1", kind: "task", sourceSlug: "task-1", targetIds: [targetId] }] });
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
    expect((await service.get(admitted.job.id, authority.actorKey))!.status).toBe("running");

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

  it("rechecks the original session and active membership before starting an admitted import", async () => {
    const revoked = await seedAuthority(true);
    const revokedActor = revoked.actor!;
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(revoked), revokedActor);
    expect(admitted.job.progressStage).toBe("admitted");
    await db.delete(authSessions).where(eq(authSessions.id, revoked.sessionId));
    await expect(service.start(admitted.job, revokedActor)).rejects.toMatchObject({ status: 403 });
    expect(await service.get(admitted.job.id, revoked.actorKey)).toMatchObject({ status: "running", progressStage: "admitted" });

    const current = await seedAuthority(true);
    const currentActor = current.actor!;
    const currentService = companyImportJobService(db);
    const currentJob = await currentService.admit(admission(current), currentActor);
    expect(await currentService.start(currentJob.job, currentActor)).toBe(true);

    const withdrawn = await seedAuthority(true);
    const withdrawnActor = withdrawn.actor!;
    const withdrawnJob = await service.admit(admission(withdrawn), withdrawnActor);
    await db.delete(companyMemberships).where(and(
      eq(companyMemberships.companyId, withdrawn.companyId),
      eq(companyMemberships.principalId, withdrawn.userId),
    ));
    await expect(service.start(withdrawnJob.job, withdrawnActor)).rejects.toMatchObject({ status: 403 });
    expect(await service.get(withdrawnJob.job.id, withdrawn.actorKey)).toMatchObject({ status: "running", progressStage: "admitted" });
  }, 90_000);

  it("retries the same operation only after a known pre-domain rejection and fences old attempts", async () => {
    const authority = await seedAuthority(true);
    const actor = authority.actor!;
    const sourceBody = "NATIVE_IMPORT_INPUT_SENTINEL";
    const input = admission(authority, {
      inputHash: createHash("sha256").update(sourceBody).digest("hex"),
    });
    const service = companyImportJobService(db);
    const first = await service.admit(input, actor);
    expect(await service.start(first.job, actor)).toBe(true);
    await service.fail(first.job, false);
    expect(await service.get(first.job.id, authority.actorKey)).toMatchObject({
      status: "failed", progressStage: "rejected_before_import", attempt: first.job.attempt,
    });

    const retry = await companyImportJobService(db).admit(input, actor);
    expect(retry.replay).toBe(false);
    expect(retry.job.id).toBe(first.job.id);
    expect(retry.job.attempt).toBe(first.job.attempt + 1);
    expect(retry.job.attemptId).not.toBe(first.job.attemptId);
    expect(await service.start(first.job, actor)).toBe(false);
    const result: CompanyPortabilityImportResult = {
      company: { id: authority.companyId, name: "Import target", action: "updated" },
      agents: [], skills: [], projects: [], routines: [], envInputs: [], warnings: [],
    };
    expect(await service.succeed(first.job, result)).toBeNull();

    const retryService = companyImportJobService(db);
    expect(await retryService.start(retry.job, actor)).toBe(true);
    const running = await retryService.get(retry.job.id, authority.actorKey);
    expect(running).toMatchObject({ id: first.job.id, status: "running", progressStage: "importing",
      attempt: retry.job.attempt, attemptId: retry.job.attemptId, inputHash: input.inputHash, domainOperationRef: null });
    expect(JSON.stringify(running)).not.toContain(sourceBody);
  }, 90_000);
  it("does not resume a rejected import while a different operation owns the requester's slot", async () => {
    const authority = await seedAuthority();
    const service = companyImportJobService(db);
    const firstInput = admission(authority);
    const first = await service.admit(firstInput);
    expect(await service.start(first.job)).toBe(true);
    await service.fail(first.job, false); // Native pre-domain refusal fixture.
    const second = await service.admit(admission(authority, { idempotencyKey: "second-intent",
      inputHash: createHash("sha256").update("different input").digest("hex") }));
    await expect(service.admit(firstInput)).rejects.toMatchObject({ status: 409, details: { code: "import_already_running" } });
    expect((await service.get(first.job.id, authority.actorKey))!.attemptId).toBe(first.job.attemptId);
    expect((await service.get(second.job.id, authority.actorKey))!.status).toBe("running");
  });

  it("confirms cancellation before dispatch and fences a later start", async () => {
    const authority = await seedAuthority(true);
    const actor = authority.actor!;
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority), actor);

    const cancelled = await service.requestCancellation(admitted.job.id, authority.actorKey, actor);
    expect(cancelled).toMatchObject({ status: "cancelled", progressStage: "cancelled", cancelRequestedAt: expect.any(Date) });
    expect(await service.start(admitted.job, actor)).toBe(false);
    expect((await service.requestCancellation(admitted.job.id, authority.actorKey, actor))?.status).toBe("cancelled");
    const retried = await service.admit(admission(authority), actor);
    expect(retried).toMatchObject({ replay: false, job: { id: admitted.job.id, status: "running", attempt: admitted.job.attempt + 1 } });
    expect(await service.start(retried.job, actor)).toBe(true);
  }, 90_000);

  it("keeps cancellation requested during effects and makes restart inconclusive", async () => {
    const authority = await seedAuthority(true);
    const actor = authority.actor!;
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority), actor);
    expect(await service.start(admitted.job, actor)).toBe(true);

    const requested = await service.requestCancellation(admitted.job.id, authority.actorKey, actor);
    expect(requested).toMatchObject({ status: "running", progressStage: "importing", cancelRequestedAt: expect.any(Date) });
    expect(await service.cancellationRequested(admitted.job)).toBe(true);
    await db.update(customerOperations).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(customerOperations.id, admitted.job.id));
    await service.recoverInterrupted();
    expect((await service.get(admitted.job.id, authority.actorKey))?.status).toBe("needs_reconciliation");
  }, 90_000);

  it("requires the original current session and company access to request cancellation", async () => {
    const authority = await seedAuthority(true);
    const actor = authority.actor!;
    const other = await seedAuthority(true);
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority), actor);
    expect(await service.requestCancellation(admitted.job.id, other.actorKey, other.actor!)).toBeNull();

    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, authority.companyId),
      eq(companyMemberships.principalId, authority.userId)));
    await expect(service.requestCancellation(admitted.job.id, authority.actorKey, actor)).rejects.toMatchObject({ status: 403 });
    expect((await service.get(admitted.job.id, authority.actorKey))?.status).toBe("running");

    const expiredAuthority = await seedAuthority(true);
    const expiredActor = expiredAuthority.actor!;
    const expiredJob = await service.admit(admission(expiredAuthority), expiredActor);
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authSessions.id, expiredAuthority.sessionId!));
    await expect(service.requestCancellation(expiredJob.job.id, expiredAuthority.actorKey, expiredActor)).rejects.toMatchObject({ status: 403 });
    expect((await service.get(expiredJob.job.id, expiredAuthority.actorKey))?.status).toBe("running");
  }, 90_000);

  it("stores one bounded exact source-release receipt under the current target manager", async () => {
    const authority = await seedAuthority(true);
    const actor = authority.actor!;
    const service = companyImportJobService(db);
    const admitted = await service.admit(admission(authority), actor);
    expect(await service.start(admitted.job, actor)).toBe(true);
    const receipt = {
      version: 1 as const,
      sourceMode: "manual_open_content" as const,
      sourceCompanyIds: [],
      sourceItems: [{ kind: "issue" as const, id: "external:review", slug: "review" }],
      sourceAccess: "reviewed_open_external" as const,
      targetMode: "existing_company" as const,
      targetCompanyId: authority.companyId,
      previewFingerprint: "a".repeat(64),
      selectedPayloadFingerprint: "b".repeat(64),
      reviewedByUserId: authority.userId,
      reviewedAt: new Date().toISOString(),
    };
    const saved = await service.recordSourceReleaseReview(admitted.job, receipt, actor);
    expect(saved.sourceReleaseReview).toEqual(receipt);
    const repeated = await service.recordSourceReleaseReview(admitted.job, { ...receipt,
      reviewedAt: new Date(Date.now() + 1000).toISOString(),
    }, actor);
    expect(repeated.sourceReleaseReview).toEqual(receipt);
    await expect(service.recordSourceReleaseReview(admitted.job, { ...receipt,
      selectedPayloadFingerprint: "c".repeat(64),
    }, actor)).rejects.toMatchObject({ status: 409, details: { code: "import_source_review_changed" } });
    expect(await db.select({ sourceReleaseReview: customerOperations.sourceReleaseReview })
      .from(customerOperations).where(eq(customerOperations.id, admitted.job.id))).toMatchObject([
      { sourceReleaseReview: receipt },
    ]);

    const viewer = await seedAuthority(true);
    const viewerActor = viewer.actor!;
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(
      eq(companyMemberships.companyId, viewer.companyId), eq(companyMemberships.principalId, viewer.userId),
    ));
    const viewerJob = await service.admit(admission(viewer), viewerActor);
    expect(await service.start(viewerJob.job, viewerActor)).toBe(true);
    await expect(service.recordSourceReleaseReview(viewerJob.job, { ...receipt,
      targetCompanyId: viewer.companyId, reviewedByUserId: viewer.userId,
    }, viewerActor)).rejects.toMatchObject({ status: 403 });
  }, 90_000);

});
