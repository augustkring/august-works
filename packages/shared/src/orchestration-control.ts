import { z } from "zod";
import { orchestrationExperienceStatusSchema } from "./orchestration-experience.js";

export const orchestrationControlViewSchema = z.strictObject({ companyId: z.uuid(), planId: z.uuid(), taskId: z.uuid(),
  version: z.number().int().positive(), status: orchestrationExperienceStatusSchema, canPause: z.boolean(), canStop: z.boolean() });
export const orchestrationControlCommandSchema = z.strictObject({ requestId: z.uuid(), expectedVersion: z.number().int().positive(),
  action: z.enum(["pause", "cancel"]), rationale: z.string().trim().min(20).max(2000).regex(/^[^\u0000\uD800-\uDFFF]*$/u),
  acknowledgeCompletedEffectsRemain: z.literal(true) });
export const orchestrationControlReceiptSchema = z.strictObject({ companyId: z.uuid(), planId: z.uuid(), requestId: z.uuid(),
  action: z.enum(["pause", "cancel"]), resultingVersion: z.number().int().positive(), disposition: z.literal("control_requested"),
  // Immutable admission receipt, never physical Stop or effect reversal proof.
  propagation: z.literal("pending_verification") });
export type OrchestrationControlCommand = z.infer<typeof orchestrationControlCommandSchema>;
export type OrchestrationControlReceipt = z.infer<typeof orchestrationControlReceiptSchema>;
export const pendingOrchestrationControlLocatorsSchema = z.array(z.strictObject({ companyId: z.uuid(), planId: z.uuid(),
  principal: z.string().min(1).max(300), requestId: z.uuid() })).max(32).superRefine((rows, ctx) => {
  if (new Set(rows.map(row => JSON.stringify([row.companyId, row.principal, row.planId]))).size !== rows.length)
    ctx.addIssue({ code: "custom", message: "Each current principal/plan retains one unresolved request" });
});
