import { proposeOptimizerCandidate } from "./optimizer-candidate-proposal.js";
import { automationArtifactService } from "../automation-artifacts/automation-artifact-service.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, companyMemberships, createDb, instanceSettings, workflowOptimizerEvaluations, workflowOptimizerObservations } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { workflowService } from "../workflows/workflow-service.js";
import { workflowExecutorService } from "../workflows/workflow-executor.js";
import { reviewWorkflowRun } from "./optimizer-run-review.js";
import { optimizerSuggestionService } from "./optimizer-suggestions.js";
import { optimizerCandidateRequestSchema, optimizerEvaluationService } from "./optimizer-evaluation.js";
import { approvalService } from "../approvals.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
suite("governed optimizer workflow integration", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { temp = await startEmbeddedPostgresTestDatabase("paperclip-optimizer-live-"); db = createDb(temp.connectionString); }, 30_000);
  afterAll(async () => temp?.cleanup());

  async function qualify() {
    const experimental = {
      enableWorkflowsV1: true, enableWorkflowOptimizerSuggestions: true, enableWorkflowOptimizerShadow: true,
      enableWorkflowOptimizerPromotion: true, enableAutomationArtifactsV1: true,
    };
    await db.insert(instanceSettings).values({ singletonKey: "default", general: {}, experimental })
      .onConflictDoUpdate({ target: instanceSettings.singletonKey, set: { experimental } });
    const [company] = await db.insert(companies).values({ name: "Optimizer integration", issuePrefix: `O${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    const userId = `owner-${randomUUID()}`;
    await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const actor = { principal: { type: "user" as const, userId } };
    const svc = workflowService(db);
    const workflow = await svc.create(company!.id, { name: "Reviewed pure transform" }, actor);
    const draft = await svc.updateDraft(company!.id, workflow.id, { expectedRevisionId: workflow.draftRevisionId!, graph: {
      version: 1, nodes: [
        { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "copy", type: "core.transform", name: "Copy reviewed value", position: { x: 100, y: 0 }, config: { mapping: { value: "{{input.value}}" } } },
      ], edges: [{ id: "e", source: "start", target: "copy" }], variables: [], settings: {} } }, actor);
    await svc.publish(company!.id, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null }, actor);
    const executor = workflowExecutorService(db);
    for (let index = 1; index <= 3; index++) {
      const run = await executor.startManualRun(company!.id, workflow.id, { input: { value: index } }, actor, `source-${index}`);
      await reviewWorkflowRun(db, company!.id, run.run.id, { humanCorrection: false, correctedOutputs: {}, reason: "Verified the fixture result against the copy contract" }, actor);
    }
    const suggestions = await optimizerSuggestionService(db).forWorkflow(company!.id, workflow.id);
    const suggestion = suggestions!.suggestions.find((item) => item.operationTypes.length === 1 && item.operationTypes[0] === "core.transform")!;
    expect(suggestion).toBeTruthy();
    const request = await proposeOptimizerCandidate(db, company!.id, workflow.id, suggestion.id);
    expect(request.sourceCode).toBe('{"value":"{{input.value}}"}');
    request.invariants.push({ id: "nonnegative", description: "Values remain nonnegative", critical: true, expression: "{{trigger.output.value}} >= 0" });
    expect(optimizerCandidateRequestSchema.safeParse({ ...request, humanApproved: true, canaryPassed: true }).success).toBe(false);
    const evaluations = optimizerEvaluationService(db);
    const created = await evaluations.compile(company!.id, workflow.id, suggestion.id, request, actor);
    expect(created).toMatchObject({ gatesPassed: true, replayEvaluation: { status: "passed" } });
    await evaluations.startShadow(company!.id, created.evaluationId, actor);
    await expect(evaluations.requestPromotionApproval(company!.id, created.evaluationId, actor)).rejects.toMatchObject({ status: 409 });
    for (let index = 1; index <= 3; index++) {
      const run = await executor.startManualRun(company!.id, workflow.id, { input: { value: index + 3 } }, actor, `shadow-${index}`);
      expect(run.run.status).toBe("succeeded");
      expect(run.steps.find((item) => item.nodeId === "copy")?.outputJson).toEqual({ value: index + 3 });
    }
    const approval = await evaluations.requestPromotionApproval(company!.id, created.evaluationId, actor);
    expect((await evaluations.prepareCanary(company!.id, created.evaluationId)).decision.status).toBe("approval_required");
    await approvalService(db).approve(approval.approvalId!, userId, "Approve bounded pure canary with the original workflow fallback");
    expect((await evaluations.prepareCanary(company!.id, created.evaluationId)).decision.status).toBe("canary_ready");
    expect((await evaluations.activate(company!.id, created.evaluationId)).decision.status).toBe("canary_ready");
    for (let index = 0; index < 160; index++) {
      await executor.startManualRun(company!.id, workflow.id, { input: { value: index + 10 } }, actor, `canary-${index}`);
      const observations = await db.select().from(workflowOptimizerObservations).where(and(eq(workflowOptimizerObservations.evaluationId, created.evaluationId), eq(workflowOptimizerObservations.mode, "canary")));
      if (observations.filter((item) => item.candidateUsed && item.passed).length >= 10) break;
    }
    expect((await evaluations.activate(company!.id, created.evaluationId)).decision.status).toBe("promotion_ready");
    const active = await executor.startManualRun(company!.id, workflow.id, { input: { value: 42 } }, actor, "active-result");
    expect(active.steps.find((item) => item.nodeId === "copy")).toMatchObject({ outputJson: { value: 42 }, automationArtifactVersionId: created.artifactVersionId });
    return { company: company!, userId, actor, svc, workflow, executor, evaluations, created, active };
  }

  it("uses generated contracts, reviewed runs, shadow observations, bound approval, canary and fallback", async () => {
    const { company, actor, workflow, executor, evaluations, created } = await qualify();
    // New input shape fails closed to the original published transform and removes live eligibility.
    const fallback = await executor.startManualRun(company!.id, workflow.id, { input: { value: 42, neverSeen: true } }, actor, "new-shape-fallback");
    expect(fallback.run.status).toBe("succeeded");
    expect(fallback.steps.find((item) => item.nodeId === "copy")?.outputJson).toEqual({ value: 42 });
    const [degraded] = await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, created.evaluationId));
    expect(degraded?.status).toBe("degraded");
    await expect(evaluations.prepareCanary(randomUUID(), created.evaluationId)).rejects.toMatchObject({ status: 404 });
  }, 120_000);
  it("quarantines an active replacement when an authoritative reviewer corrects its output", async () => {
    const { company, actor, active, executor, workflow, created } = await qualify();
    await reviewWorkflowRun(db, company.id, active.run.id, { humanCorrection: true, correctedOutputs: { copy: { value: 41 } }, reason: "The reviewed business outcome requires correction" }, actor);
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, created.evaluationId)))[0]?.status).toBe("degraded");
    const fallback = await executor.startManualRun(company.id, workflow.id, { input: { value: 42 } }, actor, "after-human-correction");
    expect(fallback.steps.find((step) => step.nodeId === "copy")).toMatchObject({ outputJson: { value: 42 }, automationArtifactVersionId: null });
  }, 120_000);
  it("quarantines a replacement when its pinned published workflow changes", async () => {
    const { company, actor, svc, workflow, executor, created } = await qualify();
    const current = await svc.getDetail(company.id, workflow.id);
    const graph = structuredClone(current!.publishedRevision!.graph);
    graph.nodes.find((node) => node.id === "copy")!.config = { mapping: { value: "changed contract" } };
    const draft = await svc.updateDraft(company.id, workflow.id, { expectedRevisionId: current!.draftRevisionId!, graph }, actor);
    await svc.publish(company.id, workflow.id, { expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: current!.publishedRevisionId, approvalId: null }, actor);
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, created.evaluationId)))[0]?.status).toBe("degraded");
    const next = await executor.startManualRun(company.id, workflow.id, { input: { value: 42 } }, actor, "after-revision-change");
    expect(next.steps.find((step) => step.nodeId === "copy")?.outputJson).toEqual({ value: "changed contract" });
  }, 120_000);
  it("falls back when an activated candidate artifact is revoked", async () => {
    const { company, actor, workflow, executor, created } = await qualify();
    await automationArtifactService(db).archive(company.id, created.artifactId, { expectedLatestVersionId: created.artifactVersionId }, actor);
    const fallback = await executor.startManualRun(company.id, workflow.id, { input: { value: 42 } }, actor, "revoked-artifact");
    expect(fallback.steps.find((step) => step.nodeId === "copy")).toMatchObject({ outputJson: { value: 42 }, automationArtifactVersionId: null });
    expect((await db.select().from(workflowOptimizerEvaluations).where(eq(workflowOptimizerEvaluations.id, created.evaluationId)))[0]?.status).toBe("degraded");
  }, 120_000);
});
