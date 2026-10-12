import { selectedApprovedKnowledgeSchema } from "./agent-approved-knowledge.js";
import { z } from "zod";
import { agentAuthoringContentSchema } from "./agent-authoring.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const agentPublicationPackageSchema = z.strictObject({ installationId: z.uuid(), versionId: z.uuid(),
  key: z.string().min(1).max(120), version: z.string().min(1).max(120), contentHash: digest });
// A bare dotted SemVer resembles a JWT to the generic configuration redactor.
// Preserve its exact parts in provenance without exempting arbitrary strings.
const legacyPackageProvenance = agentPublicationPackageSchema.omit({ version: true }).extend({
  releaseVersion: z.tuple([z.string().regex(/^[0-9]+$/), z.string().regex(/^[0-9]+$/), z.string().regex(/^[0-9]+$/)]) });
// Package keys may also contain dots. Keep newly published keys as exact
// validated parts; accept existing revisions without changing their hashes.
export const agentPublicationPackageProvenanceSchema = z.union([
  legacyPackageProvenance,
  legacyPackageProvenance.omit({ key: true }).extend({
    keyParts: z.array(z.string().regex(/^[a-z0-9_-]*$/).max(120)).min(1).max(120),
  }).refine(value => /^[a-z0-9][a-z0-9._-]{0,119}$/.test(value.keyParts.join(".")), "Invalid package key"),
]);
export const agentDraftPublicationCommandSchema = z.strictObject({
  requestId: z.uuid().refine(id => id === id.toLowerCase(), "Use the canonical request ID"),
  expectedVersion: z.number().int().positive(), expectedReviewHash: digest,
  activate: z.literal(true), confirmPublication: z.literal(true), confirmActivation: z.literal(true),
});
export const agentDraftPublicationReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), version: z.number().int().positive(), agentId: z.uuid(),
  previousVersion: z.number().int().positive().nullable(), nextVersion: z.number().int().positive(),
  before: agentAuthoringContentSchema.nullable(), after: agentAuthoringContentSchema,
  activate: z.literal(true), canPublish: z.boolean(),
  blockers: z.array(z.strictObject({ code: z.string().min(1).max(100), message: z.string().min(1).max(2000) })).max(50),
  requiredProcedures: z.array(z.strictObject({ name: z.string().min(1).max(200), skillId: z.uuid(), versionId: z.uuid() })).max(32),
  selectedKnowledge: z.array(selectedApprovedKnowledgeSchema).max(30).optional(),
  requiredPlaybooks: z.array(z.strictObject({ playbookId: z.uuid(), revisionId: z.uuid(),
    name: z.string().min(1).max(200), bodyHash: digest })).max(32).optional(),
  maximumPerModelCallMinor: z.number().int().nonnegative().nullable(), currency: z.literal("USD"),
  provider: z.literal("anthropic").nullable(), model: z.string().min(1).max(200).nullable(),
  runtimeBindingId: z.uuid().nullable(), reviewHash: digest,
  modelCalled: z.literal(false), authorityGranted: z.literal(false), executionStarted: z.literal(false),
}).superRefine((value, context) => {
  if (value.canPublish !== (value.blockers.length === 0))
    context.addIssue({ code: "custom", path: ["canPublish"], message: "Publication requires every current blocker to be resolved" });
});
export const agentDraftPublicationReceiptSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), requestId: z.uuid(), agentId: z.uuid(), revisionId: z.uuid(),
  publishedVersion: z.number().int().positive(), publishedAt: z.iso.datetime(), activatedAtPublication: z.boolean(),
  publishedContent: agentAuthoringContentSchema,
  packageInstallation: agentPublicationPackageSchema.nullable().optional(),
  authorityGranted: z.literal(false), executionStarted: z.literal(false),
});
export type AgentDraftPublicationCommand = z.infer<typeof agentDraftPublicationCommandSchema>;
export type AgentDraftPublicationReview = z.infer<typeof agentDraftPublicationReviewSchema>;
export type AgentDraftPublicationReceipt = z.infer<typeof agentDraftPublicationReceiptSchema>;
