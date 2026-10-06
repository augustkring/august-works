import { and, eq, sql } from "drizzle-orm";
import { learningRetainedAssets, learningDomainCandidates, learningHypotheses, learningEvidence, memoryRecords, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
/** Native consumers enforce retained lineage independently of Learning rollout flags. */
export async function assertLearningAssetCurrent(db: Db, companyId: string, type: string, id: string) {
  const result = await db.execute(sql`select aw_learning_asset_current(${companyId}::uuid, ${type}, ${id}::uuid) as current`);
  if (!(result[0] as { current: boolean } | undefined)?.current) throw conflict("Learning source evidence changed; review this version before use");
}

export async function learningAssetRoots(db: Db, companyId: string, type: string, id: string, purpose?: string) {
  await assertLearningAssetCurrent(db, companyId, type, id);
  const rows = await db.select({ id: memoryRecords.id, expectedVersion: learningEvidence.sourceVersion, record: memoryRecords }).from(learningRetainedAssets)
    .innerJoin(learningDomainCandidates, and(eq(learningDomainCandidates.companyId, learningRetainedAssets.companyId), eq(learningDomainCandidates.id, learningRetainedAssets.candidateLinkId)))
    .innerJoin(learningHypotheses, and(eq(learningHypotheses.companyId, learningDomainCandidates.companyId), eq(learningHypotheses.id, learningDomainCandidates.hypothesisId)))
    .innerJoin(learningEvidence, and(eq(learningEvidence.companyId, learningHypotheses.companyId), eq(learningEvidence.cycleId, learningHypotheses.cycleId)))
    .innerJoin(memoryRecords, and(eq(memoryRecords.companyId, learningEvidence.companyId), eq(memoryRecords.id, learningEvidence.memoryRecordId)))
    .where(and(eq(learningRetainedAssets.companyId, companyId), eq(learningRetainedAssets.assetType, type), eq(learningRetainedAssets.assetId, id)));
  if (rows.some(row => row.record.updatedAt.toISOString() !== row.expectedVersion || purpose && Array.isArray(row.record.metadata.allowedPurposes) && !row.record.metadata.allowedPurposes.includes(purpose))) throw conflict("Learned Context requires current roots for its actual purpose");
  return rows;
}
