import { z } from "zod";

/** Native run pins, issued by the controller rather than supplied by a model. */
export const workerModelBindingSchema = z
  .object({
    planId: z.string().uuid(),
    workerId: z.string().uuid(),
    workerAttemptId: z.string().uuid(),
    executionManifestId: z.string().uuid(),
    expectedPlanVersion: z.number().int().positive(),
  })
  .strict();
export type WorkerModelBinding = z.infer<typeof workerModelBindingSchema>;

const reviewModelSourceBinding = {
  planId: z.string().uuid(),
  issueId: z.string().uuid(),
  decisionId: z.string().uuid(),
  sourceRunId: z.string().uuid(),
  sourceWorkerId: z.string().uuid(),
  sourceAgentId: z.string().uuid(),
  sourceAttemptId: z.string().uuid(),
  sourceResultId: z.string().uuid(),
  sourceReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceResultCanonicalSha256: z.string().regex(/^(sha256:)?[a-f0-9]{64}$/),
  reviewerAgentId: z.string().uuid(),
  reviewerRunId: z.string().uuid(),
  executionManifestId: z.string().uuid(),
  expectedPlanVersion: z.number().int().positive(),
};

/** Host-minted completion-review binding. It deliberately contains no writer
 * worker/attempt identity: the canonical card and committed source own it.
 * It carries no `kind` key (MS1f decision 4): an absent kind is the completion
 * kind, so every completion binding, token and dispatch marker keeps its bytes. */
export const completionReviewModelBindingSchema = z.object({
  ...reviewModelSourceBinding,
  interactionId: z.string().uuid(),
}).strict();

/** MS1f decision 4. Host-minted execution-policy stage review binding under a
 * plan: it names the reviewed stage instead of a review interaction, and
 * `decisionId` is the executor's applied `execution_policy_stage_pending`
 * status decision. */
export const executionStageReviewModelBindingSchema = z.object({
  kind: z.literal("execution_stage"),
  ...reviewModelSourceBinding,
  stageId: z.string().uuid(),
}).strict();

export const reviewModelBindingSchema = z.union([completionReviewModelBindingSchema, executionStageReviewModelBindingSchema]);
export type CompletionReviewModelBinding = z.infer<typeof completionReviewModelBindingSchema>;
export type ExecutionStageReviewModelBinding = z.infer<typeof executionStageReviewModelBindingSchema>;
export type ReviewModelBinding = z.infer<typeof reviewModelBindingSchema>;

/** The review kind a `review_model` binding names. */
export function reviewModelBindingKind(binding: ReviewModelBinding): "completion" | "execution_stage" {
  return "kind" in binding && binding.kind === "execution_stage" ? "execution_stage" : "completion";
}

/** Current Human chat runs have no orchestration plan or worker attempt. The
 * controller issues this separate binding from the persisted Native run. */
export const conversationModelBindingSchema = z.object({
  issueId: z.string().uuid(),
  conversationSessionGeneration: z.number().int().nonnegative(),
  executionManifestId: z.string().uuid(),
  executionManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ConversationModelBinding = z.infer<typeof conversationModelBindingSchema>;

/** First supported worker transport: one bounded text inference. Model,
 * connection, destination, tariffs, Native task and authority are server-owned.
 * Client/server tools, sessions, attachments, thinking and retries are absent. */
export const workerModelCallSchema = z
  .object({
    callId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
    system: z.string().min(1).max(16000),
    prompt: z.string().min(1).max(256000),
    maxOutputTokens: z.number().int().min(1).max(8192),
  })
  .strict();
export type WorkerModelCall = z.infer<typeof workerModelCallSchema>;

export const workerModelResultSchema = z
  .object({
    reservationId: z.string().uuid(),
    text: z.string().max(256000),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type WorkerModelResult = z.infer<typeof workerModelResultSchema>;
