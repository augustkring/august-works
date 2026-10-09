import { createHmac } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, businessExperimentAssignments, businessExperimentCompletions, businessExperimentExecutions, businessExperimentExposures, businessExperimentVersions, businessExperimentTransitions, type Db } from "@paperclipai/db";
import { ISSUE_STATUSES, PROJECT_STATUSES, type BusinessExperimentAssignmentView, type BusinessExperimentExposureView, type BusinessExperimentUnitSnapshot } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { resolveDecisionSigningSecret, signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { authorizeStrategyNativePopulation, authorizeStrategyReference } from "../strategy-execution/references.js";
import { inspectDecisionSourceAuthority } from "../decision-intelligence.js";
import { assertAnalyticalSourcesNotErased } from "../analytical-privacy.js";
import { inspectBusinessExperimentResults, type ExperimentAnalysis, type ExperimentOutcome, type ExperimentInterpretation } from "./results.js";
import { assignNativeBusinessExperimentUnit } from "./kernel.js";

export type ExperimentVersion = typeof businessExperimentVersions.$inferSelect;
export type ExperimentExecution = typeof businessExperimentExecutions.$inferSelect;
export type ExperimentAssignment = typeof businessExperimentAssignments.$inferSelect;
export type ExperimentExposure = typeof businessExperimentExposures.$inferSelect;
export type ExperimentCompletion = typeof businessExperimentCompletions.$inferSelect;
export type ExperimentEdge = Pick<typeof analyticalLineageEdges.$inferInsert, "inputType" | "inputRef" | "inputHash" | "relationship">;
export const EXPERIMENT_OWNER_ENGINE = "aw-native-business-experiment-owner-v1";
export function experimentBudget(deadline: number) { if (performance.now() > deadline) throw unprocessable("Experiment receipt source budget exceeded"); }
export function experimentEdges(edges: ExperimentEdge[]) {
  const result = new Map<string, ExperimentEdge>();
  for (const edge of edges) {
    const key = `${edge.inputType}:${edge.inputRef}`, prior = result.get(key);
    if (prior && prior.inputHash !== edge.inputHash) throw conflict("Experiment receipt source hashes conflict");
    result.set(key, { inputType: edge.inputType, inputRef: edge.inputRef, inputHash: edge.inputHash, relationship: edge.relationship });
  }
  if (result.size > 260) throw unprocessable("Experiment receipt source population exceeds its budget");
  return [...result.values()].sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
}
/** Batch transport only. Every original receipt still checks its exact tenant,
 * identity, hashes, complete edges and expiry. No authority or content cache
 * escapes the enclosing native company → Memory transaction. */
export async function loadExperimentLineage(tx: Db, companyId: string, refs: string[], deadline: number) {
  const ids = [...new Set(refs)], manifests = new Map<string, typeof analyticalLineageManifests.$inferSelect>(), edges = new Map<string, ExperimentEdge[]>();
  // 4,000 assignments plus primary/eight guardrail/eight secondary outcomes.
  if (ids.length > 4000 * 18) throw unprocessable("Experiment lineage population exceeds its native outcome bounds");
  // A complete 68,000-outcome replay otherwise makes 1,360 sequential queries
  // just to transport these rows. Keep the same total population, per-receipt
  // edge bounds and share locks, but use bounded 1,000-receipt transport batches.
  const batchSize = 1000;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    experimentBudget(deadline); const selected = ids.slice(offset, offset + batchSize);
    for (const row of await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), inArray(analyticalLineageManifests.id, selected))).limit(selected.length + 1).for("share")) manifests.set(row.id, row);
    const rows = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), inArray(analyticalLineageEdges.manifestId, selected))).limit(selected.length * 260 + 1).for("share");
    if (rows.length > selected.length * 260) throw notFound("Experiment complete receipt lineage is unavailable");
    for (const row of rows) { const group = edges.get(row.manifestId) ?? []; group.push({ inputType: row.inputType, inputRef: row.inputRef, inputHash: row.inputHash, relationship: row.relationship }); if (group.length > 260) throw notFound("Experiment receipt lineage exceeds its exact bound"); edges.set(row.manifestId, group); }
  }
  experimentBudget(deadline); return { manifests, edges };
}
/** Derive a domain-separated key from the existing protected instance signing
 * owner. It is never a public field, caller input or alternate credential store. */
export function experimentAssignmentKey(companyId: string, versionId: string) {
  return createHmac("sha256", resolveDecisionSigningSecret()).update(`aw-business-experiment-assignment-key-v1:${companyId}:${versionId}`).digest();
}
export function signedExperimentReceipt(domain: string, material: Record<string, unknown>) {
  const receiptHash = nativeSha256(material);
  return { receiptHash, signature: signDecisionSpec({ domain: `aw-business-experiment:${domain}:v1`, receiptHash }) };
}
export function verifyExperimentReceipt(domain: string, material: Record<string, unknown>, row: { receiptHash: string; signature: string }) {
  if (nativeSha256(material) !== row.receiptHash || !verifyDecisionSpec({ domain: `aw-business-experiment:${domain}:v1`, receiptHash: row.receiptHash }, row.signature)) throw notFound("Experiment native receipt integrity is unavailable");
}
export function experimentReviewHash(row: typeof businessExperimentTransitions.$inferSelect) {
  return nativeSha256({ ...row, createdAt: row.createdAt.toISOString() });
}
export function executionMaterial(row: ExperimentExecution, definitionHash: string, reviewHash: string) {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, definitionHash,
    mode: row.mode, reviewTransitionId: row.reviewTransitionId, reviewHash, assignmentKeyFingerprint: row.assignmentKeyFingerprint, rationale: row.rationale, startedBy: row.startedBy, startedAt: row.startedAt.toISOString() };
}
export function assignmentMaterial(row: ExperimentAssignment, executionHash: string, definitionHash: string) {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, definitionHash, executionHash,
    unitType: row.unitType, unitId: row.unitId, arm: row.arm, sourceSnapshot: row.sourceSnapshot, sourceHash: row.sourceHash, invariantReceipts: row.invariantReceipts,
    assignedBy: row.assignedBy, assignedAt: row.assignedAt.toISOString() };
}
export function exposureMaterial(row: ExperimentExposure, assignmentHash: string) {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, assignmentId: row.assignmentId, assignmentHash, arm: row.arm,
    status: row.status, provenance: row.provenance, assertedAppliedAt: row.assertedAppliedAt?.toISOString() ?? null, rationale: row.rationale, recordedBy: row.recordedBy, recordedAt: row.recordedAt.toISOString() };
}
export function completionMaterial(row: ExperimentCompletion, executionHash: string) {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, executionHash, reason: row.reason,
    concurrentChangeReview: row.concurrentChangeReview, rationale: row.rationale, completedBy: row.completedBy, completedAt: row.completedAt.toISOString() };
}
export function assignmentView(row: ExperimentAssignment): BusinessExperimentAssignmentView {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, unitType: row.unitType, unitId: row.unitId, arm: row.arm,
    sourceHash: row.sourceHash, invariantReceipts: row.invariantReceipts, receiptHash: row.receiptHash, assignedBy: row.assignedBy, assignedAt: row.assignedAt.toISOString() };
}
export function exposureView(row: ExperimentExposure): BusinessExperimentExposureView {
  return { id: row.id, companyId: row.companyId, experimentId: row.experimentId, versionId: row.versionId, assignmentId: row.assignmentId, arm: row.arm, status: row.status,
    provenance: row.provenance, assertedAppliedAt: row.assertedAppliedAt?.toISOString() ?? null, rationale: row.rationale, receiptHash: row.receiptHash, recordedBy: row.recordedBy, recordedAt: row.recordedAt.toISOString() };
}
async function inspectNativeExperimentUnit(tx: Db, companyId: string, actor: AuthorizationActor, version: ExperimentVersion, unitId: string, checkErasure:boolean) {
  const entity = version.definition.population.randomizationUnit;
  const admitted = await authorizeStrategyReference(tx, companyId, actor, { type: entity, id: unitId }, version.definition.sensitivity,true);
  if(checkErasure)await assertAnalyticalSourcesNotErased(tx, companyId, admitted.issueIds, admitted.projectIds);
  return nativeExperimentSource(version, admitted);
}
function nativeExperimentSource(version: ExperimentVersion, admitted: Awaited<ReturnType<typeof authorizeStrategyReference>>) {
  const entity = version.definition.population.randomizationUnit;
  const current=admitted.nativeObject;
  if(!current||current.archived)throw notFound("Experiment unit is unavailable");
  const snapshot:BusinessExperimentUnitSnapshot=current.snapshot;
  if(entity==="issue"&&version.definition.scope.type==="project"&&snapshot.projectId!==version.definition.scope.id)throw conflict("Experiment unit moved outside its registered project population");
  const plan = version.definition.sampleOrDurationPlan;
  const statuses: readonly string[] = entity === "issue" ? ISSUE_STATUSES : PROJECT_STATUSES;
  if (!statuses.includes(snapshot.status)) throw conflict("Experiment unit has no admitted native status semantics");
  if (Date.parse(snapshot.createdAt) < Date.parse(plan.from) || Date.parse(snapshot.createdAt) >= Date.parse(plan.until)) throw conflict("Experiment unit was not created in the registered native metric population window");
  return { snapshot, edges: [
    ...admitted.issueIds.map(id => ({ inputType: "issue" as const, inputRef: id, inputHash: nativeSha256({ type: "issue", id }), relationship: "source" as const })),
    ...admitted.projectIds.map(id => ({ inputType: "project" as const, inputRef: id, inputHash: nativeSha256({ type: "project", id }), relationship: "source" as const })),
  ] };
}
export function nativeExperimentUnit(tx:Db,companyId:string,actor:AuthorizationActor,version:ExperimentVersion,unitId:string) {
  return inspectNativeExperimentUnit(tx,companyId,actor,version,unitId,true);
}
/** Registry and recording consumers must authorize every enrolled source before
 * returning any protocol/receipt/aggregate. No recursive registry admission. */
export async function inspectBusinessExperimentReceipts(tx: Db, companyId: string, actor: AuthorizationActor, version: ExperimentVersion, deadline: number) {
  const currentUnits = new Map<string, Awaited<ReturnType<typeof nativeExperimentUnit>>>();
  const where = and(eq(businessExperimentExecutions.companyId, companyId), eq(businessExperimentExecutions.experimentId, version.experimentId), eq(businessExperimentExecutions.versionId, version.id));
  const [execution] = await tx.select().from(businessExperimentExecutions).where(where).for("share");
  if (!execution) return { execution: null, assignments: [] as ExperimentAssignment[], exposures: [] as ExperimentExposure[], completion: null as ExperimentCompletion | null, analysis: null as ExperimentAnalysis | null, outcomes: [] as ExperimentOutcome[], interpretation: null as ExperimentInterpretation | null, currentUnits, assignmentLineage: new Map<string, ExperimentEdge[]>() };
  const [review] = await tx.select().from(businessExperimentTransitions).where(and(eq(businessExperimentTransitions.companyId, companyId), eq(businessExperimentTransitions.experimentId, version.experimentId), eq(businessExperimentTransitions.versionId, version.id), eq(businessExperimentTransitions.id, execution.reviewTransitionId))).for("share");
  if (!review || review.toState !== "ready" || review.createdAt > execution.startedAt || review.createdAt.getTime() > Date.parse(version.definition.sampleOrDurationPlan.from)) throw notFound("Experiment exact human preregistration review is unavailable");
  verifyExperimentReceipt("execution", executionMaterial(execution, version.contentHash, experimentReviewHash(review)), execution);
  const assignmentKey = experimentAssignmentKey(companyId, version.id);
  if (nativeSha256(assignmentKey.toString("hex")) !== execution.assignmentKeyFingerprint) throw conflict("Experiment signing owner changed; assignment receipts require operator revalidation");
  const assignments = await tx.select().from(businessExperimentAssignments).where(and(eq(businessExperimentAssignments.companyId, companyId), eq(businessExperimentAssignments.experimentId, version.experimentId), eq(businessExperimentAssignments.versionId, version.id))).orderBy(asc(businessExperimentAssignments.id)).limit(version.definition.sampleOrDurationPlan.maximumAssignedUnits + 1).for("share");
  if (assignments.length > version.definition.sampleOrDurationPlan.maximumAssignedUnits) throw unprocessable("Experiment assignment population exceeds preregistered bounds");
  const versionEdges = await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, version.lineageManifestId))).limit(257);
  const lineage = await loadExperimentLineage(tx, companyId, assignments.map(assignment => assignment.lineageManifestId), deadline), authorityEdges = new Map<string, ExperimentEdge>(), admittedObjectSourceKeys=new Set<string>();
  // Verify the original immutable assignment material before transporting
  // current rows. Batch transport never replaces any native source authorization.
  for (const assignment of assignments) {
    experimentBudget(deadline); verifyExperimentReceipt("assignment", assignmentMaterial(assignment, execution.receiptHash, version.contentHash), assignment);
    if (assignment.sourceHash !== nativeSha256({ snapshot: assignment.sourceSnapshot, invariantReceipts: assignment.invariantReceipts })
      || assignment.arm !== assignNativeBusinessExperimentUnit(assignmentKey, companyId, version.id, assignment.unitId, version.definition.assignment.treatmentProbability)) throw notFound("Experiment assignment source or label integrity is unavailable");
  }
  const nativeSources = await authorizeStrategyNativePopulation(tx, companyId, actor, version.definition.population.randomizationUnit,
    assignments.map(assignment => assignment.unitId), version.definition.sensitivity, deadline);
  // Bound and pipeline transport only: each unit and its complete ancestry
  // still enter the original native owner independently. Drain every in-flight
  // admission before throwing so none can outlive this transaction's locks.
  for (let offset = 0; offset < assignments.length; offset += 32) {
    experimentBudget(deadline);
    const inspected = await Promise.allSettled(assignments.slice(offset, offset + 32).map(async assignment => {
      experimentBudget(deadline);
      const admitted = nativeSources.get(assignment.unitId);
      if (!admitted) throw notFound("Experiment native source population is unavailable");
      const current = nativeExperimentSource(version, admitted);
      currentUnits.set(assignment.id, current);
      for(const edge of current.edges)admittedObjectSourceKeys.add(`${edge.inputType}:${edge.inputRef}`);
      if (current.snapshot.createdAt !== assignment.sourceSnapshot.createdAt) throw conflict("Experiment enrolled unit identity was corrected");
      const manifest = lineage.manifests.get(assignment.lineageManifestId), edges = lineage.edges.get(assignment.lineageManifestId) ?? [];
      const expectedEdges = experimentEdges([...versionEdges,
        { inputType: assignment.unitType, inputRef: assignment.unitId, inputHash: nativeSha256({ type: assignment.unitType, id: assignment.unitId }), relationship: "source" },
        ...(assignment.sourceSnapshot.projectId ? [{ inputType: "project" as const, inputRef: assignment.sourceSnapshot.projectId, inputHash: nativeSha256({ type: "project", id: assignment.sourceSnapshot.projectId }), relationship: "source" as const }] : []),
      ]);
      if (!manifest || manifest.expiresAt <= new Date() || manifest.engineVersion !== EXPERIMENT_OWNER_ENGINE || manifest.analysisType !== "experiment_assignment" || manifest.analysisRef !== assignment.id
        || manifest.definitionHash !== version.contentHash || manifest.inputHash !== assignment.sourceHash || manifest.parameters.receiptHash !== assignment.receiptHash
        || manifest.sourceCount !== edges.length || manifest.parameters.lineageHash !== nativeSha256(experimentEdges(edges)) || nativeSha256(experimentEdges(edges)) !== nativeSha256(expectedEdges)
        || manifest.createdAt.getTime() !== assignment.assignedAt.getTime() || manifest.expiresAt.getTime() !== version.expiresAt.getTime()
        || !edges.some(edge => edge.inputType === assignment.unitType && edge.inputRef === assignment.unitId && edge.inputHash === nativeSha256({ type: assignment.unitType, id: assignment.unitId }))) throw notFound("Experiment enrolled source lineage is erased or unavailable");
      for (const edge of edges) { const key = `${edge.inputType}:${edge.inputRef}`, prior = authorityEdges.get(key); if (prior && prior.inputHash !== edge.inputHash) throw conflict("Experiment enrolled Source pins disagree"); authorityEdges.set(key, edge); }
      experimentBudget(deadline);
    }));
    for (const result of inspected) if (result.status === "rejected") throw result.reason;
  }
  // Batch only the marker lookup, after every actual current native object
  // was admitted. The company → Memory locks prevent erasure between reads.
  const currentIssueRefs:string[]=[],currentProjectRefs:string[]=[];
  for(const sources of currentUnits.values())for(const edge of sources.edges)(edge.inputType==="issue"?currentIssueRefs:currentProjectRefs).push(edge.inputRef);
  await assertAnalyticalSourcesNotErased(tx,companyId,currentIssueRefs,currentProjectRefs);
  // Every current unit/ancestry was just admitted and share-locked above in
  // this same company → Memory transaction. Inspect remaining recorded
  // ancestry; keep every original hash/receipt check and every current unit.
  await inspectDecisionSourceAuthority(tx, companyId, actor, [...authorityEdges.values()].filter(edge=>!admittedObjectSourceKeys.has(`${edge.inputType}:${edge.inputRef}`)), deadline);
  for(const edge of authorityEdges.values())if(edge.inputType==="issue"||edge.inputType==="project")admittedObjectSourceKeys.add(`${edge.inputType}:${edge.inputRef}`);
  const exposures = await tx.select().from(businessExperimentExposures).where(and(eq(businessExperimentExposures.companyId, companyId), eq(businessExperimentExposures.experimentId, version.experimentId), eq(businessExperimentExposures.versionId, version.id))).limit(assignments.length + 1).for("share");
  if (exposures.length > assignments.length) throw notFound("Experiment exposure join integrity is unavailable");
  const byAssignment = new Map(assignments.map(assignment => [assignment.id, assignment]));
  for (const exposure of exposures) {
    const assignment = byAssignment.get(exposure.assignmentId);
    if (!assignment || exposure.arm !== assignment.arm || exposure.provenance !== "human_attestation") throw notFound("Experiment exposure receipt has no exact assignment");
    verifyExperimentReceipt("exposure", exposureMaterial(exposure, assignment.receiptHash), exposure);
  }
  const [completion] = await tx.select().from(businessExperimentCompletions).where(and(eq(businessExperimentCompletions.companyId, companyId), eq(businessExperimentCompletions.experimentId, version.experimentId), eq(businessExperimentCompletions.versionId, version.id))).for("share");
  if (completion) verifyExperimentReceipt("completion", completionMaterial(completion, execution.receiptHash), completion);
  const receipts = { execution, assignments, exposures, completion: completion ?? null, assignmentLineage: lineage.edges,admittedObjectSourceKeys };
  const results = await inspectBusinessExperimentResults(tx, companyId, actor, version, receipts, deadline);
  experimentBudget(deadline); return { ...receipts, ...results, currentUnits };
}
export async function experimentStatementTime(tx: Db) {
  const rows = await tx.execute<{ captured_at: Date }>(sql`select statement_timestamp() as captured_at`);
  return new Date(rows[0].captured_at);
}
