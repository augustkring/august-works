import { agentSetupAuthoringInputSchema, agentSetupAuthoringReceiptSchema, agentSetupCatalogInputSchema, agentSetupCatalogViewSchema } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { assertConversationRoutineAuthoring } from "./routine-authoring-authority.js";
import { agentAuthoringService } from "./agents/authoring-drafts.js";

/** Native drafts contain only empty Custom fields or canonical catalog
 * defaults. Private conversation prose is deliberately not copied into an
 * independently retained configuration, revision or runtime. */
export function agentSetupAuthoringToolsService(db: Db) {
  return {
    catalog: async (context: { companyId: string; agentId: string; runId: string }, raw: unknown) => {
      const input = agentSetupCatalogInputSchema.parse(raw);
      const current = await assertConversationRoutineAuthoring(db, context, "agents:create");
      const available = await agentAuthoringService(db).hireCatalog({ type: "board", source: "session", userId: current.responsibleUserId,
        ignoreInstanceAdmin: true, isInstanceAdmin: false }, context.companyId);
      await assertConversationRoutineAuthoring(db, context, "agents:create");
      const query = input.query.toLocaleLowerCase();
      return agentSetupCatalogViewSchema.parse({ coverage: "bounded", modelCalled: false,
        capabilities: available.filter(capability => !query || `${capability.key} ${capability.name} ${capability.outcome}`.toLocaleLowerCase().includes(query)) });
    },
    create: async (context: { companyId: string; agentId: string; runId: string }, raw: unknown) => {
      const input = agentSetupAuthoringInputSchema.parse(raw);
      const current = await assertConversationRoutineAuthoring(db, context, "agents:create");
      const hex = nativeSha256(["aw-conversation-agent-setup-v1", context.companyId, context.agentId,
        current.conversation.id, current.conversation.conversationSessionGeneration, input.idempotencyKey]).slice(0, 32);
      const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
      const draft = await agentAuthoringService(db).create({ type: "board", source: "session", userId: current.responsibleUserId,
        ignoreInstanceAdmin: true, isInstanceAdmin: false }, context.companyId,
      { requestId, ...(input.packageVersionId ? { packageVersionId: input.packageVersionId } : {}) }, context);
      await assertConversationRoutineAuthoring(db, context, "agents:create");
      // Do not return current Human-edited content to the proposing Agent.
      return agentSetupAuthoringReceiptSchema.parse({ draftId: draft.id, requestId, kind: draft.kind,
        currentVersion: draft.version, currentStatus: draft.status, packageVersionId: draft.package?.versionId ?? null,
        href: draft.kind === "hire" ? `/agents/hire/drafts/${draft.id}` : `/agents/custom/${draft.id}`,
        creationCreatedAgent: false, creationInstalledPackage: false, creationGrantedAuthority: false,
        creationStartedExecution: false, requiresHumanReview: true });
    },
  };
}
