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
 const retain=()=>retainAnalyticalContextResult(db,companyId,actor,contextId,{result:{assets},sourceManifestIds:[...manifests],authorityPins:[...pins.values()],retentionUntil:new Date(expiresAt)});
 if(actor.type==="agent"&&actor.source==="none"){
  const {withNativeAnalyticalSourceReader}=await import("../analytical-reader.js");
  await withNativeAnalyticalSourceReader(db,companyId,actor,retain,"task");
 }else await withNativeAnalyticalReader(db,companyId,actor,retain,"task");
}

/** Generated Skill copies require the actual immutable native pin, current
 * Task reader and complete retained signal graph, not caller-supplied metadata. */
export async function assertRuntimeSkillSourceRetained(db:Db,companyId:string,actor:AuthorizationActor,skillId:string,versionId:string){
 if(actor.type!=="agent"||!actor.runId||actor.companyId!==companyId)throw forbidden("Skill copies require the current native execution");
 // The platform substrate has its own server-owned immutable Run admission,
 // including Fabric-off profiles. Customer/learned Skills retain the complete
 // original manifest/context requirement below; none can use this branch.
 const {companySkills}=await import("@paperclipai/db");
 const [platform]=await db.select({key:companySkills.key}).from(companySkills).where(and(
  eq(companySkills.companyId,companyId),eq(companySkills.id,skillId),eq(companySkills.key,"blentera-platform"))).limit(1);
 if(platform){
  const {assertPlatformSkillAdmission}=await import("../platform-skill-admission.js");
  const {blenteraPlatformContractHashes}=await import("../tool-gateway.js");
  await assertPlatformSkillAdmission(db,actor,blenteraPlatformContractHashes());
  const {skillResolverService}=await import("../skill-resolver.js");
  const selected=await skillResolverService(db).authorizedVersion(actor,companyId,skillId,versionId,false,"task");
  const source=await assertLearnedAssetAnalyticalSources(db,companyId,"skill_version",versionId,actor,"task");
  if(source.cycles.length || (await learningAssetRoots(db,companyId,"skill_version",versionId,undefined,actor,"task")).length)
   throw forbidden("The required platform procedure cannot contain customer-derived source dependencies");
  return selected;
 }
 const [pin]=await db.execute<{context_id:string;test_current:boolean;runtime_mode:string|null;runtime_mode_resolved_at:Date|null;adapter_type:string|null}>(sql`select e.context_manifest_id as context_id,r.runtime_mode,r.runtime_mode_resolved_at,a.adapter_type,exists(select 1 from company_skill_test_runs t where t.company_id=e.company_id and t.agent_id=e.agent_id and t.issue_id=coalesce(r.native_issue_id,(select c.issue_id from context_manifests c where c.company_id=e.company_id and c.id=e.context_manifest_id)) and t.skill_id=${skillId}::uuid and t.skill_version_id=${versionId}::uuid and t.deleted_at is null and t.superseded_at is null and t.status in ('queued','running') and (t.evaluation_context is null or exists(select 1 from company_skill_eval_runs v where v.company_id=t.company_id and v.id=(t.evaluation_context->>'evaluationRunId')::uuid and v.status='running' and v.created_by_user_id=r.responsible_user_id))) as test_current from agent_execution_manifests e join heartbeat_runs r on r.company_id=e.company_id and r.id=e.run_id join agents a on a.company_id=e.company_id and a.id=e.agent_id join agent_execution_manifest_items i on i.company_id=e.company_id and i.manifest_id=e.id where e.company_id=${companyId}::uuid and e.run_id=${actor.runId}::uuid and e.agent_id=${actor.agentId}::uuid and r.agent_id=e.agent_id and r.responsible_user_id is not distinct from ${actor.onBehalfOfUserId??null} and r.status='running' and i.type='skill' and i.ref=${skillId} and i.version_ref=${versionId} limit 1`);
 if(!pin)throw forbidden("Skill is outside the current native execution inventory");
 const {assertAnalyticalContextPayloadAccess}=await import("../analytical-context-authority.js");
 await assertAnalyticalContextPayloadAccess(db,companyId,actor,{runId:actor.runId},"task");
 const {skillResolverService}=await import("../skill-resolver.js");
 const resolver=skillResolverService(db);
 // V5 creates the immutable manifest before Native mode is claimed. During
 // that bounded preparation window, only an exact manifest pin that is also
 // the currently active, company-visible version may be materialized. A
 // superseded retained pin still requires the persisted Native execution
 // proof checked by authorizedCurrentManifestVersion below.
 const unresolvedNativePreparation=(pin.runtime_mode===null||pin.runtime_mode==="legacy")&&
  pin.runtime_mode_resolved_at===null&&pin.adapter_type==="paperclip_runner";
 const selected=pin.test_current || unresolvedNativePreparation
  ? await resolver.authorizedVersion(actor,companyId,skillId,versionId,pin.test_current,"task")
  : await resolver.authorizedCurrentManifestVersion(actor,companyId,skillId,versionId,"task");
 const source=await assertLearnedAssetAnalyticalSources(db,companyId,"skill_version",versionId,actor,"task");
 for(const cycle of source.cycles){
  const [coverage]=await db.execute<{covered:number}>(sql`select count(distinct d.source_manifest_id)::int as covered from learning_analytical_dependencies d where d.company_id=${companyId}::uuid and d.cycle_id=${cycle.id}::uuid and exists(select 1 from analytical_context_dependencies a join context_manifest_memory_roots r on r.company_id=a.company_id and r.memory_record_id=a.memory_record_id where a.company_id=d.company_id and a.source_manifest_id=d.source_manifest_id and r.manifest_id=${pin.context_id}::uuid)`);
  if(coverage?.covered!==cycle.analyticalSourceCount)throw forbidden("The complete pinned Skill Source was not retained",{code:"analytical_source_access_lost"});
 }
 return selected;
}

export type RetainedRuntimeSkillSourcePin = Omit<Extract<import("@paperclipai/shared").NativePayloadSourceInput,
 {kind:"runtime_skill"}>,"versionId"> & {versionId:string};
const retainedSkillRecord=(value:unknown):Record<string,unknown>=>value && typeof value==="object" && !Array.isArray(value)
 ? value as Record<string,unknown> : {};
const retainedSkillLost=()=>forbidden("The retained runtime Skill producer is unavailable");

/** Authenticate the persisted producer without borrowing its identity or
 * requiring its historical Run to be live. Current reader policy is separate. */
export async function assertRetainedRuntimeSkillProducer(db:Db,companyId:string,producerRunId:string,
 source:RetainedRuntimeSkillSourcePin){
 const {heartbeatRuns,companySkills,companySkillVersions,agentExecutionManifests,agentExecutionManifestItems,contextManifests}=await import("@paperclipai/db");
 const {nativePayloadSourceInputSchema,nativeRunInputSourceReceiptSchema,agentExecutionManifestSchema,platformSkillIdentitySchema}=await import("@paperclipai/shared");
 const parsedSource=nativePayloadSourceInputSchema.safeParse(source);
 if(!parsedSource.success || parsedSource.data.kind!=="runtime_skill" || !parsedSource.data.versionId)throw retainedSkillLost();
 source=parsedSource.data as RetainedRuntimeSkillSourcePin;
 const {hashContextPolicySnapshot}=await import("../context/context-manifest.js");
 const {nativeRuntimeAssetsRoot}=await import("../native-runtime/runtime-asset-retention.js");
 const {readNativeRuntimeAssetText}=await import("../native-runtime/runtime-context.js");
 const path=await import("node:path");
 const [run]=await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,producerRunId))).for("share");
 if(!run || run.runtimeMode!=="native" || run.nativeInputSourceProtocolVersion!==1 || !run.responsibleUserId)throw retainedSkillLost();
 const profile=retainedSkillRecord(run.runnerProfileJson);
 const {parseNativeExecutionInput}=await import("../../vendor/paperclip-runner/index.js");
 let execution:ReturnType<typeof parseNativeExecutionInput>;
 try{execution=parseNativeExecutionInput(profile.nativeExecutionInput);}catch{throw retainedSkillLost();}
 if(execution.binding.companyId!==companyId || execution.binding.runId!==producerRunId || execution.binding.agentId!==run.agentId || !run.nativeIssueId || execution.binding.issueId!==run.nativeIssueId)
  throw retainedSkillLost();
 const runtime=retainedSkillRecord("runtimeContext" in execution ? execution.runtimeContext : null);
 const skills=Array.isArray(runtime.skills)?runtime.skills.map(retainedSkillRecord):[];
 const selected=skills.filter(skill=>skill.key===source.key && skill.versionId===source.versionId &&
  retainedSkillRecord(skill.bundle).digest===source.bundleDigest && retainedSkillRecord(skill.bundle).manifestDigest===source.manifestDigest);
 if(selected.length!==1)throw retainedSkillLost();
 const bundle=selected[0]!.bundle as Parameters<typeof readNativeRuntimeAssetText>[0];
 if(bundle.rootPath!==path.join(nativeRuntimeAssetsRoot({companyId,runId:producerRunId}),"bundles",source.bundleDigest))throw retainedSkillLost();
 const receipt=nativeRunInputSourceReceiptSchema.safeParse(profile.nativeInputSourceReceipt);
 if(!receipt.success || receipt.data.binding.companyId!==companyId || receipt.data.binding.runId!==producerRunId ||
  receipt.data.binding.agentId!==run.agentId || receipt.data.binding.responsibleUserId!==run.responsibleUserId || receipt.data.binding.issueId!==run.nativeIssueId ||
  !receipt.data.bootstrap.inputs.some(pin=>pin.kind==="runtime_skill" && pin.key===source.key && pin.versionId===source.versionId &&
    pin.bundleDigest===source.bundleDigest && pin.manifestDigest===source.manifestDigest))throw retainedSkillLost();
 const {digest:_receiptDigest,...receiptBody}=receipt.data;
 const [receiptHash]=await db.execute<{digest:string;execution_digest:string}>(sql`select encode(sha256(convert_to((${JSON.stringify(receiptBody)}::jsonb)::text,'UTF8')),'hex') as digest, encode(sha256(convert_to((${JSON.stringify(profile.nativeExecutionInput)}::jsonb)::text,'UTF8')),'hex') as execution_digest`);
 if(receiptHash?.digest!==receipt.data.digest || receiptHash.execution_digest!==receipt.data.bootstrap.executionInputDigest)throw retainedSkillLost();
 const [version]=await db.select({skill:companySkills,version:companySkillVersions}).from(companySkillVersions)
  .innerJoin(companySkills,and(eq(companySkills.companyId,companySkillVersions.companyId),eq(companySkills.id,companySkillVersions.companySkillId)))
  .where(and(eq(companySkillVersions.companyId,companyId),eq(companySkillVersions.id,source.versionId),eq(companySkills.key,source.key))).for("share");
 if(!version)throw retainedSkillLost();
 const [manifestRow]=await db.select().from(agentExecutionManifests).where(and(
  eq(agentExecutionManifests.companyId,companyId),eq(agentExecutionManifests.runId,producerRunId),eq(agentExecutionManifests.agentId,run.agentId))).for("share");
 const originalManifestId=retainedSkillRecord(run.contextSnapshot).v5ExecutionManifestId;
 if(originalManifestId!==undefined && originalManifestId!==null &&
  (typeof originalManifestId!=="string" || !manifestRow || manifestRow.id!==originalManifestId))throw retainedSkillLost();
 let contextId:string|null=null;
 if(manifestRow){
  const parsed=agentExecutionManifestSchema.safeParse(manifestRow.manifest);
  if(!parsed.success || manifestRow.hash!==hashContextPolicySnapshot(parsed.data) ||
   parsed.data.companyId!==companyId || parsed.data.runId!==producerRunId || parsed.data.agentId!==run.agentId ||
   parsed.data.agentIdentityId!==manifestRow.agentIdentityId || parsed.data.responsibleUserId!==run.responsibleUserId ||
   parsed.data.executionPolicy.policySnapshotHash!==manifestRow.policySnapshotHash ||
   !parsed.data.contextManifests.some(ref=>ref.companyId===companyId && ref.contextManifestId===manifestRow.contextManifestId) ||
   !parsed.data.skills.some(pin=>pin.skillId===version.skill.id && pin.versionId===source.versionId && pin.key===source.key))throw retainedSkillLost();
  const [item]=await db.select({id:agentExecutionManifestItems.id}).from(agentExecutionManifestItems).where(and(
   eq(agentExecutionManifestItems.companyId,companyId),eq(agentExecutionManifestItems.manifestId,manifestRow.id),
   eq(agentExecutionManifestItems.type,"skill"),eq(agentExecutionManifestItems.ref,version.skill.id),eq(agentExecutionManifestItems.versionRef,source.versionId))).limit(1);
  if(!item)throw retainedSkillLost();
  const [context]=await db.select().from(contextManifests).where(and(eq(contextManifests.companyId,companyId),
   eq(contextManifests.id,manifestRow.contextManifestId))).for("share");
  if(!context || context.runId!==producerRunId || context.agentId!==run.agentId || context.issueId!==run.nativeIssueId)
   throw retainedSkillLost();
  contextId=manifestRow.contextManifestId;
 }
 if(source.key==="blentera-platform"){
  const admission=retainedSkillRecord(profile.platformSkillAdmission);
  const identity=platformSkillIdentitySchema.safeParse(admission.platformSkill);
  const {buildInventoryContentHash}=await import("../company-skills.js");
  const {createHash}=await import("node:crypto");
  const inventory=version.version.fileInventory;
  if(!identity.success || admission.schemaVersion!==1 || admission.runtimeAdapter!=="paperclip_runner" ||
   !/^[a-f0-9]{64}$/.test(String(admission.operationManifestHash)) || !/^[a-f0-9]{64}$/.test(String(admission.toolCatalogContractHash)) ||
   version.skill.metadata?.sourceKind!=="paperclip_bundled" || version.version.releaseId!==identity.data.version ||
   !Array.isArray(inventory) || inventory.some(file=>typeof file.path!=="string" || typeof file.content!=="string") ||
   buildInventoryContentHash(inventory.map(file=>({path:file.path,sha256:createHash("sha256").update(file.content).digest("hex")})))!==identity.data.digest ||
   (manifestRow && hashContextPolicySnapshot(manifestRow.manifest.platformSkill)!==hashContextPolicySnapshot(identity.data)))throw retainedSkillLost();
 }else if(!manifestRow)throw retainedSkillLost();
 // The exact owned bundle is checked once by this shared retained-copy owner.
 // Live materialization continues to use assertRuntimeSkillSourceRetained.
 await readNativeRuntimeAssetText(bundle,256000,{companyId,runId:producerRunId});
 return {skillId:version.skill.id,contextId,platform:source.key==="blentera-platform"};
}

/** Current readers retain their own company/Skill/Memory/analytical authority.
 * The completed producer supplies evidence, never an impersonated agent grant. */
export async function assertRetainedRuntimeSkillSourceCurrent(db:Db,input:{companyId:string;actor:AuthorizationActor;
 producerRunId:string;source:RetainedRuntimeSkillSourcePin}){
 const {skillResolverService}=await import("../skill-resolver.js");
 const selected=await skillResolverService(db).authorizedRetainedRuntimeVersion(input.actor,input.companyId,input.producerRunId,input.source);
 const source=await assertLearnedAssetAnalyticalSources(db,input.companyId,"skill_version",input.source.versionId,input.actor,"task");
 const roots=await learningAssetRoots(db,input.companyId,"skill_version",input.source.versionId,undefined,input.actor,"task");
 if(selected.producer.platform){
  if(source.cycles.length || roots.length)
   throw forbidden("The required platform procedure cannot contain customer-derived source dependencies");
 }else {
  for(const root of roots){
   const [coverage]=await db.execute<{covered:boolean}>(sql`select exists(select 1 from context_manifest_memory_roots r where r.company_id=${input.companyId}::uuid and r.manifest_id=${selected.producer.contextId}::uuid and r.memory_record_id=${root.id}::uuid and r.source_version=${root.expectedVersion}) as covered`);
   if(!coverage?.covered)throw forbidden("The complete pinned Skill Source was not retained",{code:"analytical_source_access_lost"});
  }
  for(const cycle of source.cycles){
  const [coverage]=await db.execute<{covered:number}>(sql`select count(distinct d.source_manifest_id)::int as covered from learning_analytical_dependencies d where d.company_id=${input.companyId}::uuid and d.cycle_id=${cycle.id}::uuid and exists(select 1 from analytical_context_dependencies a join context_manifest_memory_roots r on r.company_id=a.company_id and r.memory_record_id=a.memory_record_id where a.company_id=d.company_id and a.source_manifest_id=d.source_manifest_id and r.manifest_id=${selected.producer.contextId}::uuid)`);
  if(coverage?.covered!==cycle.analyticalSourceCount)throw forbidden("The complete pinned Skill Source was not retained",{code:"analytical_source_access_lost"});
  }
 }
 return selected;
}
