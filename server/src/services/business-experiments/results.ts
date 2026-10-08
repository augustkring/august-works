import { and, eq } from "drizzle-orm";
import { businessExperimentAnalyses, businessExperimentInterpretations, businessExperimentOutcomes, businessExperimentTransitions, type Db } from "@paperclipai/db";
import type { BusinessExperimentAnalysisView, BusinessExperimentInvariantDiagnostic, NativeBusinessExperimentCapture } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound } from "../../errors.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { inspectDecisionSourceAuthority } from "../decision-intelligence.js";
import { businessMetricService } from "../business-metrics/service.js";
import { calculateNativeMetric } from "../business-metrics/native-engine.js";
import { exactExperimentInvariantBalance, evaluateNativeBusinessExperiment } from "./kernel.js";
import { EXPERIMENT_OWNER_ENGINE, experimentBudget, experimentEdges, loadExperimentLineage, verifyExperimentReceipt, type ExperimentEdge, type ExperimentVersion, type ExperimentAssignment, type ExperimentExposure, type ExperimentExecution, type ExperimentCompletion } from "./receipts.js";
export type ExperimentAnalysis = typeof businessExperimentAnalyses.$inferSelect;
export type ExperimentOutcome = typeof businessExperimentOutcomes.$inferSelect;
export type ExperimentInterpretation = typeof businessExperimentInterpretations.$inferSelect;
export interface RecordingReceipts { execution: ExperimentExecution|null; assignments: ExperimentAssignment[]; exposures: ExperimentExposure[]; completion: ExperimentCompletion|null; assignmentLineage: Map<string, ExperimentEdge[]> }
export function experimentInvariantDiagnostics(version: ExperimentVersion, assignments: ExperimentAssignment[]): BusinessExperimentInvariantDiagnostic[] {
  return version.metricPins.filter(pin => pin.role === "invariant").map(pin => {
    const control = assignments.filter(a=>a.arm==="control"), treatment = assignments.filter(a=>a.arm==="treatment");
    const successes = (rows: ExperimentAssignment[]) => rows.reduce((n,a)=>{ const value=a.invariantReceipts.find(r=>r.key===pin.key&&r.metricId===pin.metricId&&r.metricVersionId===pin.metricVersionId); if (!value || value.value!==0&&value.value!==1) throw notFound("Experiment exact pretreatment invariant is unavailable"); return n+value.value; },0);
    const controlSuccesses=successes(control), treatmentSuccesses=successes(treatment), pValue=exactExperimentInvariantBalance(control.length,controlSuccesses,treatment.length,treatmentSuccesses), threshold=version.definition.diagnostics.invariantBalance.familywiseAlpha/version.definition.diagnostics.invariantMetricRefs.length;
    return {key:pin.key,controlUnits:control.length,controlSuccesses,treatmentUnits:treatment.length,treatmentSuccesses,method:"exact_fisher_probability_ordering_v1",pValue,threshold,balanced:pValue>=threshold};
  });
}
export function experimentCapture(version:ExperimentVersion, receipts:RecordingReceipts, reviewedAt:Date, outcomes:ExperimentOutcome[], at:Date):NativeBusinessExperimentCapture {
  const completion=receipts.completion!, diagnostics=experimentInvariantDiagnostics(version,receipts.assignments), plan=version.definition.sampleOrDurationPlan;
  const metrics=version.metricPins.filter(p=>p.role!=="invariant");
  const exposures=new Map(receipts.exposures.map(exposure=>[exposure.assignmentId,exposure])),byAssignment=new Map<string,ExperimentOutcome[]>();
  for(const outcome of outcomes){const group=byAssignment.get(outcome.assignmentId)??[];group.push(outcome);byAssignment.set(outcome.assignmentId,group);}
  return {versionId:version.id,definitionHash:version.contentHash,registeredAt:version.createdAt.toISOString(),reviewedAt:reviewedAt.toISOString(),completedAt:completion.completedAt.toISOString(),analyzedAt:at.toISOString(),completionReason:completion.reason,
    integrity:{assignmentLogComplete:!!receipts.execution,exposureLogComplete:receipts.exposures.length===receipts.assignments.length&&receipts.assignments.every(a=>exposures.has(a.id)),telemetryComplete:completion.reason!=="fixed_horizon"||outcomes.length===receipts.assignments.length*metrics.length,joinIntegrity:true,invariantsPassed:diagnostics.every(d=>d.balanced),interferenceAdmitted:completion.concurrentChangeReview.assessment==="none_identified"},
    units:receipts.assignments.map(a=>{const exposure=exposures.get(a.id);return {unitId:a.unitId,unitSourceHash:a.sourceHash,arm:a.arm,assignedAt:a.assignedAt.toISOString(),assignmentReceiptHash:a.receiptHash,exposure:exposure?.status==="applied"?{arm:exposure.arm,exposedAt:exposure.assertedAppliedAt!.toISOString(),receiptHash:exposure.receiptHash}:null,
      outcomes:(byAssignment.get(a.id)??[]).map(o=>({key:o.key,metricId:o.metricId,metricVersionId:o.metricVersionId,outcomeReceiptId:o.id,sourceHash:o.sourceHash,from:plan.from,until:plan.until,observedAt:o.capturedAt.toISOString(),value:o.value})).sort((a,b)=>a.key.localeCompare(b.key))};})};
}
export function experimentAnalysisMaterial(row:ExperimentAnalysis,completionHash:string) {
  return {id:row.id,companyId:row.companyId,experimentId:row.experimentId,versionId:row.versionId,definitionHash:row.definitionHash,completionHash,capture:row.capture,result:row.result,invariantDiagnostics:row.invariantDiagnostics,analyzedBy:row.analyzedBy,analyzedAt:row.analyzedAt.toISOString()};
}
export function experimentOutcomeMaterial(row:ExperimentOutcome, assignmentHash:string, definitionHash:string) {
  return {id:row.id,companyId:row.companyId,experimentId:row.experimentId,versionId:row.versionId,analysisId:row.analysisId,assignmentId:row.assignmentId,assignmentHash,definitionHash,key:row.key,metricId:row.metricId,metricVersionId:row.metricVersionId,value:row.value,sourceSnapshot:row.sourceSnapshot,inputHash:row.inputHash,sourceHash:row.sourceHash,capturedAt:row.capturedAt.toISOString()};
}
export function experimentInterpretationMaterial(row:ExperimentInterpretation,analysisHash:string) {
  return {id:row.id,companyId:row.companyId,experimentId:row.experimentId,versionId:row.versionId,analysisId:row.analysisId,analysisHash,conclusion:row.conclusion,rationale:row.rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only",interpretedBy:row.interpretedBy,interpretedAt:row.interpretedAt.toISOString()};
}
export function experimentAnalysisView(row:ExperimentAnalysis,completion:ExperimentCompletion,current:boolean):BusinessExperimentAnalysisView {
  return {id:row.id,companyId:row.companyId,experimentId:row.experimentId,versionId:row.versionId,definitionHash:row.definitionHash,qualityGates:{assignmentReceipts:row.capture.integrity.assignmentLogComplete,exposureReports:row.capture.integrity.exposureLogComplete,finalOutcomeCapture:row.capture.completionReason!=="fixed_horizon"?"not_required_nonconfirmatory_stop":row.capture.integrity.telemetryComplete?"complete":"incomplete",identityJoins:row.capture.integrity.joinIntegrity,baselineBalance:row.capture.integrity.invariantsPassed,concurrentReviewAdmitted:row.capture.integrity.interferenceAdmitted},result:row.result,invariantDiagnostics:row.invariantDiagnostics,exposureProvenance:"human_attestation",outcomeTimeSemantics:"created_in_window_current_state_at_common_final_capture",concurrentChangeReview:completion.concurrentChangeReview,causalAuthority:row.result.numericallyQualified&&current?"conditional_on_registered_randomization_and_human_attestations":"withheld",analyzedAt:row.analyzedAt.toISOString(),analyzedBy:row.analyzedBy,receiptHash:row.receiptHash,currentQualification:current?"current":"needs_revalidation"};
}
export function experimentInterpretationView(row:ExperimentInterpretation) {
  return {id:row.id,analysisId:row.analysisId,conclusion:row.conclusion,rationale:row.rationale,executionAuthority:"advisory_only" as const,receiptHash:row.receiptHash,interpretedBy:row.interpretedBy,interpretedAt:row.interpretedAt.toISOString()};
}
/** Verify material, complete per-unit source ownership and original arithmetic
 * before any registry/receipt consumer may disclose a saved result. */
export async function inspectBusinessExperimentResults(tx:Db,companyId:string,actor:AuthorizationActor,version:ExperimentVersion,receipts:RecordingReceipts,deadline:number) {
  const [analysis]=await tx.select().from(businessExperimentAnalyses).where(and(eq(businessExperimentAnalyses.companyId,companyId),eq(businessExperimentAnalyses.versionId,version.id))).for("share");
  if(!analysis)return {analysis:null,outcomes:[] as ExperimentOutcome[],interpretation:null as ExperimentInterpretation|null};
  if(!receipts.execution||!receipts.completion||analysis.definitionHash!==version.contentHash)throw notFound("Experiment analysis source ownership is unavailable");
  const metrics=version.metricPins.filter(p=>p.role!=="invariant"), expected=receipts.completion.reason==="fixed_horizon"?receipts.assignments.length*metrics.length:0;
  const outcomes=await tx.select().from(businessExperimentOutcomes).where(and(eq(businessExperimentOutcomes.companyId,companyId),eq(businessExperimentOutcomes.analysisId,analysis.id))).limit(expected+1).for("share");
  if(outcomes.length!==expected)throw notFound("Experiment intention-to-treat outcome receipt set is unavailable");
  const definitions=new Map<string,Awaited<ReturnType<ReturnType<typeof businessMetricService>["inspectPublishedDefinition"]>>>();
  for(const pin of metrics)definitions.set(pin.key,await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,pin.metricId,pin.metricVersionId));
  const lineage=await loadExperimentLineage(tx,companyId,outcomes.map(outcome=>outcome.lineageManifestId),deadline),assignments=new Map(receipts.assignments.map(assignment=>[assignment.id,assignment])),authorityEdges=new Map<string,ExperimentEdge>();
  for(const outcome of outcomes){
    experimentBudget(deadline);const assignment=assignments.get(outcome.assignmentId),metric=definitions.get(outcome.key),pin=metrics.find(p=>p.key===outcome.key);
    if(!assignment||!metric||!pin||outcome.metricId!==pin.metricId||outcome.metricVersionId!==pin.metricVersionId||outcome.capturedAt.getTime()!==analysis.analyzedAt.getTime()||outcome.sourceSnapshot.id!==assignment.unitId||outcome.sourceSnapshot.createdAt!==assignment.sourceSnapshot.createdAt)throw notFound("Experiment outcome exact identity or capture time is unavailable");
    verifyExperimentReceipt("outcome",experimentOutcomeMaterial(outcome,assignment.receiptHash,version.contentHash),outcome);
    const calculation=calculateNativeMetric(metric.version.definition,{metricId:pin.metricId,versionId:pin.metricVersionId,from:version.definition.sampleOrDurationPlan.from,until:version.definition.sampleOrDurationPlan.until,dimensions:[],maxRows:1},[outcome.sourceSnapshot]);
    if(calculation.status!=="observed"||calculation.value!==outcome.value||calculation.inputHash!==outcome.inputHash||outcome.sourceHash!==nativeSha256({snapshot:outcome.sourceSnapshot,metricHash:pin.contentHash,inputHash:outcome.inputHash,value:outcome.value}))throw notFound("Experiment native outcome material is unavailable");
    const manifest=lineage.manifests.get(outcome.lineageManifestId),edges=lineage.edges.get(outcome.lineageManifestId)??[],inherited=receipts.assignmentLineage.get(assignment.lineageManifestId);
    if(!inherited)throw notFound("Experiment exact assignment lineage is unavailable");
    const expectedEdges=experimentEdges([...inherited,...(outcome.sourceSnapshot.projectId?[{inputType:"project" as const,inputRef:outcome.sourceSnapshot.projectId,inputHash:nativeSha256({type:"project",id:outcome.sourceSnapshot.projectId}),relationship:"source" as const}]:[])]);
    if(!manifest||manifest.expiresAt<=new Date()||manifest.engineVersion!==EXPERIMENT_OWNER_ENGINE||manifest.analysisType!=="experiment_outcome"||manifest.analysisRef!==outcome.id||manifest.definitionHash!==version.contentHash||manifest.inputHash!==outcome.sourceHash||manifest.parameters.receiptHash!==outcome.receiptHash||manifest.createdAt.getTime()!==outcome.capturedAt.getTime()||manifest.expiresAt.getTime()!==version.expiresAt.getTime()||manifest.sourceCount!==edges.length||manifest.parameters.lineageHash!==nativeSha256(experimentEdges(edges))||nativeSha256(expectedEdges)!==nativeSha256(experimentEdges(edges)))throw notFound("Experiment outcome lineage is erased or unavailable");
    for(const edge of edges){const key=`${edge.inputType}:${edge.inputRef}`,prior=authorityEdges.get(key);if(prior&&prior.inputHash!==edge.inputHash)throw conflict("Experiment outcome Source pins disagree");authorityEdges.set(key,edge);}
  }
  await inspectDecisionSourceAuthority(tx,companyId,actor,[...authorityEdges.values()],deadline);
  const [review]=await tx.select().from(businessExperimentTransitions).where(eq(businessExperimentTransitions.id,receipts.execution.reviewTransitionId)).for("share");
  if(!review)throw notFound("Experiment exact reviewed protocol is unavailable");
  const capture=experimentCapture(version,receipts,review.createdAt,outcomes,analysis.analyzedAt), diagnostics=experimentInvariantDiagnostics(version,receipts.assignments);
  if(nativeSha256(capture)!==nativeSha256(analysis.capture)||nativeSha256(diagnostics)!==nativeSha256(analysis.invariantDiagnostics)||nativeSha256(evaluateNativeBusinessExperiment(version.definition,capture))!==nativeSha256(analysis.result))throw notFound("Experiment saved analysis material is unavailable");
  verifyExperimentReceipt("analysis",experimentAnalysisMaterial(analysis,receipts.completion.receiptHash),analysis);
  const [interpretation]=await tx.select().from(businessExperimentInterpretations).where(and(eq(businessExperimentInterpretations.companyId,companyId),eq(businessExperimentInterpretations.analysisId,analysis.id))).for("share");
  if(interpretation)verifyExperimentReceipt("interpretation",experimentInterpretationMaterial(interpretation,analysis.receiptHash),interpretation);
  experimentBudget(deadline);return {analysis,outcomes,interpretation:interpretation??null};
}
