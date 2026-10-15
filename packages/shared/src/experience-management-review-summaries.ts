import { z } from "zod";
import { managementAgendaCategorySchema } from "./management-reviews.js";
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true }), key = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
const status = z.enum(["draft", "published", "superseded"]);
const period = z.object({ from: time, until: time }).refine(value => Date.parse(value.from) < Date.parse(value.until));
export const insightManagementControlsSchema = z.object({ items: z.array(z.object({ id, status, createdAt: time, expiresAt: time })).max(20), nextCursor: id.nullable(), coverage: z.literal("bounded_native_review_metadata") });
export const insightManagementSummarySchema = z.object({ id, companyId: id, status, name: z.string().min(3).max(200),
  reviewType: z.enum(["daily_operational", "weekly_leadership", "monthly_business", "quarterly_strategy", "ad_hoc"]),
  contentHash: hash, definitionHash: hash, sourceKeys: z.array(key).min(1).max(20), createdAt: time, expiresAt: time, publishedAt: time.nullable(), currentQualification: z.enum(["current", "needs_revalidation"]),
  packet: z.object({ engineVersion: z.literal("aw-native-management-skeleton-v1"), definitionHash: hash, inputHash: hash, contentHash: hash, asOf: time, period,
    coverage: z.literal("explicit_selected_native_sources"), executionAuthority: z.literal("read_only_historical_review"), limitations: z.array(z.string().max(4000)).max(100),
    claims: z.array(z.object({ key: z.string().regex(/^(claim_|comparison_)[a-z][a-z0-9_-]{0,79}$/), sourceKeys: z.array(key).min(1).max(20),
      grade: z.enum(["native_observation", "native_current_state", "predictive", "conditional_scenario", "human_interpreted_experiment", "conditional_causal", "native_outcome_review", "native_learning_cycle"]),
      facts: z.record(z.string().max(100), z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 100),
      limitations: z.array(z.string().max(4000)).max(100) })).max(40),
    agenda: z.array(z.object({ key, category: managementAgendaCategorySchema, dueAt: time, sourceKeys: z.array(key).min(1).max(20),
      nextAction: z.string().min(10).max(2000), hypothesis: z.string().min(10).max(2000).nullable(),
      interpretation: z.literal("human_declared_agenda"), hypothesisAuthority: z.enum(["human_hypothesis", "none"]) })).max(10) }) });
export interface InsightManagementReviewPage { items: z.infer<typeof insightManagementSummarySchema>[]; hasMoreReviews: boolean; boundedPage: true; }
