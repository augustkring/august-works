import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { analyticalLineageManifests, analyticalLineageEdges, businessExperiments, businessExperimentAssignments, businessExperimentCompletions, businessExperimentExecutions, businessExperimentExposures, businessExperimentTransitions, businessExperimentVersions, type Db } from "@paperclipai/db";
import { BUSINESS_EXPERIMENT_TRANSITIONS, startBusinessExperimentSchema, assignBusinessExperimentUnitSchema, recordBusinessExperimentExposureSchema, controlBusinessExperimentExecutionSchema, type BusinessExperimentInvariantReceipt, type BusinessExperimentState } from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";
import { businessMetricService } from "../business-metrics/service.js";
import { calculateNativeMetric } from "../business-metrics/native-engine.js";
import { admitBusinessExperiment, lockBusinessExperimentRoot, inspectBusinessExperimentVersion, businessExperimentRootView, auditBusinessExperiment } from "./service.js";
import { assignNativeBusinessExperimentUnit } from "./kernel.js";
import { EXPERIMENT_OWNER_ENGINE, assignmentMaterial, assignmentView, completionMaterial, executionMaterial, experimentAssignmentKey, experimentBudget, experimentEdges, experimentStatementTime, experimentReviewHash, exposureMaterial, exposureView, nativeExperimentUnit, signedExperimentReceipt,
  type ExperimentAssignment, type ExperimentCompletion, type ExperimentExecution, type ExperimentExposure } from "./receipts.js";

async function transition(tx: Db, companyId: string, actor: AuthorizationActor, row: typeof businessExperiments.$inferSelect, state: BusinessExperimentState, rationale: string, at: Date) {
  await tx.insert(businessExperimentTransitions).values({ companyId, experimentId: row.id, versionId: row.currentVersionId!, revision: row.revision + 1, fromState: row.state, toState: state, rationale, createdBy: v7HumanActorId(actor), createdAt: at });
  const [updated] = await tx.update(businessExperiments).set({ state, revision: row.revision + 1, updatedAt: at }).where(and(eq(businessExperiments.companyId, companyId), eq(businessExperiments.id, row.id), eq(businessExperiments.revision, row.revision))).returning();
  return updated;
}
async function requireNoOtherActiveRecording(tx: Db, companyId: string, experimentId: string) {
  const [other] = await tx.select({ id: businessExperiments.id }).from(businessExperiments).where(and(eq(businessExperiments.companyId, companyId), sql`${businessExperiments.id}<>${experimentId}::uuid`, inArray(businessExperiments.state, ["running", "paused"]))).limit(1).for("share");
  if (other) throw conflict("Another native experiment is recording in this company; concurrent interference requires separate qualification");
}
/** Bookkeeping only. No method dispatches work, changes a native task/project,
 * asserts customer consent, verifies a workflow or grants policy authority. */
export function businessExperimentRecordingService(db: Db) {
  return {
    async start(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof startBusinessExperimentSchema.parse>[0]) {
      const input = startBusinessExperimentSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admitBusinessExperiment(tx, companyId, actor, true); const row = await lockBusinessExperimentRoot(tx, companyId, id), deadline = performance.now() + 30_000;
        if (row.revision !== input.expectedRevision || row.currentVersionId !== input.versionId || row.state !== "ready") throw conflict("Recording requires the exact currently ready human-reviewed protocol");
        const pin = await inspectBusinessExperimentVersion(tx, row, actor, input.versionId, true, deadline);
        if (pin.receipts.execution) throw conflict("This immutable experiment version already started recording");
        const [review] = await tx.select().from(businessExperimentTransitions).where(and(eq(businessExperimentTransitions.companyId, companyId), eq(businessExperimentTransitions.experimentId, id), eq(businessExperimentTransitions.versionId, input.versionId), eq(businessExperimentTransitions.revision, row.revision), eq(businessExperimentTransitions.toState, "ready"))).for("share");
        if (!review) throw notFound("The exact current readiness receipt is unavailable");
        await requireNoOtherActiveRecording(tx, companyId, id);
        const at = await experimentStatementTime(tx);
        if (at.getTime() >= Date.parse(pin.value.definition.sampleOrDurationPlan.until) || pin.value.expiresAt <= at) throw conflict("The registered recording horizon or source review expired");
        const value: ExperimentExecution = { id: randomUUID(), companyId, experimentId: id, versionId: input.versionId, mode: input.mode, reviewTransitionId: review.id,
          assignmentKeyFingerprint: nativeSha256(experimentAssignmentKey(companyId, input.versionId).toString("hex")), rationale: input.rationale, receiptHash: "", signature: "", startedBy: v7HumanActorId(actor), startedAt: at };
        Object.assign(value, signedExperimentReceipt("execution", executionMaterial(value, pin.value.contentHash, experimentReviewHash(review))));
        await tx.insert(businessExperimentExecutions).values(value); const updated = await transition(tx, companyId, actor, row, "running", input.rationale, at);
        await auditBusinessExperiment(tx, publications, companyId, actor, id, "recording_started", { versionId: input.versionId, revision: updated.revision, receiptHash: value.receiptHash, mode: input.mode });
        experimentBudget(deadline); return businessExperimentRootView(updated);
      });
    },
    async assign(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof assignBusinessExperimentUnitSchema.parse>[0]) {
      const input = assignBusinessExperimentUnitSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admitBusinessExperiment(tx, companyId, actor, true); const row = await lockBusinessExperimentRoot(tx, companyId, id), deadline = performance.now() + 30_000;
        if (row.revision !== input.expectedRevision || row.currentVersionId !== input.versionId || row.state !== "running") throw conflict("Enrollment requires the current running recording and protocol revision");
        const pin = await inspectBusinessExperimentVersion(tx, row, actor, input.versionId, true, deadline), execution = pin.receipts.execution;
        if (!execution) throw notFound("Native recording ownership is unavailable");
        const prior = pin.receipts.assignments.find(item => item.unitId === input.unitId); if (prior) return assignmentView(prior);
        const plan = pin.value.definition.sampleOrDurationPlan;
        if (pin.receipts.assignments.length >= plan.maximumAssignedUnits) throw conflict("The preregistered maximum enrollment was reached");
        await requireNoOtherActiveRecording(tx, companyId, id);
        const source = await nativeExperimentUnit(tx, companyId, actor, pin.value, input.unitId), at = await experimentStatementTime(tx);
        if (at.getTime() < Date.parse(plan.from) || at.getTime() >= Date.parse(plan.until) || pin.value.expiresAt <= at) throw conflict("Enrollment must occur within the registered horizon and current source review");
        const invariantReceipts: BusinessExperimentInvariantReceipt[] = [];
        // Capture actual native pretreatment state before producing the private
        // allocation label. These are experiment receipts, not fabricated
        // business_metric_observations on a differently scoped population.
        for (const metric of pin.value.metricPins.filter(item => item.role === "invariant")) {
          const definition = await businessMetricService(tx).inspectPublishedDefinition(companyId, actor, metric.metricId, metric.metricVersionId);
          const calculated = calculateNativeMetric(definition.version.definition, { metricId: metric.metricId, versionId: metric.metricVersionId, from: plan.from, until: plan.until, dimensions: [], maxRows: 1 }, [source.snapshot]);
          if (calculated.status !== "observed" || calculated.value !== 0 && calculated.value !== 1) throw conflict("Native pretreatment invariant is not an exact binary unit receipt");
          invariantReceipts.push({ key: metric.key, metricId: metric.metricId, metricVersionId: metric.metricVersionId, observedAt: at.toISOString(), value: calculated.value, inputHash: calculated.inputHash });
        }
        const sourceHash = nativeSha256({ snapshot: source.snapshot, invariantReceipts }), assignmentId = randomUUID(), manifestId = randomUUID();
        const value: ExperimentAssignment = { id: assignmentId, companyId, experimentId: id, versionId: input.versionId, unitId: input.unitId, unitType: pin.value.definition.population.randomizationUnit,
          issueId: pin.value.definition.population.randomizationUnit === "issue" ? input.unitId : null, projectId: pin.value.definition.population.randomizationUnit === "project" ? input.unitId : null,
          arm: assignNativeBusinessExperimentUnit(experimentAssignmentKey(companyId, input.versionId), companyId, input.versionId, input.unitId, pin.value.definition.assignment.treatmentProbability), sourceSnapshot: source.snapshot, sourceHash, invariantReceipts,
          lineageManifestId: manifestId, receiptHash: "", signature: "", assignedBy: v7HumanActorId(actor), assignedAt: at };
        Object.assign(value, signedExperimentReceipt("assignment", assignmentMaterial(value, execution.receiptHash, pin.value.contentHash)));
        const edges = experimentEdges([...pin.source.edges, ...source.edges]);
        await tx.insert(analyticalLineageManifests).values({ id: manifestId, companyId, analysisType: "experiment_assignment", analysisRef: assignmentId, engineVersion: EXPERIMENT_OWNER_ENGINE, definitionHash: pin.value.contentHash, inputHash: sourceHash,
          requestedBy: v7HumanActorId(actor), sourceWatermark: source.snapshot.updatedAt, sourceCount: edges.length, parameters: { receiptHash: value.receiptHash, lineageHash: nativeSha256(edges) }, createdAt: at, expiresAt: pin.value.expiresAt });
        await tx.insert(analyticalLineageEdges).values(edges.map(edge => ({ ...edge, companyId, manifestId })));
        await tx.insert(businessExperimentAssignments).values(value);
        await auditBusinessExperiment(tx, publications, companyId, actor, id, "unit_assigned", { versionId: input.versionId, assignmentId, receiptHash: value.receiptHash });
        experimentBudget(deadline); return assignmentView(value);
      });
    },
    async recordExposure(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof recordBusinessExperimentExposureSchema.parse>[0]) {
      const input = recordBusinessExperimentExposureSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admitBusinessExperiment(tx, companyId, actor, true); const row = await lockBusinessExperimentRoot(tx, companyId, id), deadline = performance.now() + 30_000;
        if (row.revision !== input.expectedRevision || row.currentVersionId !== input.versionId || !["running", "paused", "completed"].includes(row.state)) throw conflict("Exposure attestation requires the exact retained recording state");
        const pin = await inspectBusinessExperimentVersion(tx, row, actor, input.versionId, true, deadline), assignment = pin.receipts.assignments.find(item => item.id === input.assignmentId);
        if (!assignment) throw notFound("Exposure requires an exact native assignment");
        const prior = pin.receipts.exposures.find(item => item.assignmentId === assignment.id);
        const asserted = input.exposure.status === "applied" ? new Date(input.exposure.assertedAppliedAt) : null;
        if (prior) {
          if (prior.status !== input.exposure.status || prior.rationale !== input.exposure.rationale || prior.assertedAppliedAt?.getTime() !== asserted?.getTime()) throw conflict("Exposure attestation is immutable; a retry cannot silently replace it");
          return exposureView(prior);
        }
        const at = await experimentStatementTime(tx), plan = pin.value.definition.sampleOrDurationPlan;
        if (asserted && (asserted < assignment.assignedAt || asserted > at || asserted.getTime() >= Date.parse(plan.until) || pin.receipts.completion && asserted > pin.receipts.completion.completedAt)) throw conflict("Human-asserted exposure time must follow assignment, precede stopping/the horizon and not be in the future");
        const value: ExperimentExposure = { id: randomUUID(), companyId, experimentId: id, versionId: input.versionId, assignmentId: assignment.id, arm: assignment.arm,
          status: input.exposure.status, provenance: "human_attestation", assertedAppliedAt: asserted, rationale: input.exposure.rationale, receiptHash: "", signature: "", recordedBy: v7HumanActorId(actor), recordedAt: at };
        Object.assign(value, signedExperimentReceipt("exposure", exposureMaterial(value, assignment.receiptHash)));
        await tx.insert(businessExperimentExposures).values(value);
        await auditBusinessExperiment(tx, publications, companyId, actor, id, "exposure_attested", { versionId: input.versionId, assignmentId: assignment.id, exposureId: value.id, status: value.status, provenance: value.provenance, receiptHash: value.receiptHash });
        experimentBudget(deadline); return exposureView(value);
      });
    },
    async control(companyId: string, actor: AuthorizationActor, id: string, raw: Parameters<typeof controlBusinessExperimentExecutionSchema.parse>[0]) {
      const input = controlBusinessExperimentExecutionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admitBusinessExperiment(tx, companyId, actor, true, input.state === "running"); const row = await lockBusinessExperimentRoot(tx, companyId, id);
        if (row.revision !== input.expectedRevision || row.currentVersionId !== input.versionId || !["running", "paused"].includes(row.state) || !BUSINESS_EXPERIMENT_TRANSITIONS[row.state].includes(input.state)) throw conflict("Recording state/version changed or control transition is invalid");
        const [version] = await tx.select().from(businessExperimentVersions).where(and(eq(businessExperimentVersions.companyId, companyId), eq(businessExperimentVersions.experimentId, id), eq(businessExperimentVersions.id, input.versionId))).for("share");
        const [execution] = await tx.select().from(businessExperimentExecutions).where(and(eq(businessExperimentExecutions.companyId, companyId), eq(businessExperimentExecutions.experimentId, id), eq(businessExperimentExecutions.versionId, input.versionId))).for("share");
        if (!version || !execution) throw notFound("Native recording ownership is unavailable");
        if (input.state === "running") {
          await inspectBusinessExperimentVersion(tx, row, actor, version.id, true, performance.now() + 30_000); await requireNoOtherActiveRecording(tx, companyId, id);
        }
        const at = await experimentStatementTime(tx);
        if (input.state === "running" && at.getTime() >= Date.parse(version.definition.sampleOrDurationPlan.until)) throw conflict("The registered recording horizon ended");
        if (input.completion?.reason === "fixed_horizon" && at.getTime() < Date.parse(version.definition.sampleOrDurationPlan.until)) throw conflict("Fixed-horizon completion cannot provide early efficacy stopping");
        if (["completed", "cancelled"].includes(input.state)) {
          const value: ExperimentCompletion = { id: randomUUID(), companyId, experimentId: id, versionId: input.versionId, reason: input.state === "cancelled" ? "cancelled" : input.completion!.reason,
            concurrentChangeReview: input.completion?.concurrentChangeReview ?? { assessment: "material_or_unknown", rationale: input.rationale }, rationale: input.rationale, receiptHash: "", signature: "", completedBy: v7HumanActorId(actor), completedAt: at };
          Object.assign(value, signedExperimentReceipt("completion", completionMaterial(value, execution.receiptHash))); await tx.insert(businessExperimentCompletions).values(value);
        }
        const updated = await transition(tx, companyId, actor, row, input.state, input.rationale, at);
        await auditBusinessExperiment(tx, publications, companyId, actor, id, "recording_controlled", { versionId: input.versionId, revision: updated.revision, from: row.state, to: updated.state, reason: input.completion?.reason ?? null, rationaleHash: nativeSha256(input.rationale) });
        return businessExperimentRootView(updated);
      });
    },
    async receipts(companyId: string, actor: AuthorizationActor, id: string, versionId: string) {
      return db.transaction(async raw => {
        const tx = raw as unknown as Db; await admitBusinessExperiment(tx, companyId, actor); const row = await lockBusinessExperimentRoot(tx, companyId, id), pin = await inspectBusinessExperimentVersion(tx, row, actor, versionId, false, performance.now() + 30_000);
        return { versionId, assignments: pin.receipts.assignments.map(assignmentView), exposures: pin.receipts.exposures.map(exposureView),
          recording: pin.receipts.execution ? { mode: pin.receipts.execution.mode, startedBy: pin.receipts.execution.startedBy, startedAt: pin.receipts.execution.startedAt.toISOString(), receiptHash: pin.receipts.execution.receiptHash } : null,
          completion: pin.receipts.completion ? { reason: pin.receipts.completion.reason, concurrentChangeReview: pin.receipts.completion.concurrentChangeReview, completedBy: pin.receipts.completion.completedBy, completedAt: pin.receipts.completion.completedAt.toISOString(), receiptHash: pin.receipts.completion.receiptHash } : null,
          exposureProvenance: "human_attestation" as const, currentQualification: pin.source.current ? "current" as const : "needs_revalidation" as const };
      });
    },
  };
}
