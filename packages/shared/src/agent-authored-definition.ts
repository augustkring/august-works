import { z } from "zod";
import { agentAuthoringContentSchema } from "./agent-authoring.js";
import { agentPublicationPackageProvenanceSchema } from "./agent-authoring-publication.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const modelMigrationProvenanceSchema = z.strictObject({
  action: z.enum(["migration", "rollback"]),
  rollbackOfRevisionId: z.uuid().optional(),
  cohort: z.strictObject({ kind: z.literal("single_agent"), agentId: z.uuid(),
    baselineRevisionId: z.uuid(), baselineVersion: z.number().int().positive(), targetVersion: z.number().int().positive(), maxAgents: z.literal(1) }),
  baseline: z.strictObject({ adapterConfigurationHash: digest, modelProfileHash: digest, qualificationProfileHash: digest,
    lifecycleHash: digest, verifiedTestIds: z.array(z.uuid()).min(1).max(10) }),
  currentIncumbent: z.strictObject({ profileHash: digest, qualificationProfileHash: digest, lifecycleHash: digest }),
  candidate: z.strictObject({ configurationHash: digest, profileHash: digest, conformanceRequestId: z.uuid(),
    conformanceEvidenceHash: digest, verifiedTestIds: z.array(z.uuid()).min(1).max(10) }),
  behaviorHash: digest,
  reviewedByUserId: z.string().min(1).max(200),
  reviewedAt: z.iso.datetime(),
});
const publishedModelRuntimeSchema = z.strictObject({
  adapterConfigurationHash: digest,
  configurationHash: digest,
  profileHash: digest,
  qualificationProfileHash: digest,
  lifecycleHash: digest,
  qualificationArtifactSha256: digest,
  conformanceRequestId: z.uuid().optional(),
  conformanceEvidenceHash: digest.optional(),
  verifiedTestIds: z.array(z.uuid()).min(1).max(10),
});

/** Reserved server-managed value in the Original Agent configuration revision.
 * Drafts, model output and generic Agent PATCH requests cannot install it. */
export const AUTHORED_AGENT_DEFINITION_KEY = "agentDefinitionVersion";
export const authoredAgentDefinitionSchema = z.strictObject({
  schema: z.literal("paperclip.agent-authored-definition.v1"),
  revisionId: z.uuid(),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  procedureSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  version: z.number().int().positive().optional(),
  publication: z.strictObject({ draftId: z.uuid(), draftVersion: z.number().int().positive(),
    candidateRevision: z.number().int().positive(), requestedByUserId: z.string().min(1).max(200),
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    verifiedTestIds: z.array(z.uuid()).min(1).max(10), priorRevisionId: z.uuid().nullable(), activatedAtPublication: z.boolean(),
    procedureSnapshotHash: digest.optional(), modelRuntime: publishedModelRuntimeSchema.optional(),
    packageInstallation: agentPublicationPackageProvenanceSchema.optional(),
    modelMigration: modelMigrationProvenanceSchema.optional() }).optional(),
  content: agentAuthoringContentSchema,
}).superRefine((value, context) => {
  if (Boolean(value.publication) !== (value.version !== undefined) || value.publication && !value.procedureSnapshotHash)
    context.addIssue({ code: "custom", message: "A customer publication needs its version, reviewed provenance and procedural mapping" });
  if (value.publication?.modelMigration) {
    const migration = value.publication.modelMigration;
    if ((migration.action === "rollback") !== Boolean(migration.rollbackOfRevisionId))
      context.addIssue({ code: "custom", path: ["publication", "modelMigration", "rollbackOfRevisionId"], message: "A qualified rollback must link the exact prior migration revision" });
    if (migration.cohort.targetVersion !== value.version || migration.cohort.targetVersion !== migration.cohort.baselineVersion + 1)
      context.addIssue({ code: "custom", path: ["publication", "modelMigration", "cohort"], message: "A migration receipt must bind the immediately preceding Agent version" });
  }
  if ((value.content.knowledgeDocumentIds.length || value.content.memory !== "none") && !value.procedureSnapshotHash)
    context.addIssue({ code: "custom", message: "Selected knowledge needs its exact retained Source snapshot" });
});
export type AuthoredAgentDefinition = z.infer<typeof authoredAgentDefinitionSchema>;

/** Only the text-data Native draft and Human-reviewed task proposal are mapped. Other choices
 * remain drafts until their canonical runtime policy is implemented. */
export function authoredAgentMappingBlockers(content: z.infer<typeof agentAuthoringContentSchema>) {
  const blockers: string[] = [];
  if (content.knowledgeDocumentIds.length && !content.capabilities.some(c => c.operation === "read_approved_knowledge" && c.autonomy === "automatic"))
    blockers.push("knowledge_read_authority_required");
  if (content.memory === "approved_work_preferences" && !content.memoryRecordIds?.length ||
    content.memory === "approved_company_knowledge" && !content.knowledgeDocumentIds.length)
    blockers.push("memory_source_selection_required");
  if (content.memory !== "approved_work_preferences" && content.memoryRecordIds?.length)
    blockers.push("memory_policy_mismatch");
  if (!content.capabilities.some(c => c.operation === "create_internal_draft" && c.autonomy === "automatic"))
    blockers.push("internal_draft_authority_required");
  if (content.capabilities.some(c => c.autonomy !== "not_allowed" &&
    !((["create_internal_draft", "read_approved_knowledge"].includes(c.operation) && c.autonomy === "automatic") ||
      (c.operation === "create_task" && c.autonomy === "ask_first"))))
    blockers.push("capability_mapping_required");
  return blockers;
}
