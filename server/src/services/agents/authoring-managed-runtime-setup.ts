import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { activityLog, agents, companyMemberships, runtimeCapacityProfiles, runtimeVersionCatalog,
  runtimeCells, runtimeOperations, type Db } from "@paperclipai/db";
import { agentManagedRuntimeSetupCatalogSchema, agentManagedRuntimeSetupCommandSchema,
  agentManagedRuntimeSetupReviewInputSchema, agentManagedRuntimeSetupReviewSchema, agentManagedRuntimeSetupReceiptSchema,
  v6FeatureEnabled, v6FeatureFlagsSchema } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
import { agentAuthoringService } from "./authoring-drafts.js";
import { entitlementService } from "../billing/entitlements.js";
import { accessService } from "../access.js";
import { instanceSettingsService } from "../instance-settings.js";
import { runtimeControlService } from "../runtime/control.js";
import { assertRuntimeQualificationEvidenceCurrent } from "../runtime/catalog.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { v5HumanActorId } from "../v5-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";

const action = "agent_configuration.managed_runtime_requested", schema = "agent-managed-runtime-setup-v1";
const evidenceSchema = z.object({ reportUri: z.url(), reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  qualifiedAt: z.iso.datetime(), qualificationSourceSha: z.string().regex(/^[a-f0-9]{40}$/) }).passthrough();
type Selection = z.infer<typeof agentManagedRuntimeSetupReviewInputSchema>;

/** Compose the current authoring draft with the Original V6 provisioning owner.
 * This creates a durable provisioning request, never a second provisioning
 * engine, model grant, live binding, qualified runtime or activated Agent. */
export function agentAuthoringManagedRuntimeSetupService(db: Db, config?: SaasPlatformConfig) {
  async function owner(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, write = false) {
    const userId = v5HumanActorId(actor), current = { ...actor, ignoreInstanceAdmin: true, isInstanceAdmin: false };
    const draft = await agentAuthoringService(tx).runtimeCandidateSnapshot(current, companyId, draftId, write);
    const agentId = draft.agentId ?? draft.preparedAgentId;
    if (!agentId) throw conflict("Prepare the inactive Agent before managed runtime setup");
    const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
    if (!agent || agent.status === "terminated") throw notFound("The draft's actual Agent is unavailable");
    const [membership] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active")));
    if (!membership || !(["owner", "admin"].includes(membership.membershipRole ?? "") ||
      (await accessService(tx).decide({ actor: current, action: "runtime:manage", resource: { type: "company", companyId } })).allowed))
      throw forbidden("Current company runtime management authority is required");
    return { draft, agent, userId };
  }
  function qualification(value: unknown) {
    if (!config) throw notFound("Managed provisioning is unavailable");
    const proof = evidenceSchema.safeParse(value);
    if (!proof.success) return false;
    try { assertRuntimeQualificationEvidenceCurrent(config, proof.data, new Date()); return true; }
    catch { return false; }
  }
  async function decision(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, selection?: Selection, ownCreatedCellId?: string) {
    const state = await owner(tx, actor, companyId, draftId, true);
    if (!config || !v6FeatureEnabled(v6FeatureFlagsSchema.parse(await instanceSettingsService(tx).getExperimental()), "hosted_openclaw_v6"))
      throw notFound("Managed provisioning is unavailable");
    const commercial = await entitlementService(tx).require(companyId, "hosted_runtime.provision");
    await entitlementService(tx).require(companyId, "platform.access");
    const cells = (await tx.select().from(runtimeCells).where(and(eq(runtimeCells.billingAccountId, commercial.billingAccountId), isNull(runtimeCells.deletedAt))).for("share"))
      .filter(cell => cell.id !== ownCreatedCellId);
    const occupied = cells.filter(cell => cell.isolationMode === "company_cell").length;
    const available = Math.max(0, Number(commercial.entitlements["hosted_runtime.standard.max_cells"]) - occupied);
    // Resolve performance usage through its actual catalog product, never a
    // capacity-name convention or an assumed subscription tier.
    const profiles = await tx.select().from(runtimeCapacityProfiles).where(eq(runtimeCapacityProfiles.qualified, true)).limit(101).for("share");
    const usedProfiles = cells.length ? await tx.select({ key: runtimeCapacityProfiles.key, product: runtimeCapacityProfiles.commercialProductKey })
      .from(runtimeCapacityProfiles).where(inArray(runtimeCapacityProfiles.key, [...new Set(cells.map(cell => cell.capacityProfile))])) : [];
    const performanceUsed = cells.filter(cell => usedProfiles.some(p => p.key === cell.capacityProfile && p.product === "runtime_performance")).length;
    const versions = await tx.select().from(runtimeVersionCatalog).where(eq(runtimeVersionCatalog.status, "approved")).limit(101).for("share");
    if (profiles.length > 100 || versions.length > 100) throw unprocessable("Review the bounded managed runtime catalog in Advanced setup");
    const selectable = profiles.filter(p => ["runtime_standard", "runtime_performance"].includes(p.commercialProductKey) &&
      p.benchmarkEvidence?.hostPlan === config.runtime.hostPlan && qualification(p.benchmarkEvidence));
    const approved = versions.filter(v => v.approvedAt && v.approvedByUserId && qualification(v.conformance));
    const catalog = agentManagedRuntimeSetupCatalogSchema.parse({ companyId, draftId, agentId: state.agent.id, version: state.draft.version,
      capacity: selectable.map(p => ({ key: p.key, product: p.commercialProductKey, availableCells: p.commercialProductKey === "runtime_performance"
        ? Math.min(available, Math.max(0, Number(commercial.entitlements["hosted_runtime.performance.max_cells"]) - performanceUsed)) : available })),
      versions: approved.map(v => ({ imageDigest: v.imageDigest, providerVersion: v.providerVersion })), changesLiveConfiguration: false });
    if (!selection) return { ...state, catalog };
    const capacity = catalog.capacity.find(p => p.key === selection.capacityProfile), version = approved.find(v => v.imageDigest === selection.imageDigest);
    const blockers: string[] = [];
    if (!capacity || !version) blockers.push("Current qualified capacity and approved runtime version are required");
    if (capacity && !capacity.availableCells) blockers.push("Included runtime capacity is used; add capacity or use an existing runtime");
    if (state.draft.status !== "draft") blockers.push("Review the saved authoring draft");
    if (state.agent.status !== "paused" || state.agent.pauseReason !== "manual") blockers.push("Managed setup requires the prepared inactive Agent");
    if (cells.some(cell => cell.dedicatedAgentId === state.agent.id)) blockers.push("This Agent already has a managed runtime; inspect its Original state");
    const selectedProfile = selectable.find(p => p.key === selection.capacityProfile);
    const reviewHash = nativeSha256({ schema, companyId, draftId, userId: state.userId, draftVersion: state.draft.version,
      agent: { id: state.agent.id, status: state.agent.status, pauseReason: state.agent.pauseReason }, selection,
      capacity: selectedProfile ? { ...selectedProfile, memoryBytes: String(selectedProfile.memoryBytes), diskBytes: String(selectedProfile.diskBytes) } : null,
      version: version ?? null, entitlements: commercial.entitlements, billingAccountId: commercial.billingAccountId,
      cells: cells.map(cell => ({ id: cell.id, dedicatedAgentId: cell.dedicatedAgentId, capacityProfile: cell.capacityProfile, isolationMode: cell.isolationMode })), blockers });
    return { ...state, catalog, review: agentManagedRuntimeSetupReviewSchema.parse({ companyId, draftId, agentId: state.agent.id,
      version: state.draft.version, reviewHash, canProvision: blockers.length === 0, blockers, usesIncludedCapacity: true,
      modelCalled: false, activatesAgent: false, grantsAuthority: false, createsRuntime: true }) };
  }
  const key = (draftId: string, requestId: string) => `aw-authoring:${draftId}:${requestId}`;
  async function original(tx: Db, actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) {
    const current = await owner(tx, actor, companyId, draftId);
    const [record] = await tx.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, draftId),
      eq(activityLog.action, action), eq(activityLog.actorId, current.userId), eq(activityLog.actorType, "user"),
      sql`${activityLog.details}->>'requestId'=${requestId}`));
    if (!record || record.details?.schema !== schema) return null;
    const [runtime] = await tx.select({ operation: runtimeOperations, cell: runtimeCells }).from(runtimeOperations)
      .innerJoin(runtimeCells, and(eq(runtimeCells.companyId, runtimeOperations.companyId), eq(runtimeCells.id, runtimeOperations.runtimeCellId)))
      .where(and(eq(runtimeOperations.companyId, companyId), eq(runtimeOperations.idempotencyKey, key(draftId, requestId)),
        eq(runtimeOperations.operationType, "provision"), eq(runtimeOperations.requestedByType, "user"), eq(runtimeOperations.requestedById, current.userId))).for("share");
    if (!runtime || runtime.operation.id !== record.details.operationId || runtime.cell.id !== record.details.cellId ||
      runtime.cell.dedicatedAgentId !== current.agent.id) throw conflict("The Original managed provisioning receipt changed");
    await owner(tx, actor, companyId, draftId);
    return { record, receipt: agentManagedRuntimeSetupReceiptSchema.parse({ companyId, draftId, agentId: current.agent.id, requestId,
      cellId: runtime.cell.id, operationId: runtime.operation.id, recordedAt: record.createdAt.toISOString(), operationStatus: runtime.operation.status,
      runtimeStatus: runtime.cell.status, modelConfigured: !!runtime.cell.modelSecretRef && !!runtime.cell.modelSecretVersion,
      activatesAgent: false, grantsAuthority: false, runtimeQualified: false }) };
  }
  return {
    latestReceipt: (actor: AuthorizationActor, companyId: string, draftId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
      const current = await owner(tx, actor, companyId, draftId);
      const [record] = await tx.select({ requestId: sql<string>`${activityLog.details}->>'requestId'` }).from(activityLog)
        .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, draftId), eq(activityLog.action, action),
          eq(activityLog.actorType, "user"), eq(activityLog.actorId, current.userId), sql`${activityLog.details}->>'schema'=${schema}`))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(1);
      return record ? (await original(tx, actor, companyId, draftId, z.uuid().parse(record.requestId)))?.receipt ?? null : null;
    }),
    catalog: (actor: AuthorizationActor, companyId: string, draftId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
      const result = await decision(tx, actor, companyId, draftId); await owner(tx, actor, companyId, draftId, true); return result.catalog;
    }),
    review: (actor: AuthorizationActor, companyId: string, draftId: string, raw: unknown) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId);
      const result = await decision(tx, actor, companyId, draftId, agentManagedRuntimeSetupReviewInputSchema.parse(raw));
      await owner(tx, actor, companyId, draftId, true); if (!("review" in result)) throw conflict("Current managed runtime review is required"); return result.review;
    }),
    receipt: (actor: AuthorizationActor, companyId: string, draftId: string, requestId: string) => db.transaction(async rawTx => {
      const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, companyId); return (await original(tx, actor, companyId, draftId, z.uuid().parse(requestId)))?.receipt ?? null;
    }),
    confirm: async (actor: AuthorizationActor, companyId: string, draftId: string, raw: unknown) => {
      const input = agentManagedRuntimeSetupCommandSchema.parse(raw), userId = v5HumanActorId(actor);
      const requestHash = nativeSha256({ schema, companyId, draftId, userId, input });
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await owner(tx, actor, companyId, draftId);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key(draftId, input.requestId)},0))`);
        const previous = await original(tx, actor, companyId, draftId, input.requestId);
        if (previous) {
          if (previous.record.details?.requestHash !== requestHash) throw conflict("This provisioning request belongs to its original inputs");
          return previous.receipt;
        }
        const [orphan] = await tx.select({ id: runtimeOperations.id }).from(runtimeOperations).where(and(eq(runtimeOperations.companyId, companyId),
          eq(runtimeOperations.operationType, "provision"), eq(runtimeOperations.idempotencyKey, key(draftId, input.requestId))));
        if (orphan) throw conflict("Inspect the Original provisioning operation before another request");
        const selection = { capacityProfile: input.capacityProfile, imageDigest: input.imageDigest };
        const result = await decision(tx, actor, companyId, draftId, selection);
        if (!("review" in result) || !result.review.canProvision || result.review.version !== input.expectedVersion ||
          result.review.reviewHash !== input.expectedReviewHash) throw conflict("Review the current provisioning decision and capacity");
        const created = await runtimeControlService(tx, config!).create(companyId, userId, { isolationMode: "company_cell",
          capacityProfile: input.capacityProfile, imageDigest: input.imageDigest, dedicatedAgentId: result.agent.id,
          idempotencyKey: key(draftId, input.requestId) });
        await logActivity(tx, { companyId, actorType: "user", actorId: userId, action, entityType: "agent_configuration_draft", entityId: draftId,
          details: { schema, requestId: input.requestId, requestHash, cellId: created.cell.id, operationId: created.operation.id } }, publications);
        const final = await owner(tx, actor, companyId, draftId, true);
        if (final.draft.version !== input.expectedVersion || final.agent.status !== "paused" || final.agent.pauseReason !== "manual")
          throw conflict("Current inactive authoring authority changed");
        const finalReview = await decision(tx, actor, companyId, draftId, selection, created.cell.id);
        if (!("review" in finalReview) || !finalReview.review.canProvision || finalReview.review.reviewHash !== input.expectedReviewHash)
          throw conflict("The reviewed runtime qualification or commercial capacity changed");
        const receipt = await original(tx, actor, companyId, draftId, input.requestId);
        if (!receipt) throw conflict("The Original provisioning receipt was not retained"); return receipt.receipt;
      });
    },
  };
}
