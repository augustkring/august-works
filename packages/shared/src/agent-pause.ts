import { z } from "zod";
import { AGENT_STATUSES } from "./constants.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const agentPauseCommandSchema = z.strictObject({
  requestId: z.uuid().refine(id => id === id.toLowerCase(), "Use the canonical request ID"),
  expectedSourceToken: digest, pendingWork: z.enum(["drain", "cancel"]), confirmPause: z.literal(true),
});
export const agentPauseReviewSchema = z.strictObject({
  companyId: z.uuid(), agentId: z.uuid(), name: z.string().min(1).max(200),
  nativeStatus: z.enum(AGENT_STATUSES), sourceToken: digest, canPause: z.boolean(),
}).superRefine((value, context) => {
  if (value.canPause !== !["paused", "pending_approval", "terminated"].includes(value.nativeStatus))
    context.addIssue({ code: "custom", message: "Pause admission must match current Native lifecycle" });
});
/** Historical admission acceptance, never proof that remote work is settled. */
export const agentPauseReceiptSchema = z.strictObject({
  companyId: z.uuid(), agentId: z.uuid(), requestId: z.uuid(), pendingWork: z.enum(["drain", "cancel"]),
  acceptedAt: z.iso.datetime(), admissionClosedAtAcceptance: z.literal(true), workSettled: z.literal(false),
});
export type AgentPauseCommand = z.infer<typeof agentPauseCommandSchema>;
export type AgentPauseReview = z.infer<typeof agentPauseReviewSchema>;
export type AgentPauseReceipt = z.infer<typeof agentPauseReceiptSchema>;
