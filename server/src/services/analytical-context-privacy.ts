import {randomUUID} from "node:crypto";
import {and,eq,inArray,isNull,sql} from "drizzle-orm";
import {analyticalContextDependencies,analyticalContextRoots,analyticalLineageManifests,businessMetricObservations,contextManifests,contextManifestMemoryRoots,heartbeatRuns,memoryBindings,memoryRecords,type Db} from "@paperclipai/db";
import type {AnalyticalContextAuthorityPin} from "@paperclipai/shared";
import {inspectAnalyticalContextPins} from "./analytical-context-authority.js";
import type {AuthorizationActor} from "./authorization.js";
import {assertAnalyticalReader,withNativeAnalyticalReader} from "./analytical-reader.js";
import {nativeSha256} from "./native-runtime/canonical.js";
import {lockAnalyticalCompany} from "./analytical-privacy.js";
import {lockMemoryPrivacy,memoryDeletionKey,purgeMemoryRecords} from "./memory/memory-privacy.js";
import {conflict,forbidden} from "../errors.js";

/** Private in-process boundary: the callback must read the actual source owners
 * using this transaction and actor before returning their full manifest set.
 * No result crosses the tool boundary before its retention root is committed. */
export async function withAnalyticalConversationRetention<T>(db:Db,companyId:string,actor:AuthorizationActor,
 read:(tx:Db)=>Promise<RetainedAnalyticalResult<T>>) {
 const deadline=performance.now()+30000;
 return withNativeAnalyticalReader(db,companyId,actor,()=>db.transaction(async rawTx=>{
  const tx=rawTx as unknown as Db;await tx.execute(sql`set local statement_timeout='8s'`);
  await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await assertAnalyticalReader(tx,companyId,actor);
  if(actor.type!=="agent"||!actor.runId||!actor.agentId)throw forbidden("A native conversation is required for analytical retention");
  const [context]=await tx.select().from(contextManifests).where(and(eq(contextManifests.companyId,companyId),eq(contextManifests.runId,actor.runId),eq(contextManifests.agentId,actor.agentId),sql`${contextManifests.issueId}=(select h.native_issue_id from ${heartbeatRuns} h where h.company_id=${companyId}::uuid and h.id=${actor.runId}::uuid)`)).orderBy(sql`${contextManifests.createdAt} desc`,sql`${contextManifests.id} desc`).limit(1).for("share");
  if(!context?.issueId)throw conflict("The native conversation Context manifest is unavailable");
  return retainAnalyticalContextResult(tx,companyId,actor,context.id,await read(tx),deadline);
 }),"conversation");
}

type RetainedAnalyticalResult<T>={result:T;sourceManifestIds?:string[];retentionUntil:Date;authorityPins?:AnalyticalContextAuthorityPin[]};
/** The caller holds company -> Memory and has read the actual source owners.
 * Reuse the original private, unverified retention owner for a persisted run's
 * Context copy; independent verified Learning evidence is never the C7 target. */
export async function retainAnalyticalContextResult<T>(tx:Db,companyId:string,actor:AuthorizationActor,contextId:string,captured:RetainedAnalyticalResult<T>,deadline=performance.now()+30000){
 await assertAnalyticalReader(tx,companyId,actor);
 if(performance.now()>deadline)throw conflict("The complete analytical result exceeded its bounded time budget");
 if(actor.type!=="agent"||!actor.runId||!actor.agentId)throw forbidden("An actual run reader is required for analytical Context retention");
 const [context]=await tx.select({id:contextManifests.id}).from(contextManifests).innerJoin(heartbeatRuns,and(eq(heartbeatRuns.companyId,contextManifests.companyId),eq(heartbeatRuns.id,contextManifests.runId)))
  .where(and(eq(contextManifests.companyId,companyId),eq(contextManifests.id,contextId),eq(contextManifests.runId,actor.runId),eq(contextManifests.agentId,actor.agentId),sql`(${contextManifests.issueId}=${heartbeatRuns.nativeIssueId} or (${heartbeatRuns.nativeIssueId} is null and ${contextManifests.issueId}::text=coalesce(${heartbeatRuns.contextSnapshot}->>'issueId',${heartbeatRuns.contextSnapshot}->>'taskId')))`)).limit(1).for("share");
 if(!context)throw conflict("The actual run Context manifest is unavailable");
  let ids=[...new Set(captured.sourceManifestIds ?? [])].sort();
  // The native owner may return an empty authorized discovery page. An exact
  // empty array carries no source facts and must not invent a retention root.
  if(!ids.length&&captured.authorityPins?.length===0&&Array.isArray(captured.result)&&captured.result.length===0)return captured.result;
  if((captured.sourceManifestIds && !ids.length)||ids.length>26200)throw conflict("The complete analytical source manifest set is required");
  let authorityPins=captured.authorityPins;
  if(!authorityPins){
   if(!ids.length||ids.length>32)throw conflict("Exact native analytical authority pins are required");
   const observations=await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId,companyId),inArray(businessMetricObservations.lineageManifestId,ids))).for("share");
   if(observations.length!==ids.length)throw conflict("Exact native metric authority is unavailable");
   authorityPins=observations.map(observation=>({kind:"analytical_evidence",source:{type:"metric_observation",id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId}}));
  }
  const authority=await inspectAnalyticalContextPins(tx,companyId,actor,authorityPins,deadline,false);
  // SDK callers supply exact pins, not a second independently resolved copy of
  // the same authority. This owner alone resolves the complete manifest set.
  if(!captured.sourceManifestIds)ids=authority.manifestIds;
  if(JSON.stringify(authority.manifestIds)!==JSON.stringify(ids))throw conflict("The complete native source authority set differs from its retained manifests");
  const sources=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),inArray(analyticalLineageManifests.id,ids))).for("share");
  if(!captured.authorityPins&&sources.some(source=>source.analysisType!=="business_metric"))throw conflict("Exact native analytical authority pins are required");
  const now=new Date(),expiresAt=new Date(Math.min(captured.retentionUntil.getTime(),authority.expiresAt.getTime(),...sources.map(s=>s.expiresAt.getTime())));
  if(sources.length!==ids.length||!Number.isFinite(expiresAt.getTime())||expiresAt.getTime()<=now.getTime())throw conflict("An analytical source was erased or expired");
  const bindingKey="native_analytical_retention";
  await tx.insert(memoryBindings).values({companyId,key:bindingKey,name:"Native analytical retention",providerKey:"local"}).onConflictDoNothing();
  const [binding]=await tx.select().from(memoryBindings).where(and(eq(memoryBindings.companyId,companyId),eq(memoryBindings.key,bindingKey))).for("share");
  if(!binding||binding.providerKey!=="local"||!binding.enabled)throw conflict("The native analytical retention binding is unavailable");
  const id=randomUUID(),contentHash=nativeSha256({authorityPins:authority.pins,sources:sources.map(s=>({id:s.id,inputHash:s.inputHash,definitionHash:s.definitionHash})).sort((a,b)=>a.id.localeCompare(b.id)),result:captured.result});
  await tx.insert(memoryRecords).values({id,companyId,bindingId:binding.id,providerKey:"local",memoryType:"observation",scopeType:"agent",scopeId:actor.agentId,ownerAgentId:actor.agentId,
   content:"Private analytical retention root; not a verified Task outcome",reviewState:"rejected",verificationState:"unverified",sensitivityLabel:"restricted",confidenceScore:0,importance:0,
   observedAt:now,expiresAt,createdByActorType:"system",createdByActorId:"native_analytical_retention"});
  await tx.insert(analyticalContextRoots).values({companyId,memoryRecordId:id,sourceCount:ids.length,authorityPins:authority.pins,contentHash,deletionKey:memoryDeletionKey(companyId,"record",id),createdAt:now,expiresAt});
  for(let start=0;start<ids.length;start+=500)await tx.insert(analyticalContextDependencies).values(ids.slice(start,start+500).map(sourceManifestId=>({companyId,memoryRecordId:id,sourceManifestId})));
  await tx.insert(contextManifestMemoryRoots).values({companyId,manifestId:contextId,memoryRecordId:id,sourceVersion:contentHash});
  if(performance.now()>deadline)throw conflict("The complete analytical result exceeded its bounded time budget");
  return captured.result;
}

/** Memory is already held. Marking before propagation prevents source/run
 * erasure recursion from re-entering the same live retention root. */
export async function eraseAnalyticalContextSourcesUnderMemory(tx:Db,companyId:string,sourceManifestIds:string[],at=new Date()) {
 if(!sourceManifestIds.length)return;
 const roots=await tx.select({id:memoryRecords.id}).from(analyticalContextDependencies).innerJoin(memoryRecords,and(eq(memoryRecords.companyId,analyticalContextDependencies.companyId),eq(memoryRecords.id,analyticalContextDependencies.memoryRecordId)))
  .where(and(eq(analyticalContextDependencies.companyId,companyId),inArray(analyticalContextDependencies.sourceManifestId,sourceManifestIds),isNull(memoryRecords.deletedAt)));
 if(roots.length)await purgeMemoryRecords(tx,companyId,[...new Set(roots.map(r=>r.id))],at);
}

/** Retire only this chat's private analytical retention copies. Original source
 * manifests and shared/verified Memory never become a chat-reset target. */
export async function eraseAnalyticalConversationRootsUnderMemory(tx:Db,companyId:string,issueId:string) {
 const roots=await tx.selectDistinct({id:analyticalContextRoots.memoryRecordId}).from(contextManifests)
  .innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
  .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId)))
  .where(and(eq(contextManifests.companyId,companyId),eq(contextManifests.issueId,issueId)));
 if(roots.length)await purgeMemoryRecords(tx,companyId,roots.map(r=>r.id));
}
