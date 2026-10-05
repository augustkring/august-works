import { and, eq, inArray } from "drizzle-orm";
import { cognitiveMemoryBindings, cognitiveProviderOperations, memoryRecords, type Db } from "@paperclipai/db";
import { localCognitiveProvider } from "./cognitive-provider.js";
import { invalidateDerivedMemory } from "./derived-privacy.js";
/** Privacy propagation executes in the source transaction, independent of rollout flags. */
export async function invalidateCognitiveRecords(tx: Db, companyId: string, recordIds: string[]) {
  if (!recordIds.length) return;
  await invalidateDerivedMemory(tx, companyId, recordIds);
  const records = await tx.select({ id: memoryRecords.id, updatedAt: memoryRecords.updatedAt, scopeType: memoryRecords.scopeType, scopeId: memoryRecords.scopeId })
    .from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, recordIds)));
  const bindings = await tx.select().from(cognitiveMemoryBindings).where(eq(cognitiveMemoryBindings.companyId, companyId));
  for (const binding of bindings) {
    const versions = records.filter((record) => record.scopeType === binding.scopeType && record.scopeId === binding.scopeId).map((record) => ({ id: record.id, version: record.updatedAt.toISOString() }));
    if (!versions.length) continue;
    const [operation] = await tx.insert(cognitiveProviderOperations).values({ companyId, bindingId: binding.id, operationType: "delete", recordVersions: versions }).returning();
    if (binding.providerKey === "local_baseline" || binding.providerKey === "noop") {
      const result = await localCognitiveProvider(binding.providerKey).deleteGovernedRecords({ companyId, bindingId: binding.id, scopeType: binding.scopeType, scopeId: binding.scopeId, purpose: binding.purpose }, versions);
      await tx.update(cognitiveProviderOperations).set({ status: "succeeded", attemptCount: 1, receiptHash: result.receipt, completedAt: new Date() }).where(eq(cognitiveProviderOperations.id, operation!.id));
    } else {
      await tx.update(cognitiveMemoryBindings).set({ status: "degraded", updatedAt: new Date() }).where(eq(cognitiveMemoryBindings.id, binding.id));
    }
  }
}
