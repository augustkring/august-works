import { z } from "zod";
import { orchestrationCompletionSchema } from "./orchestration.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.uuid().refine(value => value === value.toLowerCase(), "Use the canonical request ID");

/** A representative internal-draft call is separate from runtime conformance.
 * The initiating human reviews the output through canonical verification. */
export const agentDraftTestReviewSchema = z.strictObject({
  companyId: z.uuid(), draftId: z.uuid(), version: z.number().int().positive(),
  agentId: z.uuid(), scenarioIndex: z.number().int().min(0).max(9),
  scenario: z.string().trim().min(1).max(2000),
  runtimeBindingId: z.uuid(), configurationHash: digest, candidateHash: digest,
  procedureSnapshotHash: digest.optional(),
  requiredProcedures: z.array(z.strictObject({ skillId: z.uuid(), versionId: z.uuid(),
    name: z.string().min(1).max(200), bodyHash: digest })).max(32).optional(),
  requiredPlaybooks: z.array(z.strictObject({ playbookId: z.uuid(), revisionId: z.uuid(),
    name: z.string().min(1).max(200), bodyHash: digest })).max(32).optional(),
  maximumCostMinor: z.number().int().min(0).max(1000000),
  currency: z.literal("USD"),
  provider: z.literal("anthropic"), model: z.string().min(1).max(200),
  transport: z.literal("server-text-only-v1"),
  toolsGranted: z.literal(false), activatesAgent: z.literal(false),
  companyVisibleResult: z.literal(true), reviewHash: digest,
});
export const agentDraftTestCommandSchema = z.strictObject({
  requestId, expectedVersion: z.number().int().positive(),
  scenarioIndex: z.number().int().min(0).max(9), expectedReviewHash: digest,
  confirmRepresentativeTest: z.literal(true),
  confirmCompanyVisibleResult: z.literal(true),
});
/** The existing verification packet, constrained to this tool-free harness. */
export const agentDraftTestPacketSchema = z.strictObject({
  planId: z.uuid(), planVersion: z.number().int().positive(), workerId: z.null(), issueId: z.uuid(), contractId: z.uuid(),
  contractHash: digest, contract: orchestrationCompletionSchema, resultHash: digest,
  evidence: z.array(z.strictObject({ ref: z.string().min(1).max(200), type: z.literal("task_document"),
    sourceId: z.uuid(), sourceVersion: z.uuid(), hash: digest })).min(1).max(16),
  deterministicFailures: z.array(z.string().min(1).max(500)).max(64), liveAttempts: z.literal(0), riskClass: z.literal("C0"),
  policy: z.strictObject({ independentRequired: z.literal(true), humanRequired: z.literal(true), workerSelfCertification: z.literal(false) }),
});
export const agentDraftTestViewSchema = z.strictObject({
  id: z.uuid(), companyId: z.uuid(), draftId: z.uuid(), version: z.number().int().positive(),
  requestId, scenarioIndex: z.number().int().min(0).max(9),
  scenario: z.string().trim().min(10).max(2000),
  agentId: z.uuid(), runId: z.uuid(), planId: z.uuid(),
  candidateCurrent: z.boolean(), runtimeCurrent: z.boolean(), resultCurrent: z.boolean(),
  execution: z.enum(["running", "succeeded", "failed", "unknown", "cancelled"]),
  verification: z.enum(["not_reviewed", "pass", "fail", "inconclusive", "needs_human"]),
  testQualified: z.boolean(), toolsGranted: z.literal(false), activatesAgent: z.literal(false),
  result: z.string().max(128000).nullable(),
  maximumCostMinor: z.number().int().min(0).max(1000000),
  currency: z.literal("USD"),
  createdAt: z.iso.datetime(),
}).superRefine((view, context) => {
  if (view.testQualified && (!view.candidateCurrent || !view.runtimeCurrent || !view.resultCurrent || view.execution !== "succeeded" || view.verification !== "pass"))
    context.addIssue({ code: "custom", message: "Qualification requires the current candidate, runtime, execution and independent verification" });
});
export type AgentDraftTestReview = z.infer<typeof agentDraftTestReviewSchema>;
export type AgentDraftTestCommand = z.infer<typeof agentDraftTestCommandSchema>;
export type AgentDraftTestView = z.infer<typeof agentDraftTestViewSchema>;
