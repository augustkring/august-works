import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, customerFeedbackRetention, customerFeedbackRetentionChanges, customerFeedbackImages,
  feedbackImageDeletions, companyDeletionOperations, type Db } from "@paperclipai/db";
import { feedbackRetentionCommandSchema, feedbackRetentionViewSchema } from "@paperclipai/shared";
import { conflict, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { customerFeedbackService } from "./customer-feedback.js";
import { evaluateFeedbackRetention, loadFeedbackRetentionConfiguration } from "./feedback-retention.js";

/** Reuses the original internal feedback operator admission and native company/
 * feedback lock. Product policy references, tenant roles and client flags never
 * authorize hold/extension changes. Reasons stay in this private owner only. */
export function customerFeedbackRetentionService(db: Db, options: {
  operatorUserIds?: readonly string[];
  runtimeEnv?: Readonly<Record<string, string | undefined>>;
} = {}) {
  const feedback = customerFeedbackService(db, options), configuration = loadFeedbackRetentionConfiguration(options.runtimeEnv);
  async function current(reader: Db, companyId: string, feedbackId: string) {
    const [row] = await reader.select().from(customerFeedbackRetention).where(and(
      eq(customerFeedbackRetention.companyId, companyId), eq(customerFeedbackRetention.feedbackId, feedbackId),
    )).for("update");
    return feedbackRetentionViewSchema.parse({ companyId, feedbackId, version: row?.version ?? 0,
      legalHold: { active: row?.legalHold ?? false, releaseAt: row?.holdReleaseAt?.toISOString() ?? null, reason: row?.holdReason ?? "" },
      extensionUntil: row?.extensionUntil?.toISOString() ?? null, extensionReason: row?.extensionReason ?? "",
      updatedAt: row?.updatedAt.toISOString() ?? null,
    });
  }
  return {
    get: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      feedback.withInternalRetention(actor, companyId, feedbackId, reader => current(reader, companyId, feedbackId)),
    async change(actor: AuthorizationActor, companyId: string, feedbackId: string, raw: unknown) {
      const input = feedbackRetentionCommandSchema.parse(raw), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      return feedback.withInternalRetention(actor, companyId, feedbackId, async (reader, principal) => {
        const [prior] = await reader.select().from(customerFeedbackRetentionChanges).where(and(
          eq(customerFeedbackRetentionChanges.companyId, companyId), eq(customerFeedbackRetentionChanges.feedbackId, feedbackId),
          eq(customerFeedbackRetentionChanges.requestKey, input.requestKey),
        )).for("share");
        if (prior) {
          if (prior.requestHash !== hash) throw conflict("Retention request key was already used");
          return feedbackRetentionViewSchema.parse(prior.receipt);
        }
        const before = await current(reader, companyId, feedbackId);
        if (before.version !== input.expectedVersion) throw conflict("Retention controls changed; review again");
        const [clock] = await reader.execute<{ now: string }>(sql`select clock_timestamp()::text as now`), now = new Date(clock!.now);
        if ((input.extensionUntil && new Date(input.extensionUntil) <= now) ||
            (input.legalHold.active && input.legalHold.releaseAt && new Date(input.legalHold.releaseAt) <= now))
          throw unprocessable("A new retention exception requires a future deadline or an indefinite hold");
        // Already-confirmed removal cannot be retrospectively put on hold.
        // If physical removal has been requested, its original owner must
        // settle it first; a new checkbox cannot revoke an in-flight effect.
        const [deleting] = await reader.select({ id: customerFeedbackImages.id }).from(customerFeedbackImages).where(and(
          eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
          sql`${customerFeedbackImages.status} in ('scanning','storing','deleting')`,
        )).limit(1);
        const [cleanup] = await reader.select({ id: feedbackImageDeletions.id }).from(feedbackImageDeletions)
          .innerJoin(customerFeedbackImages, eq(customerFeedbackImages.id, feedbackImageDeletions.imageId)).where(and(
            eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
            sql`${feedbackImageDeletions.deletedAt} is null`,
          )).limit(1);
        if (input.legalHold.active && (deleting || cleanup)) throw conflict("An image operation is unconfirmed; settle its original owner before applying a hold");
        if (input.legalHold.active) {
          const [purging] = await reader.select({ id: companyDeletionOperations.id }).from(companyDeletionOperations).where(and(
            eq(companyDeletionOperations.companyId, companyId), eq(companyDeletionOperations.stage, "purge"),
            sql`${companyDeletionOperations.status} <> 'completed'`,
          )).limit(1).for("share");
          if (purging) throw conflict("Company erasure is unconfirmed; its original owner must settle before a new hold");
        }
        await reader.insert(customerFeedbackRetention).values({ companyId, feedbackId, version: before.version + 1,
          legalHold: input.legalHold.active, holdReleaseAt: input.legalHold.releaseAt ? new Date(input.legalHold.releaseAt) : null,
          holdReason: input.legalHold.reason, extensionUntil: input.extensionUntil ? new Date(input.extensionUntil) : null,
          extensionReason: input.extensionReason, updatedAt: sql`clock_timestamp()` }).onConflictDoUpdate({
            target: [customerFeedbackRetention.companyId, customerFeedbackRetention.feedbackId], set: {
              version: before.version + 1, legalHold: input.legalHold.active,
              holdReleaseAt: input.legalHold.releaseAt ? new Date(input.legalHold.releaseAt) : null, holdReason: input.legalHold.reason,
              extensionUntil: input.extensionUntil ? new Date(input.extensionUntil) : null, extensionReason: input.extensionReason,
              updatedAt: sql`clock_timestamp()`,
            },
          });
        const result = await current(reader, companyId, feedbackId);
        await reader.insert(customerFeedbackRetentionChanges).values({ companyId, feedbackId, requestKey: input.requestKey, requestHash: hash, receipt: result });
        await reader.insert(activityLog).values({ companyId, actorType: "user", actorId: principal,
          action: "customer_feedback.retention_changed", entityType: "customer_feedback_access", entityId: randomUUID(), details: null });
        return result;
      });
    },
    plan: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      feedback.withInternalRetention(actor, companyId, feedbackId, async (reader, _principal, owner) => {
        const controls = await current(reader, companyId, feedbackId);
        if (["CLOSED", "RESOLVED"].includes(owner.status) && owner.closedAt === null)
          throw conflict("The original closure date is unavailable; retention requires native review");
        const [clock] = await reader.execute<{ now: string }>(sql`select clock_timestamp()::text as now`);
        return evaluateFeedbackRetention({ now: new Date(clock!.now), createdAt: owner.createdAt,
          closedAt: owner.closedAt, extendedUntil: controls.extensionUntil ? new Date(controls.extensionUntil) : null,
          legalHold: controls.legalHold.active ? { releaseAt: controls.legalHold.releaseAt ? new Date(controls.legalHold.releaseAt) : null } : null,
        }, configuration);
      }),
  };
}
