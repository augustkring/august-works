import { and, eq, sql } from "drizzle-orm";
import { learningRetainedAssets, learningDomainCandidates, learningHypotheses, learningEvidence, learningAnalyticalDependencies, learningCycles, memoryRecords, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import type {AuthorizationActor} from "../authorization.js";
import {assertLearnedAssetAnalyticalSources} from "./learning-analytical-sources.js";
import {withNativeAnalyticalReader,type NativeReadScope} from "../analytical-reader.js";
import {retainAnalyticalContextResult} from "../analytical-context-privacy.js";
import type {AnalyticalContextAuthorityPin} from "@paperclipai/shared";
/** Native consumers enforce retained lineage independently of Learning rollout flags. */
export async function assertLearningAssetCurrent(db: Db, companyId: string, type: string, id: string, actor?:AuthorizationActor,readScope?:NativeReadScope) {
  const result = await db.execute(sql`select aw_learning_asset_current(${companyId}::uuid, ${type}, ${id}::uuid) as current`);
  if (!(result[0] as { current: boolean } | undefined)?.current) throw conflict("Learning source evidence changed; review this version before use");
  await assertLearnedAssetAnalyticalSources(db,companyId,type,id,actor,readScope);
}

export async function learningAssetRoots(db: Db, companyId: string, type: string, id: string, purpose?: string, actor?:AuthorizationActor,readScope?:NativeReadScope) {
  await assertLearningAssetCurrent(db, companyId, type, id,actor,readScope);
  const rows = await db.select({ id: memoryRecords.id, expectedVersion: learningEvidence.sourceVersion, record: memoryRecords }).from(learningRetainedAssets)
    .innerJoin(learningDomainCandidates, and(eq(learningDomainCandidates.companyId, learningRetainedAssets.companyId), eq(learningDomainCandidates.id, learningRetainedAssets.candidateLinkId)))
    .innerJoin(learningHypotheses, and(eq(learningHypotheses.companyId, learningDomainCandidates.companyId), eq(learningHypotheses.id, learningDomainCandidates.hypothesisId)))
    .innerJoin(learningEvidence, and(eq(learningEvidence.companyId, learningHypotheses.companyId), eq(learningEvidence.cycleId, learningHypotheses.cycleId)))
    .innerJoin(memoryRecords, and(eq(memoryRecords.companyId, learningEvidence.companyId), eq(memoryRecords.id, learningEvidence.memoryRecordId)))
    .where(and(eq(learningRetainedAssets.companyId, companyId), eq(learningRetainedAssets.assetType, type), eq(learningRetainedAssets.assetId, id)));
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
