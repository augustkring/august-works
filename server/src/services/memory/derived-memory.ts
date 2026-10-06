import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { memoryRecords, memoryEvidence, memoryObservations, memoryObservationEvidence, memoryModels, memoryModelVersions, memoryModelEvidence, memoryJobs, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { createObservationSchema, createMemoryModelSchema, rebuildMemoryModelSchema, derivedReviewSchema, EVIDENCE_SENSITIVITIES, type EvidenceSensitivity, type MemoryScope } from "@paperclipai/shared";
import { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { conflict, forbidden, notFound } from "../../errors.js";
import { memoryService } from "./memory-service.js";
import { cognitiveMemoryActor } from "./cognitive-memory.js";
import { memorySensitivityAllowed } from "./memory-retrieval.js";
import { lockMemoryPrivacy, memoryPayloadVisible } from "./memory-privacy.js";
import { assertSaasDomainAdmission } from "../saas/domain-admission.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { persistActivity } from "../activity-log.js";

type Observation = typeof memoryObservations.$inferSelect;
type Model = typeof memoryModels.$inferSelect;
type Root = typeof memoryRecords.$inferSelect;
export async function assertDerivedManager(db: Db, actor: AuthorizationActor, companyId: string) {
  v7HumanActorId(actor); await assertV7Authorization(db, actor, companyId, "company_scope:read");
  if (!(await memoryService(db).getRetentionPolicy(companyId, cognitiveMemoryActor(actor))).canManage) throw forbidden("Derived intelligence review requires a current company administrator");
}
async function assertScope(db: Db, actor: AuthorizationActor, companyId: string, scope: MemoryScope) {
  await assertV7Authorization(db, actor, companyId, "company_scope:read");
  if (scope.type === "agent") throw forbidden("Private Memory cannot be broadened through shared derived intelligence");
  if (scope.type === "project") await assertV7Authorization(db, actor, companyId, "project:read", { type: "project", companyId, projectId: scope.id });
}
export async function assertDerivedWorker(tx: Db, actor: AuthorizationActor, companyId: string) {
  if (actor.type !== "agent") return;
  if (!actor.runId || !actor.agentId) throw forbidden("A live worker attempt is required for derived candidates");
  await assertAgentRunWriteAllowed(tx, companyId, actor);
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.agentId, actor.agentId)));
  const issueId = run?.contextSnapshot?.issueId;
  if (run?.status !== "running" || typeof issueId !== "string") throw forbidden("Derived candidate requires a running Task worker");
  const [task] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
  if (!task || task.status !== "in_progress" || task.assigneeAgentId !== actor.agentId || task.checkoutRunId !== actor.runId || task.executionRunId !== actor.runId) throw forbidden("Worker no longer owns this Task");
}
export async function derivedRoots(db: Db, actor: AuthorizationActor, companyId: string, scope: MemoryScope, purpose: string, ids: string[], expected?: Map<string, string>) {
  await assertScope(db, actor, companyId, scope);
  const uniqueIds = [...new Set(ids)]; if (!uniqueIds.length || uniqueIds.length > 64) throw conflict("Derived intelligence requires bounded surviving Memory roots");
  const roots = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId), inArray(memoryRecords.id, uniqueIds), memoryPayloadVisible()));
  if (roots.length !== uniqueIds.length) throw notFound("Derived source Memory not found");
  const now = Date.now();
  if (roots.some((root) => root.scopeType !== scope.type || root.scopeId !== scope.id || root.ownerAgentId !== null || root.deletedAt || root.revokedAt
    || root.reviewState !== "accepted" || root.retentionState !== "active" || root.supersededByRecordId || (root.validFrom && root.validFrom.getTime() > now)
    || (root.validUntil && root.validUntil.getTime() <= now) || (root.expiresAt && root.expiresAt.getTime() <= now)
    || (Array.isArray(root.metadata.allowedPurposes) && !root.metadata.allowedPurposes.includes(purpose))
    || (expected && expected.get(root.id) !== root.updatedAt.toISOString()))) throw conflict("Derived evidence is no longer current, accepted or compatible with its scope and purpose");
  return roots.sort((a, b) => a.id.localeCompare(b.id));
}
function sensitivity(roots: Root[]): EvidenceSensitivity { return EVIDENCE_SENSITIVITIES[Math.max(...roots.map((root) => EVIDENCE_SENSITIVITIES.indexOf(root.sensitivityLabel)))]!; }
function watermark(roots: Root[], observations: Observation[] = []) { return nativeSha256({ roots: roots.map((root) => ({ id: root.id, version: root.updatedAt.toISOString() })), observations: observations.map((row) => ({ id: row.id, version: row.version })).sort((a, b) => a.id.localeCompare(b.id)) }); }
export async function observationLineage(db: Db, actor: AuthorizationActor, row: Observation) {
  await assertScope(db, actor, row.companyId, { type: row.scopeType as MemoryScope["type"], id: row.scopeId });
  const evidence = await db.select().from(memoryObservationEvidence).where(and(eq(memoryObservationEvidence.companyId, row.companyId), eq(memoryObservationEvidence.observationId, row.id)));
  const roots = await derivedRoots(db, actor, row.companyId, { type: row.scopeType as MemoryScope["type"], id: row.scopeId }, row.purpose, evidence.map((item) => item.memoryRecordId), new Map(evidence.map((item) => [item.memoryRecordId, item.sourceVersion])));
  return { evidence, roots };
}
export async function modelLineage(db: Db, actor: AuthorizationActor, row: Model) {
  await assertScope(db, actor, row.companyId, { type: row.scopeType as MemoryScope["type"], id: row.scopeId });
  const evidence = await db.select().from(memoryModelEvidence).where(and(eq(memoryModelEvidence.companyId, row.companyId), eq(memoryModelEvidence.modelId, row.id), eq(memoryModelEvidence.modelVersion, row.version)));
  const roots = await derivedRoots(db, actor, row.companyId, { type: row.scopeType as MemoryScope["type"], id: row.scopeId }, row.purpose, evidence.map((item) => item.memoryRecordId), new Map(evidence.map((item) => [item.memoryRecordId, item.sourceVersion])));
  const observationIds = [...new Set(evidence.flatMap((item) => item.observationId ? [item.observationId] : []))];
  const observations = observationIds.length ? await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, row.companyId), inArray(memoryObservations.id, observationIds))) : [];
  if (observations.length !== observationIds.length || observations.some((observation) => observation.status !== "accepted" || observation.erasedAt || evidence.some((item) => item.observationId === observation.id && item.observationVersion !== observation.version))) throw conflict("Model observation evidence requires current review");
  for (const observation of observations) await observationLineage(db, actor, observation);
  return { evidence, roots, observations };
}
async function modelSources(db: Db, actor: AuthorizationActor, companyId: string, input: z.infer<typeof createMemoryModelSchema>) {
  const observations = input.observationIds.length ? await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, companyId), inArray(memoryObservations.id, input.observationIds))) : [];
  if (observations.length !== input.observationIds.length || observations.some((row) => row.status !== "accepted" || row.scopeType !== input.scope.type || row.scopeId !== input.scope.id || row.purpose !== input.purpose)) throw conflict("Select accepted observations with matching scope and purpose");
  const links = await Promise.all(observations.map((row) => observationLineage(db, actor, row)));
  const roots = await derivedRoots(db, actor, companyId, input.scope, input.purpose, [...input.memoryRecordIds, ...links.flatMap((link) => link.roots.map((root) => root.id))]);
  const content = [...observations.map((row) => `[Derived observation ${row.id}] ${row.content}`), ...roots.map((root) => `[Memory ${root.id}] ${root.summary ?? root.content}`)].join("\n\n").slice(0, 64000);
  return { observations, roots, links, content, sourceWatermark: watermark(roots, observations) };
}
async function writeModelVersion(tx: Db, row: Model, sources: Awaited<ReturnType<typeof modelSources>>) {
  await tx.insert(memoryModelVersions).values({ companyId: row.companyId, modelId: row.id, version: row.version, content: sources.content, sourceWatermark: sources.sourceWatermark });
  const edges: Array<typeof memoryModelEvidence.$inferInsert> = sources.roots.map((root) => ({ companyId: row.companyId, modelId: row.id, modelVersion: row.version, memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString(), relationship: "derived_from" }));
  sources.observations.forEach((observation, index) => sources.links[index]!.evidence.forEach((edge) => edges.push({ companyId: row.companyId, modelId: row.id, modelVersion: row.version, memoryRecordId: edge.memoryRecordId, sourceVersion: edge.sourceVersion, observationId: observation.id, observationVersion: observation.version, relationship: edge.relationship })));
  await tx.insert(memoryModelEvidence).values(edges);
}
export function derivedMemoryService(db: Db) {
  async function observation(actor: AuthorizationActor, companyId: string, id: string, tx = db, lock = false) {
    await assertV7Enabled(tx, "memory_observations_v7"); await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    const query = tx.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, companyId), eq(memoryObservations.id, id)));
    const [row] = await (lock ? query.for("update") : query); if (!row || row.erasedAt) throw notFound("Observation not found"); return row;
  }
  async function model(actor: AuthorizationActor, companyId: string, id: string, tx = db, lock = false) {
    await assertV7Enabled(tx, "memory_models_v7"); await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    const query = tx.select().from(memoryModels).where(and(eq(memoryModels.companyId, companyId), eq(memoryModels.id, id)));
    const [row] = await (lock ? query.for("update") : query); if (!row || row.erasedAt) throw notFound("Mental model not found"); return row;
  }
  const identity = (actor: AuthorizationActor) => ({ actorType: actor.type === "agent" ? "agent" as const : "user" as const, actorId: actor.type === "agent" ? actor.agentId! : v7HumanActorId(actor) });
  return {
    listObservations: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "memory_observations_v7"); await assertV7Authorization(db, actor, companyId, "company_scope:read");
      const rows = await db.select().from(memoryObservations).where(and(eq(memoryObservations.companyId, companyId), isNull(memoryObservations.erasedAt))).orderBy(desc(memoryObservations.updatedAt)).limit(100);
      const visible: Observation[] = [];
      for (const row of rows) { try { await observationLineage(db, actor, row); visible.push(row); } catch (error) { if (error && typeof error === "object" && "status" in error && Number(error.status) === 409) visible.push({ ...row, content: "", status: "needs_review", confidence: 0 }); if (!(error && typeof error === "object" && "status" in error && [403, 404, 409].includes(Number(error.status)))) throw error; } }
      return visible;
    },
    getObservation: async (actor: AuthorizationActor, companyId: string, id: string) => { const row = await observation(actor, companyId, id); try { const lineage = await observationLineage(db, actor, row); return { ...row, evidence: lineage.evidence }; } catch (error) { if (!(error && typeof error === "object" && "status" in error && Number(error.status) === 409)) throw error; return { ...row, content: "", status: "needs_review", confidence: 0, evidence: [] }; } },
    createObservation: async (actor: AuthorizationActor, companyId: string, raw: z.input<typeof createObservationSchema>) => {
      const input = createObservationSchema.parse(raw); await assertV7Enabled(db, "memory_observations_v7"); await assertScope(db, actor, companyId, input.scope); await assertSaasDomainAdmission(db, companyId, "memory.use");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await assertDerivedWorker(tx, actor, companyId);
        const roots = await derivedRoots(tx, actor, companyId, input.scope, input.purpose, input.evidence.map((edge) => edge.memoryRecordId));
        if (roots.some((root) => !memorySensitivityAllowed(root, input.sensitivity))) throw forbidden("Observation cannot reduce root sensitivity");
        const supporting = roots.filter((root) => input.evidence.some((edge) => edge.memoryRecordId === root.id && edge.relation === "supports"));
        const rootEvidence = supporting.length ? await tx.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId, companyId), inArray(memoryEvidence.memoryRecordId, supporting.map((root) => root.id)))) : [];
        const trusted = rootEvidence.filter((edge) => edge.supportsOrContradicts === "supports" && edge.sourceClass !== "external_untrusted" && ["high", "medium"].includes(edge.trustLevel));
        const trustedSupportingRoots = supporting.filter((root) => trusted.some((edge) => edge.memoryRecordId === root.id));
        const independence = Math.min(new Set(trusted.map((edge) => `${edge.sourceProvider}:${edge.sourceRef}`)).size, new Set(trusted.map((edge) => edge.excerptHash)).size,
          trustedSupportingRoots.length, new Set(trustedSupportingRoots.map((root) => nativeSha256(root.content))).size);
        const contradictions = input.evidence.filter((edge) => edge.relation === "contradicts").length;
        const eligible = supporting.length >= 2 && trustedSupportingRoots.length === supporting.length && independence >= 2 && !contradictions && supporting.every((root) => ["human_verified", "system_verified", "corroborated"].includes(root.verificationState));
        const [row] = await tx.insert(memoryObservations).values({ companyId, observationKey: input.observationKey, scopeType: input.scope.type, scopeId: input.scope.id, purpose: input.purpose, content: input.content,
          status: eligible ? "candidate" : "needs_review", confidence: Math.min(...roots.map((root) => root.confidenceScore)), sensitivity: input.sensitivity, supportCount: supporting.length, contradictionCount: contradictions, independentSourceCount: independence }).returning();
        await tx.insert(memoryObservationEvidence).values(input.evidence.map((edge) => { const root = roots.find((item) => item.id === edge.memoryRecordId)!; return { companyId, observationId: row!.id, memoryRecordId: root.id, sourceVersion: root.updatedAt.toISOString(), relationship: edge.relation, rootFingerprint: nativeSha256({ id: root.id, version: root.updatedAt.toISOString() }) }; }));
        await logActivity(tx, { companyId, ...identity(actor), action: "memory.observation_proposed", entityType: "memory_observation", entityId: row!.id, details: { supportCount: supporting.length, independentSourceCount: independence, contradictions } }, publications);
        return row!;
      });
    },
    reviewObservation: async (actor: AuthorizationActor, companyId: string, id: string, decision: "accept" | "reject" | "revoke", raw: z.infer<typeof derivedReviewSchema>) => {
      const input = derivedReviewSchema.parse(raw); await assertDerivedManager(db, actor, companyId);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); const row = await observation(actor, companyId, id, tx, true);
        if (row.version !== input.expectedVersion || ["revoked", "rejected", "superseded", "expired"].includes(row.status)) throw conflict("Observation changed");
        if (decision === "accept") {
          if (row.status !== "candidate" || row.supportCount < 2 || row.independentSourceCount < 2 || row.contradictionCount) throw conflict("Observation requires stronger independent supporting evidence");
          await observationLineage(tx, actor, row);
        }
        const [updated] = await tx.update(memoryObservations).set({ status: decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "revoked", version: row.version + 1,
          reviewedByUserId: v7HumanActorId(actor), reviewedAt: new Date(), revokedAt: decision === "revoke" ? new Date() : null, updatedAt: new Date() }).where(eq(memoryObservations.id, id)).returning();
        await invalidateObservationModels(tx, companyId, [id]);
        await logActivity(tx, { companyId, ...identity(actor), action: `memory.observation_${decision}`, entityType: "memory_observation", entityId: id, details: { version: updated!.version } }, publications);
        return updated!;
      });
    },
    listModels: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "memory_models_v7"); await assertV7Authorization(db, actor, companyId, "company_scope:read");
      const rows = await db.select().from(memoryModels).where(and(eq(memoryModels.companyId, companyId), isNull(memoryModels.erasedAt))).orderBy(desc(memoryModels.updatedAt)).limit(100);
      const visible: Model[] = [];
      for (const row of rows) { try { await modelLineage(db, actor, row); visible.push(row); } catch (error) { if (error && typeof error === "object" && "status" in error && Number(error.status) === 409) visible.push({ ...row, content: "", status: "needs_rebuild", confidence: 0 }); if (!(error && typeof error === "object" && "status" in error && [403, 404, 409].includes(Number(error.status)))) throw error; } }
      return visible;
    },
    getModel: async (actor: AuthorizationActor, companyId: string, id: string) => { const row = await model(actor, companyId, id); try { const lineage = await modelLineage(db, actor, row); return { ...row, evidence: lineage.evidence }; } catch (error) { if (!(error && typeof error === "object" && "status" in error && Number(error.status) === 409)) throw error; return { ...row, content: "", status: "needs_rebuild", confidence: 0, evidence: [] }; } },
    createModel: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof createMemoryModelSchema>) => {
      const input = createMemoryModelSchema.parse(raw); await assertV7Enabled(db, "memory_models_v7"); await assertScope(db, actor, companyId, input.scope); await assertSaasDomainAdmission(db, companyId, "memory.use");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await assertDerivedWorker(tx, actor, companyId); const sources = await modelSources(tx, actor, companyId, input);
        const [row] = await tx.insert(memoryModels).values({ companyId, modelKey: input.modelKey, name: input.name, scopeType: input.scope.type, scopeId: input.scope.id, purpose: input.purpose, sourceQuery: input.sourceQuery,
          content: sources.content, confidence: Math.min(...sources.roots.map((root) => root.confidenceScore)), sensitivity: sensitivity(sources.roots), sourceWatermark: sources.sourceWatermark, lastRebuiltAt: new Date() }).onConflictDoNothing().returning();
        if (!row) throw conflict("A model with this key already exists"); await writeModelVersion(tx, row, sources);
        await logActivity(tx, { companyId, ...identity(actor), action: "memory.model_proposed", entityType: "memory_model", entityId: row.id, details: { version: 1, sourceWatermark: row.sourceWatermark } }, publications); return row;
      });
    },
    reviewModel: async (actor: AuthorizationActor, companyId: string, id: string, decision: "accept" | "revoke", raw: z.infer<typeof derivedReviewSchema>) => {
      const input = derivedReviewSchema.parse(raw); await assertDerivedManager(db, actor, companyId);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); const row = await model(actor, companyId, id, tx, true);
        if (row.version !== input.expectedVersion || row.status === "revoked") throw conflict("Model changed");
        if (decision === "accept") { if (row.status !== "candidate") throw conflict("Rebuild and review a current candidate first"); await modelLineage(tx, actor, row); }
        const [updated] = await tx.update(memoryModels).set({ status: decision === "accept" ? "active" : "revoked", reviewedByUserId: v7HumanActorId(actor), reviewedAt: new Date(), revokedAt: decision === "revoke" ? new Date() : null, updatedAt: new Date() }).where(eq(memoryModels.id, id)).returning();
        await logActivity(tx, { companyId, ...identity(actor), action: `memory.model_${decision}`, entityType: "memory_model", entityId: id, details: { version: row.version } }, publications); return updated!;
      });
    },
    rebuildModel: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof rebuildMemoryModelSchema>) => {
      const input = rebuildMemoryModelSchema.parse(raw); await assertDerivedManager(db, actor, companyId); await assertSaasDomainAdmission(db, companyId, "memory.use");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); const row = await model(actor, companyId, id, tx, true);
        if (row.version !== input.expectedVersion || row.status === "revoked") throw conflict("Model changed");
        const sources = await modelSources(tx, actor, companyId, { ...input, modelKey: row.modelKey, name: row.name, purpose: row.purpose, sourceQuery: row.sourceQuery, scope: { type: row.scopeType as MemoryScope["type"], id: row.scopeId } });
        const sourceRefJson = { modelId: id, expectedVersion: row.version, memoryRecordIds: input.memoryRecordIds, observationIds: input.observationIds, recordIds: sources.roots.map((root) => root.id), sourceWatermark: sources.sourceWatermark,
          requester: actor.source === "local_implicit" ? { type: "system", service: "local-board" } : { type: "user", userId: v7HumanActorId(actor) } };
        const [job] = await tx.insert(memoryJobs).values({ companyId, operationType: "model_rebuild", jobKey: `model-rebuild:${id}:${row.version}:${sources.sourceWatermark}`, sourceRefJson }).onConflictDoNothing().returning();
        const [existing] = job ? [job] : await tx.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, `model-rebuild:${id}:${row.version}:${sources.sourceWatermark}`), eq(memoryJobs.attemptNumber, 1)));
        await tx.update(memoryModels).set({ status: "needs_rebuild", updatedAt: new Date() }).where(eq(memoryModels.id, id));
        await logActivity(tx, { companyId, ...identity(actor), action: "memory.model_rebuild_requested", entityType: "memory_model", entityId: id, details: { jobId: existing!.id, version: row.version } }, publications); return existing!;
      });
    },
  };
}
export async function invalidateObservationModels(tx: Db, companyId: string, observationIds: string[]) {
  if (!observationIds.length) return;
  const edges = await tx.select({ modelId: memoryModelEvidence.modelId }).from(memoryModelEvidence).where(and(eq(memoryModelEvidence.companyId, companyId), inArray(memoryModelEvidence.observationId, observationIds)));
  if (edges.length) await tx.update(memoryModels).set({ status: "needs_rebuild", updatedAt: new Date() }).where(and(eq(memoryModels.companyId, companyId), inArray(memoryModels.id, edges.map((edge) => edge.modelId)), inArray(memoryModels.status, ["candidate", "active", "degraded"])));
}
const rebuildJobSchema = z.object({ modelId: z.string().uuid(), expectedVersion: z.number().int().positive(), memoryRecordIds: z.array(z.string().uuid()), observationIds: z.array(z.string().uuid()), recordIds: z.array(z.string().uuid()), sourceWatermark: z.string().regex(/^[a-f0-9]{64}$/), requester: z.union([z.object({ type: z.literal("system"), service: z.literal("local-board") }).strict(), z.object({ type: z.literal("user"), userId: z.string().min(1) }).strict()]) }).strict();
/** Called by the existing leased Memory job worker in its source-privacy transaction. */
export async function executeModelRebuild(tx: Db, job: typeof memoryJobs.$inferSelect) {
  await assertV7Enabled(tx, "memory_models_v7"); const source = rebuildJobSchema.parse(job.sourceRefJson);
  const actor: AuthorizationActor = source.requester.type === "system" ? { type: "board", source: "local_implicit" } : { type: "board", source: "session", userId: source.requester.userId };
  await assertDerivedManager(tx, actor, job.companyId);
  const [row] = await tx.select().from(memoryModels).where(and(eq(memoryModels.companyId, job.companyId), eq(memoryModels.id, source.modelId))).for("update");
  if (!row || row.erasedAt || row.status === "revoked" || row.version !== source.expectedVersion) throw conflict("Rebuild target changed or was erased");
  const sources = await modelSources(tx, actor, job.companyId, { modelKey: row.modelKey, name: row.name, purpose: row.purpose, sourceQuery: row.sourceQuery, scope: { type: row.scopeType as MemoryScope["type"], id: row.scopeId }, memoryRecordIds: source.memoryRecordIds, observationIds: source.observationIds });
  if (sources.sourceWatermark !== source.sourceWatermark) throw conflict("Rebuild requires freshly selected source evidence");
  const [updated] = await tx.update(memoryModels).set({ content: sources.content, status: "candidate", version: row.version + 1, confidence: Math.min(...sources.roots.map((root) => root.confidenceScore)), sensitivity: sensitivity(sources.roots), sourceWatermark: sources.sourceWatermark,
    reviewedAt: null, reviewedByUserId: null, lastRebuiltAt: new Date(), updatedAt: new Date() }).where(eq(memoryModels.id, row.id)).returning();
  await writeModelVersion(tx, updated!, sources);
  const publication = await persistActivity(tx, { companyId: job.companyId, actorType: "system", actorId: "memory-model-rebuild", action: "memory.model_rebuilt", entityType: "memory_model", entityId: row.id, details: { jobId: job.id, version: updated!.version, sourceWatermark: sources.sourceWatermark } });
  return { result: { modelId: row.id, version: updated!.version, status: "candidate", sourceWatermark: sources.sourceWatermark }, publication: publication.publication };
}
