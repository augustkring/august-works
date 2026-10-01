import { and, eq } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import {
  automationArtifacts,
  workflowOptimizerSuggestions,
  workflows,
} from "@paperclipai/db";
import type {
  OptimizerDriftEvaluation,
  OptimizerDriftPolicy,
  OptimizerDriftWindow,
} from "@paperclipai/shared";

import { conflict, forbidden, notFound } from "../../errors.js";
import {
  persistActivity,
  publishActivity,
  type ActivityPublication,
} from "../activity-log.js";
import type { AutomationArtifactMutationActor } from "../automation-artifacts/automation-artifact-service.js";

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function validRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validatePolicy(policy: OptimizerDriftPolicy): void {
  if (!Number.isInteger(policy.minimumExecutions) || policy.minimumExecutions < 1) {
    throw new Error("optimizer_drift_policy_invalid");
  }
  for (const [degraded, review] of [
    [policy.degradedFailureRate, policy.reviewFailureRate],
    [policy.degradedFallbackRate, policy.reviewFallbackRate],
    [policy.degradedHumanOverrideRate, policy.reviewHumanOverrideRate],
    [policy.degradedNewInputShapeRate, policy.reviewNewInputShapeRate],
  ] as const) {
    if (!validRate(degraded) || !validRate(review) || degraded > review) {
      throw new Error("optimizer_drift_policy_invalid");
    }
  }
}

function validWindow(window: OptimizerDriftWindow): boolean {
  const counts = [
    window.totalExecutions,
    window.candidateFailures,
    window.fallbacks,
    window.newInputShapes,
    window.humanOverrides,
    window.invariantFailures,
  ];
  if (
    counts.some(
      (value) => !Number.isInteger(value) || value < 0,
    )
  ) {
    return false;
  }
  return [
    window.candidateFailures,
    window.fallbacks,
    window.newInputShapes,
    window.humanOverrides,
    window.invariantFailures,
  ].every((value) => value <= window.totalExecutions);
}

function result(input: {
  status: OptimizerDriftEvaluation["status"];
  reasonCodes: string[];
  window: OptimizerDriftWindow;
  now: Date;
}): OptimizerDriftEvaluation {
  return {
    status: input.status,
    reasonCodes: [...new Set(input.reasonCodes)],
    failureRate: rate(
      input.window.candidateFailures,
      input.window.totalExecutions,
    ),
    fallbackRate: rate(input.window.fallbacks, input.window.totalExecutions),
    newInputShapeRate: rate(
      input.window.newInputShapes,
      input.window.totalExecutions,
    ),
    humanOverrideRate: rate(
      input.window.humanOverrides,
      input.window.totalExecutions,
    ),
    invariantFailureCount: input.window.invariantFailures,
    totalExecutions: input.window.totalExecutions,
    evaluatedAt: input.now.toISOString(),
  };
}

export function evaluateOptimizerDrift(
  window: OptimizerDriftWindow,
  policy: OptimizerDriftPolicy,
  options: { now?: Date } = {},
): OptimizerDriftEvaluation {
  validatePolicy(policy);
  const now = options.now ?? new Date();

  if (!validWindow(window)) {
    return result({
      status: "review_required",
      reasonCodes: ["optimizer_drift_window_invalid"],
      window,
      now,
    });
  }

  const immediate: string[] = [];
  if (window.invariantFailures > 0) {
    immediate.push("optimizer_drift_invariant_failure");
  }
  if (window.connectorOrToolChanged) {
    immediate.push("optimizer_drift_connector_or_tool_changed");
  }
  if (window.workflowChanged) {
    immediate.push("optimizer_drift_workflow_changed");
  }
  if (window.foundationOrPolicyChanged) {
    immediate.push("optimizer_drift_foundation_or_policy_changed");
  }
  if (immediate.length > 0) {
    return result({
      status: "review_required",
      reasonCodes: immediate,
      window,
      now,
    });
  }

  if (window.totalExecutions < policy.minimumExecutions) {
    return result({
      status: "insufficient_data",
      reasonCodes: ["optimizer_drift_insufficient_data"],
      window,
      now,
    });
  }

  const failureRate = rate(window.candidateFailures, window.totalExecutions);
  const fallbackRate = rate(window.fallbacks, window.totalExecutions);
  const humanOverrideRate = rate(
    window.humanOverrides,
    window.totalExecutions,
  );
  const newInputShapeRate = rate(
    window.newInputShapes,
    window.totalExecutions,
  );

  const reviewReasons: string[] = [];
  if (failureRate >= policy.reviewFailureRate) {
    reviewReasons.push("optimizer_drift_failure_rate_review");
  }
  if (fallbackRate >= policy.reviewFallbackRate) {
    reviewReasons.push("optimizer_drift_fallback_rate_review");
  }
  if (humanOverrideRate >= policy.reviewHumanOverrideRate) {
    reviewReasons.push("optimizer_drift_human_override_rate_review");
  }
  if (newInputShapeRate >= policy.reviewNewInputShapeRate) {
    reviewReasons.push("optimizer_drift_new_input_shape_rate_review");
  }
  if (reviewReasons.length > 0) {
    return result({
      status: "review_required",
      reasonCodes: reviewReasons,
      window,
      now,
    });
  }

  const degradedReasons: string[] = [];
  if (failureRate >= policy.degradedFailureRate) {
    degradedReasons.push("optimizer_drift_failure_rate_degraded");
  }
  if (fallbackRate >= policy.degradedFallbackRate) {
    degradedReasons.push("optimizer_drift_fallback_rate_degraded");
  }
  if (humanOverrideRate >= policy.degradedHumanOverrideRate) {
    degradedReasons.push("optimizer_drift_human_override_rate_degraded");
  }
  if (newInputShapeRate >= policy.degradedNewInputShapeRate) {
    degradedReasons.push("optimizer_drift_new_input_shape_rate_degraded");
  }

  return result({
    status: degradedReasons.length > 0 ? "degraded" : "healthy",
    reasonCodes:
      degradedReasons.length > 0
        ? degradedReasons
        : ["optimizer_drift_healthy"],
    window,
    now,
  });
}

function assertSystemActor(actor: AutomationArtifactMutationActor): void {
  if (actor.principal.type !== "system") {
    throw forbidden("Optimizer drift state is a governed system transition", {
      code: "optimizer_drift_system_actor_required",
    });
  }
}

export function optimizerDriftService(db: Db) {
  return {
    evaluateAndApply: async (input: {
      companyId: string;
      suggestionId: string;
      artifactId: string;
      window: OptimizerDriftWindow;
      policy: OptimizerDriftPolicy;
      actor: AutomationArtifactMutationActor;
      now?: Date;
    }): Promise<OptimizerDriftEvaluation> => {
      assertSystemActor(input.actor);
      const now = input.now ?? new Date();
      const publications: ActivityPublication[] = [];

      const evaluation = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const [suggestion] = await txDb
          .select()
          .from(workflowOptimizerSuggestions)
          .where(
            and(
              eq(workflowOptimizerSuggestions.companyId, input.companyId),
              eq(workflowOptimizerSuggestions.id, input.suggestionId),
            ),
          )
          .for("update");
        if (!suggestion) throw notFound("Optimizer suggestion not found");

        const [artifact] = await txDb
          .select()
          .from(automationArtifacts)
          .where(
            and(
              eq(automationArtifacts.companyId, input.companyId),
              eq(automationArtifacts.id, input.artifactId),
            ),
          )
          .for("update");
        if (!artifact) throw notFound("Automation Artifact not found");
        if (
          artifact.createdByOptimizerSuggestionId !== suggestion.id ||
          artifact.originWorkflowId !== suggestion.workflowId
        ) {
          throw conflict("Optimizer drift artifact provenance mismatch", {
            code: "optimizer_drift_artifact_provenance_mismatch",
          });
        }

        const [workflow] = await txDb
          .select({ publishedRevisionId: workflows.publishedRevisionId })
          .from(workflows)
          .where(
            and(
              eq(workflows.companyId, input.companyId),
              eq(workflows.id, suggestion.workflowId),
            ),
          );
        if (!workflow) throw notFound("Workflow not found");

        const effectiveWindow: OptimizerDriftWindow = {
          ...input.window,
          workflowChanged:
            input.window.workflowChanged ||
            workflow.publishedRevisionId !== suggestion.workflowRevisionId,
        };
        const evaluated = evaluateOptimizerDrift(
          effectiveWindow,
          input.policy,
          { now },
        );

        if (
          evaluated.status === "degraded" ||
          evaluated.status === "review_required"
        ) {
          const activity = await persistActivity(txDb, {
            companyId: input.companyId,
            actorType: "system",
            actorId: "workflow-optimizer",
            action:
              evaluated.status === "review_required"
                ? "optimizer.drift_review_required"
                : "optimizer.drift_detected",
            entityType: "workflow_optimizer_suggestion",
            entityId: suggestion.id,
            details: {
              artifactId: artifact.id,
              status: evaluated.status,
              reasonCodes: evaluated.reasonCodes,
              totalExecutions: evaluated.totalExecutions,
              failureRate: evaluated.failureRate,
              fallbackRate: evaluated.fallbackRate,
              newInputShapeRate: evaluated.newInputShapeRate,
              humanOverrideRate: evaluated.humanOverrideRate,
              invariantFailureCount: evaluated.invariantFailureCount,
            },
          });
          publications.push(activity.publication);
        }

        if (evaluated.status !== "review_required") {
          return evaluated;
        }

        if (
          artifact.status === "failed" &&
          suggestion.status === "needs_revision"
        ) {
          return evaluated;
        }
        if (
          artifact.status !== "active" ||
          suggestion.status !== "promoted"
        ) {
          throw conflict(
            "Optimizer drift quarantine requires the promoted active pair",
            {
              code: "optimizer_drift_promotion_state_invalid",
              artifactStatus: artifact.status,
              suggestionStatus: suggestion.status,
            },
          );
        }

        const artifactUpdated = await txDb
          .update(automationArtifacts)
          .set({ status: "failed", updatedAt: now })
          .where(
            and(
              eq(automationArtifacts.companyId, input.companyId),
              eq(automationArtifacts.id, artifact.id),
              eq(automationArtifacts.status, "active"),
            ),
          )
          .returning({ id: automationArtifacts.id })
          .then((rows) => rows[0] ?? null);
        const suggestionUpdated = await txDb
          .update(workflowOptimizerSuggestions)
          .set({ status: "needs_revision", updatedAt: now })
          .where(
            and(
              eq(workflowOptimizerSuggestions.companyId, input.companyId),
              eq(workflowOptimizerSuggestions.id, suggestion.id),
              eq(workflowOptimizerSuggestions.status, "promoted"),
            ),
          )
          .returning({ id: workflowOptimizerSuggestions.id })
          .then((rows) => rows[0] ?? null);
        if (!artifactUpdated || !suggestionUpdated) {
          throw conflict("Optimizer drift quarantine raced with another writer", {
            code: "optimizer_drift_quarantine_conflict",
          });
        }

        const quarantineActivity = await persistActivity(txDb, {
          companyId: input.companyId,
          actorType: "system",
          actorId: "workflow-optimizer",
          action: "optimizer.drift_quarantined",
          entityType: "workflow_optimizer_suggestion",
          entityId: suggestion.id,
          details: {
            artifactId: artifact.id,
            reasonCodes: evaluated.reasonCodes,
            fallbackRequired: true,
          },
        });
        publications.push(quarantineActivity.publication);
        return evaluated;
      });

      publications.forEach(publishActivity);
      return evaluation;
    },
  };
}
