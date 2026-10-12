import { and, eq } from "drizzle-orm";
import { foundationDocuments, type Db } from "@paperclipai/db";
import type { AgentAuthoringContent } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { approvedFoundationView, foundationService } from "../foundation/foundation-service.js";
import { learningAssetRoots } from "../learning/learning-assets.js";
import { assertLearnedAssetAnalyticalSources } from "../learning/learning-analytical-sources.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict } from "../../errors.js";

/** Selected evidence uses the Original approved revision owner. A saved
 * selection supplies neither permission nor executable instructions. */
export async function resolveAuthoringKnowledge(db: Db, input: {
  companyId: string; agentId: string; responsibleUserId: string;
  content: AgentAuthoringContent; now?: Date;
}) {
  const ids = input.content.knowledgeDocumentIds;
  if (new Set(ids).size !== ids.length || ids.length > 30) throw conflict("Choose each knowledge source once within the saved scope");
  if (ids.length && !input.content.capabilities.some(item => item.operation === "read_approved_knowledge" && item.autonomy === "automatic"))
    throw conflict("Selected knowledge requires the reviewed read-only capability");
  const actor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId: input.companyId,
    agentId: input.agentId, onBehalfOfUserId: input.responsibleUserId, ignoreInstanceAdmin: true };
  if (ids.length) await assertV5Authorization(db, actor, input.companyId, "foundation:read", { type: "company", companyId: input.companyId });
  const knowledge: Array<{ foundationDocumentId: string; documentId: string; revisionId: string; revisionNumber: number; title: string;
    bodyHash: string; body: string; sensitivity: "public" | "internal"; validFrom: string | null; validUntil: string | null }> = [];
  const now = (input.now ?? new Date()).getTime(); let bytes = 0;
  for (const id of [...ids].sort()) {
    // Callers own the enclosing admission and company privacy transaction.
    const [source] = await db.select({ id: foundationDocuments.id }).from(foundationDocuments)
      .where(and(eq(foundationDocuments.companyId, input.companyId), eq(foundationDocuments.id, id))).for("share");
    const original = source ? await foundationService(db).get(input.companyId, id, actor) : null;
    const approved = original && !["archived", "superseded"].includes(original.status) ? approvedFoundationView(original) : null;
    if (!approved?.approvedRevisionId || !approved.body.trim() ||
      approved.validFrom && approved.validFrom.getTime() > now || approved.validUntil && approved.validUntil.getTime() <= now)
      throw conflict("Selected approved knowledge is unavailable or outside its validity period");
    if (approved.sensitivity !== "public" && approved.sensitivity !== "internal")
      throw conflict("This text-only evidence boundary supports public and internal approved knowledge");
    const analytical = await assertLearnedAssetAnalyticalSources(db, input.companyId, "document_revision", approved.approvedRevisionId, actor);
    const roots = await learningAssetRoots(db, input.companyId, "document_revision", approved.approvedRevisionId, undefined, actor);
    if (analytical.cycles.length || roots.length) throw conflict("Learned knowledge requires its complete retained Source mapping");
    const size = Buffer.byteLength(approved.body, "utf8"); bytes += size;
    if (size > 32000 || bytes > 128000) throw conflict("Selected knowledge exceeds the bounded text-only evidence envelope");
    knowledge.push({ foundationDocumentId: id, documentId: approved.documentId, revisionId: approved.approvedRevisionId,
      revisionNumber: approved.latestRevisionNumber!, title: approved.title ?? approved.foundationKey, bodyHash: nativeSha256(approved.body), body: approved.body,
      sensitivity: approved.sensitivity, validFrom: approved.validFrom?.toISOString() ?? null, validUntil: approved.validUntil?.toISOString() ?? null });
  }
  const pins = knowledge.map(({ body, ...pin }) => pin);
  return { knowledge, pins, hash: nativeSha256(pins) };
}
