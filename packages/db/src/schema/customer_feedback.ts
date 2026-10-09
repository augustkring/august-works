import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

export const customerFeedback = pgTable(
  "customer_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    category: text("category").notNull(),
    body: text("body").notNull(),
    goal: text("goal").notNull().default(""),
    blocksWork: boolean("blocks_work").notNull().default(false),
    submittedByUserId: text("submitted_by_user_id"),
    omitName: boolean("omit_name").notNull().default(false),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    diagnostics: jsonb("diagnostics").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("RECEIVED"),
    version: integer("version").notNull().default(0),
    internalState: text("internal_state").notNull().default("RECEIVED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_feedback_company_id_idx").on(t.companyId, t.id),
    index("customer_feedback_company_created_idx").on(t.companyId, t.createdAt),
    check(
      "customer_feedback_category_check",
      sql`${t.category} in ('BUG','IMPROVEMENT','IDEA','OTHER')`,
    ),
    check(
      "customer_feedback_status_check",
      sql`${t.status} in ('RECEIVED','REVIEWING','NEEDS_INFO','RESOLVED','CLOSED')`,
    ),
    check(
      "customer_feedback_name_check",
      sql`not ${t.omitName} or ${t.submittedByUserId} is null`,
    ),
  ],
);

// Restricted account-access purpose, deliberately excluded from product triage.
// Not a claim of anonymous feedback; no-name product records have no author/contact.
export const customerFeedbackAccess = pgTable(
  "customer_feedback_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    feedbackId: uuid("feedback_id").notNull(),
    userId: text("user_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.companyId, t.feedbackId],
      foreignColumns: [customerFeedback.companyId, customerFeedback.id],
    }).onDelete("cascade"),
    uniqueIndex("customer_feedback_access_request_idx").on(
      t.companyId,
      t.userId,
      t.requestKey,
    ),
    index("customer_feedback_access_owner_idx").on(t.companyId, t.userId),
  ],
);

export const customerFeedbackEvents = pgTable(
  "customer_feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    feedbackId: uuid("feedback_id").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    internalNote: text("internal_note"),
    linkType: text("link_type"),
    linkId: uuid("link_id"),
    customerVisible: boolean("customer_visible").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.companyId, t.feedbackId],
      foreignColumns: [customerFeedback.companyId, customerFeedback.id],
    }).onDelete("cascade"),
    uniqueIndex("customer_feedback_events_request_idx").on(
      t.feedbackId,
      t.requestKey,
    ),
    index("customer_feedback_events_feedback_idx").on(
      t.companyId,
      t.feedbackId,
      t.createdAt,
    ),
    check(
      "customer_feedback_events_kind_check",
      sql`${t.kind} in ('customer_follow_up','product_message')`,
    ),
  ],
);
