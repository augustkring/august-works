import { and, eq, sql } from "drizzle-orm";
import { learningDomainCandidates, learningHypotheses, learningEvidence, learningAnalyticalDependencies, learningCycles, memoryRecords, type Db } from "@paperclipai/db";
import { conflict,forbidden } from "../../errors.js";
import type {AuthorizationActor} from "../authorization.js";
import {assertLearnedAssetAnalyticalSources} from "./learning-analytical-sources.js";
import {withNativeAnalyticalReader,type NativeReadScope} from "../analytical-reader.js";
import {retainAnalyticalContextResult} from "../analytical-context-privacy.js";
import type {AnalyticalContextAuthorityPin} from "@paperclipai/shared";
/** Native consumers enforce retained lineage independently of Learning rollout flags. */
export async function assertLearningAssetCurrent(db: Db, companyId: string, type: string, id: string, actor?:AuthorizationActor,readScope?:NativeReadScope) {
  const result = await db.execute(sql`select aw_learning_asset_current(${companyId}::uuid, ${type}, ${id}::uuid) and (${type}<>'skill_version' or (not aw_skill_version_source_erased(${companyId}::uuid,${id}::uuid) and not exists(select 1 from learning_domain_candidates l where l.company_id=${companyId}::uuid and l.target_domain='skill' and l.candidate_id=${id}::uuid and not aw_learning_link_current(l.company_id,l.id)))) as current`);
  if (!(result[0] as { current: boolean } | undefined)?.current) throw conflict("Learning source evidence changed; review this version before use");
  await assertLearnedAssetAnalyticalSources(db,companyId,type,id,actor,readScope);
}

export async function learningAssetRoots(db: Db, companyId: string, type: string, id: string, purpose?: string, actor?:AuthorizationActor,readScope?:NativeReadScope) {
  await assertLearningAssetCurrent(db, companyId, type, id,actor,readScope);
  const rows = await db.select({ id: memoryRecords.id, expectedVersion: learningEvidence.sourceVersion, record: memoryRecords }).from(learningDomainCandidates)
    .innerJoin(learningHypotheses, and(eq(learningHypotheses.companyId, learningDomainCandidates.companyId), eq(learningHypotheses.id, learningDomainCandidates.hypothesisId)))
    .innerJoin(learningEvidence, and(eq(learningEvidence.companyId, learningHypotheses.companyId), eq(learningEvidence.cycleId, learningHypotheses.cycleId)))
    .innerJoin(memoryRecords, and(eq(memoryRecords.companyId, learningEvidence.companyId), eq(memoryRecords.id, learningEvidence.memoryRecordId)))
    .where(and(eq(learningDomainCandidates.companyId,companyId),sql`(exists(select 1 from learning_retained_assets a where a.company_id=${companyId}::uuid and a.candidate_link_id=${learningDomainCandidates.id} and a.asset_type=${type} and a.asset_id=${id}::uuid) or (${type}='skill_version' and ${learningDomainCandidates.targetDomain}='skill' and ${learningDomainCandidates.candidateId}=${id}::uuid))`)).limit(257);
  if(rows.length>256)throw conflict("The complete learned Context exceeds its Memory root budget");
  if (rows.some(row => row.record.updatedAt.toISOString() !== row.expectedVersion || purpose && Array.isArray(row.record.metadata.allowedPurposes) && !row.record.metadata.allowedPurposes.includes(purpose))) throw conflict("Learned Context requires current roots for its actual purpose");
  return rows;
}

/** Original Context owner holds company -> Memory before retaining learned
 * signal copies. The complete native cycle graph supplies pins and manifests. */
export async function retainLearnedAssetsInContext(db:Db,companyId:string,actor:AuthorizationActor|undefined,contextId:string,assets:{type:string;id:string}[]){
 const deadline=performance.now()+30000;
 if(assets.length>256)throw conflict("The learned Context exceeds its complete-source retention budget");
 const budget=()=>{if(performance.now()>deadline)throw conflict("The complete learned Context Source review exceeded its time budget");};
 const cycles=new Map<string,typeof learningCycles.$inferSelect>();
 for(const asset of assets){budget();const source=await assertLearnedAssetAnalyticalSources(db,companyId,asset.type,asset.id,actor,"task");for(const cycle of source.cycles)cycles.set(cycle.id,cycle);}
 if(!cycles.size)return;
 if(!actor)throw conflict("The current learned Context reader is required");
 const pins=new Map<string,AnalyticalContextAuthorityPin>(),manifests=new Set<string>();let expiresAt=Infinity;
 for(const cycle of cycles.values()){
  budget();
  for(const pin of cycle.analyticalSourcePins)pins.set(JSON.stringify(pin),pin);
  expiresAt=Math.min(expiresAt,cycle.analyticalSourceExpiresAt!.getTime());
  const sources=await db.select({id:learningAnalyticalDependencies.sourceManifestId}).from(learningAnalyticalDependencies).where(and(eq(learningAnalyticalDependencies.companyId,companyId),eq(learningAnalyticalDependencies.cycleId,cycle.id))).limit(26201);
  if(sources.length!==cycle.analyticalSourceCount)throw conflict("The complete learned Context Source graph is required");
  sources.forEach(source=>manifests.add(source.id));
 }
 budget();if(pins.size>32||manifests.size>26200)throw conflict("The learned Context exceeds its complete-source retention budget");
 await withNativeAnalyticalReader(db,companyId,actor,()=>retainAnalyticalContextResult(db,companyId,actor,contextId,{result:{assets},sourceManifestIds:[...manifests],authorityPins:[...pins.values()],retentionUntil:new Date(expiresAt)}),"task");
}

/** Generated Skill copies require the actual immutable native pin, current
 * Task reader and complete retained signal graph, not caller-supplied metadata. */
export async function assertRuntimeSkillSourceRetained(db:Db,companyId:string,actor:AuthorizationActor,skillId:string,versionId:string){
 if(actor.type!=="agent"||!actor.runId||actor.companyId!==companyId)throw forbidden("Skill copies require the current native execution");
 const [pin]=await db.execute<{context_id:string;test_current:boolean}>(sql`select e.context_manifest_id as context_id,exists(select 1 from company_skill_test_runs t where t.company_id=e.company_id and t.agent_id=e.agent_id and t.issue_id=coalesce(r.native_issue_id,(select c.issue_id from context_manifests c where c.company_id=e.company_id and c.id=e.context_manifest_id)) and t.skill_id=${skillId}::uuid and t.skill_version_id=${versionId}::uuid and t.deleted_at is null and t.superseded_at is null and t.status in ('queued','running') and (t.evaluation_context is null or exists(select 1 from company_skill_eval_runs v where v.company_id=t.company_id and v.id=(t.evaluation_context->>'evaluationRunId')::uuid and v.status='running' and v.created_by_user_id=r.responsible_user_id))) as test_current from agent_execution_manifests e join heartbeat_runs r on r.company_id=e.company_id and r.id=e.run_id join agent_execution_manifest_items i on i.company_id=e.company_id and i.manifest_id=e.id where e.company_id=${companyId}::uuid and e.run_id=${actor.runId}::uuid and e.agent_id=${actor.agentId}::uuid and r.agent_id=e.agent_id and r.responsible_user_id is not distinct from ${actor.onBehalfOfUserId??null} and r.status='running' and i.type='skill' and i.ref=${skillId} and i.version_ref=${versionId} limit 1`);
 if(!pin)throw forbidden("Skill is outside the current native execution inventory");
 const {assertAnalyticalContextPayloadAccess}=await import("../analytical-context-authority.js");
 await assertAnalyticalContextPayloadAccess(db,companyId,actor,{runId:actor.runId},"task");
 const {skillResolverService}=await import("../skill-resolver.js");
 const selected=await skillResolverService(db).authorizedVersion(actor,companyId,skillId,versionId,pin.test_current,"task");
 const source=await assertLearnedAssetAnalyticalSources(db,companyId,"skill_version",versionId,actor,"task");
 for(const cycle of source.cycles){
  const [coverage]=await db.execute<{covered:number}>(sql`select count(distinct d.source_manifest_id)::int as covered from learning_analytical_dependencies d where d.company_id=${companyId}::uuid and d.cycle_id=${cycle.id}::uuid and exists(select 1 from analytical_context_dependencies a join context_manifest_memory_roots r on r.company_id=a.company_id and r.memory_record_id=a.memory_record_id where a.company_id=d.company_id and a.source_manifest_id=d.source_manifest_id and r.manifest_id=${pin.context_id}::uuid)`);
  if(coverage?.covered!==cycle.analyticalSourceCount)throw forbidden("The complete pinned Skill Source was not retained",{code:"analytical_source_access_lost"});
 }
 return selected;
}
