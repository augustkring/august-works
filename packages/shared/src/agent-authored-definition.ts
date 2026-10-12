import { z } from "zod";
import { agentAuthoringContentSchema } from "./agent-authoring.js";
import { agentPublicationPackageProvenanceSchema } from "./agent-authoring-publication.js";

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
    packageInstallation: agentPublicationPackageProvenanceSchema.optional() }).optional(),
  content: agentAuthoringContentSchema,
}).superRefine((value, context) => {
  if (Boolean(value.publication) !== (value.version !== undefined) || value.publication && !value.procedureSnapshotHash)
    context.addIssue({ code: "custom", message: "A customer publication needs its version, reviewed provenance and procedural mapping" });
  if (value.content.knowledgeDocumentIds.length && !value.procedureSnapshotHash)
    context.addIssue({ code: "custom", message: "Selected knowledge needs its exact retained Source snapshot" });
});
export type AuthoredAgentDefinition = z.infer<typeof authoredAgentDefinitionSchema>;

/** Only the actual text-only Native boundary is mapped here. Other choices
 * remain drafts until their canonical runtime policy is implemented. */
export function authoredAgentMappingBlockers(content: z.infer<typeof agentAuthoringContentSchema>) {
  const blockers: string[] = [];
  if (content.knowledgeDocumentIds.length && !content.capabilities.some(c => c.operation === "read_approved_knowledge" && c.autonomy === "automatic"))
    blockers.push("knowledge_read_authority_required");
  if (content.memory !== "none") blockers.push("memory_mapping_required");
  if (!content.capabilities.some(c => c.operation === "create_internal_draft" && c.autonomy === "automatic"))
    blockers.push("internal_draft_authority_required");
  if (content.capabilities.some(c => c.autonomy !== "not_allowed" &&
    !(["create_internal_draft", "read_approved_knowledge"].includes(c.operation) && c.autonomy === "automatic")))
    blockers.push("capability_mapping_required");
  return blockers;
}
