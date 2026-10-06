import { z } from "zod";

/** References carry native identities and explicit version pins, never copied
 * Foundation narrative or an implied authorization grant. */
export const strategyExecutionReferenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("foundation_section"), foundationDocumentId: z.string().uuid(), approvedRevisionId: z.string().uuid(), sectionId: z.string().uuid(), headingPath: z.array(z.string().max(500)).max(32), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ type: z.literal("goal"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("metric"), id: z.string().uuid(), versionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("metric_target"), id: z.string().uuid(), versionId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("project"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("milestone"), id: z.string().uuid(), projectId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("issue"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("decision"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("metric_observation"), id: z.string().uuid(), metricId: z.string().uuid(), metricVersionId: z.string().uuid() }).strict(),
]);
export const strategyExecutionRelationshipSchema = z.enum(["supports", "measures", "constrains", "advanced_by", "depends_on", "conflicts_with", "funds", "informs"]);
export const strategyExecutionContributionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hypothesis"), statement: z.string().trim().min(10).max(2000) }).strict(),
  z.object({ kind: z.literal("relative_priority"), weight: z.number().finite().positive().max(1000), rationale: z.string().trim().min(10).max(2000) }).strict(),
]);
function identity(reference: z.infer<typeof strategyExecutionReferenceSchema>) {
  return reference.type === "foundation_section" ? `foundation:${reference.foundationDocumentId}` : `${reference.type}:${reference.id}`;
}
export const strategyExecutionLinkDefinitionSchema = z.object({
  from: strategyExecutionReferenceSchema, to: strategyExecutionReferenceSchema,
  relationship: strategyExecutionRelationshipSchema,
  rationale: z.string().trim().min(10).max(2000),
  ownerUserId: z.string().trim().min(1).max(300),
  reviewFrequencyDays: z.number().int().min(1).max(365),
  retentionDays: z.number().int().min(1).max(3650),
  sensitivity: z.enum(["internal", "confidential"]),
  purpose: z.literal("management_intelligence"),
  governanceObligationRefs: z.array(z.string().uuid()).min(1).max(32),
  contribution: strategyExecutionContributionSchema.nullable().default(null),
}).strict().refine(value => identity(value.from) !== identity(value.to), "A strategic link requires distinct native endpoints")
  .refine(value => value.relationship !== "measures" || ["metric", "metric_target", "metric_observation"].includes(value.from.type) && ["goal", "project", "milestone", "issue"].includes(value.to.type), "Measurement links connect a pinned measurement to a native execution context")
  .refine(value => value.relationship !== "advanced_by" || value.from.type === "goal" && ["project", "milestone", "issue"].includes(value.to.type) || value.from.type === "project" && ["milestone", "issue"].includes(value.to.type) || value.from.type === "milestone" && value.to.type === "issue", "Execution links follow existing Goal/Project/Milestone/Task ownership");
export const createStrategyExecutionLinkSchema = z.object({ definition: strategyExecutionLinkDefinitionSchema }).strict();
export const reviseStrategyExecutionLinkSchema = z.object({ expectedRevision: z.number().int().positive(), definition: strategyExecutionLinkDefinitionSchema }).strict();
export const approveStrategyExecutionLinkSchema = z.object({ expectedRevision: z.number().int().positive(), versionId: z.string().uuid(), rationale: z.string().trim().min(10).max(2000) }).strict();
export const retireStrategyExecutionLinkSchema = z.object({ expectedRevision: z.number().int().positive(), rationale: z.string().trim().min(10).max(2000) }).strict();
export type StrategyExecutionReference = z.infer<typeof strategyExecutionReferenceSchema>;
export type StrategyExecutionLinkDefinition = z.infer<typeof strategyExecutionLinkDefinitionSchema>;
export type CreateStrategyExecutionLink = z.infer<typeof createStrategyExecutionLinkSchema>;
export type ReviseStrategyExecutionLink = z.infer<typeof reviseStrategyExecutionLinkSchema>;
export type ApproveStrategyExecutionLink = z.infer<typeof approveStrategyExecutionLinkSchema>;
export type RetireStrategyExecutionLink = z.infer<typeof retireStrategyExecutionLinkSchema>;
export interface StrategyExecutionLinkView {
  id: string; companyId: string; revision: number;
  status: "proposed" | "active" | "needs_review" | "retired";
  approvedVersionId: string | null; createdAt: string; updatedAt: string;
}
export interface StrategyExecutionLinkVersionView {
  id: string; companyId: string; linkId: string; revision: number;
  definition: StrategyExecutionLinkDefinition; contentHash: string; createdAt: string;
}
