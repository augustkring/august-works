import { assertOptimizerRunSources } from "./optimizer-source-authority.js";
import type { AuthorizationActor } from "../authorization.js";
import { learningActorFromPrincipal } from "../learning/learning-analytical-sources.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { companyMemberships, workflowRevisions, workflowRunReviews, workflowRuns, workflowStepRuns, type Db } from "@paperclipai/db";
import { z } from "zod";
import type { WorkflowMutationActor } from "../workflows/workflow-service.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { persistActivity, publishActivity } from "../activity-log.js";
import { validateWorkflowOutput } from "../workflows/workflow-output-schema.js";

import { workflowRunReviewSchema } from "../v4-api-contracts.js";
export { workflowRunReviewSchema } from "../v4-api-contracts.js";

export async function getWorkflowRunReview(db: Db, companyId: string, runId: string, actor?: AuthorizationActor) {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    await assertOptimizerRunSources(tx, companyId, runId, actor);
    const [review] = await tx.select().from(workflowRunReviews).where(and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, runId))).for("share");
    let result = review ?? null;
    if (review) {
      try { await assertMemoryRecordsRetained(tx, companyId, review.memoryRecordIds); }
      catch { result = { ...review, correctedOutputs: {}, reason: "Source payload erased" }; }
    }
    await assertOptimizerRunSources(tx, companyId, runId, actor);
    return result;
  });
}

export async function reviewWorkflowRun(db: Db, companyId: string, runId: string,
  rawInput: z.input<typeof workflowRunReviewSchema>, actor: WorkflowMutationActor) {
  const parsed = workflowRunReviewSchema.safeParse(rawInput);
  if (!parsed.success) throw unprocessable("Invalid workflow review", parsed.error.issues);
  const input = parsed.data;
  const reviewer = actor.principal, sourceActor = learningActorFromPrincipal(companyId, actor.principal, actor.runId);
  if (reviewer.type === "agent" || (reviewer.type === "system" && reviewer.service !== "local-board")) {
    throw forbidden("Only a board reviewer may confirm correction evidence");
  }
  const accepted = await db.transaction(async (tx) => {
    await lockAnalyticalCompany(tx as unknown as Db, companyId);
    await lockMemoryPrivacy(tx as unknown as Db, companyId);
    if (reviewer.type === "user") {
      const [membership] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, reviewer.userId), eq(companyMemberships.status, "active")));
      if (!membership) throw forbidden("Current company membership is required");
    }
    const [run] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId))).for("update");
    if (!run) throw notFound("Workflow run not found");
    await assertOptimizerRunSources(tx as unknown as Db, companyId, runId, sourceActor);
    if (run.source === "test") throw conflict("Internal workflow tests cannot become production correction evidence", {
      code: "workflow_test_not_production_evidence",
    });
    if (!["succeeded", "failed", "cancelled"].includes(run.status)) throw conflict("Review requires a terminal workflow run");
    const [existing] = await tx.select().from(workflowRunReviews).where(and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, runId)));
    if (existing) {
      await assertMemoryRecordsRetained(tx as unknown as Db, companyId, existing.memoryRecordIds);
      if (!isDeepStrictEqual(existing.reviewer, reviewer) || existing.humanCorrection !== input.humanCorrection ||
        !isDeepStrictEqual(existing.correctedOutputs, input.correctedOutputs) || existing.reason !== input.reason) {
        throw conflict("Accepted run review is immutable", { code: "workflow_run_review_already_accepted" });
      }
      await assertOptimizerRunSources(tx as unknown as Db, companyId, runId, sourceActor);
      return { review: existing, publication: null };
    }
    const steps = await tx.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, runId)));
    const references = [...new Set([...run.memoryRecordIds, ...steps.flatMap((step) => step.memoryRecordIds)])];
    await assertMemoryRecordsRetained(tx as unknown as Db, companyId, references);
    const [revision] = await tx.select().from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.id, run.workflowRevisionId)));
    for (const [nodeId, output] of Object.entries(input.correctedOutputs)) {
      const node = revision?.graph.nodes.find((item) => item.id === nodeId);
      if (!node || !steps.some((step) => step.nodeId === nodeId && step.status !== "skipped")) throw unprocessable("Correction must reference an observed node", { nodeId });
      validateWorkflowOutput((node.config as Record<string, unknown>).expectedOutputSchema as Record<string, unknown> | null, output);
    }
    const [review] = await tx.insert(workflowRunReviews).values({ companyId, workflowRunId: runId,
      ...input, reviewer: reviewer, memoryRecordIds: references }).returning();
    const principal = reviewer;
    const audit = await persistActivity(tx as unknown as Db, { companyId, actorType: principal.type,
      actorId: principal.type === "user" ? principal.userId : principal.service,
      action: "workflow.run_reviewed", entityType: "workflow_run", entityId: runId,
      details: { reviewId: review!.id, humanCorrection: input.humanCorrection, correctedNodeIds: Object.keys(input.correctedOutputs) } });
    await assertOptimizerRunSources(tx as unknown as Db, companyId, runId, sourceActor);
    return { review: review!, publication: audit.publication };
  });
  if (accepted.publication) publishActivity(accepted.publication);
  if (accepted.review.humanCorrection) {
    const [run] = await db.select({ workflowId: workflowRuns.workflowId }).from(workflowRuns)
      .where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, runId)));
    if (run) await (await import("./optimizer-live-drift.js")).evaluateWorkflowOptimizerDrift(db, companyId, run.workflowId);
  }
  return accepted.review;
}
