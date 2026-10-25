import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { businessExperimentAnalyses,businessExperimentInterpretations,businessExperimentOutcomes,businessExperimentTransitions,type Db } from "@paperclipai/db";
import { analyzeBusinessExperimentSchema,interpretBusinessExperimentSchema } from "@paperclipai/shared";
import type { BusinessMetricQuery } from "@paperclipai/shared";
import { conflict,notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { v7HumanActorId } from "../v7-authorization.js";
import { withV7ActivityTransaction } from "../v7-mutations.js";
import { canonicalNativeJson, nativeSha256 } from "../native-runtime/canonical.js";
import { businessMetricService } from "../business-metrics/service.js";
import { prepareNativeMetric, prepareNativeMetricInput } from "../business-metrics/native-engine.js";
import { admitBusinessExperiment,lockBusinessExperimentRoot,inspectBusinessExperimentVersion,businessExperimentRootView,auditBusinessExperiment } from "./service.js";
import { transitionExperimentRecording } from "./recording.js";
import { EXPERIMENT_OWNER_ENGINE,experimentBudget,experimentEdges,experimentOutcomeSourceHashFromCanonicalSnapshot,experimentStatementTime,signedExperimentReceipt } from "./receipts.js";
import { evaluateNativeBusinessExperiment } from "./kernel.js";
import { experimentCapture,experimentInvariantDiagnostics,experimentAnalysisMaterial,experimentOutcomeMaterial,experimentInterpretationMaterial,experimentAnalysisView,experimentInterpretationView,type ExperimentAnalysis,type ExperimentOutcome,type ExperimentInterpretation } from "./results.js";
/** Sole final native capture owner. Commands supply identities/CAS only; never
 * pasted outcomes, public arms, integrity booleans or caller-chosen results. */
export function businessExperimentAnalysisService(db:Db){return {
  async analyze(companyId:string,actor:AuthorizationActor,id:string,raw:Parameters<typeof analyzeBusinessExperimentSchema.parse>[0]){
    const input=analyzeBusinessExperimentSchema.parse(raw);
    const serviceStarted=performance.now();
    const result=await withV7ActivityTransaction(db,async(tx,publications)=>{
      const admissionStarted=performance.now();
      await admitBusinessExperiment(tx,companyId,actor,true);const row=await lockBusinessExperimentRoot(tx,companyId,id),deadline=performance.now()+30_000;
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"admit_and_lock",ms:Math.round(performance.now()-admissionStarted)})}\n`);
      if(row.revision!==input.expectedRevision||row.currentVersionId!==input.versionId||row.state!=="completed")throw conflict("A single final analysis requires the exact completed protocol and revision");
      const sourceReviewStarted=performance.now();
      const pin=await inspectBusinessExperimentVersion(tx,row,actor,input.versionId,true,deadline),receipts=pin.receipts;
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"source_review",ms:Math.round(performance.now()-sourceReviewStarted),units:receipts.assignments.length})}\n`);
      if(!receipts.execution||!receipts.completion||receipts.analysis)throw conflict("An exact recording/completion is required and cannot be analyzed twice");
      const version=pin.value,plan=version.definition.sampleOrDurationPlan,analysisId=randomUUID(),outcomes:ExperimentOutcome[]=[],pendingEdges=new Map<string,{direct:ReturnType<typeof experimentEdges>;assignmentManifestId:string;assignmentLineageHash:string;completeLineageHash:string;lineageHash:string}>();
      const metrics=version.metricPins.filter(p=>p.role!=="invariant"),definitions=new Map<string,Awaited<ReturnType<ReturnType<typeof businessMetricService>["inspectPublishedDefinition"]>>>();
      for(const metric of metrics)definitions.set(metric.key,await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,metric.metricId,metric.metricVersionId));
      const metricQuery:BusinessMetricQuery={metricId:metrics[0]?.metricId??input.versionId,versionId:metrics[0]?.metricVersionId??input.versionId,from:plan.from,until:plan.until,dimensions:[],maxRows:1};
      const calculations=new Map(metrics.map(metric=>[metric.key,prepareNativeMetric(definitions.get(metric.key)!.version.definition,{...metricQuery,metricId:metric.metricId,versionId:metric.metricVersionId})]));
      // Lock all current ITT sources before the common actual database capture
      // time. Never substitute status at horizon end for this current snapshot.
      // The receipt owner just admitted and share-locked every actual current
      // unit in this same transaction. Reuse those current native rows, never
      // the historical assignment snapshot or a caller-supplied measurement.
      const sources=receipts.currentUnits;
      const at=await experimentStatementTime(tx);
      const computeStarted=performance.now();
      if(receipts.completion.reason==="fixed_horizon"&&at.getTime()<Date.parse(plan.until))throw conflict("The preregistered fixed horizon has not elapsed");
      if(receipts.completion.reason==="fixed_horizon")for(const assignment of receipts.assignments){
        const source=sources.get(assignment.id), inherited=receipts.assignmentLineage.get(assignment.lineageManifestId);
        if(!source||!inherited)throw notFound("Experiment complete current assignment Source lineage is unavailable");
        // The immutable assignment FK already owns the complete registered
        // Source lineage. Retain only current final-capture edges here and
        // bind the inherited manifest/hashes, rather than copying its same
        // protocol edges into every one of the seventeen outcomes.
        const direct=experimentEdges(source.edges),lineage={direct,assignmentManifestId:assignment.lineageManifestId,assignmentLineageHash:nativeSha256(experimentEdges(inherited)),completeLineageHash:nativeSha256(experimentEdges([...inherited,...direct])),lineageHash:nativeSha256(direct)};
        const preparedInput=prepareNativeMetricInput(metricQuery,[source.snapshot]);
        const snapshotCanonical=canonicalNativeJson(source.snapshot);
        for(const metric of metrics){
          experimentBudget(deadline);const calculated=calculations.get(metric.key)!(preparedInput);
          if(calculated.status!=="observed"||calculated.value!==0&&calculated.value!==1)throw conflict("Every assigned unit requires exact binary native outcomes; no unit may be dropped");
          const sourceHash=experimentOutcomeSourceHashFromCanonicalSnapshot(snapshotCanonical,metric.contentHash,calculated.inputHash,calculated.value);
          const value:ExperimentOutcome={id:randomUUID(),companyId,experimentId:id,versionId:version.id,analysisId,assignmentId:assignment.id,key:metric.key,metricId:metric.metricId,metricVersionId:metric.metricVersionId,value:calculated.value,sourceSnapshot:source.snapshot,inputHash:calculated.inputHash,sourceHash,lineageManifestId:randomUUID(),receiptHash:"",signature:"",capturedAt:at};
          Object.assign(value,signedExperimentReceipt("outcome",experimentOutcomeMaterial(value,assignment.receiptHash,version.contentHash)));outcomes.push(value);pendingEdges.set(value.id,lineage);
        }
      }
      const [review]=await tx.select().from(businessExperimentTransitions).where(eq(businessExperimentTransitions.id,receipts.execution.reviewTransitionId)).for("share");
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"outcome_compute",ms:Math.round(performance.now()-computeStarted),outcomes:outcomes.length})}\n`);
      if(!review)throw notFound("The exact native readiness review is unavailable");
      const captureStarted=performance.now();
      const capture=experimentCapture(version,receipts,review.createdAt,outcomes,at),result=evaluateNativeBusinessExperiment(version.definition,capture);
      const analysis:ExperimentAnalysis={id:analysisId,companyId,experimentId:id,versionId:version.id,definitionHash:version.contentHash,capture,result,invariantDiagnostics:experimentInvariantDiagnostics(version,receipts.assignments),receiptHash:"",signature:"",analyzedBy:v7HumanActorId(actor),analyzedAt:at};
      Object.assign(analysis,signedExperimentReceipt("analysis",experimentAnalysisMaterial(analysis,receipts.completion.receiptHash)));
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"capture_and_analysis_sign",ms:Math.round(performance.now()-captureStarted)})}\n`);
      const publishStarted=performance.now();
      const updated=await transitionExperimentRecording(tx,companyId,actor,row,"analyzing","Native immutable fixed-protocol final analysis awaiting explicit human interpretation",at);
      await tx.insert(businessExperimentAnalyses).values(analysis);
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"transition_and_analysis_insert",ms:Math.round(performance.now()-publishStarted)})}\n`);
      // Transport the complete signed capture in bounded groups. Every manifest,
      // direct edge and outcome still enters its original native table and guards
      // in the same transaction; no result or source is sampled or omitted.
      // Bind this capture's already signed tenant/protocol/time constants once
      // per statement, rather than serializing them into all 68,000 JSON rows.
      // Per-row identities, snapshots, pins, hashes and signatures remain exact.
      const outcomeBatchSize=4000;
      for(let offset=0;offset<outcomes.length;offset+=outcomeBatchSize){
        experimentBudget(deadline);const group=outcomes.slice(offset,offset+outcomeBatchSize);
        const prepStarted=performance.now();
        const manifests=group.map(outcome=>{const lineage=pendingEdges.get(outcome.id)!,edges=lineage.direct;return {id:outcome.lineageManifestId,analysis_ref:outcome.id,input_hash:outcome.sourceHash,source_watermark:outcome.sourceSnapshot.updatedAt,source_count:edges.length,parameters_json:{receiptHash:outcome.receiptHash,lineageHash:lineage.lineageHash,assignmentManifestId:lineage.assignmentManifestId,assignmentLineageHash:lineage.assignmentLineageHash,completeLineageHash:lineage.completeLineageHash}};});
        const manifestPayload=JSON.stringify(manifests);
        const manifestPrepareMs=performance.now()-prepStarted,manifestDbStarted=performance.now();
        await tx.execute(sql`insert into analytical_lineage_manifests
          (id,company_id,analysis_type,analysis_ref,engine_version,input_hash,definition_hash,requested_by,source_watermark,source_count,parameters_json,created_at,expires_at)
          select m.id,${companyId}::uuid,'experiment_outcome',m.analysis_ref,${EXPERIMENT_OWNER_ENGINE},m.input_hash,
            ${version.contentHash},${analysis.analyzedBy},m.source_watermark,m.source_count,m.parameters_json,
            ${at.toISOString()}::timestamptz,${version.expiresAt.toISOString()}::timestamptz
          from json_populate_recordset(null::analytical_lineage_manifests,${manifestPayload}::json) m`);
        process.stdout.write(`Experiment batch ${JSON.stringify({offset,phase:"manifest",prepareMs:Math.round(manifestPrepareMs),dbMs:Math.round(performance.now()-manifestDbStarted)})}\n`);

        const edgePrepStarted=performance.now();
        const batchEdges=group.flatMap(outcome=>pendingEdges.get(outcome.id)!.direct.map(edge=>({manifest_id:outcome.lineageManifestId,input_type:edge.inputType,input_ref:edge.inputRef,input_hash:edge.inputHash,relationship:edge.relationship})));
        const edgePayload=JSON.stringify(batchEdges),edgePrepareMs=performance.now()-edgePrepStarted,edgeDbStarted=performance.now();
        await tx.execute(sql`insert into analytical_lineage_edges (company_id,manifest_id,input_type,input_ref,input_hash,relationship)
          select ${companyId}::uuid,e.manifest_id,e.input_type,e.input_ref,e.input_hash,e.relationship
          from json_populate_recordset(null::analytical_lineage_edges,${edgePayload}::json) e`);
        process.stdout.write(`Experiment batch ${JSON.stringify({offset,phase:"edges",prepareMs:Math.round(edgePrepareMs),dbMs:Math.round(performance.now()-edgeDbStarted)})}\n`);

        const outcomePrepStarted=performance.now();
        const rows=group.map(outcome=>({id:outcome.id,assignment_id:outcome.assignmentId,metric_key:outcome.key,metric_id:outcome.metricId,metric_version_id:outcome.metricVersionId,value:outcome.value,source_snapshot_json:outcome.sourceSnapshot,input_hash:outcome.inputHash,source_hash:outcome.sourceHash,lineage_manifest_id:outcome.lineageManifestId,receipt_hash:outcome.receiptHash,signature:outcome.signature}));
        const outcomePayload=JSON.stringify(rows),outcomePrepareMs=performance.now()-outcomePrepStarted,outcomeDbStarted=performance.now();
        await tx.execute(sql`insert into business_experiment_outcomes
          (id,company_id,experiment_id,version_id,analysis_id,assignment_id,metric_key,metric_id,metric_version_id,value,source_snapshot_json,input_hash,source_hash,lineage_manifest_id,receipt_hash,signature,captured_at)
          select o.id,${companyId}::uuid,${id}::uuid,${version.id}::uuid,${analysisId}::uuid,o.assignment_id,
            o.metric_key,o.metric_id,o.metric_version_id,o.value,o.source_snapshot_json,o.input_hash,o.source_hash,
            o.lineage_manifest_id,o.receipt_hash,o.signature,${at.toISOString()}::timestamptz
          from json_populate_recordset(null::business_experiment_outcomes,${outcomePayload}::json) o`);
        process.stdout.write(`Experiment batch ${JSON.stringify({offset,phase:"outcomes",prepareMs:Math.round(outcomePrepareMs),dbMs:Math.round(performance.now()-outcomeDbStarted)})}\n`);

      }
      await auditBusinessExperiment(tx,publications,companyId,actor,id,"analyzed",{versionId:version.id,analysisId,receiptHash:analysis.receiptHash,status:result.status});
      experimentBudget(deadline);
      process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"before_commit",ms:Math.round(performance.now()-serviceStarted)})}\n`);
      if(Math.min(version.expiresAt.getTime(),pin.source.expiresAt.getTime())<=Date.now())throw conflict("Experiment current Source expired before final capture completed");
      return {experiment:businessExperimentRootView(updated),analysis:experimentAnalysisView(analysis,receipts.completion,true)};
    });
    process.stdout.write(`Experiment capture stage ${JSON.stringify({stage:"service_total_including_commit",ms:Math.round(performance.now()-serviceStarted)})}\n`);
    return result;
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
