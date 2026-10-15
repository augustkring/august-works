import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { routineRevisions, routines, type Db } from "@paperclipai/db";
import { createRoutineSchema, routineAuthoringCreateInputSchema } from "@paperclipai/shared";
import { assertConversationRoutineAuthoring } from "./routine-authoring-authority.js";
import { assertRoutineSourceAccess } from "./routine-source-authority.js";
import { routineService } from "./routines.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { withV7ActivityTransaction, logActivity } from "./v7-mutations.js";
import { conflict } from "../errors.js";

/** Only saved, unconfigured Native drafts. No target, trigger, credentials,
 * publication, execution, model call or broader authority is created. */
export function routineAuthoringToolsService(db: Db) {
  return {
    create: async (context: { companyId: string; agentId: string; runId: string }, raw: unknown) => {
      const input = routineAuthoringCreateInputSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, context.companyId); await lockMemoryPrivacy(tx, context.companyId);
        const current = await assertConversationRoutineAuthoring(tx, context);
        const hex = createHash("sha256").update(JSON.stringify(["aw-conversation-routine-v1", context.companyId, context.agentId,
          current.conversation.id, current.conversation.conversationSessionGeneration, input.idempotencyKey])).digest("hex").slice(0, 32);
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
        const [existing] = await tx.select().from(routines).where(and(eq(routines.companyId, context.companyId), eq(routines.id, id))).for("share");
        let saved: { id: string; latestRevisionId: string | null; latestRevisionNumber: number; status: string; executionTargetRef?: string | null };
        const replayed = !!existing;
        if (existing) {
          saved = existing;
          await assertRoutineSourceAccess(tx, existing, { type: "board", source: "session", userId: current.responsibleUserId, ignoreInstanceAdmin: true });
          const [original] = await tx.select().from(routineRevisions).where(and(eq(routineRevisions.companyId, context.companyId),
            eq(routineRevisions.routineId, id), eq(routineRevisions.revisionNumber, 1)));
          if (!original || existing.originKind !== "conversation_draft" || existing.createdByAgentId !== context.agentId ||
            existing.responsibleUserId !== current.responsibleUserId || original.title !== input.title ||
            original.description !== input.description || original.snapshot.routine.priority !== input.priority || !original.createdByRunId)
            throw conflict("The routine draft request changed; use a new request identity");
          await assertAnalyticalContextPayloadAccess(tx, context.companyId, { type: "board", source: "session",
            userId: current.responsibleUserId, ignoreInstanceAdmin: true }, { runId: original.createdByRunId });
        } else {
          saved = await routineService(tx).create(context.companyId, createRoutineSchema.parse({ title: input.title,
            description: input.description, priority: input.priority, status: "paused", executionTarget: null,
            parentIssueId: current.conversation.id }), { agentId: context.agentId, runId: context.runId },
            { idOverride: id, conversationDraftRunId: context.runId });
          await logActivity(tx, { companyId: context.companyId, actorType: "agent", actorId: context.agentId,
            agentId: context.agentId, runId: context.runId, action: "routine.conversation_draft_created", entityType: "routine", entityId: id,
            details: { revisionId: saved.latestRevisionId, revisionNumber: saved.latestRevisionNumber, executionConfigured: false, enabled: false } }, publications);
        }
        await assertConversationRoutineAuthoring(tx, context);
        return { status: replayed ? "replayed" as const : "created" as const, routineId: saved.id,
          currentRevisionId: saved.latestRevisionId, currentRevisionNumber: saved.latestRevisionNumber,
          enabled: saved.status === "active", executionConfigured: !!saved.executionTargetRef,
          href: `/routines/${saved.id}`, requiresHumanReview: true as const };
      });
    },
  };
}
