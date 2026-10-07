import { randomUUID } from "node:crypto";
import { and,eq } from "drizzle-orm";
import { analyticalLineageEdges,analyticalLineageManifests,businessExperimentAnalyses,businessExperimentInterpretations,businessExperimentOutcomes,businessExperimentTransitions,type Db } from "@paperclipai/db";
import { analyzeBusinessExperimentSchema,interpretBusinessExperimentSchema } from "@paperclipai/shared";
import { conflict,notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { businessMetricService } from "../business-metrics/service.js";
import { calculateNativeMetric } from "../business-metrics/native-engine.js";
import { admitBusinessExperiment,lockBusinessExperimentRoot,inspectBusinessExperimentVersion,businessExperimentRootView,auditBusinessExperiment } from "./service.js";
import { transitionExperimentRecording } from "./recording.js";
import { EXPERIMENT_OWNER_ENGINE,experimentBudget,experimentEdges,experimentStatementTime,nativeExperimentUnit,signedExperimentReceipt } from "./receipts.js";
import { evaluateNativeBusinessExperiment } from "./kernel.js";
import { experimentCapture,experimentInvariantDiagnostics,experimentAnalysisMaterial,experimentOutcomeMaterial,experimentInterpretationMaterial,experimentAnalysisView,experimentInterpretationView,type ExperimentAnalysis,type ExperimentOutcome,type ExperimentInterpretation } from "./results.js";
/** Sole final native capture owner. Commands supply identities/CAS only; never
 * pasted outcomes, public arms, integrity booleans or caller-chosen results. */
export function businessExperimentAnalysisService(db:Db){return {
  async analyze(companyId:string,actor:AuthorizationActor,id:string,raw:Parameters<typeof analyzeBusinessExperimentSchema.parse>[0]){
    const input=analyzeBusinessExperimentSchema.parse(raw);
    return withV7ActivityTransaction(db,async(tx,publications)=>{
      await admitBusinessExperiment(tx,companyId,actor,true);const row=await lockBusinessExperimentRoot(tx,companyId,id),deadline=performance.now()+30_000;
      if(row.revision!==input.expectedRevision||row.currentVersionId!==input.versionId||row.state!=="completed")throw conflict("A single final analysis requires the exact completed protocol and revision");
      const pin=await inspectBusinessExperimentVersion(tx,row,actor,input.versionId,true,deadline),receipts=pin.receipts;
      if(!receipts.execution||!receipts.completion||receipts.analysis)throw conflict("An exact recording/completion is required and cannot be analyzed twice");
      const version=pin.value,plan=version.definition.sampleOrDurationPlan,analysisId=randomUUID(),outcomes:ExperimentOutcome[]=[],pendingEdges=new Map<string,ReturnType<typeof experimentEdges>>();
      const metrics=version.metricPins.filter(p=>p.role!=="invariant"),definitions=new Map<string,Awaited<ReturnType<ReturnType<typeof businessMetricService>["inspectPublishedDefinition"]>>>();
      for(const metric of metrics)definitions.set(metric.key,await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,metric.metricId,metric.metricVersionId));
      // Lock all current ITT sources before the common actual database capture
      // time. Never substitute status at horizon end for this current snapshot.
      const sources=new Map<string,Awaited<ReturnType<typeof nativeExperimentUnit>>>();
      for(const assignment of receipts.assignments){experimentBudget(deadline);sources.set(assignment.id,await nativeExperimentUnit(tx,companyId,actor,version,assignment.unitId));}
      const at=await experimentStatementTime(tx);
      if(receipts.completion.reason==="fixed_horizon"&&at.getTime()<Date.parse(plan.until))throw conflict("The preregistered fixed horizon has not elapsed");
      if(receipts.completion.reason==="fixed_horizon")for(const assignment of receipts.assignments){
        const source=sources.get(assignment.id)!, inherited=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,assignment.lineageManifestId))).limit(261);
        const edges=experimentEdges([...inherited,...source.edges]);
        for(const metric of metrics){
          experimentBudget(deadline);const calculated=calculateNativeMetric(definitions.get(metric.key)!.version.definition,{metricId:metric.metricId,versionId:metric.metricVersionId,from:plan.from,until:plan.until,dimensions:[],maxRows:1},[source.snapshot]);
          if(calculated.status!=="observed"||calculated.value!==0&&calculated.value!==1)throw conflict("Every assigned unit requires exact binary native outcomes; no unit may be dropped");
          const value:ExperimentOutcome={id:randomUUID(),companyId,experimentId:id,versionId:version.id,analysisId,assignmentId:assignment.id,key:metric.key,metricId:metric.metricId,metricVersionId:metric.metricVersionId,value:calculated.value,sourceSnapshot:source.snapshot,inputHash:calculated.inputHash,sourceHash:nativeSha256({snapshot:source.snapshot,metricHash:metric.contentHash,inputHash:calculated.inputHash,value:calculated.value}),lineageManifestId:randomUUID(),receiptHash:"",signature:"",capturedAt:at};
          Object.assign(value,signedExperimentReceipt("outcome",experimentOutcomeMaterial(value,assignment.receiptHash,version.contentHash)));outcomes.push(value);pendingEdges.set(value.id,edges);
        }
      }
      const [review]=await tx.select().from(businessExperimentTransitions).where(eq(businessExperimentTransitions.id,receipts.execution.reviewTransitionId)).for("share");
      if(!review)throw notFound("The exact native readiness review is unavailable");
      const capture=experimentCapture(version,receipts,review.createdAt,outcomes,at),result=evaluateNativeBusinessExperiment(version.definition,capture);
      const analysis:ExperimentAnalysis={id:analysisId,companyId,experimentId:id,versionId:version.id,definitionHash:version.contentHash,capture,result,invariantDiagnostics:experimentInvariantDiagnostics(version,receipts.assignments),receiptHash:"",signature:"",analyzedBy:v7HumanActorId(actor),analyzedAt:at};
      Object.assign(analysis,signedExperimentReceipt("analysis",experimentAnalysisMaterial(analysis,receipts.completion.receiptHash)));
      const updated=await transitionExperimentRecording(tx,companyId,actor,row,"analyzing","Native immutable fixed-protocol final analysis awaiting explicit human interpretation",at);
      await tx.insert(businessExperimentAnalyses).values(analysis);
      for(const outcome of outcomes){const edges=pendingEdges.get(outcome.id)!;
        await tx.insert(analyticalLineageManifests).values({id:outcome.lineageManifestId,companyId,analysisType:"experiment_outcome",analysisRef:outcome.id,engineVersion:EXPERIMENT_OWNER_ENGINE,definitionHash:version.contentHash,inputHash:outcome.sourceHash,requestedBy:v7HumanActorId(actor),sourceWatermark:outcome.sourceSnapshot.updatedAt,sourceCount:edges.length,parameters:{receiptHash:outcome.receiptHash,lineageHash:nativeSha256(edges)},createdAt:at,expiresAt:version.expiresAt});
        await tx.insert(analyticalLineageEdges).values(edges.map(edge=>({...edge,companyId,manifestId:outcome.lineageManifestId})));await tx.insert(businessExperimentOutcomes).values(outcome);
      }
      await auditBusinessExperiment(tx,publications,companyId,actor,id,"analyzed",{versionId:version.id,analysisId,receiptHash:analysis.receiptHash,status:result.status});experimentBudget(deadline);
      return {experiment:businessExperimentRootView(updated),analysis:experimentAnalysisView(analysis,receipts.completion,true)};
    });
  },
  async interpret(companyId:string,actor:AuthorizationActor,id:string,raw:Parameters<typeof interpretBusinessExperimentSchema.parse>[0]){
    const input=interpretBusinessExperimentSchema.parse(raw);
    return withV7ActivityTransaction(db,async(tx,publications)=>{
      await admitBusinessExperiment(tx,companyId,actor,true);const row=await lockBusinessExperimentRoot(tx,companyId,id),deadline=performance.now()+30_000;
      if(row.revision!==input.expectedRevision||row.currentVersionId!==input.versionId||row.state!=="analyzing")throw conflict("Human interpretation requires the exact analyzed version/revision");
      const pin=await inspectBusinessExperimentVersion(tx,row,actor,input.versionId,true,deadline),analysis=pin.receipts.analysis;
      if(!analysis||analysis.id!==input.analysisId||pin.receipts.interpretation)throw conflict("Human interpretation requires the exact immutable analysis");
      if(input.conclusion==="ship_candidate"&&(analysis.result.status!=="pass"||!analysis.result.numericallyQualified))throw conflict("A ship candidate requires the registered primary and all guardrail bounds; inconclusive or invalid evidence must abstain");
      if(analysis.result.status==="invalid"&&input.conclusion!=="abstain")throw conflict("Invalid evidence requires an explicit abstention");
      const at=await experimentStatementTime(tx),value:ExperimentInterpretation={id:randomUUID(),companyId,experimentId:id,versionId:input.versionId,analysisId:analysis.id,conclusion:input.conclusion,rationale:input.rationale,receiptHash:"",signature:"",interpretedBy:v7HumanActorId(actor),interpretedAt:at};
      Object.assign(value,signedExperimentReceipt("interpretation",experimentInterpretationMaterial(value,analysis.receiptHash)));await tx.insert(businessExperimentInterpretations).values(value);
      const state=analysis.result.status==="invalid"?"invalid":analysis.result.status==="inconclusive"?"inconclusive":"decided";
      const updated=await transitionExperimentRecording(tx,companyId,actor,row,state,input.rationale,at);
      await auditBusinessExperiment(tx,publications,companyId,actor,id,"interpreted",{versionId:input.versionId,analysisId:analysis.id,conclusion:input.conclusion,executionAuthority:"advisory_only",receiptHash:value.receiptHash});
      return {experiment:businessExperimentRootView(updated),interpretation:experimentInterpretationView(value)};
    });
  },
};}
