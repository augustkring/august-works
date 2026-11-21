import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customerFeedback } from "./customer_feedback.js";

/** Optional consented ratings belong to Feedback and cascade with its existing
 * privacy/retention owner. Keeping them separate allows withdrawal without
 * rewriting the immutable original submission. */
export const customerFeedbackExperienceMeasures = pgTable(
  "customer_feedback_experience_measures",
  {
    companyId: uuid("company_id").notNull(),
    feedbackId: uuid("feedback_id").notNull(),
    satisfaction: text("satisfaction").notNull(),
    effort: text("effort").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "customer_feedback_experience_measures_pk", columns: [t.companyId, t.feedbackId] }),
    foreignKey({
      columns: [t.companyId, t.feedbackId],
      foreignColumns: [customerFeedback.companyId, customerFeedback.id],
    }).onDelete("cascade"),
    check("customer_feedback_experience_satisfaction_check", sql`${t.satisfaction} in ('very_dissatisfied','dissatisfied','neither','satisfied','very_satisfied')`),
    check("customer_feedback_experience_effort_check", sql`${t.effort} in ('very_difficult','difficult','neither','easy','very_easy')`),
  ],
);
