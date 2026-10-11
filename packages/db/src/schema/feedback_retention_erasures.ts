import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, check, index } from "drizzle-orm/pg-core";

/** Minimal original erasure receipt, deliberately without parent/company/user
 * foreign keys: erasing the subject must not erase outstanding object ownership.
 * No feedback text, contact, reason, filename, bytes or credentials are retained.
 * Operator digest is private request binding, not anonymous learning evidence. */
export const feedbackRetentionErasures = pgTable("feedback_retention_erasures", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), feedbackId: uuid("feedback_id").notNull(),
  requestKey: uuid("request_key").notNull(), requestHash: text("request_hash").notNull(), operatorHash: text("operator_hash").notNull(),
  reviewHash: text("review_hash").notNull(), policyHash: text("policy_hash").notNull(),
  caseVersion: integer("case_version").notNull(), retentionVersion: integer("retention_version").notNull(),
  targetKind: text("target_kind").notNull(), imageId: uuid("image_id"),
  objectImageIds: uuid("object_image_ids").array().notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  uniqueIndex("feedback_retention_erasures_request_idx").on(t.companyId, t.feedbackId, t.requestKey),
  index("feedback_retention_erasures_pending_idx").on(t.companyId, t.status),
  index("feedback_retention_erasures_worker_idx").on(t.requestedAt, t.id).where(sql`${t.status}='pending'`),
  index("feedback_retention_erasures_history_idx").on(t.companyId, t.operatorHash, t.status, t.requestedAt, t.id),
  check("feedback_retention_erasures_scope_check", sql`(${t.targetKind}='case' and ${t.imageId} is null) or (${t.targetKind}='image' and ${t.imageId} is not null)`),
  check("feedback_retention_erasures_version_check", sql`${t.caseVersion}>=0 and ${t.retentionVersion}>=0`),
  check("feedback_retention_erasures_digest_check", sql`${t.requestHash} ~ '^[a-f0-9]{64}$' and ${t.operatorHash} ~ '^[a-f0-9]{64}$' and ${t.reviewHash} ~ '^[a-f0-9]{64}$' and ${t.policyHash} ~ '^[a-f0-9]{64}$'`),
  check("feedback_retention_erasures_objects_check", sql`cardinality(${t.objectImageIds}) between 0 and 3 and array_position(${t.objectImageIds},null) is null`),
  check("feedback_retention_erasures_state_check", sql`(${t.status}='pending' and ${t.completedAt} is null) or (${t.status}='completed' and ${t.completedAt} is not null)`),
]);
