import { randomUUID } from "node:crypto";
import { captureAnalyticalEvidence, inspectAnalyticalEvidenceAuthority as inspectAuthorityEdges } from "./analytical-evidence.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests,
  companyMemberships, decisionContexts, decisionContextVersions, decisionContextPreparations, decisionContextBindings,
  decisionEvidenceLinks, decisionCalculationPins, decisionExperimentPins, decisionCausalPins, decisionAssumptions, decisionCriteria, decisionExpectedOutcomes, decisions, type Db } from "@paperclipai/db";
import { decisionContextDefinitionSchema, proposeDecisionContextSchema, prepareDecisionContextSchema, withdrawPreparedDecisionContextSchema,
  v7FeatureEnabled, v8FeatureEnabled, type CapturedDecisionEvidence, type DecisionContextDefinition, type DecisionContextView,
  type ProposeDecisionContext, type PrepareDecisionContext, type WithdrawPreparedDecisionContext } from "@paperclipai/shared";
import type { AuthorizationActor } from "./authorization.js";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { assertV7Authorization, v7HumanActorId } from "./v7-authorization.js";
import { instanceSettingsService } from "./instance-settings.js";
import { lockAnalyticalCompany, assertAnalyticalSourcesNotErased } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "./analytical-purpose.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { authorizeStrategyReference } from "./strategy-execution/references.js";
import { businessMetricService } from "./business-metrics/service.js";
import { processAnalysisService } from "./process-analysis.js";
import { inspectBusinessForecastRun } from "./business-forecasting/service.js";
import { inspectBusinessScenarioRun } from "./business-scenarios/service.js";
import { experimentInterpretationView } from "./business-experiments/results.js";
import { inspectBusinessExperimentEvidence } from "./business-experiments/evidence.js";
import { inspectCausalClaimEvidence } from "./causal-claims/service.js";
import { logActivity, withV7ActivityTransaction } from "./v7-mutations.js";
import { managementSourceOptions } from "./management-reviews/source-options.js";

type Decision = typeof decisions.$inferSelect;
type Version = typeof decisionContextVersions.$inferSelect;
type Edge = Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
const DAY=86_400_000, EDGE_BUDGET=20_065;
export function decisionContextSpecHash(row:Decision) {
  return nativeSha256({id:row.id,signedSpec:row.signedSpec,options:row.options,inputs:row.inputs,targetSnapshots:row.targetSnapshots});
}
function materialHash(row:Pick<Version,"definition"|"evidence"|"decisionSpecHash">) {
  return nativeSha256({definition:row.definition,evidence:row.evidence,decisionSpecHash:row.decisionSpecHash});
}
function checkTime(deadline:number) { if(performance.now()>deadline) throw unprocessable("Decision context inspection exceeded its bounded source budget"); }
async function locks(tx:Db,companyId:string) {
  await tx.execute(sql`set local statement_timeout='8s'`);
  await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
}
async function admission(tx:Db,companyId:string,actor:AuthorizationActor,write=false) {
  v7HumanActorId(actor);
  await assertV7Authorization(tx,actor,companyId,write?"users:manage_permissions":"company_scope:read");
  const flags=await instanceSettingsService(tx).getExperimental();
  if(!v8FeatureEnabled(flags,"decision_intelligence_v8") || !v7FeatureEnabled(flags,"governance_evidence_v7")) throw notFound("Governed decision context is not enabled");
}
async function decision(tx:Db,companyId:string,id:string) {
  const [row]=await tx.select().from(decisions).where(and(eq(decisions.companyId,companyId),eq(decisions.id,id))).for("update");
  if(!row) throw notFound("Native decision not found");return row;
}
async function decisionAuthority(tx:Db,row:Decision,actor:AuthorizationActor,sensitivity:"internal"|"confidential") {
  const ancestry=await authorizeStrategyReference(tx,row.companyId,actor,{type:"decision",id:row.id},sensitivity);
  const descendantIds=new Set<string>();
  for(const snapshot of Object.values(row.targetSnapshots)) {
    if(snapshot && typeof snapshot==="object" && "descendantIds" in snapshot && Array.isArray(snapshot.descendantIds)) {
      for(const id of snapshot.descendantIds) {
        if(typeof id!=="string") throw conflict("Native decision snapshot descendants are invalid");
        descendantIds.add(id);if(descendantIds.size>1000) throw unprocessable("Native decision context exceeds its bounded descendant authority budget");
      }
    }
  }
  const deadline=performance.now()+30_000;
  for(const id of descendantIds) {
    checkTime(deadline);const child=await authorizeStrategyReference(tx,row.companyId,actor,{type:"issue",id},sensitivity);
    ancestry.issueIds.push(...child.issueIds);ancestry.projectIds.push(...child.projectIds);
  }
  await assertAnalyticalSourcesNotErased(tx,row.companyId,ancestry.issueIds,ancestry.projectIds);
  return ancestry;
}
function open(row:Decision) { if(row.status!=="open" || row.expiresAt<=new Date()) throw conflict("Only a current open native decision can receive prospective context"); }
async function contextRoot(tx:Db,companyId:string,decisionId:string) {
  const [row]=await tx.select().from(decisionContexts).where(and(eq(decisionContexts.companyId,companyId),eq(decisionContexts.decisionId,decisionId))).for("update");return row;
}
async function pinnedVersion(tx:Db,companyId:string,decisionId:string,id:string) {
  const [row]=await tx.select().from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.decisionId,decisionId),eq(decisionContextVersions.id,id))).for("share");
  if(!row || row.expiresAt<=new Date()) throw notFound("Decision context is erased, expired or unavailable");
  if(!decisionContextDefinitionSchema.safeParse(row.definition).success || materialHash(row)!==row.contentHash) throw conflict("Decision context integrity is unavailable");
  return row;
}
async function purpose(tx:Db,companyId:string,actor:AuthorizationActor,definition:DecisionContextDefinition) {
  if(definition.ownerUserId!==v7HumanActorId(actor)) {
    const [member]=await tx.select({id:companyMemberships.id}).from(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,definition.ownerUserId),eq(companyMemberships.status,"active"))).for("share");
    if(!member) throw conflict("Decision context owner must be a current company human");
  }
  return currentAnalyticalPurpose(tx,companyId,definition,"decision");
}
async function scopeAuthority(tx:Db,companyId:string,actor:AuthorizationActor,definition:DecisionContextDefinition) {
  if(definition.scope.type==="company") return {issueIds:[],projectIds:[]};
  return authorizeStrategyReference(tx,companyId,actor,{type:definition.scope.type,id:definition.scope.id},definition.sensitivity);
}
function optionPins(row:Decision,definition:DecisionContextDefinition) {
  const options=new Set(row.options.map(option=>option.id));
  if(definition.expectedOutcomes.some(item=>!options.has(item.optionId)) || definition.evidence.some(item=>item.optionId && !options.has(item.optionId))) throw conflict("Context refers to an option outside this exact native decision");
}
/** Capture only native owner-admitted facts. Public callers cannot supply copied
 * values, timestamps, source hashes or numerical confidence. */
async function capture(tx:Db,row:Decision,actor:AuthorizationActor,definition:DecisionContextDefinition) {
  const deadline=performance.now()+30_000,policies=await purpose(tx,row.companyId,actor,definition);
  optionPins(row,definition);
  const ancestry=await decisionAuthority(tx,row,actor,definition.sensitivity),scope=await scopeAuthority(tx,row.companyId,actor,definition);
  const captured=await captureAnalyticalEvidence(tx,row.companyId,actor,definition,deadline);
  const edges=new Map<string,Edge>();
  for(const source of captured.edges) edges.set(`${source.inputType}:${source.inputRef}`,source);
  for(const id of [...ancestry.issueIds,...scope.issueIds]) edges.set(`issue:${id}`,{inputType:"issue",inputRef:id,inputHash:nativeSha256({type:"issue",id}),relationship:"source"});
  for(const id of [...ancestry.projectIds,...scope.projectIds]) edges.set(`project:${id}`,{inputType:"project",inputRef:id,inputHash:nativeSha256({type:"project",id}),relationship:"source"});
  for(const policy of policies) edges.set(`governance_obligation:${policy.id}`,{inputType:"governance_obligation",inputRef:policy.id,inputHash:policy.obligationHash,relationship:"policy"});
  if(edges.size>EDGE_BUDGET)throw unprocessable("Decision context exceeds its native source budget");
  const lineage=[...edges.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  await inspectAuthorityEdges(tx,row.companyId,actor,lineage,deadline);
  return {...captured,edges:lineage};
}

async function inspectRetained(tx:Db,row:Decision,actor:AuthorizationActor,pin:Version) {
  await purpose(tx,row.companyId,actor,pin.definition);await decisionAuthority(tx,row,actor,pin.definition.sensitivity);await scopeAuthority(tx,row.companyId,actor,pin.definition);
  const revalidationRequiredEvidenceKeys:string[]=[];
  for(const link of pin.definition.evidence) {
    if(link.source.type==="metric_observation") {
      await authorizeStrategyReference(tx,row.companyId,actor,link.source,pin.definition.sensitivity);
    } else if(link.source.type==="process_finding") {
      // Inspect current source ownership and approved process use, without
      // recomputing a historical event window or replacing captured findings.
      const source=await processAnalysisService(tx).detail(row.companyId,actor,link.source.definitionId);
      if(source.root.status!=="published" || source.reviewReason) throw conflict("Process evidence owner requires current human review");
    } else if(link.source.type==="forecast_run") {
      const ref=link.source,source=await inspectBusinessForecastRun(tx,row.companyId,actor,ref.specId,ref.versionId,ref.id,false);
      if(pin.definition.sensitivity==="internal" && source.forecastDefinition.sensitivity==="confidential") throw forbidden("Confidential forecast evidence cannot be downgraded");
      const point=source.view.result.points[ref.pointIndex];
      if(!point || pin.evidence.find(item=>item.key===link.key)?.sourceHash!==nativeSha256({runContentHash:source.view.contentHash,pointIndex:ref.pointIndex,point})) throw notFound("Exact retained forecast evidence is unavailable");
      if(source.view.currentQualification!=="qualified") revalidationRequiredEvidenceKeys.push(link.key);
    } else if(link.source.type==="scenario_run") {
      const ref=link.source,source=await inspectBusinessScenarioRun(tx,row.companyId,actor,ref.scenarioId,ref.versionId,ref.id,false),output=source.view.result.cases.find(item=>item.key===ref.caseKey)?.outputs.find(item=>item.key===ref.outputKey);
      if(pin.definition.sensitivity==="internal" && source.definition.sensitivity==="confidential") throw forbidden("Confidential scenario evidence cannot be downgraded");
      if(!output || pin.evidence.find(item=>item.key===link.key)?.sourceHash!==nativeSha256({runContentHash:source.view.contentHash,caseKey:ref.caseKey,outputKey:ref.outputKey,output})) throw notFound("Exact retained scenario evidence is unavailable");
      if(source.view.currentQualification!=="current") revalidationRequiredEvidenceKeys.push(link.key);
    } else if(link.source.type==="causal_analysis") {
      const source=await inspectCausalClaimEvidence(tx,row.companyId,actor,link.source,false),captured=pin.evidence.find(item=>item.key===link.key);
      if(pin.definition.sensitivity==="internal"&&source.definition.sensitivity==="confidential")throw forbidden("Confidential causal evidence cannot be downgraded");
      const original={definition:source.definition,run:{...source.view,currentQualification:"current"},review:source.review};
      if(captured?.sourceHash!==source.sourceHash||nativeSha256(captured.causal??null)!==nativeSha256(original))throw notFound("Exact retained causal model/review/result is unavailable");
      if(source.view.currentQualification!=="current")revalidationRequiredEvidenceKeys.push(link.key);
    } else {
      const source=await inspectBusinessExperimentEvidence(tx,row.companyId,actor,link.source,false,performance.now()+30_000);
      if(pin.definition.sensitivity==="internal" && source.definition.sensitivity==="confidential") throw forbidden("Confidential experiment evidence cannot be downgraded");
      const captured=pin.evidence.find(item=>item.key===link.key),expected={analysis:{...source.view,currentQualification:"current",causalAuthority:source.analysis.result.numericallyQualified?"conditional_on_registered_randomization_and_human_attestations":"withheld"},registeredMetrics:{primaryMetric:source.definition.primaryMetric,guardrailMetrics:source.definition.guardrailMetrics,secondaryMetrics:source.definition.secondaryMetrics,diagnostics:source.definition.diagnostics},interpretation:experimentInterpretationView(source.interpretation)};
      if(captured?.sourceHash!==source.sourceHash || nativeSha256(captured.experiment??null)!==nativeSha256(expected)) throw notFound("Exact retained experiment analysis/interpretation is unavailable");
      if(source.view.currentQualification!=="current") revalidationRequiredEvidenceKeys.push(link.key);
    }
  }
  const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,row.companyId),eq(analyticalLineageManifests.id,pin.lineageManifestId))).for("share");
  const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,row.companyId),eq(analyticalLineageEdges.manifestId,pin.lineageManifestId))).limit(EDGE_BUDGET+1);
  const material=edges.map(({inputType,inputRef,inputHash,relationship})=>({inputType,inputRef,inputHash,relationship})).sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  if(!manifest || manifest.analysisType!=="decision_context" || manifest.analysisRef!==pin.id || manifest.expiresAt<=new Date() || manifest.inputHash!==nativeSha256(pin.evidence)
    || manifest.definitionHash!==pin.contentHash || manifest.sourceCount!==edges.length || edges.length>EDGE_BUDGET || manifest.parameters.lineageHash!==nativeSha256(material)) throw conflict("Decision context source lineage is unavailable");
  await inspectAuthorityEdges(tx,row.companyId,actor,material,performance.now()+30_000);
  const calculations=await tx.select().from(decisionCalculationPins).where(and(eq(decisionCalculationPins.companyId,row.companyId),eq(decisionCalculationPins.contextVersionId,pin.id))).for("share");
  const expected=pin.evidence.filter(item=>item.source.type==="forecast_run" || item.source.type==="scenario_run");
  if(calculations.length!==expected.length || expected.some(item=>!calculations.some(calc=>calc.decisionId===row.id && calc.key===item.key && calc.sourceHash===item.sourceHash && (item.source.type==="forecast_run"?calc.forecastRunId===item.source.id && calc.scenarioRunId===null:calc.scenarioRunId===item.source.id && calc.forecastRunId===null)))) throw notFound("Decision calculation source pins are erased or unavailable");
  const experimentPins=await tx.select().from(decisionExperimentPins).where(and(eq(decisionExperimentPins.companyId,row.companyId),eq(decisionExperimentPins.contextVersionId,pin.id))).for("share");
  const experiments=pin.evidence.filter(item=>item.source.type==="experiment_analysis");
  if(experimentPins.length!==experiments.length || experiments.some(item=>{const ref=item.source;return ref.type!=="experiment_analysis" || !experimentPins.some(p=>p.decisionId===row.id&&p.key===item.key&&p.sourceHash===item.sourceHash&&p.analysisId===ref.id&&p.experimentId===ref.experimentId&&p.experimentVersionId===ref.versionId&&p.interpretationId===ref.interpretationId);})) throw notFound("Decision experiment source pins are unavailable");
  const causalPins=await tx.select().from(decisionCausalPins).where(and(eq(decisionCausalPins.companyId,row.companyId),eq(decisionCausalPins.contextVersionId,pin.id))).for("share");
  const causal=pin.evidence.filter(item=>item.source.type==="causal_analysis");
  if(causalPins.length!==causal.length||causal.some(item=>{const ref=item.source;return ref.type!=="causal_analysis"||!causalPins.some(p=>p.decisionId===row.id&&p.key===item.key&&p.sourceHash===item.sourceHash&&p.runId===ref.id&&p.claimId===ref.claimId&&p.claimVersionId===ref.versionId&&p.reviewId===ref.reviewId);}))throw notFound("Decision causal source pins are unavailable");
  return revalidationRequiredEvidenceKeys;
  // No recomputation with today's metric values, no replacement of January's
  // process interpretation and no retrospective evidence enrichment.
}
async function inspect(tx:Db,row:Decision,actor:AuthorizationActor):Promise<DecisionContextView> {
  await decisionAuthority(tx,row,actor,"confidential");const root=await contextRoot(tx,row.companyId,row.id);
  const [binding]=await tx.select().from(decisionContextBindings).where(and(eq(decisionContextBindings.companyId,row.companyId),eq(decisionContextBindings.decisionId,row.id))).for("share");
  const rows=await tx.select().from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,row.companyId),eq(decisionContextVersions.decisionId,row.id),sql`${decisionContextVersions.expiresAt}>now()`)).orderBy(desc(decisionContextVersions.revision)).limit(6);
  const versions:DecisionContextView["versions"]=[],deadline=performance.now()+30_000;
  const selected=rows.slice(0,5);
  if(binding && !selected.some(pin=>pin.id===binding.versionId)) selected.push(await pinnedVersion(tx,row.companyId,row.id,binding.versionId));
  for(const candidate of selected) {
    checkTime(deadline);const pin=await pinnedVersion(tx,row.companyId,row.id,candidate.id),revalidationRequiredEvidenceKeys=await inspectRetained(tx,row,actor,pin);
    versions.push({id:pin.id,companyId:pin.companyId,decisionId:pin.decisionId,revision:pin.revision,definition:pin.definition,evidence:pin.evidence,contentHash:pin.contentHash,
      decisionSpecHash:pin.decisionSpecHash,createdAt:pin.createdAt.toISOString(),expiresAt:pin.expiresAt.toISOString(),
      state:binding?.versionId===pin.id?"frozen_for_decision":row.status!=="open" || pin.id!==rows[0]?.id?"superseded":"draft",revalidationRequiredEvidenceKeys});
  }
  if(binding && (row.status!=="decided" || row.chosenOptionId!==binding.optionId || !row.decidedAt || row.decidedAt.getTime()!==binding.frozenAt.getTime()
    || versions.find(pin=>pin.id===binding.versionId)?.contentHash!==binding.contextHash)) throw conflict("Frozen context no longer agrees with its native decision receipt");
  return {companyId:row.companyId,decisionId:row.id,revision:root?.revision??0,preparedVersionId:root?.preparedVersionId??null,
    binding:binding?{versionId:binding.versionId,optionId:binding.optionId,contextHash:binding.contextHash,decisionSpecHash:binding.decisionSpecHash,frozenAt:binding.frozenAt.toISOString()}:null,
    versions,hasMoreVersions:rows.length>5,authorizationCheckedAt:new Date().toISOString()};
}
/** Internal native review admission. The caller's transaction owns the same
 * company → Memory → Decision locks and inspects only the exact frozen pin. */
export async function inspectBoundDecisionContext(tx:Db,companyId:string,actor:AuthorizationActor,id:string,write=false) {
  await locks(tx,companyId);await admission(tx,companyId,actor,write);
  const row=await decision(tx,companyId,id);
  const [binding]=await tx.select().from(decisionContextBindings).where(and(eq(decisionContextBindings.companyId,companyId),eq(decisionContextBindings.decisionId,id))).for("share");
  if(!binding || row.status!=="decided" || row.chosenOptionId!==binding.optionId || !row.decidedAt || row.decidedAt.getTime()!==binding.frozenAt.getTime()) throw notFound("Outcome review requires the surviving prospective native decision binding");
  const pin=await pinnedVersion(tx,companyId,id,binding.versionId);await inspectRetained(tx,row,actor,pin);
  if(pin.contentHash!==binding.contextHash || pin.decisionSpecHash!==binding.decisionSpecHash || decisionContextSpecHash(row)!==binding.decisionSpecHash) throw conflict("Outcome review baseline no longer agrees with its native decision");
  return {decision:row,binding,version:pin};
}
export {inspectAuthorityEdges as inspectDecisionSourceAuthority};
export function decisionIntelligenceService(db:Db) {
  return {
    async scopeOptions(companyId:string,actor:AuthorizationActor,kind:"project"|"issue") { return db.transaction(async rawTx=>{const tx=rawTx as unknown as Db;await locks(tx,companyId);await admission(tx,companyId,actor);return managementSourceOptions(tx,companyId,actor,{kind});}); },
    async detail(companyId:string,actor:AuthorizationActor,id:string) {
      return db.transaction(async rawTx=>{const tx=rawTx as unknown as Db;await locks(tx,companyId);await admission(tx,companyId,actor);return inspect(tx,await decision(tx,companyId,id),actor);});
    },
    async propose(companyId:string,actor:AuthorizationActor,id:string,raw:ProposeDecisionContext) {
      const input=proposeDecisionContextSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        await locks(tx,companyId);await admission(tx,companyId,actor,true);const row=await decision(tx,companyId,id);open(row);
        let root=await contextRoot(tx,companyId,id);
        if((root?.revision??0)!==input.expectedRevision) throw conflict("Decision context revision changed; reload before proposing");
        const captured=await capture(tx,row,actor,input.definition),revision=input.expectedRevision+1;
        if(!root) [root]=await tx.insert(decisionContexts).values({companyId,decisionId:id}).returning();
        const versionId=randomUUID(),lineageManifestId=randomUUID(),decisionSpecHash=decisionContextSpecHash(row),contentHash=materialHash({definition:input.definition,evidence:captured.evidence,decisionSpecHash});
        await tx.insert(analyticalLineageManifests).values({id:lineageManifestId,companyId,analysisType:"decision_context",analysisRef:versionId,engineVersion:"aw-native-decision-context-v1",
          inputHash:nativeSha256(captured.evidence),definitionHash:contentHash,requestedBy:v7HumanActorId(actor),sourceWatermark:captured.now.toISOString(),sourceCount:captured.edges.length,
          parameters:{decisionId:id,decisionSpecHash,lineageHash:nativeSha256(captured.edges)},createdAt:captured.now,expiresAt:captured.expiresAt});
        for(let start=0;start<captured.edges.length;start+=500) await tx.insert(analyticalLineageEdges).values(captured.edges.slice(start,start+500).map(edge=>({...edge,companyId,manifestId:lineageManifestId})));
        await tx.insert(decisionContextVersions).values({id:versionId,companyId,decisionId:id,revision,definition:input.definition,evidence:captured.evidence,contentHash,decisionSpecHash,lineageManifestId,
          createdBy:v7HumanActorId(actor),createdAt:captured.now,expiresAt:captured.expiresAt});
        const fields={companyId,decisionId:id,contextVersionId:versionId};
        if(input.definition.evidence.length) await tx.insert(decisionEvidenceLinks).values(input.definition.evidence.map(payload=>({...fields,key:payload.key,payload})));
        const calculationEvidence=captured.evidence.filter(item=>item.source.type==="forecast_run" || item.source.type==="scenario_run");
        if(calculationEvidence.length) await tx.insert(decisionCalculationPins).values(calculationEvidence.map(item=>({...fields,key:item.key,sourceHash:item.sourceHash,forecastRunId:item.source.type==="forecast_run"?item.source.id:null,scenarioRunId:item.source.type==="scenario_run"?item.source.id:null})));
        for(const item of captured.evidence) if(item.source.type==="experiment_analysis") await tx.insert(decisionExperimentPins).values({...fields,key:item.key,sourceHash:item.sourceHash,experimentId:item.source.experimentId,experimentVersionId:item.source.versionId,analysisId:item.source.id,interpretationId:item.source.interpretationId});
        const causalPins=captured.evidence.flatMap(item=>item.source.type==="causal_analysis"?[{...fields,key:item.key,claimId:item.source.claimId,claimVersionId:item.source.versionId,runId:item.source.id,reviewId:item.source.reviewId,sourceHash:item.sourceHash}]:[]);
        if(causalPins.length)await tx.insert(decisionCausalPins).values(causalPins);
        if(input.definition.assumptions.length) await tx.insert(decisionAssumptions).values(input.definition.assumptions.map(payload=>({...fields,key:payload.key,payload})));
        await tx.insert(decisionCriteria).values(input.definition.criteria.map(payload=>({...fields,key:payload.key,payload})));
        await tx.insert(decisionExpectedOutcomes).values(input.definition.expectedOutcomes.map((payload,index)=>({...fields,key:String(index),payload})));
        await tx.update(decisionContexts).set({revision,preparedVersionId:null}).where(and(eq(decisionContexts.companyId,companyId),eq(decisionContexts.decisionId,id)));
        await logActivity(tx,{companyId,actorType:"user",actorId:v7HumanActorId(actor),action:"decision_context.proposed",entityType:"decision",entityId:id,details:{versionId,revision,contentHash}},publications);
        return inspect(tx,row,actor);
      });
    },
    async prepare(companyId:string,actor:AuthorizationActor,id:string,raw:PrepareDecisionContext) {
      const input=prepareDecisionContextSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        await locks(tx,companyId);await admission(tx,companyId,actor,true);const row=await decision(tx,companyId,id);open(row);const root=await contextRoot(tx,companyId,id);
        if(!root || root.revision!==input.expectedRevision) throw conflict("Decision context revision changed; reload before preparing");
        const pin=await pinnedVersion(tx,companyId,id,input.versionId);
        const [latest]=await tx.select({id:decisionContextVersions.id}).from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.decisionId,id))).orderBy(desc(decisionContextVersions.revision)).limit(1);
        if(latest?.id!==pin.id || pin.decisionSpecHash!==decisionContextSpecHash(row)) throw conflict("Prepare only the current context for this exact native decision");
        await freshPin(tx,row,actor,pin);
        const revision=root.revision+1;
        await tx.update(decisionContexts).set({revision,preparedVersionId:pin.id}).where(and(eq(decisionContexts.companyId,companyId),eq(decisionContexts.decisionId,id)));
        await tx.insert(decisionContextPreparations).values({companyId,decisionId:id,versionId:pin.id,revision,action:"prepare",rationale:input.rationale,recordedBy:v7HumanActorId(actor)});
        await logActivity(tx,{companyId,actorType:"user",actorId:v7HumanActorId(actor),action:"decision_context.prepared",entityType:"decision",entityId:id,details:{versionId:pin.id,revision}},publications);
        return inspect(tx,row,actor);
      });
    },
    async withdraw(companyId:string,actor:AuthorizationActor,id:string,raw:WithdrawPreparedDecisionContext) {
      const input=withdrawPreparedDecisionContextSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        await locks(tx,companyId);await admission(tx,companyId,actor,true);const row=await decision(tx,companyId,id);open(row);await decisionAuthority(tx,row,actor,"confidential");
        const root=await contextRoot(tx,companyId,id);if(!root || root.revision!==input.expectedRevision || !root.preparedVersionId) throw conflict("No matching prepared context can be withdrawn");
        // The receipt owns its version FK. Erased preparations need no payload
        // reconstruction; a stale UUID pointer is cleared without recreating it.
        const [retained]=await tx.select({id:decisionContextVersions.id}).from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.decisionId,id),eq(decisionContextVersions.id,root.preparedVersionId)));
        const revision=root.revision+1;
        await tx.update(decisionContexts).set({revision,preparedVersionId:null}).where(and(eq(decisionContexts.companyId,companyId),eq(decisionContexts.decisionId,id)));
        if(retained) await tx.insert(decisionContextPreparations).values({companyId,decisionId:id,versionId:retained.id,revision,action:"withdraw",rationale:input.rationale,recordedBy:v7HumanActorId(actor)});
        await logActivity(tx,{companyId,actorType:"user",actorId:v7HumanActorId(actor),action:"decision_context.withdrawn",entityType:"decision",entityId:id,details:{revision}},publications);
        return {revision,preparedVersionId:null};
      });
    },
  };
}
async function freshPin(tx:Db,row:Decision,actor:AuthorizationActor,pin:Version) {
  await inspectRetained(tx,row,actor,pin);const fresh=await capture(tx,row,actor,pin.definition);
  // Capture time is the original epistemic receipt, not a changing fact. Owner
  // facts, exact hashes, pins and privacy ancestry must still match at choice.
  const comparable=(items:CapturedDecisionEvidence[])=>items.map(({capturedAt:_capturedAt,...item})=>item);
  const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,row.companyId),eq(analyticalLineageManifests.id,pin.lineageManifestId)));
  if(pin.decisionSpecHash!==decisionContextSpecHash(row) || nativeSha256(comparable(pin.evidence))!==nativeSha256(comparable(fresh.evidence)) || manifest?.parameters.lineageHash!==nativeSha256(fresh.edges)) throw conflict("Prospective decision evidence or source scope changed; propose and prepare a current context");
}
/** Caller holds company → Memory → native Decision locks. The existing choice
 * CAS and this binding commit together; effects run only after that commit. */
export async function freezeDecisionContextForChoice(tx:Db,row:Decision,actor:AuthorizationActor,optionId:string,chosenAt:Date) {
  const flags=await instanceSettingsService(tx).getExperimental();
  if(!v8FeatureEnabled(flags,"decision_intelligence_v8")) return;
  const root=await contextRoot(tx,row.companyId,row.id);if(!root?.preparedVersionId) return;
  await admission(tx,row.companyId,actor);const pin=await pinnedVersion(tx,row.companyId,row.id,root.preparedVersionId);
  const [receipt]=await tx.select().from(decisionContextPreparations).where(and(eq(decisionContextPreparations.companyId,row.companyId),eq(decisionContextPreparations.decisionId,row.id),eq(decisionContextPreparations.revision,root.revision),eq(decisionContextPreparations.action,"prepare"),eq(decisionContextPreparations.versionId,pin.id))).for("share");
  if(!receipt) throw conflict("Prepared context human receipt is unavailable");
  await freshPin(tx,row,actor,pin);
  await tx.insert(decisionContextBindings).values({companyId:row.companyId,decisionId:row.id,versionId:pin.id,optionId,contextHash:pin.contentHash,decisionSpecHash:pin.decisionSpecHash,frozenBy:v7HumanActorId(actor),frozenAt:chosenAt});
}
