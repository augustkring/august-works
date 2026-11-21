import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agentIdentities, agents, authSessions, authUsers, companies, companyMemberships, contextManifests, createDb, foundationDocuments, heartbeatRuns, issues, principalPermissionGrants, readinessAssessments, readinessRequirements, type Db } from "@paperclipai/db";
import { assessReadinessSchema, createReadinessRequirementSchema } from "@paperclipai/shared";
import { readinessService } from "../services/readiness/readiness-service.js";
import { readinessHash } from "../services/readiness/readiness-policy.js";
import { readinessRoutes } from "../routes/readiness.js";
import { errorHandler } from "../middleware/error-handler.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies, seedV5Presences } from "./helpers/v5-fixtures.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { initializeRunIdentity } from "../services/run-identity.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("V7 readiness on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string, agentId: string;
  const owner = { actor: { type: "board" as const, source: "local_implicit" as const }, principalId: "local-board", userId: null };
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-readiness-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    companyId = randomUUID(); agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Readiness fixture", issuePrefix: `R${companyId.slice(0, 7)}` });
    const [identity] = await db.insert(agentIdentities).values({ name: "Assessor", homeCompanyId: companyId }).returning();
    await db.insert(agents).values({ id: agentId, companyId, agentIdentityId: identity!.id, name: "Assessor" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map((permissionKey) => ({ companyId, principalType: "agent", principalId: agentId, permissionKey })));
  });
  const input = (actionClass: "internal_draft" | "external_communication") => assessReadinessSchema.parse({ agentId, actionClass, query: "Prepare company work" });
  const requirement = () => createReadinessRequirementSchema.parse({ requirementKey: "company.extra", name: "Extra evidence", actionClass: "internal_draft", expectedVersion: 0,
    criteria: [{ key: "knowledge", domain: "market_customer", sourceClasses: ["foundation"], allowedPurposes: ["internal_draft"] }] });
  function app(actor: Express.Request["actor"]) {
    const application = express(); application.use(express.json());
    application.use((req, _res, next) => { req.actor = actor; next(); });
    application.use("/api", readinessRoutes(db)); application.use(errorHandler);
    return application;
  }

  it("enforces the feature gate and principal boundary through the HTTP API", async () => {
    const http = request(app(owner.actor));
    await http.get(`/api/companies/${companyId}/readiness/overview`).expect(404);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true });
    const created = await http.post(`/api/companies/${companyId}/readiness/assess`).send(input("internal_draft")).expect(201);
    await request(app({ type: "agent", companyId, agentId, source: "agent_key" }))
      .get(`/api/companies/${companyId}/readiness/assessments/${created.body.id}`).expect(404);
    await request(app({ type: "agent", companyId: randomUUID(), agentId, source: "agent_key" }))
      .get(`/api/companies/${companyId}/readiness/overview`).expect(403);
    await instanceSettingsService(db).updateExperimental({ readiness_engine_v7: false });
  });

  it("persists immutable action-specific assessments and scoped findings without a company score", async () => {
    const svc = readinessService(db);
    const draft = await svc.assess(companyId, input("internal_draft"), owner);
    const send = await svc.assess(companyId, input("external_communication"), owner);
    expect(draft.status).toBe("ready_with_warnings"); expect(send.status).toBe("blocked");
    expect(send.requirementSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readinessHash(send.requirementSnapshot)).toBe(send.requirementSnapshotHash);
    const details = await svc.get(companyId, send.id, owner.principalId);
    expect(details.findings.length).toBeGreaterThan(0);
    await expect(svc.get(companyId, send.id, "user:another")).rejects.toMatchObject({ status: 404 });
    expect((await db.select().from(readinessAssessments).where(eq(readinessAssessments.id, draft.id)))[0]!.status).toBe("ready_with_warnings");
  });
  it("uses approved Foundation revisions and closes on permission revocation", async () => {
    await enableV5ForTest(db);
    const userId = `user-${randomUUID()}`, now = new Date(), expiresAt = new Date(Date.now() + 60_000), sessionId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Readiness owner", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId, principalType: "user", principalId: userId, ...grant })));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt });
    const humanActor = { type: "board" as const, source: "session" as const, userId, sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime() };
    const humanOwner = { actor: humanActor, principalId: userId, userId };
    const foundation = foundationService(db);
    for (const category of ["company", "governance"] as const) {
      const draft = await foundation.createDraft(companyId, { foundationKey: category, category, documentType: category, body: `# ${category}\nReviewed policy and company facts.`, authorityLevel: "canonical", sensitivity: "internal" }, { principal: { type: "system", service: "fixture" } });
      await foundation.submitForReview(companyId, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
      await foundation.approve(companyId, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    }
    const svc = readinessService(db);
    const ready = await svc.assess(companyId, input("external_communication"), humanOwner);
    expect(ready.status).toBe("ready");
    expect(ready.contextManifestId).toBeNull();
    expect(ready.policySnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, userId), eq(principalPermissionGrants.permissionKey, "foundation:read")));
    expect((await svc.assess(companyId, input("external_communication"), humanOwner)).status).toBe("blocked");
    expect((await svc.get(companyId, ready.id, userId)).status).toBe("ready");
  });
  it("serializes concurrent requirement publication and cannot replace mandatory system policy", async () => {
    const svc = readinessService(db);
    await expect(svc.publishRequirement(companyId, { ...requirement(), requirementKey: "system.internal_draft" }, owner)).rejects.toMatchObject({ status: 403 });
    const outcomes = await Promise.allSettled([svc.publishRequirement(companyId, requirement(), owner), svc.publishRequirement(companyId, requirement(), owner)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await svc.requirements(companyId)).toHaveLength(1);
    await svc.publishRequirement(companyId, { ...requirement(), expectedVersion: 1 }, owner);
    expect(await db.select().from(readinessRequirements).where(eq(readinessRequirements.companyId, companyId))).toHaveLength(2);
    expect((await svc.assess(companyId, input("internal_draft"), owner)).status).toBe("blocked");
  });
  it("rejects a foreign-company agent and foreign subject before source retrieval", async () => {
    const foreign = randomUUID();
    await expect(readinessService(db).assess(foreign, input("internal_draft"), owner)).rejects.toMatchObject({ status: 404 });
    await expect(readinessService(db).assess(companyId, { ...input("internal_draft"), subjectType: "task", subjectId: randomUUID() }, owner)).rejects.toMatchObject({ status: 404 });
  });
  it("inspects current public Context for an authenticated Human without creating a runtime manifest", async () => {
    await enableV5ForTest(db);
    const fixture = await seedV5Presences(db);
    const expiresAt = new Date(Date.now() + 60_000), sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: fixture.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt });
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true });
    const foundation = foundationService(db);
    for (const category of ["company", "governance"] as const) {
      const draft = await foundation.createDraft(fixture.home, { foundationKey: category, category, documentType: category,
        body: `# ${category}\nCurrent, reviewed company facts.`, authorityLevel: "canonical", sensitivity: "internal" },
        { principal: { type: "system", service: "fixture" } });
      await foundation.submitForReview(fixture.home, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
      await foundation.approve(fixture.home, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    }
    const actor = { ...fixture.actor, sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime() };
    const owner = { actor, principalId: fixture.userId, userId: fixture.userId };
    const manifestsBefore = await db.select().from(contextManifests);
    const result = await readinessService(db).assess(fixture.home,
      assessReadinessSchema.parse({ agentId: fixture.presence.id, actionClass: "external_communication", query: "Current company facts" }), owner);
    expect(result.status).toBe("ready");
    expect(result.contextManifestId).toBeNull();
    expect(await db.select().from(contextManifests)).toEqual(manifestsBefore);

    const [privateTask] = await db.insert(issues).values({ companyId: fixture.home, title: "Human-owned private readiness source",
      description: "A private task visible to its responsible Human", visibility: "private", createdByUserId: fixture.userId,
      responsibleUserId: fixture.userId, assigneeAgentId: fixture.presence.id }).returning();
    const secondDb = createDb(database.connectionString);
    try {
      await secondDb.select({ id: companies.id }).from(companies).where(eq(companies.id, fixture.home));
      let inspectionStarted!: () => void, releaseInspection!: () => void;
      const acquired = new Promise<void>(resolve => { inspectionStarted = resolve; });
      const hold = new Promise<void>(resolve => { releaseInspection = resolve; });
      let deleteFinished = false;
      const inspectionInput = { companyId: fixture.home, agentId: fixture.presence.id, responsibleUserId: fixture.userId,
        enforceResponsibleUserIntersection: true, issueId: privateTask!.id,
        query: "Human-owned private readiness source", intent: "external_communication", sensitivityCeiling: "internal" as const };
      const inspection = contextEngineService(db).inspectReadOnly(inspectionInput, actor, {
        complete: async assembly => { inspectionStarted(); await hold; return assembly; },
      });
      await acquired;
      const erasure = secondDb.delete(issues).where(eq(issues.id, privateTask!.id)).then(() => { deleteFinished = true; });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(deleteFinished).toBe(false);
      releaseInspection();
      const inspectedPrivate = await inspection;
      await erasure;
      expect(inspectedPrivate.decisions.some(decision => decision.evidence.sourceRef === `issue://${privateTask!.id}`)).toBe(true);
    } finally {
      await secondDb.$client.end();
    }

    // The DB session can be extended; this request still expires at its original verified carrier deadline.
    const expiredActor = { ...actor, authenticatedCredentialExpiresAt: now.getTime() - 1 };
    await expect(readinessService(db).assess(fixture.home,
      assessReadinessSchema.parse({ agentId: fixture.presence.id, actionClass: "external_communication", query: "Current company facts" }),
      { actor: expiredActor, principalId: fixture.userId, userId: fixture.userId })).rejects.toMatchObject({ status: 403 });

    const bob = await seedV5Companies(db), bobSessionId = randomUUID(), bobExpiresAt = new Date(Date.now() + 60_000);
    await db.insert(authSessions).values({ id: bobSessionId, userId: bob.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt: bobExpiresAt });
    await expect(readinessService(db).assess(fixture.home,
      assessReadinessSchema.parse({ agentId: fixture.presence.id, actionClass: "external_communication", query: "Current company facts" }),
      { actor: { ...bob.actor, sessionId: bobSessionId, authenticatedCredentialExpiresAt: bobExpiresAt.getTime() },
        principalId: bob.userId, userId: bob.userId })).rejects.toMatchObject({ status: 403 });
    await expect(contextEngineService(db).inspectReadOnly({ companyId: fixture.home, agentId: fixture.presence.id,
      responsibleUserId: bob.userId, enforceResponsibleUserIntersection: true, issueId: privateTask!.id,
      query: "Human-owned private readiness source", intent: "external_communication", sensitivityCeiling: "internal" },
      { ...bob.actor, sessionId: bobSessionId, authenticatedCredentialExpiresAt: bobExpiresAt.getTime() })).rejects.toMatchObject({ status: 403 });

    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, fixture.home),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, fixture.userId)));
    await expect(readinessService(db).assess(fixture.home,
      assessReadinessSchema.parse({ agentId: fixture.presence.id, actionClass: "external_communication", query: "Current company facts" }), owner))
      .rejects.toMatchObject({ status: 403 });
  }, 60_000);

  it("does not publish readiness assessment activity when final Human source recheck rolls back", async () => {
    await enableV5ForTest(db);
    const fixture = await seedV5Presences(db);
    const now = new Date(), expiresAt = new Date(Date.now() + 60_000), sessionId = randomUUID();
    await db.insert(authSessions).values({ id: sessionId, userId: fixture.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt });
    const actor = { ...fixture.actor, sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime() };
    const foundation = foundationService(db);
    for (const category of ["company", "governance"] as const) {
      const draft = await foundation.createDraft(fixture.home, { foundationKey: category, category, documentType: category,
        body: `# ${category}\nCurrent, reviewed company facts.`, authorityLevel: "canonical", sensitivity: "internal" },
        { principal: { type: "system", service: "fixture" } });
      await foundation.submitForReview(fixture.home, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
      await foundation.approve(fixture.home, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    }

    // Change the source after the assessment write but inside its transaction.
    // The final native recheck must reject and roll back both assessment rows
    // and their buffered activity publication.
    const suffix = randomUUID().replaceAll("-", "");
    const triggerFunction = `aw_test_readiness_recheck_${suffix}`;
    const triggerName = `${triggerFunction}_trigger`;
    await db.execute(sql.raw(`CREATE FUNCTION public.${triggerFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE foundation_documents SET last_reviewed_at = clock_timestamp()
        WHERE company_id = NEW.company_id AND foundation_key = 'company';
        RETURN NEW;
      END;
    $$`));
    await db.execute(sql`CREATE TRIGGER ${sql.identifier(triggerName)} AFTER INSERT ON readiness_assessments
      FOR EACH ROW EXECUTE FUNCTION public.${sql.identifier(triggerFunction)}()`);

    const liveEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = subscribeCompanyLiveEvents(fixture.home, event => {
      if (event.type === "activity.logged") liveEvents.push({ type: event.type, payload: event.payload });
    });
    try {
      await expect(readinessService(db).assess(fixture.home,
        assessReadinessSchema.parse({ agentId: fixture.presence.id, actionClass: "external_communication", query: "Current company facts" }),
        { actor, principalId: fixture.userId, userId: fixture.userId })).rejects.toMatchObject({
          status: 409, message: "Approved Foundation revision changed or is unavailable",
        });
      expect(await db.select().from(readinessAssessments).where(eq(readinessAssessments.companyId, fixture.home))).toHaveLength(0);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, fixture.home), eq(activityLog.action, "readiness.assessed"))))
        .toHaveLength(0);
      expect(liveEvents.filter(event => event.payload.action === "readiness.assessed")).toHaveLength(0);
    } finally {
      unsubscribe();
      await db.execute(sql`DROP TRIGGER ${sql.identifier(triggerName)} ON readiness_assessments`);
      await db.execute(sql`DROP FUNCTION public.${sql.identifier(triggerFunction)}()`);
    }
  }, 60_000);

  it("holds approved Foundation pointers through Human assessment on a separate connection", async () => {
    await enableV5ForTest(db);
    const fixture = await seedV5Presences(db);
    const expiresAt = new Date(Date.now() + 60_000), sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: fixture.userId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt });
    const actor = { ...fixture.actor, sessionId, authenticatedCredentialExpiresAt: expiresAt.getTime() };
    const foundation = foundationService(db);
    const initial = await foundation.createDraft(fixture.home, { foundationKey: "company", category: "company", documentType: "company",
      body: "# Current company\nApproved revision one.", authorityLevel: "canonical", sensitivity: "internal" },
      { principal: { type: "system", service: "fixture" } });
    await foundation.submitForReview(fixture.home, initial.id, initial.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    await foundation.approve(fixture.home, initial.id, initial.latestRevisionId!, { principal: { type: "system", service: "fixture" } });
    await expect(db.transaction(tx => foundationService(tx as unknown as Db).pinApprovedRevisions(fixture.home,
      [{ documentId: initial.id, revisionId: randomUUID() }], actor))).rejects.toMatchObject({ status: 409 });

    const secondDb = createDb(database.connectionString);
    try {
      await secondDb.select({ id: companies.id }).from(companies).where(eq(companies.id, fixture.home));
      let pointer = initial.latestRevisionId!;
      const advanceApproval = async (body: string, commitPin: boolean) => {
        const currentFoundation = await foundation.getByKey(fixture.home, "company");
        expect(currentFoundation?.latestRevisionId).toBe(pointer);
        const draft = await foundation.updateDraft(fixture.home, initial.id, { baseRevisionId: pointer, body,
          changeSummary: "New reviewed revision" }, { principal: { type: "system", service: "fixture" } });
        await foundation.submitForReview(fixture.home, draft.id, draft.latestRevisionId!, { principal: { type: "system", service: "fixture" } });

        let acquired!: () => void, release!: () => void;
        const hasLock = new Promise<void>(resolve => { acquired = resolve; });
        const wait = new Promise<void>(resolve => { release = resolve; });
        const pinRun = db.transaction(async tx => {
          await foundationService(tx as unknown as Db).pinApprovedRevisions(fixture.home,
            [{ documentId: initial.id, revisionId: pointer }], actor);
          acquired();
          await wait;
          if (!commitPin) throw new Error("fixture pin rollback");
        });
        await hasLock;
        let approvalFinished = false;
        const approval = foundationService(secondDb).approve(fixture.home, draft.id, draft.latestRevisionId!,
          { principal: { type: "system", service: "fixture" } }).then(row => { approvalFinished = true; return row; });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(approvalFinished).toBe(false);
        release();
        if (commitPin) await pinRun;
        else await expect(pinRun).rejects.toThrow("fixture pin rollback");
        const approved = await approval;
        expect(approved.approvedRevisionId).toBe(draft.latestRevisionId);
        pointer = draft.latestRevisionId!;
      };
      await advanceApproval("# Current company\nApproved revision two.", true);
      await advanceApproval("# Current company\nApproved revision three.", false);
    } finally {
      await secondDb.$client.end();
    }
  }, 60_000);

  it("assesses Agent readiness against its actual native Run and denies a missing Run", async () => {
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true });
    const userId = `user-${randomUUID()}`, now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Accountable Human", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read", "issue:read"].map(permissionKey => ({
      companyId, principalType: "user", principalId: userId, permissionKey,
    })));
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agentId, permissionKey: "issue:read" });
    const foundation = foundationService(db), system = { principal: { type: "system" as const, service: "fixture" } };
    for (const category of ["company", "governance"] as const) {
      const draft = await foundation.createDraft(companyId, { foundationKey: `agent-${category}`, category, documentType: category,
        body: `# ${category}\nCurrent approved Agent readiness facts.`, authorityLevel: "canonical", sensitivity: "internal" }, system);
      await foundation.submitForReview(companyId, draft.id, draft.latestRevisionId!, system);
      await foundation.approve(companyId, draft.id, draft.latestRevisionId!, system);
    }
    const [task] = await db.insert(issues).values({ companyId, title: "Actual Agent readiness Task", status: "in_progress",
      assigneeAgentId: agentId, responsibleUserId: userId }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "running", runtimeMode: "native",
      runtimeModeResolvedAt: new Date(), nativeIssueId: task!.id, responsibleUserId: userId,
      contextSnapshot: { issueId: task!.id } }).returning();
    await db.update(issues).set({ executionRunId: run!.id }).where(eq(issues.id, task!.id));
    await initializeRunIdentity(db, { companyId, runId: run!.id, issueId: task!.id, responsibleUserId: userId, cause: "dispatch" });
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId,
      runId: run!.id, onBehalfOfUserId: userId };
    const assessment = await readinessService(db).assess(companyId,
      assessReadinessSchema.parse({ agentId, subjectType: "task", subjectId: task!.id, actionClass: "external_communication", query: "Current approved facts" }),
      { actor, principalId: agentId, userId });
    expect(assessment.status).toBe("ready");
    expect(assessment.contextManifestId).toBeTruthy();
    expect(assessment.assessment.requirements.flatMap(item => item.evidenceRefs)
      .some(ref => ref.sourceRef.startsWith("foundation://"))).toBe(true);

    const noRunActor = { ...actor, runId: undefined };
    await expect(readinessService(db).assess(companyId,
      assessReadinessSchema.parse({ agentId, subjectType: "task", subjectId: task!.id, actionClass: "external_communication", query: "Current approved facts" }),
      { actor: noRunActor, principalId: agentId, userId })).rejects.toMatchObject({ status: 403 });
  }, 60_000);
});
