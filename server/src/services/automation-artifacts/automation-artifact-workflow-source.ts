import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { automationArtifactVersions, workflowOptimizerEvaluations, workflowRevisions, workflowRuns, workflowStepRuns, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { withNativeAnalyticalReader } from "../analytical-reader.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertLearningAssetCurrent } from "../learning/learning-assets.js";
import { learningActorFromPrincipal } from "../learning/learning-analytical-sources.js";
import { assertLearnedWorkflowPayloadAccess } from "../analytical-context-authority.js";
import type { AutomationArtifactMutationActor } from "./automation-artifact-service.js";

/** Internal owner identities, never a client-supplied read grant. */
export type NativeArtifactWorkflowConsumer = { stepId: string; executionOwnerId: string; optimizerEvaluationId?: string };
export async function withNativeArtifactWorkflowSource<T>(db: Db, companyId: string, versionId: string,
  actor: AutomationArtifactMutationActor, consumer: NativeArtifactWorkflowConsumer,
  use: (tx: Db, reader: AuthorizationActor | undefined) => Promise<T>) {
  return db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const checkOwner = async () => {
      const [owner] = await tx.select({ step: workflowStepRuns, run: workflowRuns, revision: workflowRevisions, version: automationArtifactVersions })
        .from(workflowStepRuns)
        .innerJoin(workflowRuns, and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.id, workflowStepRuns.workflowRunId)))
        .innerJoin(workflowRevisions, and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.id, workflowRuns.workflowRevisionId), eq(workflowRevisions.workflowId, workflowRuns.workflowId)))
        .innerJoin(automationArtifactVersions, and(eq(automationArtifactVersions.companyId, companyId), eq(automationArtifactVersions.id, workflowStepRuns.automationArtifactVersionId)))
        .where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.id, consumer.stepId))).for("share");
      const node = owner?.revision.graph.nodes.find(node => node.id === owner.step.nodeId);
      const config = node?.config as Record<string, unknown> | undefined;
      const [evaluation] = consumer.optimizerEvaluationId ? await tx.select({ versionId: workflowOptimizerEvaluations.artifactVersionId,
        revisionId: workflowOptimizerEvaluations.workflowRevisionId, workflowId: workflowOptimizerEvaluations.workflowId, nodeId: workflowOptimizerEvaluations.nodeId })
        .from(workflowOptimizerEvaluations).where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.id, consumer.optimizerEvaluationId))) : [];
      const graphMatches = consumer.optimizerEvaluationId
        ? node?.type === "core.transform" && evaluation?.versionId === versionId && evaluation.revisionId === owner?.run.workflowRevisionId &&
          evaluation.workflowId === owner?.run.workflowId && evaluation.nodeId === owner?.step.nodeId
        : node?.type === "automation.artifact" && config?.artifactVersionId === versionId && config.artifactId === owner?.version.artifactId;
      if (!owner || owner.step.status !== "running" || owner.run.status !== "running" || owner.version.id !== versionId ||
        owner.run.executionOwnerId !== consumer.executionOwnerId || !owner.run.leaseExpiresAt || owner.run.leaseExpiresAt <= new Date() ||
        !isDeepStrictEqual(owner.run.executionPrincipal, actor.principal) || (owner.run.executionAgentRunId ?? null) !== (actor.runId ?? null) ||
        !graphMatches) {
        throw conflict("Current native Workflow Artifact consumer changed", { code: "workflow_artifact_consumer_changed" });
      }
      return owner.run;
    };
    const run = await checkOwner();
    const reader = learningActorFromPrincipal(companyId, actor.principal, actor.runId);
    const checkSources = async () => {
      await assertLearningAssetCurrent(tx, companyId, "workflow_revision", run.workflowRevisionId, reader, "task");
      await assertLearningAssetCurrent(tx, companyId, "automation_artifact_version", versionId, reader, "task");
      await assertLearnedWorkflowPayloadAccess(tx, companyId, reader, { workflowRunId: run.id }, "task");
    };
    const read = async () => { await checkSources(); const result = await use(tx, reader); await checkOwner(); await checkSources(); return result; };
    return reader?.type === "agent" ? withNativeAnalyticalReader(tx, companyId, reader, read, "task") : read();
  });
}
