import { z } from "zod";

export const PLAYBOOK_STATUSES = ["draft", "in_review", "approved", "superseded", "archived"] as const;
export const createPlaybookSchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/), title: z.string().trim().min(1).max(200), category: z.string().max(100).default("general"), markdown: z.string().min(1).max(1_000_000), sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"), ownerUserId: z.string().max(200).nullable().default(null), ownerAgentId: z.string().uuid().nullable().default(null), reviewFrequencyDays: z.number().int().min(1).max(3650).default(90) }).strict();
export const playbookDraftSchema = z.object({ expectedRevisionId: z.string().uuid(), title: z.string().trim().min(1).max(200), markdown: z.string().min(1).max(1_000_000), changeSummary: z.string().trim().min(1).max(4000) }).strict();
export const updatePlaybookMetadataSchema = z.object({ expectedUpdatedAt: z.string().datetime(), category: z.string().trim().min(1).max(100), sensitivity: z.enum(["public", "internal", "confidential", "restricted"]), ownerUserId: z.string().min(1).max(200).nullable(), ownerAgentId: z.string().uuid().nullable(), reviewFrequencyDays: z.number().int().min(1).max(3650), rationale: z.string().trim().min(20).max(4000) }).strict();
export const reviewPlaybookSchema = z.object({ expectedRevisionId: z.string().uuid(), decision: z.enum(["approve", "request_changes", "archive"]), rationale: z.string().trim().min(10).max(4000) }).strict();
export const proposePlaybookSchema = z.object({ baseApprovedRevisionId: z.string().uuid().nullable(), title: z.string().trim().min(1).max(200), markdown: z.string().min(1).max(1_000_000), reason: z.string().trim().min(20).max(4000), sourceSkillId: z.string().uuid().nullable().default(null), sourceSkillVersionId: z.string().uuid().nullable().default(null) }).strict().refine((v) => Boolean(v.sourceSkillId) === Boolean(v.sourceSkillVersionId), "Skill feedback requires both local Skill and version");
export const linkPlaybookSkillSchema = z.object({ playbookRevisionId: z.string().uuid(), skillId: z.string().uuid(), skillVersionId: z.string().uuid(), relationType: z.enum(["implements", "refers_to", "derived_from"]), syncPolicy: z.enum(["manual", "notify_on_change", "auto_generate_candidate"]).default("notify_on_change") }).strict();
export const projectPlaybookSkillSchema = z.object({ approvedRevisionId: z.string().uuid(), skillId: z.string().uuid(), baseActiveVersionId: z.string().uuid().nullable(), markdown: z.string().min(1).max(100_000), summary: z.string().trim().min(20).max(4000), syncPolicy: z.enum(["manual", "notify_on_change", "auto_generate_candidate"]).default("notify_on_change") }).strict();
export interface PlaybookSummary { id: string; companyId: string; key: string; title: string | null; category: string; status: typeof PLAYBOOK_STATUSES[number]; sensitivity: string; approvedRevisionId: string | null; latestRevisionId: string; reviewFrequencyDays: number; nextReviewAt: string | null; ownerUserId: string | null; ownerAgentId: string | null; overdue: boolean; }

export type CreatePlaybookInput = z.input<typeof createPlaybookSchema>;
export type PlaybookDraftInput = z.input<typeof playbookDraftSchema>;
export type UpdatePlaybookMetadataInput = z.input<typeof updatePlaybookMetadataSchema>;
export type ReviewPlaybookInput = z.input<typeof reviewPlaybookSchema>;
export interface PlaybookReviewResult {
  id: string;
  status: PlaybookSummary["status"];
  approvedRevisionId: string | null;
  generatedCandidates: Array<{ skillId: string; versionId: string }>;
  synchronizationFailures: Array<{ skillId: string | null; reason: string }>;
}
export type ProjectPlaybookSkillInput = z.input<typeof projectPlaybookSkillSchema>;

export const reviewPlaybookProposalSchema = z.object({ accept: z.boolean(), rationale: z.string().trim().min(10).max(4000) }).strict();
