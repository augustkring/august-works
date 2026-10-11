import { z } from "zod";

export const AGENT_RETIREMENT_MAX_BINDINGS = 256;
export const AGENT_RETIREMENT_POLICY_VERSION = "aw.agent-retirement.v1";
/** Local domain processing contract; no Telemetry caller or provider export. */
export const AGENT_RETIREMENT_PROCESSING_CONTRACT = Object.freeze({
  id: "aw.agent-retirement-processing.v1",
  eventFamily: "original_agent_retirement",
  owner: "August Works Agent administration and privacy",
  decisionOrProductPurpose: "Review and permanently detach one Agent's local authority after original work and provider access have settled.",
  allowedFields: Object.freeze(["Current company/Agent identity and name", "Fixed blocker codes", "Bounded access counts", "Opaque source token", "Reviewed request and source hashes", "Policy version", "Retirement time", "Verified local postcondition"]),
  prohibitedFields: Object.freeze(["Configuration content", "Credentials or secret values", "Provider credential names", "Prompts and output", "Messages or work content", "Private errors", "Arbitrary properties"]),
  identityGranularity: "One Agent in one company; the existing Activity Log owns the initiating human's audit identity.",
  tenantCompanyScope: "One currently authorized company and its original Agent; no cross-company aggregate.",
  dataClassification: "Company-confidential administration metadata",
  collectionSource: "Original Agent, work, automation, access, provider and installation owners; no recursive private-content scan",
  processorOrSink: "Private read response, original Agent retirement receipt and original Activity Log only",
  processingRegion: "Existing deployment; no additional region or residency claim",
  accessPolicy: "Current verified human membership and original Agent read/configure/runtime, permission-administration and tool-administration authority; no instance-admin bypass",
  sampling: "Explicit review and confirmed C3 command; foreground reads do not create events",
  retentionTrigger: "One confirmed Native retirement commit; read projections last only for the response",
  retentionRule: "Receipt follows the original Agent/company lifetime; audit identity and canonical history retain their original owner policies",
  deletionAndRightsBehavior: "Original Agent/company erasure cascades the receipt; retirement preserves required history and does not certify erasure. Current account/source loss hides prior views.",
  backupOrExportBehavior: "Existing governed database backups only; no new export or backup-erasure claim",
  redactionOrHashing: "Strict allow-list; source hash uses routing metadata, versions and blocker booleans, never credential or configuration content. Hashes are private metadata, not anonymous data.",
  tests: Object.freeze(["Strict schema", "Native current authority and source withdrawal", "Local-only atomic cleanup", "Rollback and original-request replay", "Legacy writer fencing", "Private HTTP namespace", "Current-account UI cancellation"]),
  reviewTriggers: Object.freeze(["New field or owner", "Identity/scope/access change", "Retention or erasure change", "Provider/sink/export", "External runtime or credential effects"]),
});
export const AGENT_RETIREMENT_BLOCKERS = [
  "pause_required", "work_pending", "automation_connected", "reports_pending",
  "disconnect_required", "protected_agent", "source_limit", "disabled",
] as const;
const boundedCount = z.number().int().min(0).max(AGENT_RETIREMENT_MAX_BINDINGS);
export const agentRetirementCountsSchema = z.strictObject({
  apiKeys: boundedCount,
  permissions: boundedCount,
  agentPermissionSettings: z.number().int().min(0).max(1),
  connectedApps: boundedCount,
  credentialBindings: boundedCount,
  runtimeBindings: boundedCount,
  toolTokens: boundedCount,
  toolProfiles: boundedCount,
});
export type AgentRetirementCounts = z.infer<typeof agentRetirementCountsSchema>;
export const agentRetirementCommandSchema = z.strictObject({
  requestId: z.uuid().toLowerCase(),
  expectedSourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  confirmRetirement: z.literal(true),
  pendingWorkPolicy: z.literal("require_settled"),
  accessPolicy: z.literal("detach_agent_only"),
  retentionPolicy: z.literal("existing_company_policy"),
});
export type AgentRetirementCommand = z.infer<typeof agentRetirementCommandSchema>;
export const agentRetirementViewSchema = z.strictObject({
  companyId: z.uuid(),
  agentId: z.uuid(),
  name: z.string().min(1).max(200),
  observedAt: z.iso.datetime(),
  sourceToken: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["blocked", "ready", "retired"]),
  alreadyStopped: z.boolean(),
  canRetire: z.boolean(),
  blockers: z.array(z.enum(AGENT_RETIREMENT_BLOCKERS)).max(AGENT_RETIREMENT_BLOCKERS.length),
  affectedAccess: agentRetirementCountsSchema.nullable(),
  retiredAt: z.iso.datetime().nullable(),
  policyVersion: z.literal(AGENT_RETIREMENT_POLICY_VERSION),
}).superRefine((view, context) => {
  const valid = view.state === "ready"
    ? view.canRetire && !view.blockers.length && view.affectedAccess !== null && view.retiredAt === null
    : view.state === "retired"
      ? view.alreadyStopped && !view.canRetire && !view.blockers.length && view.retiredAt !== null && view.affectedAccess !== null
      : !view.canRetire && view.blockers.length > 0 && view.retiredAt === null;
  if (!valid || new Set(view.blockers).size !== view.blockers.length)
    context.addIssue({ code: "custom", message: "Retirement must match the current original owner" });
});
export type AgentRetirementView = z.infer<typeof agentRetirementViewSchema>;
