import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, check, index } from "drizzle-orm/pg-core";

/** Minimal feedback erasure identities survive subject and company deletion.
 * The independently signed operator ledger carries these beyond DB backups.
 * No body, contact, operator identity, object key or receipt token is copied. */
export const customerFeedbackDeletionMarkers = pgTable("customer_feedback_deletion_markers", {
  subjectId: uuid("subject_id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  feedbackId: uuid("feedback_id").notNull(),
  targetKind: text("target_kind").$type<"case" | "image">().notNull(),
  erasedAt: timestamp("erased_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("customer_feedback_deletion_markers_company_idx").on(t.companyId),
  index("customer_feedback_deletion_markers_feedback_idx").on(t.feedbackId),
  check("customer_feedback_deletion_markers_target_check",
    sql`(${t.targetKind}='case' and ${t.subjectId}=${t.feedbackId}) or ${t.targetKind}='image'`),
]);
