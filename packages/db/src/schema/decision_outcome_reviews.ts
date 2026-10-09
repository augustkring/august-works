import {sql} from "drizzle-orm";
import {check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,unique,uuid} from "drizzle-orm/pg-core";
import type {DecisionOutcomeReviewReceipt,DecisionOutcomeReviewState} from "@paperclipai/shared";
import {decisionContextVersions} from "./decision_intelligence.js";
import {analyticalLineageManifests} from "./analytical_lineage.js";
import {learningCycles} from "./learning.js";
type State=Exclude<DecisionOutcomeReviewState,"due">;

export const decisionOutcomeReviews=pgTable("decision_outcome_reviews",{
  id:uuid("id").primaryKey().defaultRandom(),companyId:uuid("company_id").notNull(),decisionId:uuid("decision_id").notNull(),
  contextVersionId:uuid("context_version_id").notNull(),contextHash:text("context_hash").notNull(),optionId:text("option_id").notNull(),
  learningCycleId:uuid("learning_cycle_id"),
  status:text("status").$type<State>().notNull().default("scheduled"),revision:integer("revision").notNull().default(1),
  reviewDueAt:timestamp("review_due_at",{withTimezone:true}).notNull(),createdBy:text("created_by").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull(),reviewedAt:timestamp("reviewed_at",{withTimezone:true}),reviewedByUserId:text("reviewed_by_user_id"),
},t=>({
  tenantUq:unique("decision_outcome_reviews_tenant_uq").on(t.companyId,t.id),decisionUq:unique("decision_outcome_reviews_decision_uq").on(t.companyId,t.decisionId),
  contextFk:foreignKey({name:"decision_outcome_reviews_context_fk",columns:[t.companyId,t.decisionId,t.contextVersionId],foreignColumns:[decisionContextVersions.companyId,decisionContextVersions.decisionId,decisionContextVersions.id]}).onDelete("cascade"),
  learningCycleFk:foreignKey({name:"decision_outcome_reviews_learning_cycle_fk",columns:[t.companyId,t.learningCycleId],foreignColumns:[learningCycles.companyId,learningCycles.id]}).onDelete("restrict"),
  learningCycleUq:unique("decision_outcome_reviews_learning_cycle_uq").on(t.companyId,t.learningCycleId),
  learningCycleCheck:check("decision_outcome_reviews_learning_cycle_check",sql`${t.learningCycleId} is null or ${t.status} in ('completed','inconclusive')`),
  dueIdx:index("decision_outcome_reviews_due_idx").on(t.companyId,t.status,t.reviewDueAt,t.id),
  stateCheck:check("decision_outcome_reviews_state_check",sql`${t.revision}>0 and ${t.status} in ('scheduled','in_review','completed','inconclusive','cancelled') and (${t.status} in ('completed','inconclusive'))=(${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null) and (${t.status} in ('completed','inconclusive') or (${t.reviewedAt} is null and ${t.reviewedByUserId} is null))`),
  contentCheck:check("decision_outcome_reviews_content_check",sql`${t.contextHash} ~ '^[0-9a-f]{64}$' and ${t.updatedAt}>=${t.createdAt}`),
}));
export const decisionOutcomeReviewReceipts=pgTable("decision_outcome_review_receipts",{
  companyId:uuid("company_id").notNull(),reviewId:uuid("review_id").notNull(),revision:integer("revision").notNull(),
  payload:jsonb("payload_json").$type<DecisionOutcomeReviewReceipt>().notNull(),lineageManifestId:uuid("lineage_manifest_id").notNull(),
},t=>({
  receiptUq:unique("decision_outcome_review_receipts_revision_uq").on(t.companyId,t.reviewId,t.revision),
  reviewFk:foreignKey({name:"decision_outcome_review_receipts_review_fk",columns:[t.companyId,t.reviewId],foreignColumns:[decisionOutcomeReviews.companyId,decisionOutcomeReviews.id]}).onDelete("cascade"),
  lineageFk:foreignKey({name:"decision_outcome_review_receipts_lineage_fk",columns:[t.companyId,t.lineageManifestId],foreignColumns:[analyticalLineageManifests.companyId,analyticalLineageManifests.id]}).onDelete("cascade"),
  receiptCheck:check("decision_outcome_review_receipts_content_check",sql`${t.revision}>0 and jsonb_typeof(${t.payload})='object' and ${t.payload}->>'contentHash' ~ '^[0-9a-f]{64}$' and (${t.payload}->>'revision')::integer=${t.revision}`),
}));
