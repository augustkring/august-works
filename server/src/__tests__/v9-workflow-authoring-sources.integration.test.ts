import { optimizerEvaluationService } from "../services/optimizer/optimizer-evaluation.js";
import { proposeOptimizerCandidate } from "../services/optimizer/optimizer-candidate-proposal.js";
import type { OptimizerTrace } from "@paperclipai/shared";
import { optimizerSuggestionService } from "../services/optimizer/optimizer-suggestions.js";
import { optimizerTraceService } from "../services/optimizer/optimizer-trace.js";
import { getWorkflowRunReview, reviewWorkflowRun } from "../services/optimizer/optimizer-run-review.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, automationArtifacts, automationArtifactVersions, authUsers, companyMemberships, createDb, heartbeatRuns, issues, memoryDeletionMarkers, memoryJobs,
  principalPermissionGrants, workflowRevisions, workflowRuns, workflowStepRuns, workflowRunReviews, workflows, workflowWaits } from "@paperclipai/db";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { workflowCustomerDraftFlow } from "../services/workflows/workflow-customer-draft-flow.js";
import { capabilityResolverService } from "../services/capability-resolver.js";
import { automationArtifactService } from "../services/automation-artifacts/automation-artifact-service.js";
import { assertLearningAssetCurrent } from "../services/learning/learning-assets.js";

describe.sequential("Original workflow private authoring copy owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, source: typeof issues.$inferSelect, origin: typeof heartbeatRuns.$inferSelect;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-workflow-source-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 120_000);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true, enableAiWorkflowAuthoring: true, enableAgentChat: true });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit", "workflows:publish", "workflows:run"].flatMap(permissionKey => [
      { companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey },
      { companyId: f.home, principalType: "user", principalId: f.userId, permissionKey },
    ])).onConflictDoNothing();
    source = await issueService(db).create(f.home, { title: "PRIVATE source", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "waiting", status: "in_review", createdByUserId: f.userId });
    [origin] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      status: "running", contextSnapshot: { issueId: source.id, conversationSessionGeneration: 0 } }).returning();
  });
  const human = () => ({ principal: { type: "user" as const, userId: f.userId } });
  async function authored() {
    return (await workflowAuthoringToolsService(db).create({ companyId: f.home, agentId: f.presence.id, runId: origin.id },
      { name: "PRIVATE workflow", description: "PRIVATE described intent", idempotencyKey: randomUUID() })).workflow;
  }
  async function changedAndPublished(waitForCompletion = false) {
    const created = await authored(), owner = workflowService(db);
    const changed = await owner.updateDraft(f.home, created.id, { expectedRevisionId: created.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "task", type: "work.create_task", name: "PRIVATE task step", position: { x: 0, y: 1 }, config: {
          title: "PRIVATE copied task", description: "PRIVATE copied description", projectId: null,
          assigneeAgentId: null, assigneeUserId: f.userId, waitForCompletion } },
      ], edges: [{ id: "to-task", source: "start", target: "task" }], variables: [], settings: { totalDeadlineSeconds: 60 },
    } }, human());
    const published = await owner.publish(f.home, changed.id, { expectedDraftRevisionId: changed.draftRevisionId!, expectedPublishedRevisionId: null }, human());
    return { created, changed, published };
  }
  async function privateValueWorkflow() {
    const owner = workflowService(db), childDraft = await authored();
    const childChanged = await owner.updateDraft(f.home, childDraft.id, { expectedRevisionId: childDraft.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "value", type: "core.transform", name: "Prepare value", position: { x: 0, y: 1 }, config: { mapping: { value: "PRIVATE child result" } } },
      ], edges: [{ id: "next", source: "start", target: "value" }], variables: [], settings: {},
    } }, human());
    return owner.publish(f.home, childDraft.id, { expectedDraftRevisionId: childChanged.draftRevisionId!, expectedPublishedRevisionId: null }, human());
  }
  async function parentWorkflow(child: { id: string; publishedRevisionId: string | null }) {
    const owner = workflowService(db);
    const parentDraft = await owner.create(f.home, { name: "Public parent configuration" }, human());
    const parentChanged = await owner.updateDraft(f.home, parentDraft.id, { expectedRevisionId: parentDraft.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "child", type: "core.subworkflow", name: "Run child", position: { x: 0, y: 1 }, config: {
          workflowId: child.id, revisionId: child.publishedRevisionId!, inputMapping: {}, timeoutSeconds: 60, cancellationPolicy: "propagate" } },
      ], edges: [{ id: "next", source: "start", target: "child" }], variables: [], settings: {},
    } }, human());
    return owner.publish(f.home, parentDraft.id, { expectedDraftRevisionId: parentChanged.draftRevisionId!, expectedPublishedRevisionId: null }, human());
  }
  async function eraseSource() {
    await db.transaction(async raw => {
      const tx = raw as unknown as typeof db;
      await lockAnalyticalCompany(tx, f.home); await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${origin.id}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [origin.id] });
    });
  }
  it("keeps private published workflow names out of another Human's runtime capability inventory", async () => {
    const { published } = await changedAndPublished(), resolver = capabilityResolverService(db);
    expect((await resolver.search(f.actor, f.home, "PRIVATE workflow")).map(row => row.ref)).toContain(published.id);
    const userId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Other owner", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(["workflows:read", "workflows:run"].map(permissionKey => ({ companyId: f.home, principalType: "user", principalId: userId, permissionKey })));
    const foreign = { type: "board" as const, source: "session" as const, userId, isInstanceAdmin: true, companyIds: [f.home] };
    await expect(workflowService(db).getDetail(f.home, published.id, foreign)).rejects.toMatchObject({ status: 403 });
    const inventory = await resolver.search(foreign, f.home, "PRIVATE workflow");
    expect(inventory.map(row => row.ref)).not.toContain(published.id); expect(JSON.stringify(inventory)).not.toContain("PRIVATE workflow");
    await eraseSource();
    expect((await resolver.search(f.actor, f.home, "PRIVATE workflow")).map(row => row.ref)).not.toContain(published.id);
  });
  it("keeps an Artifact's copied private workflow material behind the original Source owner", async () => {
    const workflow = await authored(), artifacts = automationArtifactService(db);
    await instanceSettingsService(db).updateExperimental({ enableAutomationArtifactsV1: true });
    const artifact = await artifacts.create(f.home, { name: "PRIVATE workflow derivative", description: "PRIVATE copied description",
      kind: "expression", language: null, riskClass: "C0", sideEffectClass: "pure", originWorkflowId: workflow.id,
      originNodeId: null, createdByOptimizerSuggestionId: null, sourceCode: "input.value", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {},
    }, human());
    expect((await artifacts.getDetail(f.home, artifact.artifact.id, human()))!.latestVersion!.sourceCode).toBe("input.value");
    const userId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Other Artifact reader", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: userId, permissionKey: "workflows:read" });
    const foreign = { principal: { type: "user" as const, userId } };
    await expect(artifacts.getDetail(f.home, artifact.artifact.id, foreign)).rejects.toMatchObject({ status: 403 });
    await expect(assertLearningAssetCurrent(db, f.home, "automation_artifact_version", artifact.latestVersion!.id,
      { type: "board", source: "session", userId })).rejects.toMatchObject({ status: 403 });
    await assertLearningAssetCurrent(db, f.home, "automation_artifact_version", artifact.latestVersion!.id, f.actor);
    expect((await artifacts.list(f.home, foreign)).map(row => row.id)).not.toContain(artifact.artifact.id);
    await expect(artifacts.appendVersion(f.home, artifact.artifact.id, { expectedLatestVersionId: artifact.latestVersion!.id,
      sourceCode: "input.value", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {},
    }, foreign)).rejects.toMatchObject({ status: 403 });
    const revised = await artifacts.appendVersion(f.home, artifact.artifact.id, { expectedLatestVersionId: artifact.latestVersion!.id,
      sourceCode: "lower(input.value)", inputSchema: { type: "object", properties: { "PRIVATE field": { type: "string" } } }, outputSchema: {}, dependencyManifest: {}, testSpec: {},
    }, human());
    await db.execute(sql`create function aw_v9_test_artifact_source_unverify() returns trigger language plpgsql as $$ begin
      if NEW.action='automation_artifact.version_created' then update ${authUsers} set email_verified=false where id=NEW.actor_id; end if; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_artifact_source_unverify after insert on activity_log for each row execute function aw_v9_test_artifact_source_unverify()`);
    try {
      await expect(artifacts.appendVersion(f.home, artifact.artifact.id, { expectedLatestVersionId: revised.latestVersion!.id,
        sourceCode: "upper(input.value)", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {},
      }, human())).rejects.toMatchObject({ status: 403 });
      expect((await db.select().from(authUsers).where(eq(authUsers.id, f.userId)))[0].emailVerified).toBe(true);
      expect((await artifacts.getDetail(f.home, artifact.artifact.id, human()))!.latestVersion!.id).toBe(revised.latestVersion!.id);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_artifact_source_unverify on activity_log`);
      await db.execute(sql`drop function aw_v9_test_artifact_source_unverify()`);
    }
    await expect(db.update(automationArtifacts).set({ originWorkflowId: null }).where(eq(automationArtifacts.id, artifact.artifact.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await eraseSource();
    await expect(artifacts.getDetail(f.home, artifact.artifact.id, human())).rejects.toMatchObject({ status: 403 });
    const cleanArtifact = await artifacts.create(f.home, { name: "Public Artifact target", kind: "expression", language: null,
      riskClass: "C0", sideEffectClass: "pure", sourceCode: "input.value", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {} }, human());
    await expect(db.update(automationArtifactVersions).set({ artifactId: cleanArtifact.artifact.id }).where(eq(automationArtifactVersions.id, revised.latestVersion!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const [erased] = await db.select().from(automationArtifacts).where(eq(automationArtifacts.id, artifact.artifact.id));
    expect(erased).toMatchObject({ name: "Source-erased artifact", description: null, status: "deprecated", inputSchema: {}, outputSchema: {}, originWorkflowId: workflow.id });
    const versions = await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.artifactId, artifact.artifact.id));
    expect(versions).toHaveLength(2);
    for (const version of versions) expect(version).toMatchObject({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null });
    expect(versions.find(version => version.id === artifact.latestVersion!.id)!.contentHash).toBe(artifact.latestVersion!.contentHash);
    await db.update(automationArtifactVersions).set({ sourceCode: "PRIVATE restored body", inputSchema: { secret: "PRIVATE restored schema" } }).where(eq(automationArtifactVersions.id, revised.latestVersion!.id));
    expect((await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, revised.latestVersion!.id)))[0]).toMatchObject({ sourceCode: "", inputSchema: {} });
    const [restored] = await db.insert(automationArtifactVersions).values({ companyId: f.home, artifactId: artifact.artifact.id, versionNumber: 3,
      sourceCode: "PRIVATE restored new version", inputSchema: { secret: "PRIVATE schema" }, outputSchema: {}, dependencyManifest: {}, testSpec: {},
      contentHash: "a".repeat(64), createdByUserId: f.userId }).returning();
    expect(restored).toMatchObject({ sourceCode: "", inputSchema: {}, outputSchema: {} });
    const jobs = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, f.home), eq(memoryJobs.jobKey, `artifact-workspace-erasure:v1:${artifact.latestVersion!.id}`)));
    expect(jobs).toHaveLength(1); expect(jobs[0].sourceRefJson).toEqual({ kind: "artifact_workspace_erasure", versionId: artifact.latestVersion!.id });
  });
  it("retains exact source identities through Human changes and publication without exposing them in public details", async () => {
    const { created, changed, published } = await changedAndPublished();
    const [stored] = await db.select().from(workflows).where(eq(workflows.id, created.id));
    expect(stored!.authoringSourceRunIds).toEqual([origin.id]);
    expect(changed.draftRevisionId).not.toBe(created.draftRevisionId);
    expect(published.publishedRevisionId).toBe(changed.draftRevisionId);
    expect(published.draftRevision?.createdByRunId).toBeNull();
    const current = await workflowService(db).getDetail(f.home, created.id, f.actor);
    expect(current!.publishedRevision?.graph.nodes[1].name).toBe("PRIVATE task step");
    expect(current).not.toHaveProperty("authoringSourceRunIds");
    expect((await workflowService(db).list(f.home, f.actor)).map(item => item.id)).toContain(created.id);
    expect(await workflowService(db).list(f.home)).toEqual([]);
    await expect(workflowService(db).getDetail(f.home, created.id)).rejects.toMatchObject({ status: 403 });
  });
  it("keeps private authoring sources authoritative for guided flow composition and its historical receipt", async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, progressive_shell_v9: true });
    const created = await authored(), service = workflowCustomerDraftFlow(db), view = await service.review(f.home, created.id, f.actor);
    const input = { requestId: randomUUID(), expectedWorkflowId: created.id, expectedDraftRevisionId: view.draftRevisionId,
      expectedPublishedRevisionId: view.publishedRevisionId, expectedUpdatedAt: view.updatedAt, expectedLastNodeId: null,
      operation: { kind: "start_manual" as const, deadlineSeconds: 30, name: "PRIVATE start" } };
    const saved = await service.save(f.home, created.id, input, f.actor);
    expect(await service.receipt(f.home, created.id, input.requestId, f.actor)).toEqual(saved);
    const [stored] = await db.select().from(workflows).where(eq(workflows.id, created.id)); expect(stored.authoringSourceRunIds).toEqual([origin.id]);
    await eraseSource();
    await expect(service.review(f.home, created.id, f.actor)).rejects.toMatchObject({ status: 403 });
    // Original privacy erasure also removes its request locator from derived
    // Activity details. Unavailable history is not evidence of no prior write.
    await expect(service.receipt(f.home, created.id, input.requestId, f.actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.save(f.home, created.id, input, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("requires the current owned source and verified account even for an instance-admin request snapshot", async () => {
    const created = await authored();
    await expect(workflowService(db).getDetail(f.home, created.id, { ...f.actor, userId: "different-human", isInstanceAdmin: true })).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(workflowService(db).getDetail(f.home, created.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("requires current Native workflow reading authority after a retained private revision was created", async () => {
    const created = await authored();
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalType, "user"), eq(principalPermissionGrants.principalId, f.userId),
      eq(principalPermissionGrants.permissionKey, "workflows:read")));
    await expect(workflowService(db).getDetail(f.home, created.id, f.actor)).rejects.toMatchObject({ status: 403 });
    expect(await workflowService(db).list(f.home, f.actor)).toEqual([]);
  });
  it("does not let an API key borrow a current Human from a real private authoring run", async () => {
    const created = await authored();
    await expect(workflowService(db).getDetail(f.home, created.id, { type: "agent", source: "agent_key", companyId: f.home,
      agentId: f.presence.id, runId: origin.id, onBehalfOfUserId: f.userId })).rejects.toMatchObject({ status: 403 });
  });
  it("retains the private child result's current source reader on its actual public parent run", async () => {
    const child = await privateValueWorkflow(), parent = await parentWorkflow(child);
    const engine = workflowExecutorService(db), completed = await engine.startManualRun(f.home, parent.id, { input: {} }, human(), randomUUID());
    expect(completed.run.status).toBe("succeeded");
    expect(JSON.stringify(completed.steps)).toContain("PRIVATE child result");
    expect(completed.run).not.toHaveProperty("authoringSourceWorkflowIds");
    const [storedParent] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, completed.run.id));
    expect(storedParent.authoringSourceWorkflowIds).toEqual([child.id]);
    const otherUser = `parent-reader-${randomUUID()}`, now = new Date();
    await db.insert(authUsers).values({ id: otherUser, name: "Other workflow reader", email: `${otherUser}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: otherUser, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: otherUser, permissionKey: "workflows:read" });
    await expect(engine.getRun(f.home, completed.run.id, { type: "board", source: "session", userId: otherUser })).rejects.toMatchObject({ status: 403 });
    await db.delete(workflowRuns).where(and(eq(workflowRuns.companyId, f.home), eq(workflowRuns.parentWorkflowRunId, completed.run.id)));
    await expect(engine.getRun(f.home, completed.run.id, { type: "board", source: "session", userId: otherUser })).rejects.toMatchObject({ status: 403 });
    await expect(db.update(workflowRuns).set({ authoringSourceWorkflowIds: [] }).where(eq(workflowRuns.id, completed.run.id))).rejects.toBeTruthy();
    await eraseSource();
    expect(JSON.stringify(await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, completed.run.id)))).not.toContain("PRIVATE child result");
    const [copiedStep] = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.workflowRunId, completed.run.id), eq(workflowStepRuns.nodeId, "child")));
    await db.update(workflowStepRuns).set({ outputJson: { value: "PRIVATE child result restored" } }).where(eq(workflowStepRuns.id, copiedStep.id));
    expect((await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.id, copiedStep.id)))[0].outputJson).toBeNull();
    await db.delete(workflowRuns).where(eq(workflowRuns.id, completed.run.id));
    await db.insert(workflowRuns).values({ id: completed.run.id, companyId: f.home, workflowId: parent.id,
      workflowRevisionId: parent.publishedRevisionId!, source: "manual", status: "succeeded", finishedAt: new Date(),
      triggerPayload: { value: "PRIVATE restored parent" }, authoringSourceWorkflowIds: [] });
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, completed.run.id)))[0].triggerPayload).toEqual({});
    await expect(engine.getRun(f.home, completed.run.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("retains the public parent's private child Source in Original Optimizer traces and review reads after child-run removal", async () => {
    const child = await privateValueWorkflow(), parent = await parentWorkflow(child);
    const completed = await workflowExecutorService(db).startManualRun(f.home, parent.id, { input: {} }, human(), randomUUID());
    expect(completed.run.status).toBe("succeeded");
    const otherUser = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: otherUser, name: "Foreign optimizer reader", email: `${otherUser}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: otherUser, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: otherUser, permissionKey: "workflows:read" });
    const foreign = { type: "board" as const, source: "session" as const, userId: otherUser, isInstanceAdmin: true };
    const reviewInput = { humanCorrection: true, correctedOutputs: { child: { value: "PRIVATE optimizer correction" } }, reason: "PRIVATE correction reason" };
    await reviewWorkflowRun(db, f.home, completed.run.id, reviewInput, human());
    await expect(optimizerTraceService(db).normalizeWorkflowRun(f.home, completed.run.id, foreign)).rejects.toMatchObject({ status: 403 });
    await expect(getWorkflowRunReview(db, f.home, completed.run.id, foreign)).rejects.toMatchObject({ status: 403 });
    await expect(optimizerSuggestionService(db).forWorkflow(f.home, parent.id, foreign)).rejects.toMatchObject({ status: 403 });
    expect(await optimizerSuggestionService(db).forWorkflow(f.home, parent.id, f.actor)).toMatchObject({ state: "insufficient_runs", terminalRunCount: 1 });
    await expect(optimizerTraceService(db).normalizeWorkflowRun(f.home, completed.run.id)).rejects.toMatchObject({ status: 403 });

    await expect(reviewWorkflowRun(db, f.home, completed.run.id, reviewInput, { principal: { type: "user", userId: otherUser } })).rejects.toMatchObject({ status: 403 });
    expect(await optimizerTraceService(db).normalizeWorkflowRun(f.home, completed.run.id, f.actor)).toMatchObject({ runId: completed.run.id });
    expect(await getWorkflowRunReview(db, f.home, completed.run.id, f.actor)).toMatchObject({ correctedOutputs: reviewInput.correctedOutputs });
    await db.delete(workflowRuns).where(and(eq(workflowRuns.companyId, f.home), eq(workflowRuns.parentWorkflowRunId, completed.run.id)));
    await expect(optimizerTraceService(db).normalizeWorkflowRun(f.home, completed.run.id, foreign)).rejects.toMatchObject({ status: 403 });
    await eraseSource();
    await expect(optimizerTraceService(db).normalizeWorkflowRun(f.home, completed.run.id, f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(getWorkflowRunReview(db, f.home, completed.run.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("cannot restore erased private copies by moving their Original run/review/step/wait ownership to a clean public run", async () => {
    const child = await privateValueWorkflow(), parent = await parentWorkflow(child), owner = workflowService(db), engine = workflowExecutorService(db);
    const privateRun = await engine.startManualRun(f.home, parent.id, { input: {} }, human(), randomUUID());
    expect(privateRun.run.status).toBe("succeeded");
    await reviewWorkflowRun(db, f.home, privateRun.run.id, { humanCorrection: true, correctedOutputs: { child: { value: "PRIVATE correction" } }, reason: "PRIVATE review reason" }, human());
    const clean = await owner.create(f.home, { name: "Public restore target" }, human());
    const draft = await owner.updateDraft(f.home, clean.id, { expectedRevisionId: clean.draftRevisionId!, graph: { version: 1,
      nodes: [{ id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} } }, human());
    const published = await owner.publish(f.home, clean.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null }, human());
    const publicRun = await engine.startManualRun(f.home, clean.id, { input: {} }, human(), randomUUID());
    expect(publicRun.run.status).toBe("succeeded");
    await eraseSource();
    const [step] = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.workflowRunId, privateRun.run.id), eq(workflowStepRuns.nodeId, "child")));
    const [wait] = await db.select().from(workflowWaits).where(eq(workflowWaits.workflowRunId, privateRun.run.id));
    const [review] = await db.select().from(workflowRunReviews).where(eq(workflowRunReviews.workflowRunId, privateRun.run.id));
    expect(step).toBeTruthy(); expect(wait).toBeTruthy(); expect(review).toBeTruthy();
    await expect(db.update(workflowStepRuns).set({ workflowRunId: publicRun.run.id, inputJson: { value: "PRIVATE step restored" }, outputJson: { value: "PRIVATE result restored" } }).where(eq(workflowStepRuns.id, step.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(workflowWaits).set({ workflowRunId: publicRun.run.id, resolutionJson: { value: "PRIVATE wait restored" } }).where(eq(workflowWaits.id, wait.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(workflowRunReviews).set({ workflowRunId: publicRun.run.id, correctedOutputs: { child: { value: "PRIVATE review restored" } } }).where(eq(workflowRunReviews.id, review.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(workflowRuns).set({ workflowId: clean.id, workflowRevisionId: published.publishedRevisionId!, triggerPayload: { value: "PRIVATE run restored" } }).where(eq(workflowRuns.id, privateRun.run.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(workflowRevisions).set({ workflowId: clean.id, graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} } }).where(eq(workflowRevisions.id, child.publishedRevisionId!))).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(JSON.stringify(await engine.getRun(f.home, publicRun.run.id, f.actor))).not.toContain("PRIVATE");
    expect((await db.select().from(workflowRunReviews).where(eq(workflowRunReviews.id, review.id)))[0].correctedOutputs).toEqual({});
  });
  it("keeps actual compiled Artifact replay copies behind a public parent's private child Sources", async () => {
    await instanceSettingsService(db).updateExperimental({ enableAutomationArtifactsV1: true, enableWorkflowOptimizerSuggestions: true });
    const child = await privateValueWorkflow(), owner = workflowService(db), engine = workflowExecutorService(db);
    const parent = await owner.create(f.home, { name: "Public compiler parent" }, human());
    const draft = await owner.updateDraft(f.home, parent.id, { expectedRevisionId: parent.draftRevisionId!, graph: { version: 1, nodes: [
      { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
      { id: "child", type: "core.subworkflow", name: "Run child", position: { x: 0, y: 1 }, config: { workflowId: child.id, revisionId: child.publishedRevisionId!, inputMapping: {}, timeoutSeconds: 60, cancellationPolicy: "propagate" } },
      { id: "project", type: "core.transform", name: "Select result", position: { x: 0, y: 2 }, config: { mapping: { value: "{{input.result.value}}" } } },
      { id: "copy", type: "core.transform", name: "Copy value", position: { x: 0, y: 3 }, config: { mapping: { value: "{{input.value}}" } } },
    ], edges: [{ id: "one", source: "start", target: "child" }, { id: "two", source: "child", target: "project" }, { id: "three", source: "project", target: "copy" }], variables: [], settings: {} } }, human());
    const published = await owner.publish(f.home, parent.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null }, human());
    const traces = new Map<string, OptimizerTrace>();
    for (let i = 0; i < 3; i++) {
      const run = await engine.startManualRun(f.home, parent.id, { input: {} }, human(), randomUUID());
      expect(run.run.status).toBe("succeeded"); expect(run.steps.find(step => step.nodeId === "copy")!.outputJson).toEqual({ value: "PRIVATE child result" });
      await reviewWorkflowRun(db, f.home, run.run.id, { humanCorrection: false, correctedOutputs: {}, reason: "Synthetic Source-copy contract; no Human qualification" }, human());
      const trace = await optimizerTraceService(db).normalizeWorkflowRun(f.home, run.run.id, f.actor);
      // Synthetic timing/cost classification selects a span; actual payloads,
      // runs, reviews, revisions and Sources remain the Original DB records.
      traces.set(run.run.id, { ...trace, steps: trace.steps.map(step => ({ ...step, durationMs: 1000, cost: 10 })) });
    }
    const suggestions = await optimizerSuggestionService(db, { traceNormalizer: { normalizeWorkflowRun: async (_company, runId) => traces.get(runId)! } }).forWorkflow(f.home, parent.id, f.actor);
    const suggestion = suggestions!.suggestions.find(item => item.stepOrdinals.length === 1 && item.stepOrdinals[0] === 4)!;
    expect(suggestion).toBeTruthy();
    const input = await proposeOptimizerCandidate(db, f.home, parent.id, suggestion.id, f.actor);
    const compiled = await optimizerEvaluationService(db).compile(f.home, parent.id, suggestion.id, input, human());
    expect(compiled.gatesPassed).toBe(true);
    const mine = await automationArtifactService(db).getDetail(f.home, compiled.artifactId, human());
    expect(JSON.stringify(mine)).toContain("PRIVATE child result");
    const userId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Other compiled Artifact reader", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "user", principalId: userId, permissionKey: "workflows:read" });
    const foreign = { principal: { type: "user" as const, userId } };
    await expect(automationArtifactService(db).getDetail(f.home, compiled.artifactId, foreign)).rejects.toMatchObject({ status: 403 });
    expect(mine.artifact).not.toHaveProperty("authoringSourceWorkflowIds");
    expect((await db.select().from(automationArtifacts).where(eq(automationArtifacts.id, compiled.artifactId)))[0].authoringSourceWorkflowIds).toEqual([child.id]);
    await expect(assertLearningAssetCurrent(db, f.home, "automation_artifact_version", compiled.artifactVersionId,
      { type: "board", source: "session", userId })).rejects.toMatchObject({ status: 403 });
    expect((await automationArtifactService(db).list(f.home, foreign)).map(row => row.id)).not.toContain(compiled.artifactId);
    await expect(db.update(automationArtifacts).set({ authoringSourceWorkflowIds: [] }).where(eq(automationArtifacts.id, compiled.artifactId))).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.delete(workflowRuns).where(eq(workflowRuns.companyId, f.home));
    expect(JSON.stringify(await automationArtifactService(db).getDetail(f.home, compiled.artifactId, human()))).toContain("PRIVATE child result");
    await expect(automationArtifactService(db).getDetail(f.home, compiled.artifactId, foreign)).rejects.toMatchObject({ status: 403 });
    const hash = mine.latestVersion!.contentHash;
    await eraseSource();
    const [erased] = await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, compiled.artifactVersionId));
    expect(erased).toMatchObject({ sourceCode: "", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, validationReport: null, securityReport: null, contentHash: hash });
    await db.update(automationArtifactVersions).set({ sourceCode: "PRIVATE restored compiler body", testSpec: { cases: [{ input: "PRIVATE restored replay" }] }, validationReport: mine.latestVersion!.validationReport, securityReport: mine.latestVersion!.securityReport }).where(eq(automationArtifactVersions.id, compiled.artifactVersionId));
    expect((await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, compiled.artifactVersionId)))[0]).toMatchObject({ sourceCode: "", testSpec: {}, validationReport: null, securityReport: null, contentHash: hash });
    await expect(automationArtifactService(db).getDetail(f.home, compiled.artifactId, human())).rejects.toMatchObject({ status: 403 });
    expect(published.publishedRevisionId).toBeTruthy();
  });
  it("keeps unresolvable legacy Artifact provenance unavailable and refuses new version copies", async () => {
    const [legacy] = await db.insert(automationArtifacts).values({ companyId: f.home, name: "Unresolved legacy fixture", kind: "expression", riskClass: "C0", sideEffectClass: "pure", authoringSourceWorkflowIds: null }).returning();
    await expect(automationArtifactService(db).getDetail(f.home, legacy.id, human())).rejects.toMatchObject({ status: 403 });
    await expect(db.update(automationArtifacts).set({ authoringSourceWorkflowIds: [] }).where(eq(automationArtifacts.id, legacy.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(automationArtifactVersions).values({ companyId: f.home, artifactId: legacy.id, versionNumber: 1, sourceCode: "PRIVATE unproven copy", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec: {}, contentHash: "a".repeat(64) })).rejects.toMatchObject({ cause: { code: "23514" } });
    const [collected] = await db.execute<{ refs: unknown }>(sql`select aw_optimizer_artifact_workflow_sources(${f.home}::uuid,${JSON.stringify([randomUUID()])}::jsonb,null::uuid) as refs`);
    expect(collected.refs).toBeNull();
  });
  it("propagates the actual private grandchild source to both public ancestors without changing their configurations", async () => {
    const child = await privateValueWorkflow(), middle = await parentWorkflow(child), outer = await parentWorkflow(middle);
    const completed = await workflowExecutorService(db).startManualRun(f.home, outer.id, { input: {} }, human(), randomUUID());
    expect(completed.run.status).toBe("succeeded"); expect(JSON.stringify(completed.steps)).toContain("PRIVATE child result");
    const executions = await db.select().from(workflowRuns).where(eq(workflowRuns.companyId, f.home));
    expect(executions).toHaveLength(3);
    for (const execution of executions) expect(execution.authoringSourceWorkflowIds).toEqual([child.id]);
    await eraseSource();
    const steps = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.companyId, f.home));
    expect(JSON.stringify(steps)).not.toContain("PRIVATE child result");
    for (const parent of [middle, outer]) expect((await workflowService(db).getDetail(f.home, parent.id, f.actor))!.status).toBe("active");
  });
  it("erases published and later Human drafts and their actual Native task copies, retaining unavailable identities", async () => {
    const { published } = await changedAndPublished(), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: { privateInput: "PRIVATE input" } }, human(), randomUUID());
    const copies = await db.select().from(issues).where(and(eq(issues.companyId, f.home), eq(issues.originKind, "workflow_task")));
    expect(copies).toHaveLength(1); expect(copies[0].title).toBe("PRIVATE copied task");
    await eraseSource();
    const [root] = await db.select().from(workflows).where(eq(workflows.id, published.id));
    expect(root).toMatchObject({ name: "Source-erased workflow", description: null, status: "paused", publishedRevisionId: null, draftRevisionId: null,
      authoringSourceRunIds: [origin.id] });
    const revisions = await db.select().from(workflowRevisions).where(eq(workflowRevisions.workflowId, published.id));
    expect(revisions.length).toBeGreaterThan(2);
    for (const row of revisions) expect(row).toMatchObject({ graph: { version: 1, nodes: [], edges: [], variables: [], settings: {} }, inputSchema: null, outputSchema: null, changeSummary: null });
    const [task] = await db.select().from(issues).where(eq(issues.id, copies[0].id));
    expect(task).toMatchObject({ title: "Erased workflow task", description: null });
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id));
    expect(run!.triggerPayload).toEqual({});
    expect(JSON.stringify(await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, run!.id)))).not.toContain("PRIVATE");
    await expect(workflowService(db).getDetail(f.home, published.id, f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(engine.getRun(f.home, run!.id, f.actor)).rejects.toMatchObject({ status: 403 });
  });
  it("refuses dropping provenance and scrubs late/restored private workflow payloads after erasure", async () => {
    const { published } = await changedAndPublished();
    await expect(db.update(workflows).set({ authoringSourceRunIds: [] }).where(eq(workflows.id, published.id))).rejects.toBeTruthy();
    await eraseSource();
    await db.update(workflows).set({ name: "PRIVATE restored", description: "PRIVATE restored" }).where(eq(workflows.id, published.id));
    const [root] = await db.select().from(workflows).where(eq(workflows.id, published.id));
    expect(root!.name).toBe("Source-erased workflow"); expect(root!.description).toBeNull();
    const [original] = await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, published.publishedRevisionId!));
    await db.update(workflowRevisions).set({ graph: published.publishedRevision!.graph, changeSummary: "PRIVATE restore" }).where(eq(workflowRevisions.id, original!.id));
    expect((await db.select().from(workflowRevisions).where(eq(workflowRevisions.id, original!.id)))[0].graph.nodes).toEqual([]);
    await db.insert(activityLog).values({ companyId: f.home, actorType: "user", actorId: f.userId,
      action: "workflow.late_fixture", entityType: "workflow", entityId: root!.id, details: { body: "PRIVATE restore" } });
    expect((await db.select().from(activityLog).where(eq(activityLog.entityId, root!.id))).every(row => !JSON.stringify(row.details).includes("PRIVATE"))).toBe(true);
  });
  it("retains Original child cancellation through erasure and completes its software cleanup with rollout closed", async () => {
    const { published } = await changedAndPublished(true), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: {} }, human(), randomUUID());
    expect(admitted.run.status).toBe("waiting");
    const childId = admitted.waits.find(wait => wait.referenceType === "issue")!.referenceId!;
    await instanceSettingsService(db).updateExperimental({ enableAiWorkflowAuthoring: false, enableWorkflowBuilderV1: false,
      enableWorkflowsV1: false, progressive_shell_v9: false, experience_projection_v9: false });
    await eraseSource();
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelling");
    const [wait] = await db.select().from(workflowWaits).where(eq(workflowWaits.workflowRunId, admitted.run.id));
    expect(wait).toMatchObject({ status: "cancelled", resolutionJson: { parentCancellation: true, errorCode: "workflow_parent_cancelled" } });
    const result = await engine.recoverExpiredRuns(100, new Date(), { cancellationOnly: true });
    expect(result.failedRunIds).toEqual([]); expect(result.recovered).toBeGreaterThan(0);
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelled");
    expect((await db.select().from(issues).where(eq(issues.id, childId)))[0]).toMatchObject({ status: "cancelled", description: null });
    await db.update(workflowWaits).set({ resolutionJson: { privateValue: "PRIVATE restored" } }).where(eq(workflowWaits.id, wait.id));
    expect((await db.select().from(workflowWaits).where(eq(workflowWaits.id, wait.id)))[0].resolutionJson).toEqual({ parentCancellation: true, errorCode: "workflow_parent_cancelled" });
  });
  it("cancels the actual queued Native child without promoting a replacement heartbeat after source erasure", async () => {
    const { published } = await changedAndPublished(true), engine = workflowExecutorService(db);
    const admitted = await engine.startManualRun(f.home, published.id, { input: {} }, human(), randomUUID());
    const childId = admitted.waits.find(wait => wait.referenceType === "issue")!.referenceId!;
    // The fixture controls queue admission; cancellation/recovery below uses
    // the actual Native heartbeat service, not a mocked cancelRun implementation.
    const [child] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id,
      responsibleUserId: f.userId, invocationSource: "on_demand", status: "queued", contextSnapshot: { issueId: childId } }).returning();
    await db.update(issues).set({ assigneeAgentId: f.presence.id, assigneeUserId: null, executionRunId: child.id,
      executionAgentId: f.presence.id }).where(eq(issues.id, childId));
    await db.update(workflowStepRuns).set({ heartbeatRunId: child.id }).where(and(eq(workflowStepRuns.workflowRunId, admitted.run.id), eq(workflowStepRuns.nodeId, "task")));
    await eraseSource();
    const result = await engine.recoverExpiredRuns(100, new Date(), { cancellationOnly: true });
    expect(result.failedRunIds).toEqual([]);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, child.id)))[0].status).toBe("cancelled");
    expect((await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).map(row => row.id).sort())
      .toEqual([origin.id, child.id].sort());
    expect((await db.select().from(workflowRuns).where(eq(workflowRuns.id, admitted.run.id)))[0].status).toBe("cancelled");
  });
  it("keeps a permanent deletion marker when the private Native workflow itself is removed", async () => {
    const created = await authored();
    await db.delete(workflows).where(eq(workflows.id, created.id));
    await db.insert(workflows).values({ id: created.id, companyId: f.home, name: "PRIVATE restore", description: "PRIVATE restore", authoringSourceRunIds: [] });
    const [restored] = await db.select().from(workflows).where(eq(workflows.id, created.id));
    expect(restored).toMatchObject({ name: "Source-erased workflow", description: null, status: "paused" });
    const [receipt] = await db.execute<{ erased: boolean }>(sql`select aw_workflow_authoring_source_erased(${f.home}::uuid,${created.id}::uuid) as erased`);
    expect(receipt.erased).toBe(true);
  });
});
