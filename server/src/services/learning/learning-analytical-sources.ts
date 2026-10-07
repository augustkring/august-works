import {and,eq,sql} from "drizzle-orm";
import {learningAnalyticalDependencies,learningCycles,learningDomainCandidates,learningHypotheses,learningRetainedAssets,type Db} from "@paperclipai/db";
import type {AuthorizationActor} from "../authorization.js";
import {inspectAnalyticalContextPins} from "../analytical-context-authority.js";
import {HttpError} from "../../errors.js";
import type {ExecutionPrincipal} from "@paperclipai/shared";
import type {NativeReadScope} from "../analytical-reader.js";

const lost=()=>new HttpError(403,"Learning analytical source access is unavailable",{code:"analytical_source_access_lost"});
export function learningActorFromPrincipal(companyId:string,principal:ExecutionPrincipal,runId?:string|null):AuthorizationActor|undefined {
 if(principal.type==="user")return {type:"board",source:"session",userId:principal.userId};
 if(principal.type==="system")return principal.service==="local-board"?{type:"board",source:"local_implicit"}:undefined;
 return {type:"agent",source:runId?"agent_jwt":"agent_key",companyId,agentId:principal.agentId,runId:runId??undefined,onBehalfOfUserId:principal.responsibleUserId??null};
}
/** Supplemental analytical signals never supply verified Learning outcomes. */
export async function assertLearningAnalyticalSources(db:Db,actor:AuthorizationActor|undefined,cycle:typeof learningCycles.$inferSelect,readScope?:NativeReadScope) {
 if(!cycle.analyticalSourceCount)return null;
 if(!actor||!cycle.analyticalSourceExpiresAt||cycle.analyticalSourceExpiresAt.getTime()<=Date.now())throw lost();
 const inspect=async()=>{
  const erased=await db.execute<{erased:boolean}>(sql`select aw_learning_cycle_erased(${cycle.companyId}::uuid,${cycle.id}::uuid) as erased`);
  if(erased[0]?.erased)throw lost();
  const current=await inspectAnalyticalContextPins(db,cycle.companyId,actor,cycle.analyticalSourcePins);
  const retained=await db.select({id:learningAnalyticalDependencies.sourceManifestId}).from(learningAnalyticalDependencies).where(and(eq(learningAnalyticalDependencies.companyId,cycle.companyId),eq(learningAnalyticalDependencies.cycleId,cycle.id))).limit(26201);
  if(retained.length!==cycle.analyticalSourceCount||JSON.stringify(retained.map(row=>row.id).sort())!==JSON.stringify(current.manifestIds))throw lost();
  return current.sourceSensitivity;
 };
 try {
  if(actor.type==="agent"){
   const {withNativeAnalyticalReader}=await import("../analytical-reader.js");
   return await withNativeAnalyticalReader(db,cycle.companyId,actor,inspect,readScope);
  }else return await inspect();
 }catch(error){if(error instanceof HttpError&&[403,404,409,422].includes(error.status))throw lost();throw error;}
}

/** A native consumer must supply its current actor before copying learned
 * content with analytical signal dependencies. Missing actor never grants access. */
export async function assertLearnedAssetAnalyticalSources(db:Db,companyId:string,type:string,id:string,actor?:AuthorizationActor,readScope?:NativeReadScope) {
 const cycles=await db.selectDistinct({cycle:learningCycles}).from(learningRetainedAssets)
  .innerJoin(learningDomainCandidates,and(eq(learningDomainCandidates.companyId,companyId),eq(learningDomainCandidates.id,learningRetainedAssets.candidateLinkId)))
  .innerJoin(learningHypotheses,and(eq(learningHypotheses.companyId,companyId),eq(learningHypotheses.id,learningDomainCandidates.hypothesisId)))
  .innerJoin(learningCycles,and(eq(learningCycles.companyId,companyId),eq(learningCycles.id,learningHypotheses.cycleId)))
  .where(and(eq(learningRetainedAssets.companyId,companyId),eq(learningRetainedAssets.assetType,type),eq(learningRetainedAssets.assetId,id),sql`(${learningCycles.analyticalSourceCount}>0 or ${learningCycles.erasedAt} is not null)`)).limit(21);
 if(cycles.length>20)throw lost();
 let sourceSensitivity:"internal"|"confidential"|null=null;
 for(const {cycle} of cycles){if(cycle.erasedAt)throw lost();const sensitivity=await assertLearningAnalyticalSources(db,actor,cycle,readScope);if(sensitivity==="confidential"||!sourceSensitivity)sourceSensitivity=sensitivity;}
 return {cycles:cycles.map(row=>row.cycle),sourceSensitivity};
}

/** The canonical domain's own human review repeats original signal admission. */
export async function assertLearningCandidateAnalyticalSources(db:Db,companyId:string,domain:string,candidateId:string,actor?:AuthorizationActor) {
 const cycles=await db.selectDistinct({cycle:learningCycles}).from(learningDomainCandidates)
  .innerJoin(learningHypotheses,and(eq(learningHypotheses.companyId,companyId),eq(learningHypotheses.id,learningDomainCandidates.hypothesisId)))
  .innerJoin(learningCycles,and(eq(learningCycles.companyId,companyId),eq(learningCycles.id,learningHypotheses.cycleId)))
  .where(and(eq(learningDomainCandidates.companyId,companyId),eq(learningDomainCandidates.targetDomain,domain),eq(learningDomainCandidates.candidateId,candidateId))).limit(21);
 if(cycles.length>20)throw lost();
 for(const {cycle} of cycles){if(cycle.erasedAt)throw lost();await assertLearningAnalyticalSources(db,actor,cycle);}
}
