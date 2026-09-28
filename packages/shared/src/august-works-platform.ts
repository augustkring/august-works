import { z } from "zod";
import type { InstanceFeatureKey } from "./feature-catalog.js";

export const AUGUST_WORKS_PLATFORM_FEATURE_KEYS = [
  "enableFoundationV1",
  "enableContextEngineV1",
  "enableWorkflowsV1",
  "enableWorkflowBuilderV1",
  "enableWorkflowAgentNodes",
  "enableWorkflowExternalAgentNodes",
  "enableCollectiveMemoryV1",
  "enablePrivateAgentMemoryV1",
  "enableAutomationArtifactsV1",
  "enableWorkflowOptimizerSuggestions",
  "enableWorkflowOptimizerShadow",
  "enableWorkflowOptimizerPromotion",
  "enableAiWorkflowAuthoring",
] as const satisfies readonly InstanceFeatureKey[];

export type AugustWorksPlatformFeatureKey =
  (typeof AUGUST_WORKS_PLATFORM_FEATURE_KEYS)[number];

export interface AugustWorksPlatformFeatureFlagContract {
  owner: "August Works Platform";
  scope: "instance";
  default: false;
  dependencies: readonly AugustWorksPlatformFeatureKey[];
  rollbackBehavior: string;
  reviewDate: string;
  cleanupCondition: string;
}

const DEFAULT_ROLLBACK =
  "Disable the flag. Additive schema and historical records remain intact until an explicit migration or cleanup change.";
const DEFAULT_REVIEW_DATE = "2026-12-31";
const DEFAULT_CLEANUP =
  "Remove after general availability, legacy-path retirement, and closure of rollback dependence on dual behavior.";

export const AUGUST_WORKS_PLATFORM_FEATURE_FLAGS = {
  enableFoundationV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: [], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableContextEngineV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableFoundationV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowsV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: [], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowBuilderV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowsV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowAgentNodes: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowsV1", "enableContextEngineV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowExternalAgentNodes: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowAgentNodes"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableCollectiveMemoryV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableContextEngineV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enablePrivateAgentMemoryV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableCollectiveMemoryV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableAutomationArtifactsV1: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowsV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowOptimizerSuggestions: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowsV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowOptimizerShadow: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowOptimizerSuggestions", "enableAutomationArtifactsV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableWorkflowOptimizerPromotion: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowOptimizerShadow"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
  enableAiWorkflowAuthoring: { owner: "August Works Platform", scope: "instance", default: false, dependencies: ["enableWorkflowBuilderV1", "enableWorkflowsV1"], rollbackBehavior: DEFAULT_ROLLBACK, reviewDate: DEFAULT_REVIEW_DATE, cleanupCondition: DEFAULT_CLEANUP },
} as const satisfies Record<
  AugustWorksPlatformFeatureKey,
  AugustWorksPlatformFeatureFlagContract
>;

export const EXECUTION_PRINCIPAL_TYPES = ["user", "agent", "system"] as const;
export type ExecutionPrincipalType = (typeof EXECUTION_PRINCIPAL_TYPES)[number];

export const executionPrincipalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string().min(1) }).strict(),
  z.object({
    type: z.literal("agent"),
    agentId: z.string().min(1),
    responsibleUserId: z.string().min(1).nullable().optional(),
  }).strict(),
  z.object({ type: z.literal("system"), service: z.string().min(1) }).strict(),
]);

export type ExecutionPrincipal = z.infer<typeof executionPrincipalSchema>;

export interface ActivityActorRef {
  actorType: ExecutionPrincipalType;
  actorId: string;
  responsibleUserId: string | null;
}

export function executionPrincipalToActivityActor(
  principal: ExecutionPrincipal,
): ActivityActorRef {
  switch (principal.type) {
    case "user":
      return { actorType: "user", actorId: principal.userId, responsibleUserId: principal.userId };
    case "agent":
      return { actorType: "agent", actorId: principal.agentId, responsibleUserId: principal.responsibleUserId ?? null };
    case "system":
      return { actorType: "system", actorId: principal.service, responsibleUserId: null };
  }
}

export const AUGUST_WORKS_AUDIT_ACTIONS = [
  "foundation.document_created",
  "foundation.revision_proposed",
  "foundation.revision_approved",
  "foundation.revision_rejected",
  "foundation.draft_updated",
  "foundation.document_archived",
  "foundation.proposal_created",
  "foundation.proposal_accepted",
  "foundation.proposal_rejected",
  "connection.created",
  "connection.grant_created",
  "connection.grant_revoked",
  "connection.sync_started",
  "connection.sync_completed",
  "context.assembled",
  "context.source_denied",
  "memory.candidate_created",
  "memory.candidate_accepted",
  "memory.candidate_rejected",
  "memory.recalled",
  "memory.corrected",
  "memory.superseded",
  "memory.revoked",
  "memory.expired",
  "memory.shared",
  "agent.created",
  "agent.invited",
  "agent.permission_changed",
  "agent.message_sent",
  "agent.task_delegated",
  "workflow.created",
  "workflow.draft_updated",
  "workflow.revision_published",
  "workflow.run_started",
  "workflow.run_completed",
  "workflow.run_failed",
  "workflow.step_failed",
  "automation_artifact.generated",
  "automation_artifact.validated",
  "automation_artifact.promoted",
  "automation_artifact.revoked",
  "optimizer.suggestion_created",
  "optimizer.shadow_started",
  "optimizer.promotion_approved",
  "optimizer.fallback_triggered",
  "tool.invoked",
  "tool.denied",
  "tool.approval_requested",
  "decision.created",
  "decision.approved",
  "security.policy_denied",
] as const;

export type AugustWorksAuditAction = (typeof AUGUST_WORKS_AUDIT_ACTIONS)[number];
