import { z } from "zod";

export const WORK_SIGNAL_TYPES = ["commitment", "completion_claim", "blocker", "deadline_change", "owner_change", "decision", "approval_request", "risk", "project_update", "new_task", "correction"] as const;
export const workSignalExtractSchema = z.object({ issueId: z.string().uuid() }).strict();
export const workSignalDecisionSchema = z.object({ expectedVersion: z.number().int().positive(), rationale: z.string().trim().min(20).max(2000), targetIssueId: z.string().uuid().optional() }).strict();
export interface WorkSignalView {
  id: string; companyId: string; issueId: string; targetIssueId: string | null; sourceDeliveryId: string | null;
  signalType: typeof WORK_SIGNAL_TYPES[number]; status: "candidate" | "ignored" | "review_requested" | "proposed" | "invalidated";
  version: number; sensitivity: "internal" | "restricted"; confidence: "explicit" | "uncertain";
  facts: { date?: string; reason: string } | null; proposalId: string | null; interactionId: string | null;
  followupAttempts: number; followupErrorCode: string | null;
  createdAt: string; expiresAt: string;
}
export type WorkSignalDecisionInput = z.infer<typeof workSignalDecisionSchema>;
