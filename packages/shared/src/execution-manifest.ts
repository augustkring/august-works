import { z } from "zod";
import { agentExecutionScopeSchema } from "./cross-company-context.js";

export const platformSkillIdentitySchema = z.object({ key: z.literal("blentera-platform"), version: z.string().min(1).max(100), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), sourceSha: z.string().regex(/^[a-f0-9]{40}$/) }).strict();
export type PlatformSkillIdentity = z.infer<typeof platformSkillIdentitySchema>;

export const executionManifestSkillSchema = z.object({ skillId: z.string().uuid(), versionId: z.string().uuid(), key: z.string().min(1).max(300), name: z.string().max(200), selection: z.enum(["required", "task_required", "recommended"]), loadPoint: z.enum(["always", "task_relevant", "on_demand"]), estimatedDescriptorTokens: z.number().int().nonnegative() }).strict();
export const executionManifestCapabilitySchema = z.object({ type: z.enum(["native_action", "tool", "workflow", "automation_artifact", "agent", "external_agent", "provider_skill", "provider_tool"]), ref: z.string().min(1).max(500), title: z.string().max(200), risk: z.enum(["C0", "C1", "C2", "C3", "C4"]), access: z.enum(["allowed", "requires_approval"]), versionHash: z.string().max(200).nullable(), deterministic: z.boolean() }).strict();
export const agentExecutionManifestSchema = z.object({
  schemaVersion: z.literal(5), runId: z.string().uuid(), companyId: z.string().uuid(), agentId: z.string().uuid(), agentIdentityId: z.string().uuid(), homeCompanyId: z.string().uuid(), responsibleUserId: z.string().min(1).max(200).nullable(),
  agentDefinitionVersion: z.object({ revisionId: z.string().uuid(), definitionHash: z.string().regex(/^[a-f0-9]{64}$/), procedureSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), version: z.number().int().positive().optional() }).strict().optional(),
  platformSkill: platformSkillIdentitySchema.optional(),
  agentNativeContract: z.object({ operationManifestHash: z.string().regex(/^[a-f0-9]{64}$/), toolCatalogContractHash: z.string().regex(/^[a-f0-9]{64}$/), protocolProfile: z.literal("2026-07-28"), runtimeAdapter: z.string().min(1).max(100), runtimeCapabilitySnapshotHash: z.string().min(1).max(100) }).strict().optional(),
  executionScope: agentExecutionScopeSchema,
  rolePack: z.object({ systemKey: z.string().max(100), systemVersion: z.string().max(200), pins: z.array(z.object({ rolePackId: z.string().uuid(), versionId: z.string().uuid(), scopeType: z.string().max(20), scopeId: z.string().uuid() }).strict()).max(100) }).strict().nullable(),
  contextManifests: z.array(z.object({ companyId: z.string().uuid(), contextManifestId: z.string().uuid() }).strict()).min(1).max(9),
  skills: z.array(executionManifestSkillSchema).max(64),
  playbooks: z.array(z.object({ playbookId: z.string().uuid(), revisionId: z.string().uuid(), required: z.boolean() }).strict()).max(32),
  capabilities: z.array(executionManifestCapabilitySchema).max(256),
  providers: z.array(z.object({ companyId: z.string().uuid(), agentId: z.string().uuid(), providerBindingId: z.string().uuid(), profileRef: z.string().max(200), snapshotHash: z.string().max(100), isolationMode: z.enum(["isolated_per_presence", "shared_trusted_runtime"]) }).strict()).min(1).max(9),
  executionPolicy: z.object({ deterministicPreference: z.literal(true), policies: z.array(z.string().max(200)).max(32), approvalRefs: z.array(z.string().uuid()).max(100), restrictions: z.array(z.string().max(500)).max(64), policySnapshotHash: z.string().max(100) }).strict(),
  inventoryEstimatedTokens: z.number().int().nonnegative(), warnings: z.array(z.string().max(1000)).max(64),
}).strict();
export type AgentExecutionManifest = z.infer<typeof agentExecutionManifestSchema>;
export type ExecutionManifestCapability = z.infer<typeof executionManifestCapabilitySchema>;
export type ExecutionManifestSkill = z.infer<typeof executionManifestSkillSchema>;
export const createExecutionScopeRequestSchema = z.object({ executionScope: agentExecutionScopeSchema, issueId: z.string().uuid().nullable().default(null), query: z.string().trim().min(1).max(500) }).strict();

export type CreateExecutionScopeRequest = z.input<typeof createExecutionScopeRequestSchema>;
