import {and,eq,sql} from "drizzle-orm";
import {learningAnalyticalDependencies,learningCycles,learningDomainCandidates,learningEvidence,learningHypotheses,learningRetainedAssets,memoryRecords,type Db} from "@paperclipai/db";
import type {AuthorizationActor} from "../authorization.js";
import {inspectAnalyticalContextPins} from "../analytical-context-authority.js";
import {HttpError} from "../../errors.js";
import type {ExecutionPrincipal} from "@paperclipai/shared";
import type {NativeReadScope} from "../analytical-reader.js";

const lost=()=>new HttpError(403,"Learning source access is unavailable",{code:"analytical_source_access_lost"});
export function learningActorFromPrincipal(companyId:string,principal:ExecutionPrincipal,runId?:string|null):AuthorizationActor|undefined {
 if(principal.type==="user")return {type:"board",source:"session",userId:principal.userId};
 if(principal.type==="system")return principal.service==="local-board"?{type:"board",source:"local_implicit"}:undefined;
 return {type:"agent",source:runId?"agent_jwt":"agent_key",companyId,agentId:principal.agentId,runId:runId??undefined,onBehalfOfUserId:principal.responsibleUserId??null};
}
/** Ordinary Memory outcomes and supplemental analytical signals both retain
 * current source authority. Analytical signals never supply verified outcomes. */
export async function assertLearningAnalyticalSources(db:Db,actor:AuthorizationActor|undefined,cycle:typeof learningCycles.$inferSelect,readScope?:NativeReadScope) {
 if(!actor||cycle.erasedAt)throw lost();
 const deadline=performance.now()+8000;
 const inspect=async()=>{
  const erased=await db.execute<{erased:boolean}>(sql`select aw_learning_cycle_erased(${cycle.companyId}::uuid,${cycle.id}::uuid) as erased`);
  if(erased[0]?.erased)throw lost();
  const roots=await db.select({id:learningEvidence.memoryRecordId,version:learningEvidence.sourceVersion,currentVersion:memoryRecords.updatedAt})
   .from(learningEvidence).leftJoin(memoryRecords,and(eq(memoryRecords.companyId,learningEvidence.companyId),eq(memoryRecords.id,learningEvidence.memoryRecordId)))
   .where(and(eq(learningEvidence.companyId,cycle.companyId),eq(learningEvidence.cycleId,cycle.id))).limit(257);
  if(!roots.length||roots.length>256)throw lost();
  const {canActorReadMemorySources}=await import("../memory/memory-privacy.js");
  for(const root of roots){
   if(performance.now()>deadline||!root.currentVersion||root.currentVersion.toISOString()!==root.version
    ||!await canActorReadMemorySources(db,cycle.companyId,actor,root.id))throw lost();
  }
  if(performance.now()>deadline)throw lost();
  if(!cycle.analyticalSourceCount)return null;
  if(!cycle.analyticalSourceExpiresAt||cycle.analyticalSourceExpiresAt.getTime()<=Date.now())throw lost();
  const current=await inspectAnalyticalContextPins(db,cycle.companyId,actor,cycle.analyticalSourcePins);
  const retained=await db.select({id:learningAnalyticalDependencies.sourceManifestId}).from(learningAnalyticalDependencies).where(and(eq(learningAnalyticalDependencies.companyId,cycle.companyId),eq(learningAnalyticalDependencies.cycleId,cycle.id))).limit(26201);
  if(retained.length!==cycle.analyticalSourceCount||JSON.stringify(retained.map(row=>row.id).sort())!==JSON.stringify(current.manifestIds))throw lost();
  return current.sourceSensitivity;
 };
 try {
  if(actor.type==="agent" && cycle.analyticalSourceCount){
   const {withNativeAnalyticalReader}=await import("../analytical-reader.js");
   return await withNativeAnalyticalReader(db,cycle.companyId,actor,inspect,readScope);
  }else return await inspect();
 }catch(error){if(error instanceof HttpError&&[403,404,409,422].includes(error.status))throw lost();throw error;}
}

/** A native consumer must supply its current actor before copying learned
 * content with retained Memory or analytical sources. */
export async function assertLearnedAssetAnalyticalSources(db:Db,companyId:string,type:string,id:string,actor?:AuthorizationActor,readScope?:NativeReadScope) {
 if(type==="automation_artifact_version"){
  const {automationArtifactVersions}=await import("@paperclipai/db");
  const [source]=await db.select({artifactId:automationArtifactVersions.artifactId}).from(automationArtifactVersions)
   .where(and(eq(automationArtifactVersions.companyId,companyId),eq(automationArtifactVersions.id,id)));
  if(source){const {assertArtifactWorkflowSources}=await import("../automation-artifacts/artifact-workflow-sources.js");
   await assertArtifactWorkflowSources(db,companyId,source.artifactId,actor,readScope);}
 }
 if(type==="workflow_revision"){
  const {workflowRevisions}=await import("@paperclipai/db");
  const [source]=await db.select({workflowId:workflowRevisions.workflowId}).from(workflowRevisions)
   .where(and(eq(workflowRevisions.companyId,companyId),eq(workflowRevisions.id,id)));
  if(source){const {assertWorkflowAuthoringSources}=await import("../workflows/workflow-authoring-sources.js");
   await assertWorkflowAuthoringSources(db,companyId,source.workflowId,actor,readScope);}
 }
 if(type==="document_revision"){
  const {assertFoundationRevisionConversationSources}=await import("../foundation-authoring-source.js");
  await assertFoundationRevisionConversationSources(db,companyId,id,actor);
 }
 const cycles=await db.selectDistinct({cycle:learningCycles}).from(learningDomainCandidates)
  .innerJoin(learningHypotheses,and(eq(learningHypotheses.companyId,companyId),eq(learningHypotheses.id,learningDomainCandidates.hypothesisId)))
  .innerJoin(learningCycles,and(eq(learningCycles.companyId,companyId),eq(learningCycles.id,learningHypotheses.cycleId)))
  .where(and(eq(learningDomainCandidates.companyId,companyId),sql`(exists(select 1 from ${learningRetainedAssets} a where a.company_id=${companyId}::uuid and a.candidate_link_id=${learningDomainCandidates.id} and a.asset_type=${type} and a.asset_id=${id}::uuid) or (${type}='skill_version' and ${learningDomainCandidates.targetDomain}='skill' and ${learningDomainCandidates.candidateId}=${id}::uuid))`)).limit(21);
 if(cycles.length>20)throw lost();
 let sourceSensitivity:"internal"|"confidential"|null=null;
 for(const {cycle} of cycles){if(cycle.erasedAt)throw lost();const sensitivity=await assertLearningAnalyticalSources(db,actor,cycle,readScope);if(sensitivity==="confidential"||!sourceSensitivity)sourceSensitivity=sensitivity;}
 // Existing retention consumers require an expiry only for analytical pins.
 return {cycles:cycles.filter(row=>row.cycle.analyticalSourceCount>0).map(row=>row.cycle),sourceSensitivity};
}

/** The canonical domain's own human review repeats original signal admission. */
export async function assertLearningCandidateAnalyticalSources(db:Db,companyId:string,domain:string,candidateId:string,actor?:AuthorizationActor,readScope?:NativeReadScope) {
 const cycles=await db.selectDistinct({cycle:learningCycles}).from(learningDomainCandidates)
  .innerJoin(learningHypotheses,and(eq(learningHypotheses.companyId,companyId),eq(learningHypotheses.id,learningDomainCandidates.hypothesisId)))
  .innerJoin(learningCycles,and(eq(learningCycles.companyId,companyId),eq(learningCycles.id,learningHypotheses.cycleId)))
  .where(and(eq(learningDomainCandidates.companyId,companyId),eq(learningDomainCandidates.targetDomain,domain),eq(learningDomainCandidates.candidateId,candidateId))).limit(21);
 if(cycles.length>20)throw lost();
 for(const {cycle} of cycles){if(cycle.erasedAt)throw lost();await assertLearningAnalyticalSources(db,actor,cycle,readScope);}
}
