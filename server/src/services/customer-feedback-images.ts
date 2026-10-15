import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { activityLog, companies, customerFeedback, customerFeedbackImages, customerFeedbackRetention, feedbackImageDeletions, type Db } from "@paperclipai/db";
import { feedbackImageSchema, feedbackImagesSchema, feedbackImageMediaTypeSchema } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import type { StorageService } from "../storage/types.js";
import { storageScopeMatches } from "../storage/object-scope.js";
import type { AuthorizationActor } from "./authorization.js";
import { customerFeedbackService } from "./customer-feedback.js";
import { configuredFeedbackImageScanner, prepareFeedbackImage, FEEDBACK_IMAGE_MAX_BYTES } from "./feedback-image-intake.js";

export type FeedbackImageUploadAdmission = Readonly<{ admitted: true }>;
type ImageRow = typeof customerFeedbackImages.$inferSelect;
const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const projection = (row: ImageRow) => feedbackImageSchema.parse({
  id: row.id, companyId: row.companyId, feedbackId: row.feedbackId, status: row.status,
  mediaType: row.mediaType, byteSize: row.byteSize, createdAt: row.createdAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

/** Original feedback authority, original Storage allocation and native receipts.
 * The scanner never grants account/business authority. External byte work is
 * outside bounded native transactions and cannot expose an image until current
 * feedback/account authority is checked again. No caller-selected object key. */
export function customerFeedbackImageService(db: Db, storage: StorageService, options: {
  scanner: ReturnType<typeof configuredFeedbackImageScanner>;
  operatorUserIds?: readonly string[];
}) {
  const feedback = customerFeedbackService(db, options);
  const scopeId = storage.scopeId;
  const admissions = new WeakMap<FeedbackImageUploadAdmission, {
    companyId: string; feedbackId: string; requestKey: string; principal: string; expiresAt: string;
  }>();
  async function noHold(reader: Db, companyId: string, feedbackId: string) {
    const [hold] = await reader.select({ id: customerFeedbackRetention.id }).from(customerFeedbackRetention).where(and(
      eq(customerFeedbackRetention.companyId, companyId), eq(customerFeedbackRetention.feedbackId, feedbackId),
      eq(customerFeedbackRetention.legalHold, true),
      sql`(${customerFeedbackRetention.holdReleaseAt} is null or ${customerFeedbackRetention.holdReleaseAt}>clock_timestamp())`,
    )).for("share");
    if (hold) throw conflict("Feedback images are subject to a current retention hold");
  }
  async function image(reader: Db, companyId: string, feedbackId: string, imageId: string) {
    const [row] = await reader.select().from(customerFeedbackImages).where(and(
      eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
      eq(customerFeedbackImages.id, imageId),
    )).for("update");
    if (!row) throw notFound("Feedback image not found");
    return row;
  }
  async function journal(reader: Db, companyId: string, principal: string, action: string, id: string) {
    await reader.insert(activityLog).values({ companyId, actorType: "user", actorId: principal,
      action, entityType: "customer_feedback_access", entityId: id, details: null });
  }
  const scope = (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
    <T>(operation: Parameters<typeof feedback.withOwnedImage<T>>[3], mutation = false) =>
      feedback.withOwnedImage(actor, companyId, feedbackId, operation, mutation);

  async function readProtected(actor: AuthorizationActor, companyId: string, feedbackId: string, imageId: string, internal: boolean) {
      companyId = z.uuid().toLowerCase().parse(companyId); feedbackId = z.uuid().toLowerCase().parse(feedbackId);
      imageId = z.uuid().toLowerCase().parse(imageId);
      const owned = <T>(operation: (reader: Db) => Promise<T>) => internal
        ? feedback.withInternalRetention(actor, companyId, feedbackId, reader => operation(reader))
        : scope(actor, companyId, feedbackId)(operation);
      const before = await owned(async reader => {
        const row = await image(reader, companyId, feedbackId, imageId);
        if (row.status !== "ready" || !row.objectKey || !row.sha256 || !row.byteSize || !storageScopeMatches(storage, row.storageScopeId))
          throw notFound("Feedback image is unavailable");
        return row;
      });
      const object = await storage.getObject(companyId, before.objectKey!), parts: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of object.stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > FEEDBACK_IMAGE_MAX_BYTES || size > before.byteSize!) throw conflict("Protected image could not be confirmed");
          parts.push(bytes);
        }
      } finally { object.stream.destroy(); }
      const body = Buffer.concat(parts);
      if (body.length !== before.byteSize || sha(body) !== before.sha256) throw conflict("Protected image could not be confirmed");
      return owned(async reader => {
        const current = await image(reader, companyId, feedbackId, imageId);
        if (current.status !== "ready" || current.objectKey !== before.objectKey || current.sha256 !== before.sha256 ||
          current.storageScopeId !== before.storageScopeId || !storageScopeMatches(storage, current.storageScopeId))
          throw conflict("Feedback image changed; check current access");
        return { body, mediaType: feedbackImageMediaTypeSchema.parse(current.mediaType) };
      });
  }

  return {
    preflight: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      scope(actor, companyId, feedbackId)(async () => undefined, true),
    async admitUpload(actor: AuthorizationActor, companyId: string, feedbackId: string, requestKey: string) {
      companyId = z.uuid().toLowerCase().parse(companyId); feedbackId = z.uuid().toLowerCase().parse(feedbackId);
      requestKey = z.uuid().toLowerCase().parse(requestKey);
      if (!options.scanner) throw unprocessable("Feedback image scanning is unavailable");
      const admitted = await scope(actor, companyId, feedbackId)(async (reader, owner) => {
        await noHold(reader, companyId, feedbackId);
        if (!storageScopeMatches(storage, scopeId)) throw unprocessable("Protected feedback storage is unavailable");
        await feedback.chargeImageAttempt(reader, companyId, owner.principal);
        const [clock] = await reader.execute<{ expiresAt: string }>(sql`select (clock_timestamp()+interval '120 seconds')::text as "expiresAt"`);
        return { principal: owner.principal, expiresAt: clock!.expiresAt };
      }, true);
      // Native abuse admission precedes any multipart body processing. This
      // server-local identity cannot be supplied by a customer JSON request.
      await options.scanner.verify();
      const token: FeedbackImageUploadAdmission = Object.freeze({ admitted: true });
      admissions.set(token, { companyId, feedbackId, requestKey, ...admitted });
      return token;
    },
    list: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      scope(actor, companyId, feedbackId)(async reader => feedbackImagesSchema.parse((await reader.select()
        .from(customerFeedbackImages).where(and(eq(customerFeedbackImages.companyId, companyId),
          eq(customerFeedbackImages.feedbackId, feedbackId),
          inArray(customerFeedbackImages.status, ["scanning", "storing", "ready", "deleting"])))
        .orderBy(asc(customerFeedbackImages.createdAt), asc(customerFeedbackImages.id)).limit(4)).map(projection))),
    request: (actor: AuthorizationActor, companyId: string, feedbackId: string, requestKey: string) =>
      scope(actor, companyId, feedbackId)(async reader => {
        const [row] = await reader.select().from(customerFeedbackImages).where(and(
          eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
          eq(customerFeedbackImages.requestKey, requestKey),
        )).limit(1);
        return row ? projection(row) : null;
      }),
    async upload(actor: AuthorizationActor, companyId: string, feedbackId: string, requestKey: string, body: Buffer, mediaType: string, admission?: FeedbackImageUploadAdmission) {
      companyId = z.uuid().toLowerCase().parse(companyId); feedbackId = z.uuid().toLowerCase().parse(feedbackId);
      requestKey = z.uuid().toLowerCase().parse(requestKey);
      if (!options.scanner) throw unprocessable("Feedback image scanning is unavailable");
      feedbackImageMediaTypeSchema.parse(mediaType);
      if (!Buffer.isBuffer(body) || !body.length || body.length > FEEDBACK_IMAGE_MAX_BYTES)
        throw unprocessable("Choose an image of at most 10 MiB");
      const originalHash = sha(body), requestHash = sha(Buffer.from(JSON.stringify({ originalHash, mediaType, byteSize: body.length }))),
        leaseToken = randomUUID(), owned = scope(actor, companyId, feedbackId);
      const reserved = await owned(async (reader, owner) => {
        if (admission) {
          const token = admissions.get(admission);
          admissions.delete(admission);
          if (!token || token.companyId !== companyId || token.feedbackId !== feedbackId ||
              token.requestKey !== requestKey || token.principal !== owner.principal)
            throw conflict("Image intake admission changed");
          const [clock] = await reader.execute<{ expired: boolean }>(sql`select ${token.expiresAt}::timestamptz <= clock_timestamp() as expired`);
          if (clock?.expired) throw conflict("Image intake admission expired");
        }
        const [prior] = await reader.select().from(customerFeedbackImages).where(and(
          eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
          eq(customerFeedbackImages.requestKey, requestKey),
        )).for("update");
        if (prior) {
          if (prior.requestHash !== requestHash) throw conflict("Image request key was already used");
          if (["ready", "deleted"].includes(prior.status)) return { row: prior, replay: true };
          // A `storing` acknowledgement is uncertain. Never allocate another
          // object or release its slot based on elapsed time alone.
          if (prior.status !== "failed" && !(prior.status === "scanning" &&
            (await reader.execute<{ expired: boolean }>(sql`select ${prior.leaseExpiresAt.toISOString()}::timestamptz <= clock_timestamp() as expired`))[0]?.expired))
            throw conflict("Image request is unconfirmed; check its original status", { code: "FEEDBACK_IMAGE_UNCONFIRMED" });
        }
        await noHold(reader, companyId, feedbackId);
        const count = await reader.select({ id: customerFeedbackImages.id }).from(customerFeedbackImages).where(and(
          eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
          inArray(customerFeedbackImages.status, ["scanning", "storing", "ready", "deleting"]),
        )).limit(4);
        if (count.length - (prior?.status === "scanning" ? 1 : 0) >= 3) throw conflict("Feedback allows at most three images");
        if (!admission) await feedback.chargeImageAttempt(reader, companyId, owner.principal);
        const [row] = prior
          ? await reader.update(customerFeedbackImages).set({ status: "scanning", leaseToken,
            leaseExpiresAt: sql`clock_timestamp() + interval '120 seconds'` }).where(eq(customerFeedbackImages.id, prior.id)).returning()
          : await reader.insert(customerFeedbackImages).values({ companyId, feedbackId, requestKey, requestHash, mediaType,
            leaseToken, leaseExpiresAt: sql`clock_timestamp() + interval '120 seconds'` }).returning();
        return { row: row!, replay: false };
      }, true);
      if (reserved.replay) return projection(reserved.row);
      let allocatedKey: string | null = null, stored = false, transportSettled = false;
      const settleTransport = async (objectKey: string) => {
        if (objectKey !== allocatedKey) throw conflict("Protected image transport receipt changed");
        // The Original Storage owner proved that this exact PUT fulfilled
        // or was prevented before dispatch. Neither observation admits
        // bytes, grants access or reconciles an unknown provider response.
        transportSettled = true;
        await db.transaction(async tx => {
          await tx.execute(sql`set local statement_timeout='5s'`);
          await tx.execute(sql`set local lock_timeout='1s'`);
          await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
          await tx.select({ id: customerFeedback.id }).from(customerFeedback).where(and(
            eq(customerFeedback.companyId, companyId), eq(customerFeedback.id, feedbackId),
          )).for("update");
          const [current] = await tx.select().from(customerFeedbackImages).where(and(
            eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.id, reserved.row.id),
          )).for("update");
          if (current?.leaseToken === leaseToken && current.objectKey === objectKey && current.storageScopeId === scopeId)
            await tx.update(customerFeedbackImages).set({ transportSettledAt: sql`coalesce(${customerFeedbackImages.transportSettledAt}, clock_timestamp())` })
              .where(eq(customerFeedbackImages.id, current.id));
          await tx.update(feedbackImageDeletions).set({ transportSettledAt: sql`coalesce(${feedbackImageDeletions.transportSettledAt}, clock_timestamp())` })
            .where(and(eq(feedbackImageDeletions.imageId, reserved.row.id), eq(feedbackImageDeletions.companyId, companyId),
              eq(feedbackImageDeletions.objectKey, objectKey), eq(feedbackImageDeletions.storageScopeId, scopeId!), isNull(feedbackImageDeletions.deletedAt)));
        });
      };
      try {
        const prepared = await prepareFeedbackImage(options.scanner, body, mediaType);
        const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[prepared.mediaType];
        const result = await storage.putFile({ companyId, namespace: `feedback-images/${feedbackId}/${reserved.row.id}`,
          originalFilename: `image.${extension}`, contentType: prepared.mediaType, body: prepared.body,
          onAllocated: async objectKey => {
            if (!storageScopeMatches(storage, scopeId)) throw unprocessable("Protected feedback storage is unavailable");
            await owned(async reader => {
              const current = await image(reader, companyId, feedbackId, reserved.row.id);
              const [clock] = await reader.execute<{ expired: boolean }>(sql`select ${current.leaseExpiresAt.toISOString()}::timestamptz <= clock_timestamp() as expired`);
              if (current.status !== "scanning" || current.leaseToken !== leaseToken || clock?.expired)
                throw conflict("Image reservation changed; check the original request");
              if (!objectKey.startsWith(`${companyId}/feedback-images/${feedbackId}/${current.id}/`))
                throw conflict("Protected image allocation changed");
              await reader.update(customerFeedbackImages).set({ status: "storing", objectKey, storageScopeId: scopeId,
                byteSize: prepared.byteSize, sha256: prepared.sha256, scannerToken: prepared.scan.scannerToken,
                scanCheckedAt: new Date(prepared.scan.checkedAt) }).where(eq(customerFeedbackImages.id, current.id));
            }, true);
            allocatedKey = objectKey;
          },
          onTransportSettled: settleTransport,
          onWritePrevented: settleTransport,
        });
        stored = true;
        if (result.objectKey !== allocatedKey || result.scopeId !== scopeId || !storageScopeMatches(storage, scopeId) ||
          result.sha256 !== prepared.sha256 || result.byteSize !== prepared.byteSize || result.contentType !== prepared.mediaType)
          throw conflict("Protected image receipt could not be confirmed");
        return await owned(async (reader, owner) => {
          const current = await image(reader, companyId, feedbackId, reserved.row.id);
          if (current.status !== "storing" || current.leaseToken !== leaseToken || current.objectKey !== result.objectKey || current.storageScopeId !== scopeId)
            throw conflict("Image reservation changed; check the original request");
          const [row] = await reader.update(customerFeedbackImages).set({ status: "ready", transportSettledAt: sql`coalesce(${customerFeedbackImages.transportSettledAt}, clock_timestamp())` })
            .where(eq(customerFeedbackImages.id, current.id)).returning();
          await journal(reader, companyId, owner.principal, "customer_feedback.image_added", randomUUID());
          return projection(row!);
        }, true);
      } catch (error) {
        if (allocatedKey && (stored || transportSettled)) {
          // Only this operation's freshly allocated object. Current authority
          // loss cannot turn its unadmitted candidate into a public image.
          await db.transaction(async tx => {
            await tx.execute(sql`set local statement_timeout='5s'`);
            await tx.execute(sql`set local lock_timeout='1s'`);
            await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
            await tx.select({ id: customerFeedback.id }).from(customerFeedback).where(and(
              eq(customerFeedback.companyId, companyId), eq(customerFeedback.id, feedbackId),
            )).for("update");
            const [current] = await tx.select().from(customerFeedbackImages).where(and(
              eq(customerFeedbackImages.id, reserved.row.id), eq(customerFeedbackImages.companyId, companyId),
            )).for("update");
            // A commit acknowledgement may be lost after `ready` committed.
            // Preserve that original receipt and object for explicit read-back.
            if (current?.status === "ready" || current?.status === "deleted") return;
            if (current && (current.leaseToken !== leaseToken || current.objectKey !== allocatedKey || current.storageScopeId !== scopeId)) return;
            await tx.insert(feedbackImageDeletions).values({ imageId: reserved.row.id, companyId, objectKey: allocatedKey!,
              storageScopeId: scopeId,
              transportSettledAt: sql`clock_timestamp()` }).onConflictDoUpdate({ target: feedbackImageDeletions.imageId,
              set: { transportSettledAt: sql`coalesce(${feedbackImageDeletions.transportSettledAt}, clock_timestamp())` } });
            if (current) await tx.update(customerFeedbackImages).set({ status: "deleting", transportSettledAt: sql`coalesce(${customerFeedbackImages.transportSettledAt}, clock_timestamp())` })
              .where(eq(customerFeedbackImages.id, current.id));
          });
        } else if (!allocatedKey) {
          // Fixed lease-owned operational cleanup, not a new business action.
          await db.update(customerFeedbackImages).set({ status: "failed" }).where(and(
            eq(customerFeedbackImages.id, reserved.row.id), eq(customerFeedbackImages.companyId, companyId),
            eq(customerFeedbackImages.leaseToken, leaseToken), eq(customerFeedbackImages.status, "scanning"),
          ));
        }
        throw error;
      } finally {
        if ((stored || transportSettled) && allocatedKey) {
          // If the original feedback disappeared during the protected write,
          // its native delete trigger retained the same allocated object key.
          await db.update(feedbackImageDeletions).set({ transportSettledAt: sql`coalesce(${feedbackImageDeletions.transportSettledAt}, clock_timestamp())` }).where(and(
            eq(feedbackImageDeletions.imageId, reserved.row.id), eq(feedbackImageDeletions.companyId, companyId),
            eq(feedbackImageDeletions.objectKey, allocatedKey), eq(feedbackImageDeletions.storageScopeId, scopeId!), isNull(feedbackImageDeletions.deletedAt),
          ));
        }
      }
    },
    read: (actor: AuthorizationActor, companyId: string, feedbackId: string, imageId: string) =>
      readProtected(actor, companyId, feedbackId, imageId, false),
    internalRead: (actor: AuthorizationActor, companyId: string, feedbackId: string, imageId: string) =>
      readProtected(actor, companyId, feedbackId, imageId, true),
    internalList: (actor: AuthorizationActor, companyId: string, feedbackId: string) =>
      feedback.withInternalRetention(actor, companyId, feedbackId, async reader =>
        feedbackImagesSchema.parse((await reader.select().from(customerFeedbackImages).where(and(
          eq(customerFeedbackImages.companyId, companyId), eq(customerFeedbackImages.feedbackId, feedbackId),
          inArray(customerFeedbackImages.status, ["scanning", "storing", "ready", "deleting"])))
          .orderBy(asc(customerFeedbackImages.createdAt), asc(customerFeedbackImages.id)).limit(4)).map(projection))),
    async remove(actor: AuthorizationActor, companyId: string, feedbackId: string, imageId: string) {
      companyId = z.uuid().toLowerCase().parse(companyId); feedbackId = z.uuid().toLowerCase().parse(feedbackId);
      imageId = z.uuid().toLowerCase().parse(imageId);
      const owned = scope(actor, companyId, feedbackId);
      const before = await owned(async (reader, owner) => {
        const row = await image(reader, companyId, feedbackId, imageId);
        if (row.status === "deleted") return row;
        await noHold(reader, companyId, feedbackId);
        if (["scanning", "failed"].includes(row.status) && !row.objectKey) {
          const [cancelled] = await reader.update(customerFeedbackImages).set({ status: "deleted", deletedAt: sql`clock_timestamp()` })
            .where(eq(customerFeedbackImages.id, row.id)).returning();
          await journal(reader, companyId, owner.principal, "customer_feedback.image_removed", randomUUID());
          return cancelled!;
        }
        if (!["ready", "deleting"].includes(row.status) || !row.objectKey || !row.transportSettledAt || !storageScopeMatches(storage, row.storageScopeId))
          throw conflict("Image storage is unconfirmed; check the original request");
        await reader.insert(feedbackImageDeletions).values({ imageId: row.id, companyId,
          objectKey: row.objectKey, storageScopeId: row.storageScopeId, transportSettledAt: row.transportSettledAt }).onConflictDoNothing();
        const [next] = await reader.update(customerFeedbackImages).set({ status: "deleting" })
          .where(eq(customerFeedbackImages.id, row.id)).returning();
        return next!;
      });
      if (before.status === "deleted") return projection(before);
      await storage.deleteObject(companyId, before.objectKey!);
      if ((await storage.headObject(companyId, before.objectKey!)).exists)
        throw conflict("Image removal is awaiting physical confirmation");
      return owned(async (reader, owner) => {
        const current = await image(reader, companyId, feedbackId, imageId);
        if (current.status === "deleted") return projection(current);
        if (current.status !== "deleting" || current.objectKey !== before.objectKey || current.storageScopeId !== before.storageScopeId ||
          !storageScopeMatches(storage, current.storageScopeId))
          throw conflict("Image removal changed; check the original request");
        const [row] = await reader.update(customerFeedbackImages).set({ status: "deleted", deletedAt: sql`clock_timestamp()` })
          .where(eq(customerFeedbackImages.id, current.id)).returning();
        await reader.update(feedbackImageDeletions).set({ deletedAt: sql`clock_timestamp()` }).where(and(
          eq(feedbackImageDeletions.imageId, current.id), eq(feedbackImageDeletions.companyId, companyId),
          eq(feedbackImageDeletions.objectKey, current.objectKey!),
          eq(feedbackImageDeletions.storageScopeId, current.storageScopeId!),
          sql`${feedbackImageDeletions.transportSettledAt} is not null`, isNull(feedbackImageDeletions.deletedAt),
        ));
        await journal(reader, companyId, owner.principal, "customer_feedback.image_removed", randomUUID());
        return projection(row!);
      });
    },
  };
}

/** Fixed original-object cleanup only. This function does not choose customer
 * retention deadlines and is not scheduled by this Source implementation. */
export async function processFeedbackImageDeletion(db: Db, storage: StorageService, accountDeletionId?: string, companyId?: string, imageId?: string) {
  if (!storageScopeMatches(storage, storage.scopeId)) return false;
  const candidate = await db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='5s'`);
    await tx.execute(sql`set local lock_timeout='1s'`);
    const [row] = await tx.select().from(feedbackImageDeletions).where(and(isNull(feedbackImageDeletions.deletedAt),
      sql`${feedbackImageDeletions.transportSettledAt} is not null`,
      eq(feedbackImageDeletions.storageScopeId, storage.scopeId!),
      accountDeletionId ? eq(feedbackImageDeletions.accountDeletionId, accountDeletionId) : undefined,
      imageId ? eq(feedbackImageDeletions.imageId, imageId) : undefined,
      companyId ? eq(feedbackImageDeletions.companyId, companyId) : undefined)).orderBy(feedbackImageDeletions.createdAt)
      .limit(1).for("update", { skipLocked: true });
    return row;
  });
  if (!candidate) return false;
  // Repeated original-object deletion is idempotent; no DB lock is held over
  // provider I/O. An uncertain absence leaves the durable candidate pending.
  await storage.deleteObject(candidate.companyId, candidate.objectKey);
  if ((await storage.headObject(candidate.companyId, candidate.objectKey)).exists)
    throw conflict("Protected image erasure is awaiting physical confirmation");
  return db.transaction(async tx => {
    await tx.execute(sql`set local statement_timeout='5s'`);
    await tx.execute(sql`set local lock_timeout='1s'`);
    // Same company -> parent -> image -> receipt order as explicit removal
    // and parent erasure. No lock survives the provider DELETE/HEAD calls.
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, candidate.companyId)).for("update");
    await tx.execute(sql`select f.id from customer_feedback f join customer_feedback_images i
      on i.company_id=f.company_id and i.feedback_id=f.id
      where i.company_id=${candidate.companyId} and i.id=${candidate.imageId} for update of f`);
    await tx.select({ id: customerFeedbackImages.id }).from(customerFeedbackImages).where(and(
      eq(customerFeedbackImages.companyId, candidate.companyId), eq(customerFeedbackImages.id, candidate.imageId),
    )).for("update");
    const [row] = await tx.select().from(feedbackImageDeletions).where(eq(feedbackImageDeletions.id, candidate.id)).for("update");
    if (!row || row.deletedAt) return false;
    if (row.companyId !== candidate.companyId || row.objectKey !== candidate.objectKey || !row.transportSettledAt ||
      row.storageScopeId !== candidate.storageScopeId || !storageScopeMatches(storage, row.storageScopeId))
      throw conflict("Protected image deletion source changed");
    await tx.update(feedbackImageDeletions).set({ deletedAt: sql`clock_timestamp()` }).where(eq(feedbackImageDeletions.id, row.id));
    await tx.update(customerFeedbackImages).set({ status: "deleted", deletedAt: sql`clock_timestamp()` }).where(and(
      eq(customerFeedbackImages.id, row.imageId), eq(customerFeedbackImages.companyId, row.companyId),
      eq(customerFeedbackImages.objectKey, row.objectKey), eq(customerFeedbackImages.status, "deleting"),
      eq(customerFeedbackImages.storageScopeId, row.storageScopeId!),
    ));
    return true;
  });
}
