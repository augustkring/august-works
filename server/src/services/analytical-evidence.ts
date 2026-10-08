import { and, eq } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, analyticalSourceSuppressions, businessMetricObservations, businessMetricVersions, processAnalysisRuns, processAnalysisVersions, type Db } from "@paperclipai/db";
import type { CapturedDecisionEvidence, DecisionEvidenceReference } from "@paperclipai/shared";
import type { AuthorizationActor } from "./authorization.js";
import { conflict, forbidden, unprocessable } from "../errors.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { assertAnalyticalSourcesNotErased } from "./analytical-privacy.js";
import { authorizeStrategyReference } from "./strategy-execution/references.js";
import { assertV7Authorization } from "./v7-authorization.js";
import { processFindingService } from "./process-findings.js";
import { inspectBusinessForecastRun } from "./business-forecasting/service.js";
import { inspectBusinessScenarioRun } from "./business-scenarios/service.js";
import { experimentInterpretationView } from "./business-experiments/results.js";
import { inspectBusinessExperimentEvidence } from "./business-experiments/evidence.js";
import { inspectCausalClaimEvidence } from "./causal-claims/service.js";
export type AnalyticalEvidenceEdge = Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
type Edge = AnalyticalEvidenceEdge;
const DAY=86_400_000, EDGE_BUDGET=20_065;
function checkTime(deadline:number) { if(performance.now()>deadline) throw unprocessable("Analytical evidence inspection exceeded its bounded source budget"); }
/** Private shared native capture. The caller must hold company then Memory locks,
 * admit its actor/feature/current destination purpose, and bind its own authority.
 * Native source owners admit every exact source; copied public facts are excluded.
 * historicalQualification permits only currently authorized retained sources;
 * freshness is returned separately and never upgrades new downstream reliance.
 * Reusing this capture never supplies a Decision choice or verified Task outcome. */
export async function captureAnalyticalEvidence(tx:Db,companyId:string,actor:AuthorizationActor,definition:{sensitivity:"internal"|"confidential";retentionDays:number;evidence:Array<{key:string;source:DecisionEvidenceReference}>},deadline:number,historicalQualification=false) {
 let sourceSensitivity:"internal"|"confidential"="internal";
 const retainSensitivity=(value:string)=>{if(value==="confidential")sourceSensitivity="confidential";};
 const now=new Date(),edges=new Map<string,Edge>(),evidence:CapturedDecisionEvidence[]=[],manifestIds=new Set<string>(),revalidationRequiredEvidenceKeys:string[]=[];
 let expiresAt=new Date(now.getTime()+definition.retentionDays*DAY);
 const inspectedMetricObjects=new Set<string>();
 function edge(value:Edge) {
  value={inputType:value.inputType,inputRef:value.inputRef,inputHash:value.inputHash,relationship:value.relationship};
  const key=`${value.inputType}:${value.inputRef}`;
  if(value.inputType==="issue"||value.inputType==="project") value={...value,inputHash:nativeSha256({type:value.inputType,id:value.inputRef})};
  const old=edges.get(key);if(old&&old.inputHash!==value.inputHash)throw conflict("Evidence pins disagree about a native source version");
  edges.set(key,value);if(edges.size>EDGE_BUDGET)throw unprocessable("Analytical evidence exceeds its native source budget");
 }
  for(const link of definition.evidence) {
    checkTime(deadline);let manifestId:string,facts:CapturedDecisionEvidence["facts"],sourceHash:string,sourceExpiry:Date,limitations:string[];
    const ref=link.source;
    if(ref.type==="metric_observation") {
      const admitted=await authorizeStrategyReference(tx,companyId,actor,ref,definition.sensitivity);
      const result=admitted.metricObservation;
      if(!result)throw conflict("The original metric owner did not admit this exact observation");
      const [observation]=await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId,companyId),eq(businessMetricObservations.id,ref.id))).for("share");
      if(!observation || observation.metricId!==ref.metricId || observation.versionId!==ref.metricVersionId) throw conflict("Exact metric observation pins are unavailable");
      const [metricVersion]=await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId,companyId),eq(businessMetricVersions.metricId,ref.metricId),eq(businessMetricVersions.id,ref.metricVersionId))).for("share");
      if(!metricVersion) throw conflict("Metric evidence definition is unavailable");
      retainSensitivity(metricVersion.definition.sensitivity);
      manifestId=observation.lineageManifestId;sourceExpiry=observation.expiresAt;sourceHash=nativeSha256(result);
      facts={value:result.value,status:result.status,unit:metricVersion.definition.unit,from:result.from,until:result.until,asOf:result.asOf};
      limitations=["Frozen measurement of the declared native population and observation window; no causal attribution.","Native population status is observed at capture, not reconstructed at a historical period boundary."];
    } else if(ref.type==="process_finding") {
      const {finding}=await processFindingService(tx).detail(companyId,actor,ref.definitionId,ref.runId,ref.id);
      const [run]=await tx.select().from(processAnalysisRuns).where(and(eq(processAnalysisRuns.companyId,companyId),eq(processAnalysisRuns.id,ref.runId),eq(processAnalysisRuns.definitionId,ref.definitionId))).for("share");
      const [version]=run?await tx.select().from(processAnalysisVersions).where(and(eq(processAnalysisVersions.companyId,companyId),eq(processAnalysisVersions.id,run.versionId))).for("share"):[];
      if(!run || !version) throw conflict("Native process finding pins are unavailable");
      retainSensitivity(version.definition.sensitivity);
      manifestId=run.lineageManifestId;sourceExpiry=new Date(finding.expiresAt);sourceHash=nativeSha256({findingHash:finding.contentHash,status:finding.status,version:finding.version});
      facts={findingStatus:finding.status,findingVersion:finding.version,findingType:finding.findingType,severity:finding.severity,interpretation:finding.interpretation,summary:finding.summary,...finding.facts.observed};
      limitations=[...finding.facts.limitations,"The human interpretation and admitted facts were captured before the choice; later lifecycle changes do not rewrite them."];
    } else if(ref.type==="forecast_run") {
      const source=await inspectBusinessForecastRun(tx,companyId,actor,ref.specId,ref.versionId,ref.id,!historicalQualification),point=source.view.result.points[ref.pointIndex];
      retainSensitivity(source.forecastDefinition.sensitivity);
      if(source.view.currentQualification!=="qualified")revalidationRequiredEvidenceKeys.push(link.key);
      if(!point || source.view.result.status!=="qualified") throw conflict("Exact qualified forecast point is unavailable");
      if(definition.sensitivity==="internal" && source.forecastDefinition.sensitivity==="confidential") throw forbidden("Confidential forecast evidence cannot be downgraded");
      manifestId=source.lineageManifestId;sourceExpiry=new Date(source.view.expiresAt);sourceHash=nativeSha256({runContentHash:source.view.contentHash,pointIndex:ref.pointIndex,point});
      facts={value:point.value,from:point.from,until:point.until,unit:source.metricDefinition.unit,status:source.view.result.status,cutoff:source.view.cutoff,intervalLower:point.interval?.lower??null,intervalUpper:point.interval?.upper??null,calibration:"not_assessed",
        ...(point.interval?{intervalMethod:point.interval.method,intervalLevel:point.interval.level,intervalLower80:point.interval.level80.lower,intervalUpper80:point.interval.level80.upper}:{})};
      limitations=[...source.view.result.limitations,"A forecast estimates a future metric under its time-safe model; it is not an observed outcome or a causal effect."];
    } else if(ref.type==="scenario_run") {
      const source=await inspectBusinessScenarioRun(tx,companyId,actor,ref.scenarioId,ref.versionId,ref.id,!historicalQualification),scenarioCase=source.view.result.cases.find(item=>item.key===ref.caseKey),output=scenarioCase?.outputs.find(item=>item.key===ref.outputKey);
      retainSensitivity(source.definition.sensitivity);
      if(source.view.currentQualification!=="current")revalidationRequiredEvidenceKeys.push(link.key);
      if(!output || source.view.result.status==="data_not_ready") throw conflict("Exact retained scenario output is unavailable");
      if(definition.sensitivity==="internal" && source.definition.sensitivity==="confidential") throw forbidden("Confidential scenario evidence cannot be downgraded");
      manifestId=source.lineageManifestId;sourceExpiry=new Date(source.view.expiresAt);sourceHash=nativeSha256({runContentHash:source.view.contentHash,caseKey:ref.caseKey,outputKey:ref.outputKey,output});
      facts={nominal:output.nominal,differenceFromBase:output.differenceFromBase,unit:JSON.stringify(output.unit),caseKind:scenarioCase!.kind,status:source.view.result.status,constraint:output.constraint,p10:output.simulation?.p10??null,median:output.simulation?.median??null,p90:output.simulation?.p90??null,uncertaintyMethod:source.view.result.uncertainty.method,uncertaintyQualification:source.view.result.uncertainty.qualification};
      limitations=[...source.view.result.limitations,"This selected scenario output is conditional on its frozen human assumptions; it is not a measured actual, causal effect or commitment."];
    } else if(ref.type==="causal_analysis") {
      const source=await inspectCausalClaimEvidence(tx,companyId,actor,ref,!historicalQualification,deadline);
      if(definition.sensitivity==="internal"&&source.definition.sensitivity==="confidential")throw forbidden("Confidential causal evidence cannot be downgraded");
      sourceExpiry=source.expiresAt;sourceHash=source.sourceHash;const result=source.view.result;retainSensitivity(source.definition.sensitivity);
      if(source.view.currentQualification!=="current")revalidationRequiredEvidenceKeys.push(link.key);
      facts={status:result.status,evidenceGrade:result.evidenceGrade,identification:result.identification.status,executionAuthority:"advisory_only",effect:result.estimate?.effect??null,intervalLower:result.estimate?.interval.lower??null,intervalUpper:result.estimate?.interval.upper??null,unit:result.estimate?.unit??null,sensitivity:result.robustness.sensitivity,providerRefutations:result.robustness.providerRefutations};
      limitations=[...result.limitations,"A separately reviewed conditional causal interpretation remains advisory evidence, not a measured actual, verified task outcome or choice authorization."];
      for(const id of source.manifestIds)manifestIds.add(id);
      for(const inherited of source.edges){checkTime(deadline);edge(inherited);}
      expiresAt=new Date(Math.min(expiresAt.getTime(),sourceExpiry.getTime()));
      evidence.push({key:link.key,source:ref,sourceHash,capturedAt:now.toISOString(),expiresAt:sourceExpiry.toISOString(),facts,limitations,causal:{definition:source.definition,run:source.view,review:source.review}});continue;
    } else {
      const source=await inspectBusinessExperimentEvidence(tx,companyId,actor,ref,!historicalQualification,deadline);
      if(definition.sensitivity==="internal" && source.definition.sensitivity==="confidential") throw forbidden("Confidential experiment evidence cannot be downgraded");
      retainSensitivity(source.definition.sensitivity);
      if(source.view.currentQualification!=="current")revalidationRequiredEvidenceKeys.push(link.key);
      const result=source.view.result, primary=result.metrics.find(metric=>metric.role==="primary");
      sourceExpiry=source.expiresAt;sourceHash=source.sourceHash;
      facts={status:result.status,causalAuthority:source.view.causalAuthority,numericalQualification:result.numericallyQualified?"qualified":"withheld",humanConclusion:source.interpretation.conclusion,executionAuthority:"advisory_only",assignedUnits:result.diagnostics.assigned,reportedExposedUnits:result.diagnostics.exposed,primaryDifference:primary?.effect??null,primaryIntervalLower:primary?.interval?.lower??null,primaryIntervalUpper:primary?.interval?.upper??null,differenceUnit:"fraction_difference",analyzedAt:source.view.analyzedAt,exposureProvenance:source.view.exposureProvenance,outcomeTimeSemantics:source.view.outcomeTimeSemantics};
      limitations=[...result.limitations,"This native status proxy and human exposure/concurrent-change attestations provide conditional advisory evidence; they do not establish verified intervention, business impact or execution authority.",...result.reasons];
      for(const id of source.manifestIds)manifestIds.add(id);
      for(const inherited of source.edges){checkTime(deadline);edge(inherited);}
      expiresAt=new Date(Math.min(expiresAt.getTime(),sourceExpiry.getTime()));
      evidence.push({key:link.key,source:ref,sourceHash,capturedAt:now.toISOString(),expiresAt:sourceExpiry.toISOString(),facts,limitations,experiment:{analysis:source.view,registeredMetrics:{primaryMetric:source.definition.primaryMetric,guardrailMetrics:source.definition.guardrailMetrics,secondaryMetrics:source.definition.secondaryMetrics,diagnostics:source.definition.diagnostics},interpretation:experimentInterpretationView(source.interpretation)}});
      continue;
    }
    manifestIds.add(manifestId);
    const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,manifestId))).for("share");
    const inherited=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,manifestId))).limit(EDGE_BUDGET+1);
    if(!manifest || inherited.length>EDGE_BUDGET) throw conflict("Native evidence lineage is unavailable");
    for(const source of inherited) {checkTime(deadline);edge(source);
      // The original metric owner just reauthorized and share-locked every
      // complete lineage object and its current project ancestry. Do not scan
      // those same objects again in this capture. No permission is cached
      // across captures, transactions, actors or other analytical owners.
      if(ref.type==="metric_observation"&&(source.inputType==="issue"||source.inputType==="project"))inspectedMetricObjects.add(`${source.inputType}:${source.inputRef}`);
    }
    expiresAt=new Date(Math.min(expiresAt.getTime(),sourceExpiry.getTime(),manifest.expiresAt.getTime()));
    evidence.push({key:link.key,source:ref,sourceHash,capturedAt:now.toISOString(),expiresAt:sourceExpiry.toISOString(),facts,limitations});
  }
 const lineage=[...edges.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
 await inspectAnalyticalEvidenceAuthority(tx,companyId,actor,lineage.filter(source=>!inspectedMetricObjects.has(`${source.inputType}:${source.inputRef}`)),deadline);
 return {sourceSensitivity:sourceSensitivity as "internal"|"confidential",evidence,edges:lineage,manifestIds:[...manifestIds].sort(),now,expiresAt,revalidationRequiredEvidenceKeys};
}
export async function inspectAnalyticalEvidenceAuthority(tx:Db,companyId:string,actor:AuthorizationActor,edges:Edge[],deadline:number) {
  for (const edge of edges.filter(edge => edge.inputType === "goal")) {
    checkTime(deadline); await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    await authorizeStrategyReference(tx, companyId, actor, { type: "goal", id: edge.inputRef }, "confidential");
    if ((await tx.select({ id: analyticalSourceSuppressions.inputRef }).from(analyticalSourceSuppressions).where(and(eq(analyticalSourceSuppressions.companyId, companyId), eq(analyticalSourceSuppressions.inputType, "goal"), eq(analyticalSourceSuppressions.inputRef, edge.inputRef))).limit(1)).length) throw conflict("An analytical Goal source was erased");
  }
  const objects=edges.flatMap(edge=>edge.inputType==="issue" || edge.inputType==="project"?[{objectType:edge.inputType,objectId:edge.inputRef,qualifier:"related" as const}]:[]);
  // Reuse the source owner's current hidden-task, project and suppression
  // admission. Current project ancestry remains separate from recorded facts.
  const issueIds=new Set<string>(),projectIds=new Set<string>();
  for(const object of objects) {
    checkTime(deadline);const current=await authorizeStrategyReference(tx,companyId,actor,{type:object.objectType,id:object.objectId},"confidential");
    for(const id of current.issueIds) issueIds.add(id);for(const id of current.projectIds) projectIds.add(id);
  }
  checkTime(deadline);await assertAnalyticalSourcesNotErased(tx,companyId,[...issueIds],[...projectIds]);
}
