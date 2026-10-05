import { and, eq, ne, or } from "drizzle-orm";
import { agents, projects, cognitiveMemoryBindings, cognitiveProviderOperations, type Db } from "@paperclipai/db";
import { cognitiveBindingSchema, v7FeatureEnabled, type CognitiveRecallRequest, type EvidenceSensitivity } from "@paperclipai/shared";
import type { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";
import { memorySensitivityAllowed } from "./memory-retrieval.js";
import { lockMemoryPrivacy } from "./memory-privacy.js";
import { cognitiveProjection, cognitiveProviderForKey, assertCognitiveRecallUniverse } from "./cognitive-provider.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";

export function cognitiveMemoryActor(actor: AuthorizationActor): MemoryMutationActor {
  if (actor.type === "agent" && actor.agentId) return { principal: { type: "agent", agentId: actor.agentId, responsibleUserId: actor.onBehalfOfUserId ?? null }, runId: actor.runId ?? null };
  const userId = v7HumanActorId(actor);
  return actor.source === "local_implicit" ? { principal: { type: "system", service: "local-board" } } : { principal: { type: "user", userId } };
}
async function assertManager(db: Db, actor: AuthorizationActor, companyId: string) {
  v7HumanActorId(actor);
  await assertV7Authorization(db, actor, companyId, "company_scope:read");
  if (!(await memoryService(db).getRetentionPolicy(companyId, cognitiveMemoryActor(actor))).canManage) throw forbidden("Cognitive provider configuration requires a company administrator");
}
type Binding = typeof cognitiveMemoryBindings.$inferSelect;
export async function cognitiveEligibleRecords(db: Db, binding: Binding, actor: AuthorizationActor, purpose: string, ceiling: EvidenceSensitivity) {
  await assertV7Authorization(db, actor, binding.companyId, "company_scope:read");
  await assertSaasDomainAdmission(db, binding.companyId, "memory.use");
  if (binding.status !== "active" || binding.purpose !== purpose) return [];
  if (binding.scopeType === "agent" && (actor.type !== "agent" || actor.agentId !== binding.scopeId || !binding.approvedPrivateProjection)) return [];
  const records = await memoryService(db).listEligible(binding.companyId, { scopeType: binding.scopeType, scopeId: binding.scopeId, limit: 100 }, cognitiveMemoryActor(actor));
  return records.filter((record) => memorySensitivityAllowed(record, ceiling) && memorySensitivityAllowed(record, binding.sensitivityCeiling)
    && (binding.scopeType !== "agent" || ["human_verified", "system_verified"].includes(record.verificationState))
    && (!Array.isArray(record.metadata.allowedPurposes) || record.metadata.allowedPurposes.includes(purpose)));
}
export function cognitiveMemoryService(db: Db) {
  async function binding(actor: AuthorizationActor, companyId: string, id: string) {
    await assertV7Enabled(db, "cognitive_memory_v7");
    await assertV7Authorization(db, actor, companyId, "company_scope:read");
    const [row] = await db.select().from(cognitiveMemoryBindings).where(and(eq(cognitiveMemoryBindings.companyId, companyId), eq(cognitiveMemoryBindings.id, id)));
    if (!row || (row.scopeType === "agent" && (actor.type !== "agent" || actor.agentId !== row.scopeId))) throw notFound("Cognitive binding not found");
    return row;
  }
  return {
    status: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "cognitive_memory_v7");
      await assertV7Authorization(db, actor, companyId, "company_scope:read");
      const bindings = await db.select().from(cognitiveMemoryBindings).where(and(eq(cognitiveMemoryBindings.companyId, companyId),
        actor.type === "agent" && actor.agentId ? or(ne(cognitiveMemoryBindings.scopeType, "agent"), eq(cognitiveMemoryBindings.scopeId, actor.agentId)) : ne(cognitiveMemoryBindings.scopeType, "agent")));
      return { mode: "governed_only", providers: ["local_baseline", "noop"], hindsight: "deferred_pending_qualification", bindings };
    },
    createBinding: async (actor: AuthorizationActor, companyId: string, raw: z.input<typeof cognitiveBindingSchema>) => {
      await assertV7Enabled(db, "cognitive_memory_v7"); await assertManager(db, actor, companyId);
      await assertSaasDomainAdmission(db, companyId, "memory.use");
      const input = cognitiveBindingSchema.parse(raw);
      if (input.scope.type === "agent") {
        const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.scope.id!)));
        if (!agent) throw notFound("Cognitive scope agent not found");
      }
      if (input.scope.type === "project") {
        const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, input.scope.id!)));
        if (!project) throw notFound("Cognitive scope project not found");
      }
      const conformance = await cognitiveProviderForKey(input.providerKey).conformance();
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [row] = await tx.insert(cognitiveMemoryBindings).values({ companyId, bindingKey: input.bindingKey, providerKey: input.providerKey,
          scopeType: input.scope.type, scopeId: input.scope.id, sensitivityCeiling: input.sensitivityCeiling, purpose: input.purpose,
          approvedPrivateProjection: input.approvedPrivateProjection, capabilitySnapshot: conformance, conformanceHash: nativeSha256(conformance) }).onConflictDoNothing().returning();
        if (!row) throw conflict("A cognitive binding with this key already exists");
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "memory.cognitive_binding_created", entityType: "cognitive_memory_binding", entityId: row.id, details: { provider: input.providerKey, scopeType: input.scope.type } }, publications);
        return row;
      });
    },
    reconcile: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await assertManager(db, actor, companyId);
      const row = await binding(actor, companyId, id), provider = cognitiveProviderForKey(row.providerKey);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const records = await cognitiveEligibleRecords(tx, row, actor, row.purpose, row.sensitivityCeiling);
        const versions = records.map((record) => ({ id: record.id, version: record.updatedAt.toISOString() }));
        const [operation] = await tx.insert(cognitiveProviderOperations).values({ companyId, bindingId: id, operationType: "reconcile", recordVersions: versions, status: "running", attemptCount: 1 }).returning();
        try {
          const health = await provider.health(), conformance = await provider.conformance();
          if (health.status !== "healthy" || nativeSha256(conformance) !== row.conformanceHash) throw new Error("provider_conformance_drift");
          const result = await provider.upsertGovernedRecords({ companyId, bindingId: id, scopeType: row.scopeType, scopeId: row.scopeId, purpose: row.purpose }, records.map(cognitiveProjection));
          await tx.update(cognitiveProviderOperations).set({ status: "succeeded", receiptHash: result.receipt, completedAt: new Date() }).where(eq(cognitiveProviderOperations.id, operation!.id));
          await tx.update(cognitiveMemoryBindings).set({ lastHealthyAt: new Date(), lastReconciledAt: new Date(), updatedAt: new Date() }).where(eq(cognitiveMemoryBindings.id, id));
          await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "memory.cognitive_reconciled", entityType: "cognitive_memory_binding", entityId: id, details: { operationId: operation!.id, count: records.length, scanLimit: 100 } }, publications);
          return { operationId: operation!.id, status: "succeeded", count: records.length, scanLimit: 100, providerStorage: conformance.storage };
        } catch {
          await tx.update(cognitiveProviderOperations).set({ status: "failed", errorCode: "provider_health_or_conformance_failed", completedAt: new Date() }).where(eq(cognitiveProviderOperations.id, operation!.id));
          await tx.update(cognitiveMemoryBindings).set({ status: "degraded", updatedAt: new Date() }).where(eq(cognitiveMemoryBindings.id, id));
          await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: "memory.cognitive_degraded", entityType: "cognitive_memory_binding", entityId: id, details: { operationId: operation!.id } }, publications);
          return { operationId: operation!.id, status: "failed", count: 0, scanLimit: 100 };
        }
      });
    },
    recall: async (actor: AuthorizationActor, companyId: string, id: string, input: { query: string; purpose: string; sensitivityCeiling: EvidenceSensitivity; topK: number; signal?: AbortSignal }) => {
      if (!v7FeatureEnabled(await instanceSettingsService(db).getExperimental(), "cognitive_memory_v7")) return [];
      const row = await binding(actor, companyId, id), records = await cognitiveEligibleRecords(db, row, actor, input.purpose, input.sensitivityCeiling);
      const request: CognitiveRecallRequest = { scope: { companyId, bindingId: id, scopeType: row.scopeType, scopeId: row.scopeId, purpose: input.purpose }, allowedRecords: records.map(cognitiveProjection),
        query: input.query, topK: Math.min(50, Math.max(1, input.topK)), signal: input.signal };
      const hits = await cognitiveProviderForKey(row.providerKey).recall(request); assertCognitiveRecallUniverse(request, hits);
      // Return only original governed records, never provider-generated payload.
      const current = await cognitiveEligibleRecords(db, row, actor, input.purpose, input.sensitivityCeiling);
      return hits.flatMap((hit) => { const record = current.find((item) => item.id === hit.id && item.updatedAt.toISOString() === hit.version); return record ? [{ record, score: hit.score }] : []; });
    },
  };
}
