import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { agents, analyticalSourceSuppressions, applyPendingMigrations, companies, companyMemberships, createDb, decisionTargetIssues, documentRevisions, foundationSections, goals, heartbeatRuns, issues, projectGoals, projects, strategyExecutionLinks, strategyExecutionLinkVersions, strategyExecutionLinkApprovals, strategyExecutionSourceBindings } from "@paperclipai/db";
import { strategyExecutionLinkDefinitionSchema, type StrategyExecutionLinkDefinition } from "@paperclipai/shared";
import { strategyExecutionService } from "../services/strategy-execution/service.js";
import { eraseStrategySource } from "../services/strategy-execution/privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { goalService } from "../services/goals.js";
import { issueService } from "../services/issues.js";
import { projectService } from "../services/projects.js";
import { decisionService } from "../services/decisions.js";
import { assertDatabaseRestoreAdmission, prepareRestoredQuarantine } from "../services/saas/quarantine.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const foundationActor = { principal: { type: "user" as const, userId: "local-board" } };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, strategy_execution_v8: true, enableFoundationV1: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("native strategy links on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>, companyId: string, otherCompanyId: string, goalId: string, projectId: string, policyId: string;
  let foundation: Awaited<ReturnType<ReturnType<typeof foundationService>["approve"]>>;
  let reference: StrategyExecutionLinkDefinition["from"];
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-strategy-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherCompanyId = randomUUID(); goalId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Strategy", issuePrefix: randomUUID() }, { id: otherCompanyId, name: "Foreign", issuePrefix: randomUUID() }]);
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "local-board", status: "active", membershipRole: "owner" });
    await db.insert(goals).values({ companyId, id: goalId, title: "Native objective" });
    await db.insert(projects).values({ companyId, id: projectId, name: "Native initiative" });
    const purpose = analyticalPurpose(); purpose.citation = "strategy-purpose"; purpose.analyticalPurpose!.capabilities = ["strategy"]; purpose.analyticalPurpose!.maxRetentionDays = 90;
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, purpose)).id;
    const svc = foundationService(db);
    const draft = await svc.createDraft(companyId, { foundationKey: "strategy", category: "strategy", documentType: "strategy", title: "Approved strategy", body: "# Strategy\nServe a defined business objective", authorityLevel: "canonical", sensitivity: "internal", reviewFrequencyDays: 30 }, foundationActor);
    await svc.submitForReview(companyId, draft.id, draft.latestRevisionId!, foundationActor);
    foundation = await svc.approve(companyId, draft.id, draft.latestRevisionId!, foundationActor);
    const [section] = await db.select().from(foundationSections).where(and(eq(foundationSections.companyId, companyId), eq(foundationSections.documentRevisionId, foundation.approvedRevisionId!)));
    reference = { type: "foundation_section", foundationDocumentId: foundation.id, approvedRevisionId: foundation.approvedRevisionId!, sectionId: section.id, headingPath: section.headingPath, contentHash: section.contentHash };
  });
  const service = () => strategyExecutionService(db);
  const definition = () => strategyExecutionLinkDefinitionSchema.parse({ from: reference, to: { type: "goal", id: goalId }, relationship: "supports", rationale: "A reviewed strategic hypothesis supporting this objective", contribution: { kind: "hypothesis", statement: "We expect this objective to advance the approved strategy" }, ownerUserId: "local-board", reviewFrequencyDays: 30, retentionDays: 90, sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [policyId] });
  async function approved(value = definition()) {
    const created = await service().create(companyId, actor, { definition: value });
    const link = await service().approve(companyId, actor, created.link.id, { expectedRevision: 1, versionId: created.version.id, rationale: "Explicit human review accepts the pinned strategic hypothesis" });
    return { ...created, link };
  }
  it("freezes human-approved pins and keeps revisions proposed until approval", async () => {
    const created = await approved();
    const revised = await service().revise(companyId, actor, created.link.id, { expectedRevision: 2, definition: { ...definition(), rationale: "A changed rationale remains proposed until separately reviewed" } });
    const detail = await service().detail(companyId, actor, created.link.id);
    expect(detail.link).toMatchObject({ status: "active", revision: 3, approvedVersionId: created.version.id });
    expect(detail.effectiveVersion.id).toBe(created.version.id);
    expect(detail.versions[0].id).toBe(revised.id);
    expect((await service().list(companyId, actor)).items[0].definition.rationale).toBe(created.version.definition.rationale);
    await expect(db.update(strategyExecutionLinkVersions).set({ contentHash: "a".repeat(64) }).where(eq(strategyExecutionLinkVersions.id, revised.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(strategyExecutionLinkApprovals).set({ rationale: "Overwrite review" }).where(eq(strategyExecutionLinkApprovals.linkId, created.link.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("uses approved Foundation while drafting, then requires review after canonical change", async () => {
    const created = await approved(); const svc = foundationService(db);
    const draft = await svc.updateDraft(companyId, foundation.id, { baseRevisionId: foundation.latestRevisionId!, body: "# Strategy\nA changed strategic direction" }, foundationActor);
    expect((await service().detail(companyId, actor, created.link.id)).link.status).toBe("active");
    await svc.submitForReview(companyId, foundation.id, draft.latestRevisionId!, foundationActor);
    await svc.approve(companyId, foundation.id, draft.latestRevisionId!, foundationActor);
    const detail = await service().detail(companyId, actor, created.link.id);
    expect(detail.link.status).toBe("needs_review"); expect(detail.effectiveVersion.definition.from).toEqual(reference);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].archivedAt).toBeNull();
    await expect(service().approve(companyId, actor, created.link.id, { expectedRevision: 2, versionId: created.version.id, rationale: "Attempt to approve obsolete strategy pin" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects foreign sources, forged native pins, moved roots and agent approval", async () => {
    const [foreign] = await db.insert(goals).values({ companyId: otherCompanyId, title: "Foreign objective" }).returning();
    await expect(service().create(companyId, actor, { definition: { ...definition(), to: { type: "goal", id: foreign.id } } })).rejects.toMatchObject({ status: 404 });
    const created = await approved();
    await expect(service().revise(companyId, actor, created.link.id, { expectedRevision: 2, definition: { ...definition(), to: { type: "project", id: projectId } } })).rejects.toMatchObject({ status: 409 });
    await expect(service().create(companyId, actor, { definition: { ...definition(), from: { ...reference, contentHash: "a".repeat(64) } as StrategyExecutionLinkDefinition["from"] } })).rejects.toMatchObject({ status: 409 });
    const agent = { type: "agent" as const, source: "agent_key" as const, companyId, agentId: randomUUID() };
    await expect(service().approve(companyId, agent, created.link.id, { expectedRevision: 2, versionId: created.version.id, rationale: "Agent cannot publish human authority" })).rejects.toMatchObject({ status: 403 });
    await expect(db.insert(strategyExecutionLinks).values({ companyId, fromType: "goal", fromRef: foreign.id, toType: "project", toRef: projectId, relationship: "supports", createdBy: "test" })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.update(strategyExecutionLinks).set({ toType: "project", toRef: projectId }).where(eq(strategyExecutionLinks.id, created.link.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("serializes CAS, requires explicit native execution ownership and rejects dependency cycles", async () => {
    await expect(service().create(companyId, actor, { definition: { ...definition(), from: { type: "goal", id: goalId }, to: { type: "project", id: projectId }, relationship: "advanced_by" } })).rejects.toMatchObject({ status: 409 });
    await db.insert(projectGoals).values({ companyId, goalId, projectId });
    await approved({ ...definition(), from: { type: "goal", id: goalId }, to: { type: "project", id: projectId }, relationship: "advanced_by" });
    const created = await approved({ ...definition(), from: { type: "goal", id: goalId }, to: { type: "project", id: projectId }, relationship: "depends_on" });
    const reverse = await service().create(companyId, actor, { definition: { ...definition(), from: { type: "project", id: projectId }, to: { type: "goal", id: goalId }, relationship: "depends_on" } });
    await expect(service().approve(companyId, actor, reverse.link.id, { expectedRevision: 1, versionId: reverse.version.id, rationale: "This reverse dependency would introduce a cycle" })).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([service().revise(companyId, actor, created.link.id, { expectedRevision: 2, definition: created.version.definition }), service().revise(companyId, actor, created.link.id, { expectedRevision: 2, definition: created.version.definition })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("erases all history through native Goal deletion and denies restored payloads with flags off", async () => {
    const created = await approved(); const originalGoal = (await db.select().from(goals).where(eq(goals.id, goalId)))[0];
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ strategy_execution_v8: false });
    await goalService(db).remove(goalId);
    expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, created.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, created.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionLinkApprovals).where(eq(strategyExecutionLinkApprovals.linkId, created.link.id))).toHaveLength(0);
    await db.insert(goals).values(originalGoal);
    await expect(db.insert(strategyExecutionLinks).values({ id: created.link.id, companyId, fromType: "foundation_section", fromRef: foundation.id, toType: "goal", toRef: goalId, relationship: "supports", status: "proposed", createdBy: "test" })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("erases a retained Foundation revision under Memory alone and blocks old pins", async () => {
    const created = await approved();
    await db.transaction(async rawTx => { const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); await eraseStrategySource(tx, companyId, "document_revision", [foundation.approvedRevisionId!]); await tx.update(documentRevisions).set({ body: "", title: "Erased" }).where(eq(documentRevisions.id, foundation.approvedRevisionId!)); });
    expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, created.link.id))).toHaveLength(0);
    expect(await db.select().from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, "document_revision")))).toHaveLength(1);
    await db.insert(strategyExecutionLinks).values({ id: created.link.id, companyId, fromType: "foundation_section", fromRef: foundation.id, toType: "goal", toRef: goalId, relationship: "supports", createdBy: "test" });
    await expect(db.insert(strategyExecutionLinkVersions).values({ companyId, linkId: created.link.id, revision: 1, definition: created.version.definition, contentHash: created.version.contentHash, createdBy: "test", createdAt: new Date(), nextReviewAt: new Date(Date.now()+86400000), expiresAt: new Date(Date.now()+86400000) })).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("allows retirement after flag rollback and removes expired retained payloads", async () => {
    const created = await approved();
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ strategy_execution_v8: false });
    expect(await service().retire(companyId, actor, created.link.id, { expectedRevision: 2, rationale: "Explicit withdrawal during rollback" })).toMatchObject({ status: "retired" });
    expect(await service().eraseExpired(companyId, new Date(Date.now()+91*86400000))).toBe(1);
    expect(await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, created.link.id))).toHaveLength(0);
  });
  it("sweeps an expired historical version with flags off and its company paused, retaining unrelated current histories", async () => {
    const expired = await approved({ ...definition(), retentionDays: 1 });
    const replacement = await service().revise(companyId, actor, expired.link.id, { expectedRevision: 2, definition: definition() });
    await service().approve(companyId, actor, expired.link.id, { expectedRevision: 3, versionId: replacement.id, rationale: "Human approval of a separately retained revision" });
    const retained = await approved({ ...definition(), from: { type: "goal", id: goalId }, to: { type: "project", id: projectId } });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ strategy_execution_v8: false });
    const now = new Date(Date.now()+2*86400000);
    expect(await service().sweepExpired(now)).toEqual({ checkedCompanies: 1, erasedLinks: 1, hasMoreCompanies: false });
    expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, expired.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, expired.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionLinkApprovals).where(eq(strategyExecutionLinkApprovals.linkId, expired.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionSourceBindings).where(eq(strategyExecutionSourceBindings.linkId, expired.link.id))).toHaveLength(0);
    expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, retained.link.id))).toHaveLength(1);
    expect(await service().sweepExpired(now)).toEqual({ checkedCompanies: 0, erasedLinks: 0, hasMoreCompanies: false });
  });
  it("preserves Decision target erasure ancestry after its native target join disappears", async () => {
    const secret = process.env.PAPERCLIP_DECISION_SIGNING_SECRET;
    process.env.PAPERCLIP_DECISION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
    try {
      const agentId = randomUUID(), runId = randomUUID(), originId = randomUUID(), targetId = randomUUID();
      await db.insert(agents).values({ companyId, id: agentId, name: "Native proposer", role: "engineer", status: "active", adapterType: "codex_local", permissions: {} });
      await db.insert(issues).values([{ companyId, id: originId, title: "Origin", assigneeAgentId: agentId, responsibleUserId: "local-board" }, { companyId, id: targetId, title: "Target", responsibleUserId: "local-board" }]);
      await db.insert(heartbeatRuns).values({ companyId, id: runId, agentId, status: "running", responsibleUserId: "local-board", contextSnapshot: { issueId: originId } });
      const agentActor = { type: "agent" as const, companyId, agentId, runId, source: "agent_jwt" as const, onBehalfOfUserId: "local-board", onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }] };
      const decision = await decisionService(db, { wakeOriginAgent: async () => {} }).create({ companyId, actor: agentActor, agentId, runId, title: "Native choice", body: "Explicitly review target work", options: [{ id: "yes", label: "Yes", effects: [{ type: "comment_on_issue", targetIssueId: targetId, staleness: "lenient", bodyMarkdown: "Accepted human choice" }] }] });
      const created = await approved({ ...definition(), to: { type: "decision", id: decision.id } });
      expect((await db.select().from(strategyExecutionSourceBindings).where(eq(strategyExecutionSourceBindings.linkId, created.link.id))).map(b => b.issueId)).toContain(targetId);
      await db.delete(decisionTargetIssues).where(eq(decisionTargetIssues.decisionId, decision.id));
      await issueService(db).remove(targetId);
      expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, created.link.id))).toHaveLength(0);
      expect(await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, created.link.id))).toHaveLength(0);
    } finally { if (secret === undefined) delete process.env.PAPERCLIP_DECISION_SIGNING_SECRET; else process.env.PAPERCLIP_DECISION_SIGNING_SECRET = secret; }
  });
  it("waits for Memory before taking Foundation rows during a native draft mutation", async () => {
    const created = await approved(); let releaseMemory!: () => void, signalHeld!: () => void;
    const held = new Promise<void>(resolve => { signalHeld = resolve; }); const release = new Promise<void>(resolve => { releaseMemory = resolve; });
    const mutation = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); signalHeld(); await release;
      await tx.execute(sql`set local lock_timeout='1s'`);
      await foundationService(tx).updateDraft(companyId, foundation.id, { baseRevisionId: foundation.latestRevisionId!, body: "# Strategy\nA concurrent native working draft" }, foundationActor);
    });
    await held; const read = service().detail(companyId, actor, created.link.id);
    try {
      let blocked = false; const deadline = performance.now()+5000;
      while (performance.now()<deadline) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) as waiting`);
        if (row.waiting) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve,20));
      }
      expect(blocked).toBe(true); releaseMemory(); await mutation;
      expect((await read).link.status).toBe("active");
    } finally { releaseMemory(); await Promise.allSettled([mutation,read]); }
  });
  it("replays post-backup Goal erasure in an isolated migrated database and preserves unrelated links", async () => {
    const erased = await approved({ ...definition(), from: { type: "goal", id: goalId }, to: { type: "project", id: projectId } });
    const [otherGoal] = await db.insert(goals).values({ companyId, title: "Unrelated objective" }).returning();
    const retained = await approved({ ...definition(), from: { type: "goal", id: otherGoal.id }, to: { type: "project", id: projectId } });
    const backup = {
      companies: await db.select().from(companies).where(eq(companies.id, companyId)),
      goals: await db.select().from(goals).where(eq(goals.companyId, companyId)),
      projects: await db.select().from(projects).where(eq(projects.companyId, companyId)),
      roots: await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.companyId, companyId)),
      versions: await db.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.companyId, companyId)),
      approvals: await db.select().from(strategyExecutionLinkApprovals).where(eq(strategyExecutionLinkApprovals.companyId, companyId)),
      bindings: await db.select().from(strategyExecutionSourceBindings).where(eq(strategyExecutionSourceBindings.companyId, companyId)),
    };
    await goalService(db).remove(goalId);
    const [guard] = await db.select().from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, "goal")));
    const name = `aw_restore_${randomUUID().replaceAll("-", "")}`; const target = new URL(database.connectionString); target.pathname = `/${name}`;
    await db.execute(sql`create database ${sql.identifier(name)}`); const restored = createDb(target.toString());
    try {
      await applyPendingMigrations(target.toString());
      await restored.insert(companies).values(backup.companies); await restored.insert(goals).values(backup.goals); await restored.insert(projects).values(backup.projects);
      await restored.insert(strategyExecutionLinks).values(backup.roots.map(row => ({ ...row, status: "proposed" as const, approvedVersionId: null })));
      await restored.insert(strategyExecutionLinkVersions).values(backup.versions);
      await restored.insert(strategyExecutionLinkApprovals).values(backup.approvals);
      await restored.insert(strategyExecutionSourceBindings).values(backup.bindings);
      for (const row of backup.roots) await restored.update(strategyExecutionLinks).set({ status: row.status, approvedVersionId: row.approvedVersionId }).where(eq(strategyExecutionLinks.id, row.id));
      const marker = { company_id: companyId, input_type: "goal" as const, input_ref: goalId, suppressed_at: guard.suppressedAt.toISOString() };
      await prepareRestoredQuarantine(restored, target.toString(), { companies: [], memory: [], businessEvents: [], analyticalSources: [marker,marker,{ ...marker, company_id: randomUUID() }] });
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow("remains quarantined");
      expect((await instanceSettingsService(restored).getExperimental()).strategy_execution_v8).toBe(false);
      expect((await restored.select().from(strategyExecutionLinks)).map(r => r.id)).toEqual([retained.link.id]);
      expect(await restored.select().from(strategyExecutionLinkVersions).where(eq(strategyExecutionLinkVersions.linkId, erased.link.id))).toHaveLength(0);
      expect(await restored.select().from(strategyExecutionLinkApprovals).where(eq(strategyExecutionLinkApprovals.linkId, erased.link.id))).toHaveLength(0);
    } finally { await db.execute(sql`drop database ${sql.identifier(name)} with (force)`); }
  });
  it("takes Memory before deleting a Project row that a concurrent native owner updates", async () => {
    const created = await approved({ ...definition(), from: { type: "project", id: projectId }, to: { type: "goal", id: goalId } });
    let releaseMemory!: () => void, signalHeld!: () => void;
    const held = new Promise<void>(resolve => { signalHeld = resolve; }), release = new Promise<void>(resolve => { releaseMemory = resolve; });
    const mutation = db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db; await lockMemoryPrivacy(tx, companyId); signalHeld(); await release;
      await tx.execute(sql`set local lock_timeout='1s'`);
      await projectService(tx).update(projectId, { name: "Privacy-reconciled native project" });
    });
    await held; const deletion = projectService(db).remove(projectId);
    try {
      let blocked = false; const deadline = performance.now()+5000;
      while (performance.now()<deadline) {
        const [row] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())) as waiting`);
        if (row.waiting) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve,20));
      }
      expect(blocked).toBe(true); releaseMemory(); await mutation;
      expect(await deletion).toMatchObject({ id: projectId });
      expect(await db.select().from(strategyExecutionLinks).where(eq(strategyExecutionLinks.id, created.link.id))).toHaveLength(0);
    } finally { releaseMemory(); await Promise.allSettled([mutation,deletion]); }
  });
});
