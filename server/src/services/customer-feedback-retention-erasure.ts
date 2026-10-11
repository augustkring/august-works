import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import { activityLog, companies, customerFeedback, customerFeedbackImages, customerFeedbackRetention,
  feedbackImageDeletions, feedbackRetentionErasures, type Db } from "@paperclipai/db";
import { feedbackRetentionErasureCommandSchema, feedbackRetentionErasureReceiptSchema,
  feedbackRetentionErasureReviewSchema } from "@paperclipai/shared";
import { feedbackRetentionErasureHistorySchema } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import type { StorageService } from "../storage/types.js";
import { storageScopeMatches } from "../storage/object-scope.js";
import { customerFeedbackService } from "./customer-feedback.js";
import { evaluateFeedbackRetention, loadFeedbackRetentionConfiguration } from "./feedback-retention.js";
import { processFeedbackImageDeletion } from "./customer-feedback-images.js";

type Owner = Pick<typeof customerFeedback.$inferSelect, "id" | "createdAt" | "closedAt" | "status" | "version">;
type Erasure = typeof feedbackRetentionErasures.$inferSelect;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publicReceipt = (row: Erasure) => feedbackRetentionErasureReceiptSchema.parse({
  id: row.id, companyId: row.companyId, feedbackId: row.feedbackId,
  target: row.targetKind === "case" ? { kind: "case" } : { kind: "image", imageId: row.imageId },
  status: row.status, requestedAt: row.requestedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
});
async function finishApprovedErasure(reader: Db, row: Erasure) {
  if (row.status === "completed") return row;
  if (row.objectImageIds.length) {
    const [remaining] = await reader.execute<{ count: string }>(sql`
      select count(*)::text as count from unnest(ARRAY[${sql.join(row.objectImageIds.map(id => sql`${id}::uuid`), sql`, `)}]) i(id)
      left join feedback_image_deletions d on d.company_id=${row.companyId} and d.image_id=i.id
      where d.id is null or d.deleted_at is null or d.transport_settled_at is null or d.storage_scope_id is null`);
    if (remaining!.count !== "0") return row;
  }
  const [complete] = await reader.update(feedbackRetentionErasures).set({ status: "completed", completedAt: sql`clock_timestamp()` })
    .where(and(eq(feedbackRetentionErasures.id, row.id), isNull(feedbackRetentionErasures.completedAt))).returning();
  return complete!;
}

/** Explicit verified internal operator C3 only. No timer, policy-reference
 * grant, customer erasure or second provider allocation is activated here. */
export function customerFeedbackRetentionErasureService(db: Db, storage: StorageService, options: {
  operatorUserIds?: readonly string[]; runtimeEnv?: Readonly<Record<string, string | undefined>>;
} = {}) {
  const feedback = customerFeedbackService(db, options), configuration = loadFeedbackRetentionConfiguration(options.runtimeEnv);
  async function review(reader: Db, companyId: string, owner: Owner) {
    const [controls] = await reader.select().from(customerFeedbackRetention).where(and(
      eq(customerFeedbackRetention.companyId, companyId), eq(customerFeedbackRetention.feedbackId, owner.id),
    )).for("update");
    if (["CLOSED", "RESOLVED"].includes(owner.status) && owner.closedAt === null)
      throw conflict("The original closure date is unavailable; retention requires native review");
    const [clock] = await reader.execute<{ now: string }>(sql`select clock_timestamp()::text as now`);
    const lifecycle = { now: new Date(clock!.now), createdAt: owner.createdAt, closedAt: owner.closedAt,
      extendedUntil: controls?.extensionUntil ?? null,
      legalHold: controls?.legalHold ? { releaseAt: controls.holdReleaseAt } : null };
    const plan = evaluateFeedbackRetention(lifecycle, configuration);
    const rows = await reader.select().from(customerFeedbackImages).where(and(
      eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, owner.id),
      sql`${customerFeedbackImages.status}<>'deleted' and (${customerFeedbackImages.status}<>'failed' or ${customerFeedbackImages.objectKey} is not null)`,
    )).orderBy(customerFeedbackImages.createdAt, customerFeedbackImages.id).for("update");
    const settled = (image: typeof customerFeedbackImages.$inferSelect) => image.objectKey === null
      ? ["scanning", "failed"].includes(image.status)
      : image.transportSettledAt !== null && storageScopeMatches(storage, image.storageScopeId) && ["storing", "ready", "deleting"].includes(image.status);
    const images = rows.map(image => {
      const result = evaluateFeedbackRetention({ ...lifecycle, imageCreatedAt: image.createdAt }, configuration);
      return { id: image.id, dueAt: result.imageDueAt!, eligible: result.imageEligible,
        canErase: result.imageEligible && settled(image), status: image.status };
    });
    const value = { companyId, feedbackId: owner.id, caseVersion: owner.version, retentionVersion: controls?.version ?? 0,
      configuration, held: plan.held, caseDueAt: plan.caseDueAt, caseEligible: plan.caseEligible,
      caseCanErase: plan.caseEligible && rows.every(settled), images };
    // Dates and actual transport settlement are bound even when a status or
    // optimistic version alone would appear unchanged. No object key leaves.
    const reviewHash = digest({ ...value, createdAt: owner.createdAt.toISOString(), closedAt: owner.closedAt?.toISOString() ?? null,
      status: owner.status, storageScopeId: storage.scopeId ?? null, transport: rows.map(image => ({ id: image.id, allocated: image.objectKey !== null,
        storageScopeId: image.storageScopeId,
        settledAt: image.transportSettledAt?.toISOString() ?? null, createdAt: image.createdAt.toISOString() })) });
    return { view: feedbackRetentionErasureReviewSchema.parse({ ...value, reviewHash }), rows };
  }
  async function load(reader: Db, companyId: string, feedbackId: string, id: string) {
    const [row] = await reader.select().from(feedbackRetentionErasures).where(and(
      eq(feedbackRetentionErasures.companyId, companyId), eq(feedbackRetentionErasures.feedbackId, feedbackId),
      eq(feedbackRetentionErasures.id, id),
    )).for("update");
    if (!row) throw notFound("Retention erasure not found");
    return row;
  }
  return {
    history: (actor: AuthorizationActor, companyId: string) =>
      feedback.withInternalRetentionReceipt(actor, companyId, null, async (reader, principal) => {
        const rows = await reader.select().from(feedbackRetentionErasures).where(and(
          eq(feedbackRetentionErasures.companyId, companyId), eq(feedbackRetentionErasures.operatorHash, digest(principal)),
        )).orderBy(desc(feedbackRetentionErasures.status), desc(feedbackRetentionErasures.requestedAt), desc(feedbackRetentionErasures.id)).limit(25);
        return feedbackRetentionErasureHistorySchema.parse(rows.map(row => {
          const receipt = publicReceipt(row), command = feedbackRetentionErasureCommandSchema.parse({ requestKey: row.requestKey,
            confirmErasure: true, expectedReviewHash: row.reviewHash, target: receipt.target });
          if (digest(command) !== row.requestHash) throw conflict("Original erasure receipt requires native review");
          return { receipt, command };
        }));
      }),
    review: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      feedback.withInternalRetention(actor, companyId, feedbackId, async (reader, _principal, owner) =>
        (await review(reader, companyId, owner)).view),
    get: (actor: AuthorizationActor, companyId: string, feedbackId: string, id: string) =>
      feedback.withInternalRetentionReceipt(actor, companyId, feedbackId, async reader =>
        publicReceipt(await load(reader, companyId, feedbackId, id))),
    getRequest: (actor: AuthorizationActor, companyId: string, feedbackId: string, requestKey: string) =>
      feedback.withInternalRetentionReceipt(actor, companyId, feedbackId, async (reader, principal) => {
        const [row] = await reader.select().from(feedbackRetentionErasures).where(and(
          eq(feedbackRetentionErasures.companyId, companyId), eq(feedbackRetentionErasures.feedbackId, feedbackId),
          eq(feedbackRetentionErasures.requestKey, requestKey), eq(feedbackRetentionErasures.operatorHash, digest(principal)),
        )).for("share");
        if (!row) throw notFound("Retention erasure not found");
        return publicReceipt(row);
      }),
    async execute(actor: AuthorizationActor, companyId: string, feedbackId: string, raw: unknown) {
      const command = feedbackRetentionErasureCommandSchema.parse(raw), requestHash = digest(command);
      const operation = await feedback.withInternalRetentionReceipt(actor, companyId, feedbackId, async (reader, principal, owner) => {
        const [prior] = await reader.select().from(feedbackRetentionErasures).where(and(
          eq(feedbackRetentionErasures.companyId, companyId), eq(feedbackRetentionErasures.feedbackId, feedbackId),
          eq(feedbackRetentionErasures.requestKey, command.requestKey),
        )).for("update");
        if (prior) {
          if (prior.requestHash !== requestHash || prior.operatorHash !== digest(principal))
            throw conflict("Retention erasure request key was already used");
          return prior;
        }
        if (!owner) throw notFound("Feedback not found");
        const native = await review(reader, companyId, owner);
        if (native.view.reviewHash !== command.expectedReviewHash)
          throw conflict("Retention erasure source changed; review again");
        const targetImageId = command.target.kind === "image" ? command.target.imageId : null;
        const selected = command.target.kind === "case" ? native.rows
          : native.rows.filter(image => image.id === targetImageId);
        const eligible = command.target.kind === "case" ? native.view.caseCanErase
          : native.view.images.some(image => image.id === targetImageId && image.canErase);
        if (!eligible) throw conflict("Retention erasure is not currently eligible");
        const [row] = await reader.insert(feedbackRetentionErasures).values({ companyId, feedbackId,
          requestKey: command.requestKey, requestHash, operatorHash: digest(principal), reviewHash: native.view.reviewHash,
          policyHash: digest(configuration), caseVersion: native.view.caseVersion, retentionVersion: native.view.retentionVersion,
          targetKind: command.target.kind, imageId: command.target.kind === "image" ? command.target.imageId : null,
          objectImageIds: selected.filter(image => image.objectKey !== null).map(image => image.id),
        }).returning();
        for (const image of selected) {
          if (image.objectKey === null) {
            await reader.update(customerFeedbackImages).set({ status: "deleted", deletedAt: sql`clock_timestamp()` })
              .where(eq(customerFeedbackImages.id, image.id));
          } else {
            await reader.update(customerFeedbackImages).set({ status: "deleting" }).where(eq(customerFeedbackImages.id, image.id));
            await reader.insert(feedbackImageDeletions).values({ companyId, imageId: image.id, objectKey: image.objectKey,
              storageScopeId: image.storageScopeId,
              transportSettledAt: image.transportSettledAt }).onConflictDoNothing({ target: feedbackImageDeletions.imageId });
          }
        }
        if (command.target.kind === "case") await reader.delete(customerFeedback).where(and(
          eq(customerFeedback.companyId, companyId), eq(customerFeedback.id, feedbackId),
        ));
        await reader.insert(activityLog).values({ companyId, actorType: "user", actorId: principal,
          action: "customer_feedback.retention_erasure_requested", entityType: "customer_feedback_access", entityId: randomUUID(), details: null });
        return row!;
      });
      if (operation.status === "completed") return publicReceipt(operation);
      // Exact approved object IDs only. Provider calls hold no DB locks. An
      // unknown DELETE/HEAD keeps the original durable receipt pending.
      for (const imageId of operation.objectImageIds) {
        try { await processFeedbackImageDeletion(db, storage, undefined, companyId, imageId); }
        catch { break; }
      }
      return feedback.withInternalRetentionReceipt(actor, companyId, feedbackId, async reader => {
        const row = await load(reader, companyId, feedbackId, operation.id);
        return publicReceipt(await finishApprovedErasure(reader, row));
      });
    },
  };
}

/** Existing configured SaaS worker only. Complete one already approved C3
 * receipt using its exact original objects. No expiry selection, new consent,
 * operator impersonation, second PUT or customer retention timer is introduced. */
export async function processApprovedFeedbackRetentionErasure(db: Db, storage: StorageService) {
  const operation = await db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='5s'`); await tx.execute(sql`set local lock_timeout='1s'`);
    const [row] = await tx.select().from(feedbackRetentionErasures).where(eq(feedbackRetentionErasures.status, "pending"))
      .orderBy(feedbackRetentionErasures.requestedAt, feedbackRetentionErasures.id).limit(1).for("update", { skipLocked: true });
    return row;
  });
  if (!operation) return false;
  for (const imageId of operation.objectImageIds)
    await processFeedbackImageDeletion(db, storage, undefined, operation.companyId, imageId);
  return db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='5s'`); await tx.execute(sql`set local lock_timeout='1s'`);
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, operation.companyId)).for("update");
    await tx.select({ id: customerFeedback.id }).from(customerFeedback).where(and(
      eq(customerFeedback.companyId, operation.companyId), eq(customerFeedback.id, operation.feedbackId),
    )).for("update");
    if (operation.objectImageIds.length) await tx.select({ id: customerFeedbackImages.id }).from(customerFeedbackImages).where(and(
      eq(customerFeedbackImages.companyId, operation.companyId), inArray(customerFeedbackImages.id, operation.objectImageIds),
    )).orderBy(customerFeedbackImages.id).for("update");
    const [row] = await tx.select().from(feedbackRetentionErasures).where(eq(feedbackRetentionErasures.id, operation.id)).for("update");
    if (!row || row.status === "completed") return false;
    return (await finishApprovedErasure(tx as unknown as Db, row)).status === "completed";
  });
}
