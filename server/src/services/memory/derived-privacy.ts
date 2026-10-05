import { and, eq, inArray } from "drizzle-orm";
import { memoryObservations, memoryObservationEvidence, memoryModels, memoryModelEvidence, memoryModelVersions, memoryJobs, type Db } from "@paperclipai/db";
/** Invalidates every historical root dependency; erasure also scrubs retained synthesis versions. */
export async function invalidateDerivedMemory(tx: Db, companyId: string, recordIds: string[], erase = false) {
  if (!recordIds.length) return;
  const observationEdges = await tx.select({ id: memoryObservationEvidence.observationId }).from(memoryObservationEvidence).where(and(eq(memoryObservationEvidence.companyId, companyId), inArray(memoryObservationEvidence.memoryRecordId, recordIds)));
  const observationIds = [...new Set(observationEdges.map((edge) => edge.id))];
  const modelEdges = await tx.select({ id: memoryModelEvidence.modelId }).from(memoryModelEvidence).where(and(eq(memoryModelEvidence.companyId, companyId), inArray(memoryModelEvidence.memoryRecordId, recordIds)));
  const modelIds = [...new Set(modelEdges.map((edge) => edge.id))], now = new Date();
  if (observationIds.length) await tx.update(memoryObservations).set(erase ? { status: "revoked", content: "", observationKey: "erased", purpose: "erased", confidence: 0, supportCount: 0, contradictionCount: 0, independentSourceCount: 0, erasedAt: now, revokedAt: now, reviewedByUserId: null, reviewedAt: null, updatedAt: now }
    : { status: "needs_review", updatedAt: now }).where(and(eq(memoryObservations.companyId, companyId), inArray(memoryObservations.id, observationIds),
      erase ? undefined : inArray(memoryObservations.status, ["candidate", "accepted", "needs_review"])));
  if (modelIds.length) {
    await tx.update(memoryModels).set(erase ? { status: "revoked", content: "", name: "Erased mental model", sourceQuery: "", purpose: "erased", confidence: 0, erasedAt: now, revokedAt: now, reviewedByUserId: null, reviewedAt: null, updatedAt: now }
      : { status: "needs_rebuild", updatedAt: now }).where(and(eq(memoryModels.companyId, companyId), inArray(memoryModels.id, modelIds),
        erase ? undefined : inArray(memoryModels.status, ["candidate", "active", "needs_rebuild", "degraded"])));
    if (erase) {
      await tx.update(memoryModelVersions).set({ content: "", erasedAt: now }).where(and(eq(memoryModelVersions.companyId, companyId), inArray(memoryModelVersions.modelId, modelIds)));
      const jobs = await tx.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.operationType, "model_rebuild")));
      for (const job of jobs) if (typeof job.sourceRefJson.modelId === "string" && modelIds.includes(job.sourceRefJson.modelId)) await tx.update(memoryJobs).set({ sourceRefJson: {}, resultJson: null, error: null, resultSummary: null, updatedAt: now }).where(eq(memoryJobs.id, job.id));
    }
  }
}
