import { z } from "zod";
import type { EvidenceItem } from "./types/context.js";
import { proposePlaybookSchema } from "./playbooks.js";
import { roadmapProposalSchema, taskForecastPatchSchema } from "./project-control.js";

export const delegatedCompanyScopeSchema = z.object({
  companyId: z.string().uuid(), agentPresenceId: z.string().uuid(),
  purpose: z.string().trim().min(1).max(500),
  accessMode: z.enum(["read", "contribute", "act"]),
}).strict();
export const agentExecutionScopeSchema = z.object({
  primaryCompanyId: z.string().uuid(), primaryAgentPresenceId: z.string().uuid(),
  delegatedScopes: z.array(delegatedCompanyScopeSchema).max(8).default([]),
}).strict().superRefine((scope, ctx) => {
  const companies = [scope.primaryCompanyId, ...scope.delegatedScopes.map((s) => s.companyId)];
  if (new Set(companies).size !== companies.length) ctx.addIssue({ code: "custom", message: "Each company may appear only once in an execution scope" });
});
export type AgentExecutionScope = z.infer<typeof agentExecutionScopeSchema>;
export const scopedRuntimeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("task.read"), companyId: z.string().uuid(), taskId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("task.forecast"), companyId: z.string().uuid(), projectId: z.string().uuid(), taskId: z.string().uuid(), forecast: taskForecastPatchSchema }).strict(),
  z.object({ action: z.literal("task.propose_plan"), companyId: z.string().uuid(), projectId: z.string().uuid(), proposal: roadmapProposalSchema }).strict(),
  z.object({ action: z.literal("playbook.propose"), companyId: z.string().uuid(), playbookId: z.string().uuid(), proposal: proposePlaybookSchema }).strict(),
  z.object({ action: z.literal("tool.list"), companyId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("tool.invoke"), companyId: z.string().uuid(), tool: z.string().trim().min(1).max(300), parameters: z.record(z.string(), z.unknown()).default({}).refine(value => JSON.stringify(value).length <= 64_000, "Tool arguments exceed the scoped limit"), idempotencyKey: z.string().trim().min(1).max(200).optional() }).strict(),
]);
export type ScopedRuntimeAction = z.infer<typeof scopedRuntimeActionSchema>;
export const crossCompanyContextRequestSchema = z.object({
  executionScope: agentExecutionScopeSchema,
  query: z.string().trim().min(1).max(500),
  intent: z.string().trim().min(1).max(200).default("cross_company_analysis"),
  maxEstimatedTokens: z.number().int().min(500).max(16000).default(8000),
}).strict();
export const crossCompanyPolicySchema = z.object({
  allowRead: z.boolean().default(false),
  allowContribute: z.boolean().default(false),
  allowAct: z.boolean().default(false),
  allowedSensitivities: z.array(z.enum(["public", "internal", "confidential"])).max(3).default(["public", "internal"]),
}).strict();
export type CrossCompanyPolicy = z.infer<typeof crossCompanyPolicySchema>;
export type CrossCompanyUsePolicy = "allow" | "no_export" | "aggregate_only";
export interface ScopedEvidenceItem extends EvidenceItem {
  sourceCompanyId: string;
  sourceCompanyName: string;
  shareClassification: EvidenceItem["sensitivity"];
  crossCompanyUsePolicy: CrossCompanyUsePolicy;
}
export interface CrossCompanyContextPacket {
  executionScope: AgentExecutionScope;
  evidence: ScopedEvidenceItem[];
  manifests: Array<{ companyId: string; contextManifestId: string }>;
  estimatedTokens: number;
  warnings: string[];
  resultOwnerCompanyId: string;
}
