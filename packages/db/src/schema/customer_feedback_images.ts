import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import { customerFeedback } from "./customer_feedback.js";

/** Native reservation/receipt. Original upload names and bytes never enter DB.
 * A lost storage acknowledgement retains `storing` for original Storage
 * reconciliation; it does not free a slot or authorize another upload. */
export const customerFeedbackImages = pgTable("customer_feedback_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  feedbackId: uuid("feedback_id").notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("scanning"),
  leaseToken: uuid("lease_token").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  objectKey: text("object_key"),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size"),
  sha256: text("sha256"),
  scannerToken: text("scanner_token"),
  scanCheckedAt: timestamp("scan_checked_at", { withTimezone: true }),
  transportSettledAt: timestamp("transport_settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, t => [
  // Keep the owner row until protected objects have been physically removed.
  // A native delete trigger copies protected-object reservations into the
  // durable deletion owner before cascade; physical erasure is separate.
  foreignKey({ columns: [t.companyId, t.feedbackId], foreignColumns: [customerFeedback.companyId, customerFeedback.id] }).onDelete("cascade"),
  uniqueIndex("customer_feedback_images_request_idx").on(t.companyId, t.feedbackId, t.requestKey),
  index("customer_feedback_images_owner_idx").on(t.companyId, t.feedbackId, t.createdAt),
  check("customer_feedback_images_status_check", sql`${t.status} in ('scanning','storing','ready','deleting','deleted','failed')`),
  check("customer_feedback_images_media_check", sql`${t.mediaType} in ('image/png','image/jpeg','image/webp')`),
  check("customer_feedback_images_size_check", sql`${t.byteSize} is null or ${t.byteSize} between 1 and 10485760`),
  check("customer_feedback_images_ready_check", sql`${t.status} not in ('ready','deleting') or (${t.objectKey} is not null and ${t.byteSize} is not null and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.scannerToken} ~ '^[a-f0-9]{64}$' and ${t.scanCheckedAt} is not null)`),
  check("customer_feedback_images_deleted_check", sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`),
  check("customer_feedback_images_company_key_check", sql`${t.objectKey} is null or (${t.objectKey} like ${t.companyId}::text || '/feedback-images/%' and ${t.objectKey} not like '%..%')`),
]);

/** No feedback prose, filename or author/contact. Survives account/company
 * erasure until each known protected object has a native absence receipt. */
export const feedbackImageDeletions = pgTable("feedback_image_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  imageId: uuid("image_id").notNull(),
  companyId: uuid("company_id").notNull(),
  objectKey: text("object_key").notNull(),
  accountDeletionId: uuid("account_deletion_id"),
  transportSettledAt: timestamp("transport_settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, t => [
  uniqueIndex("feedback_image_deletions_image_idx").on(t.imageId),
  index("feedback_image_deletions_pending_idx").on(t.deletedAt, t.createdAt),
  check("feedback_image_deletions_company_key_check", sql`${t.objectKey} like ${t.companyId}::text || '/feedback-images/%' and ${t.objectKey} not like '%..%'`),
]);
