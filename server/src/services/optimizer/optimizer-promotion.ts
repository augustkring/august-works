import {lockAnalyticalCompany} from "../analytical-privacy.js";
import {lockMemoryPrivacy} from "../memory/memory-privacy.js";
import {assertLearningAssetCurrent} from "../learning/learning-assets.js";
import type {AuthorizationActor} from "../authorization.js";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import {
  approvals,
  automationArtifacts,
  companyMemberships,
  workflowOptimizerSuggestions,
  workflows,
} from "@paperclipai/db";
import type {
  OptimizerCanaryExecutionResult,
  OptimizerCanarySelection,
  OptimizerPromotionDecision,
  OptimizerPromotionEvidence,
  OptimizerPromotionPolicy,
  WorkflowRiskClass,
  WorkflowSideEffectClass,
} from "@paperclipai/shared";

import { conflict, forbidden, notFound } from "../../errors.js";
import {
  persistActivity,
  publishActivity,
  type ActivityPublication,
} from "../activity-log.js";
import { instanceSettingsService } from "../instance-settings.js";
import type { AutomationArtifactMutationActor } from "../automation-artifacts/automation-artifact-service.js";

const RISK_ORDER: Record<WorkflowRiskClass, number> = {
  C0: 0,
  C1: 1,
  C2: 2,
  C3: 3,
  C4: 4,
};

function requiredRiskForEffect(
  sideEffectClass: WorkflowSideEffectClass,
): WorkflowRiskClass {
  if (sideEffectClass === "write") return "C2";
  if (
    sideEffectClass === "destructive" ||
    sideEffectClass === "external_communication" ||
    sideEffectClass === "financial" ||
    sideEffectClass === "privileged"
  ) {
    return "C3";
  }
  return "C0";
}

function denied(
  reasonCode: string,
  policy: OptimizerPromotionPolicy,
  humanApprovalRequired = false,
): OptimizerPromotionDecision {
  return {
    status: "denied",
    reasonCode,
    humanApprovalRequired,
    canaryRequired: true,
    fallbackKind: policy.fallbackKind,
  };
}

function replayEvidencePassed(
  replay: OptimizerPromotionEvidence["replayEvaluation"],
): boolean {
  return (
    replay.status === "passed" &&
    replay.criticalInvariantFailure === false &&
    replay.missingCategories.length === 0 &&
    replay.failedCaseCount === 0 &&
    replay.unsupportedCaseCount === 0 &&
    replay.passedCaseCount > 0
  );
}

function shadowEvidencePassed(
  shadow: OptimizerPromotionEvidence["shadowEvaluation"],
): boolean {
  return (
    shadow.status === "passed" &&
    shadow.trustedPathAuthoritative === true &&
    shadow.criticalInvariantFailure === false &&
    shadow.failedObservationCount === 0 &&
    shadow.unsupportedObservationCount === 0 &&
    shadow.passedObservationCount > 0
  );
}

export function evaluateOptimizerPromotion(input: {
  riskClass: WorkflowRiskClass;
  sideEffectClass: WorkflowSideEffectClass;
  policy: OptimizerPromotionPolicy;
  evidence: OptimizerPromotionEvidence;
}): OptimizerPromotionDecision {
  const { evidence, policy } = input;

  if (!replayEvidencePassed(evidence.replayEvaluation)) {
    return denied("optimizer_promotion_replay_gate_required", policy);
  }
  if (!shadowEvidencePassed(evidence.shadowEvaluation)) {
    return denied("optimizer_promotion_shadow_gate_required", policy);
  }
  if (!evidence.rollbackAvailable) {
    return denied("optimizer_promotion_rollback_required", policy);
  }
  if (!evidence.driftGuardAvailable) {
    return denied("optimizer_promotion_drift_guard_required", policy);
  }
  if (input.riskClass === "C4") {
    return denied("optimizer_promotion_c4_unsupported", policy, true);
  }

  const minimumRisk = requiredRiskForEffect(input.sideEffectClass);
  if (RISK_ORDER[input.riskClass] < RISK_ORDER[minimumRisk]) {
    return denied("optimizer_promotion_risk_classification_mismatch", policy);
  }

  const lowRiskPureOrRead =
    (input.riskClass === "C0" || input.riskClass === "C1") &&
    (input.sideEffectClass === "pure" || input.sideEffectClass === "read");
  const humanApprovalRequired =
    input.riskClass === "C2" ||
    input.riskClass === "C3" ||
    !lowRiskPureOrRead ||
    !policy.allowLowRiskAutoPromotion;

  if (humanApprovalRequired && !evidence.humanApproved) {
    return {
      status: "approval_required",
      reasonCode: "optimizer_promotion_human_approval_required",
      humanApprovalRequired: true,
      canaryRequired: true,
      fallbackKind: policy.fallbackKind,
    };
  }

  if (!evidence.canaryPassed) {
    return {
      status: "canary_ready",
      reasonCode: "optimizer_promotion_canary_required",
      humanApprovalRequired,
      canaryRequired: true,
      fallbackKind: policy.fallbackKind,
    };
  }

  return {
    status: "promotion_ready",
    reasonCode: "optimizer_promotion_gates_passed",
    humanApprovalRequired,
    canaryRequired: true,
    fallbackKind: policy.fallbackKind,
  };
}

export function selectOptimizerCanaryRoute(input: {
  companyId: string;
  promotionKey: string;
  routingKey: string;
  candidateTrafficPercent: number;
}): OptimizerCanarySelection {
  if (
    !Number.isInteger(input.candidateTrafficPercent) ||
    input.candidateTrafficPercent < 0 ||
    input.candidateTrafficPercent > 100
  ) {
    throw new Error("optimizer_canary_percent_invalid");
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.companyId,
        input.promotionKey,
        input.routingKey,
      ]),
    )
    .digest();
  const bucketBasisPoints = digest.readUInt32BE(0) % 10_000;
  return {
    route:
      bucketBasisPoints < input.candidateTrafficPercent * 100
        ? "candidate"
        : "trusted",
    bucketBasisPoints,
    candidateTrafficPercent: input.candidateTrafficPercent,
  };
}

export async function executeOptimizerCanaryWithFallback<T>(input: {
  decision: OptimizerPromotionDecision;
  companyId: string;
  promotionKey: string;
  routingKey: string;
  candidateTrafficPercent: number;
  guard: () => Promise<{ passed: boolean; reasonCode?: string | null }>;
  executeCandidate: () => Promise<T>;
  executeTrusted: () => Promise<T>;
  validateCandidateOutput: (
    output: T,
  ) => Promise<{ valid: boolean; reasonCode?: string | null }>;
}): Promise<OptimizerCanaryExecutionResult<T>> {
  const eligible =
    input.decision.status === "canary_ready" ||
    input.decision.status === "promotion_ready";
  const selection = eligible
    ? selectOptimizerCanaryRoute(input)
    : {
        route: "trusted" as const,
        bucketBasisPoints: 0,
        candidateTrafficPercent: input.candidateTrafficPercent,
      };

  if (!eligible) {
    return {
      path: "trusted",
      fallbackTriggered: false,
      reasonCode: "optimizer_canary_promotion_not_eligible",
      selection,
      output: await input.executeTrusted(),
    };
  }

  if (selection.route === "trusted") {
    return {
      path: "trusted",
      fallbackTriggered: false,
      reasonCode: null,
      selection,
      output: await input.executeTrusted(),
    };
  }

  const guard = await input.guard();
  if (!guard.passed) {
    return {
      path: "trusted",
      fallbackTriggered: true,
      reasonCode: guard.reasonCode ?? "optimizer_canary_guard_failed",
      selection,
      output: await input.executeTrusted(),
    };
  }

  try {
    const candidateOutput = await input.executeCandidate();
    const validation = await input.validateCandidateOutput(candidateOutput);
    if (!validation.valid) {
      return {
        path: "trusted",
        fallbackTriggered: true,
        reasonCode:
          validation.reasonCode ?? "optimizer_canary_candidate_output_invalid",
        selection,
        output: await input.executeTrusted(),
      };
    }
    return {
      path: "candidate",
      fallbackTriggered: false,
      reasonCode: null,
      selection,
      output: candidateOutput,
    };
  } catch {
    return {
      path: "trusted",
      fallbackTriggered: true,
      reasonCode: "optimizer_canary_candidate_execution_failed",
      selection,
      output: await input.executeTrusted(),
    };
  }
}

function assertSystemActor(actor: AutomationArtifactMutationActor): void {
  if (actor.principal.type !== "system") {
    throw forbidden("Optimizer promotion is a governed system transition", {
      code: "optimizer_promotion_system_actor_required",
    });
  }
}

async function assertPromotionEnabled(db: Db) {
  const experimental = await instanceSettingsService(db).getExperimental();
  if (experimental.enableWorkflowOptimizerPromotion !== true) {
    throw forbidden("Workflow Optimizer promotion is disabled", {
      code: "optimizer_promotion_disabled",
    });
  }
  return experimental;
}

function assertPromotionRuntimeEligible(
  artifact: typeof automationArtifacts.$inferSelect,
  experimental: Awaited<
    ReturnType<ReturnType<typeof instanceSettingsService>["getExperimental"]>
  >,
): void {
  if (
    artifact.kind === "python" ||
    artifact.kind === "tool_chain" ||
    artifact.kind === "subworkflow"
  ) {
    throw forbidden(
      "Automation Artifact runtime is not qualified for optimizer promotion",
      {
        code: "optimizer_promotion_runtime_not_qualified",
        artifactKind: artifact.kind,
      },
    );
  }
  if (artifact.kind === "typescript") {
    if (experimental.enableAutomationArtifactCodeExecutionV1 !== true) {
      throw forbidden("Generated-code artifact execution is disabled", {
        code: "optimizer_promotion_code_execution_disabled",
      });
    }
    if (
      artifact.sideEffectClass !== "pure" ||
      (artifact.riskClass !== "C0" && artifact.riskClass !== "C1")
    ) {
      throw forbidden(
        "Generated-code optimizer promotion is restricted to pure C0/C1 artifacts",
        {
          code: "optimizer_promotion_code_execution_risk_denied",
          riskClass: artifact.riskClass,
          sideEffectClass: artifact.sideEffectClass,
        },
      );
    }
  }
}

async function assertHumanApprovalReference(
  db: Db,
  input: {
    companyId: string;
    suggestionId: string;
    artifactId: string;
    artifactVersionId: string;
    workflowRevisionId: string;
    decision: OptimizerPromotionDecision;
    approvedByUserId: string | null | undefined;
    approvalId: string | null | undefined;
  },
): Promise<void> {
  const {
    companyId,
    decision,
    approvedByUserId,
    approvalId,
  } = input;
  if (!decision.humanApprovalRequired) return;
  const userId = approvedByUserId?.trim();
  if (!userId) {
    throw forbidden("Human approval requires an approving user reference", {
      code: "optimizer_promotion_human_approval_reference_required",
    });
  }
  const membership = await db
    .select({
      id: companyMemberships.id,
      membershipRole: companyMemberships.membershipRole,
    })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!membership || membership.membershipRole === "viewer") {
    throw forbidden("Approving user is not authorized to approve promotion", {
      code: "optimizer_promotion_human_approval_invalid",
    });
  }

  const approvalKey = approvalId?.trim();
  if (!approvalKey) {
    throw forbidden("Human approval requires an approved approval record", {
      code: "optimizer_promotion_approval_record_required",
    });
  }
  const approval = await db
    .select({
      id: approvals.id,
      type: approvals.type,
      payload: approvals.payload,
      status: approvals.status,
      decidedByUserId: approvals.decidedByUserId,
    })
    .from(approvals)
    .where(
      and(
        eq(approvals.id, approvalKey),
        eq(approvals.companyId, companyId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  const payload =
    approval?.payload &&
    typeof approval.payload === "object" &&
    !Array.isArray(approval.payload)
      ? approval.payload
      : null;
  if (
    !approval ||
    approval.status !== "approved" ||
    approval.decidedByUserId !== userId ||
    approval.type !== "optimizer_promotion" ||
    payload?.suggestionId !== input.suggestionId ||
    payload?.artifactId !== input.artifactId ||
    payload?.artifactVersionId !== input.artifactVersionId ||
    payload?.workflowRevisionId !== input.workflowRevisionId
  ) {
    throw forbidden("Promotion approval record is not bound to this promotion", {
      code: "optimizer_promotion_approval_record_invalid",
    });
  }
}

function assertPromotionBinding(input: {
  suggestion: typeof workflowOptimizerSuggestions.$inferSelect;
  artifact: typeof automationArtifacts.$inferSelect;
  publishedRevisionId: string | null;
  expectedArtifactVersionId: string;
}): void {
  if (input.publishedRevisionId !== input.suggestion.workflowRevisionId) {
    throw conflict("Optimizer suggestion targets a stale workflow revision", {
      code: "optimizer_promotion_stale_workflow_revision",
      suggestionWorkflowRevisionId: input.suggestion.workflowRevisionId,
      currentWorkflowRevisionId: input.publishedRevisionId,
    });
  }
  if (
    input.artifact.createdByOptimizerSuggestionId !== input.suggestion.id ||
    input.artifact.originWorkflowId !== input.suggestion.workflowId
  ) {
    throw conflict("Automation Artifact provenance does not match the suggestion", {
      code: "optimizer_promotion_artifact_provenance_mismatch",
    });
  }
  if (input.artifact.latestVersionId !== input.expectedArtifactVersionId) {
    throw conflict("Automation Artifact version changed during promotion", {
      code: "optimizer_promotion_artifact_version_conflict",
      currentLatestVersionId: input.artifact.latestVersionId,
    });
  }
  if (input.artifact.status !== "shadow") {
    throw conflict("Automation Artifact must complete shadow state before promotion", {
      code: "optimizer_promotion_artifact_not_shadowed",
      currentStatus: input.artifact.status,
    });
  }
}

export function optimizerPromotionService(db: Db) {
  async function loadBoundState(
    companyId: string,
    suggestionId: string,
    artifactId: string,
  ) {
    const [suggestion, artifact] = await Promise.all([
      db
        .select()
        .from(workflowOptimizerSuggestions)
        .where(
          and(
            eq(workflowOptimizerSuggestions.companyId, companyId),
            eq(workflowOptimizerSuggestions.id, suggestionId),
          ),
        )
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(automationArtifacts)
        .where(
          and(
            eq(automationArtifacts.companyId, companyId),
            eq(automationArtifacts.id, artifactId),
          ),
        )
        .then((rows) => rows[0] ?? null),
    ]);
    if (!suggestion) throw notFound("Optimizer suggestion not found");
    if (!artifact) throw notFound("Automation Artifact not found");
    const workflow = await db
      .select({
        id: workflows.id,
        publishedRevisionId: workflows.publishedRevisionId,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.companyId, companyId),
          eq(workflows.id, suggestion.workflowId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!workflow) throw notFound("Workflow not found");
    return { suggestion, artifact, workflow };
  }

  return {
    prepareCanary: async (input: {
      companyId: string;
      suggestionId: string;
      artifactId: string;
      expectedArtifactVersionId: string;
      policy: OptimizerPromotionPolicy;
      evidence: OptimizerPromotionEvidence;
      actor: AutomationArtifactMutationActor;
      sourceActor?:AuthorizationActor;
      approvedByUserId?: string | null;
      approvalId?: string | null;
    }): Promise<OptimizerPromotionDecision> => {
      assertSystemActor(input.actor);
      await assertLearningAssetCurrent(db,input.companyId,"automation_artifact_version",input.expectedArtifactVersionId,input.sourceActor);
      const experimental = await assertPromotionEnabled(db);
      const state = await loadBoundState(
        input.companyId,
        input.suggestionId,
        input.artifactId,
      );
      await assertLearningAssetCurrent(db,input.companyId,"workflow_revision",state.suggestion.workflowRevisionId,input.sourceActor);
      assertPromotionBinding({
        suggestion: state.suggestion,
        artifact: state.artifact,
        publishedRevisionId: state.workflow.publishedRevisionId,
        expectedArtifactVersionId: input.expectedArtifactVersionId,
      });
      assertPromotionRuntimeEligible(state.artifact, experimental);
      if (
        ![
          "detected",
          "generated",
          "evaluating",
          "ready_for_shadow",
          "shadowing",
          "ready_to_promote",
        ].includes(state.suggestion.status)
      ) {
        throw conflict("Optimizer suggestion cannot enter canary from its current state", {
          code: "optimizer_promotion_suggestion_state_invalid",
          currentStatus: state.suggestion.status,
        });
      }

      const decision = evaluateOptimizerPromotion({
        riskClass: state.artifact.riskClass,
        sideEffectClass: state.artifact.sideEffectClass,
        policy: input.policy,
        evidence: { ...input.evidence, canaryPassed: false },
      });
      if (decision.status !== "canary_ready") return decision;
      await assertHumanApprovalReference(db, {
        companyId: input.companyId,
        suggestionId: state.suggestion.id,
        artifactId: state.artifact.id,
        artifactVersionId: input.expectedArtifactVersionId,
        workflowRevisionId: state.suggestion.workflowRevisionId,
        decision,
        approvedByUserId: input.approvedByUserId,
        approvalId: input.approvalId,
      });

      const publications: ActivityPublication[] = [];
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,input.companyId);
        await lockMemoryPrivacy(txDb,input.companyId);
        await assertLearningAssetCurrent(txDb,input.companyId,"workflow_revision",state.suggestion.workflowRevisionId,input.sourceActor);
        await assertLearningAssetCurrent(txDb,input.companyId,"automation_artifact_version",input.expectedArtifactVersionId,input.sourceActor);
        const [lockedSuggestion] = await txDb
          .select()
          .from(workflowOptimizerSuggestions)
          .where(
            and(
              eq(workflowOptimizerSuggestions.companyId, input.companyId),
              eq(workflowOptimizerSuggestions.id, input.suggestionId),
            ),
          )
          .for("update");
        const [lockedArtifact] = await txDb
          .select()
          .from(automationArtifacts)
          .where(
            and(
              eq(automationArtifacts.companyId, input.companyId),
              eq(automationArtifacts.id, input.artifactId),
            ),
          )
          .for("update");
        const [lockedWorkflow] = await txDb
          .select({
            publishedRevisionId: workflows.publishedRevisionId,
          })
          .from(workflows)
          .where(
            and(
              eq(workflows.companyId, input.companyId),
              eq(workflows.id, state.suggestion.workflowId),
            ),
          )
          .for("update");
        if (!lockedSuggestion || !lockedArtifact || !lockedWorkflow) {
          throw conflict("Optimizer promotion state changed during canary preparation", {
            code: "optimizer_promotion_state_conflict",
          });
        }
        assertPromotionBinding({
          suggestion: lockedSuggestion,
          artifact: lockedArtifact,
          publishedRevisionId: lockedWorkflow.publishedRevisionId,
          expectedArtifactVersionId: input.expectedArtifactVersionId,
        });
        assertPromotionRuntimeEligible(lockedArtifact, experimental);
        if (lockedSuggestion.status !== state.suggestion.status) {
          throw conflict("Optimizer suggestion changed during canary preparation", {
            code: "optimizer_promotion_suggestion_conflict",
            currentStatus: lockedSuggestion.status,
          });
        }

        const updated = await txDb
          .update(workflowOptimizerSuggestions)
          .set({ status: "ready_to_promote", updatedAt: new Date() })
          .where(
            and(
              eq(workflowOptimizerSuggestions.companyId, input.companyId),
              eq(workflowOptimizerSuggestions.id, input.suggestionId),
              eq(
                workflowOptimizerSuggestions.workflowRevisionId,
                state.suggestion.workflowRevisionId,
              ),
              eq(
                workflowOptimizerSuggestions.status,
                state.suggestion.status,
              ),
            ),
          )
          .returning({ id: workflowOptimizerSuggestions.id })
          .then((rows) => rows[0] ?? null);
        if (!updated) {
          throw conflict("Optimizer suggestion changed during canary preparation", {
            code: "optimizer_promotion_suggestion_conflict",
          });
        }
        const activity = await persistActivity(txDb, {
          companyId: input.companyId,
          actorType: "system",
          actorId: "workflow-optimizer",
          action: "optimizer.canary_ready",
          entityType: "workflow_optimizer_suggestion",
          entityId: input.suggestionId,
          details: {
            artifactId: input.artifactId,
            artifactVersionId: input.expectedArtifactVersionId,
            riskClass: state.artifact.riskClass,
            sideEffectClass: state.artifact.sideEffectClass,
            fallbackKind: decision.fallbackKind,
          },
        });
        publications.push(activity.publication);
      });
      publications.forEach(publishActivity);
      return decision;
    },

    activate: async (input: {
      companyId: string;
      suggestionId: string;
      artifactId: string;
      expectedArtifactVersionId: string;
      policy: OptimizerPromotionPolicy;
      evidence: OptimizerPromotionEvidence;
      actor: AutomationArtifactMutationActor;
      sourceActor?:AuthorizationActor;
      approvedByUserId?: string | null;
      approvalId?: string | null;
    }): Promise<OptimizerPromotionDecision> => {
      assertSystemActor(input.actor);
      await assertLearningAssetCurrent(db,input.companyId,"automation_artifact_version",input.expectedArtifactVersionId,input.sourceActor);
      const experimental = await assertPromotionEnabled(db);

      const decisionState = await loadBoundState(
        input.companyId,
        input.suggestionId,
        input.artifactId,
      );
      await assertLearningAssetCurrent(db,input.companyId,"workflow_revision",decisionState.suggestion.workflowRevisionId,input.sourceActor);
      assertPromotionBinding({
        suggestion: decisionState.suggestion,
        artifact: decisionState.artifact,
        publishedRevisionId: decisionState.workflow.publishedRevisionId,
        expectedArtifactVersionId: input.expectedArtifactVersionId,
      });
      assertPromotionRuntimeEligible(decisionState.artifact, experimental);

      const decision = evaluateOptimizerPromotion({
        riskClass: decisionState.artifact.riskClass,
        sideEffectClass: decisionState.artifact.sideEffectClass,
        policy: input.policy,
        evidence: { ...input.evidence, canaryPassed: true },
      });
      if (decision.status !== "promotion_ready") return decision;
      await assertHumanApprovalReference(db, {
        companyId: input.companyId,
        suggestionId: decisionState.suggestion.id,
        artifactId: decisionState.artifact.id,
        artifactVersionId: input.expectedArtifactVersionId,
        workflowRevisionId: decisionState.suggestion.workflowRevisionId,
        decision,
        approvedByUserId: input.approvedByUserId,
        approvalId: input.approvalId,
      });
      if (decisionState.suggestion.status !== "ready_to_promote") {
        throw conflict("Optimizer suggestion is not ready to promote", {
          code: "optimizer_promotion_suggestion_not_ready",
          currentStatus: decisionState.suggestion.status,
        });
      }

      const publications: ActivityPublication[] = [];
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await lockAnalyticalCompany(txDb,input.companyId);
        await lockMemoryPrivacy(txDb,input.companyId);
        await assertLearningAssetCurrent(txDb,input.companyId,"workflow_revision",decisionState.suggestion.workflowRevisionId,input.sourceActor);
        await assertLearningAssetCurrent(txDb,input.companyId,"automation_artifact_version",input.expectedArtifactVersionId,input.sourceActor);
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
        if (!suggestion || !artifact) {
          throw conflict("Optimizer promotion state changed during activation", {
            code: "optimizer_promotion_state_conflict",
          });
        }
        const [workflow] = await txDb
          .select({
            publishedRevisionId: workflows.publishedRevisionId,
          })
          .from(workflows)
          .where(
            and(
              eq(workflows.companyId, input.companyId),
              eq(workflows.id, suggestion.workflowId),
            ),
          )
          .for("update");
        assertPromotionBinding({
          suggestion,
          artifact,
          publishedRevisionId: workflow?.publishedRevisionId ?? null,
          expectedArtifactVersionId: input.expectedArtifactVersionId,
        });
        if (suggestion.status !== "ready_to_promote") {
          throw conflict("Optimizer suggestion changed during activation", {
            code: "optimizer_promotion_suggestion_conflict",
            currentStatus: suggestion.status,
          });
        }

        const now = new Date();
        const artifactUpdated = await txDb
          .update(automationArtifacts)
          .set({ status: "active", updatedAt: now })
          .where(
            and(
              eq(automationArtifacts.companyId, input.companyId),
              eq(automationArtifacts.id, input.artifactId),
              eq(automationArtifacts.status, "shadow"),
              eq(
                automationArtifacts.latestVersionId,
                input.expectedArtifactVersionId,
              ),
            ),
          )
          .returning({ id: automationArtifacts.id })
          .then((rows) => rows[0] ?? null);
        if (!artifactUpdated) {
          throw conflict("Automation Artifact changed during activation", {
            code: "optimizer_promotion_artifact_conflict",
          });
        }

        const suggestionUpdated = await txDb
          .update(workflowOptimizerSuggestions)
          .set({ status: "promoted", updatedAt: now })
          .where(
            and(
              eq(workflowOptimizerSuggestions.companyId, input.companyId),
              eq(workflowOptimizerSuggestions.id, input.suggestionId),
              eq(workflowOptimizerSuggestions.status, "ready_to_promote"),
            ),
          )
          .returning({ id: workflowOptimizerSuggestions.id })
          .then((rows) => rows[0] ?? null);
        if (!suggestionUpdated) {
          throw conflict("Optimizer suggestion changed during activation", {
            code: "optimizer_promotion_suggestion_conflict",
          });
        }

        const activity = await persistActivity(txDb, {
          companyId: input.companyId,
          actorType: "system",
          actorId: "workflow-optimizer",
          action: "optimizer.promoted",
          entityType: "workflow_optimizer_suggestion",
          entityId: input.suggestionId,
          details: {
            artifactId: input.artifactId,
            artifactVersionId: input.expectedArtifactVersionId,
            riskClass: artifact.riskClass,
            sideEffectClass: artifact.sideEffectClass,
            fallbackKind: decision.fallbackKind,
            approvedByUserId: input.approvedByUserId ?? null,
            approvalId: input.approvalId ?? null,
          },
        });
        publications.push(activity.publication);
      });
      publications.forEach(publishActivity);
      return decision;
    },
  };
}
