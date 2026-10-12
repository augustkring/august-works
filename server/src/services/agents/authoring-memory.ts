import { and, eq } from "drizzle-orm";
import { companyMemberships, memoryRecords, memoryBindings, principalPermissionGrants, type Db } from "@paperclipai/db";
import type { AgentAuthoringContent } from "@paperclipai/shared";
import { instanceSettingsService } from "../instance-settings.js";
import { assertV5Authorization } from "../v5-authorization.js";
import { memoryService } from "../memory/memory-service.js";
import { memoryPayloadVisible } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict, forbidden } from "../../errors.js";

/** Human-approved organizational preferences remain Original Memory records.
 * A saved selection grants no Memory writes, private scope, or model learning. */
export async function resolveAuthoringMemory(db: Db, input: {
  companyId: string; agentId: string; responsibleUserId: string;
  content: AgentAuthoringContent; now?: Date;
}) {
  const ids = input.content.memoryRecordIds ?? [];
  if (input.content.memory !== "approved_work_preferences" && ids.length)
    throw conflict("Selected preferences require their reviewed Memory policy");
  if (input.content.memory === "approved_work_preferences" && !ids.length)
    throw conflict("Select the exact approved work preferences before testing");
  if (input.content.memory === "approved_company_knowledge" && !input.content.knowledgeDocumentIds.length)
    throw conflict("Select the exact approved company knowledge before testing");
  if (ids.length && !(await instanceSettingsService(db).getExperimental()).enableCollectiveMemoryV1)
    throw conflict("Approved preference use requires current Memory admission");
  const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: input.companyId,
    agentId: input.agentId, onBehalfOfUserId: input.responsibleUserId, ignoreInstanceAdmin: true };
  if (ids.length) await assertV5Authorization(db, actor, input.companyId, "company_scope:read", { type: "company", companyId: input.companyId });
  if (ids.length) {
    // Home-company read is intrinsic in V5. This reviewed Memory mapping
    // additionally requires an explicit, revocable grant and active membership.
    const [member] = await db.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "agent"),
      eq(companyMemberships.principalId, input.agentId), eq(companyMemberships.status, "active")));
    const [grant] = await db.select().from(principalPermissionGrants).where(and(
      eq(principalPermissionGrants.companyId, input.companyId), eq(principalPermissionGrants.principalType, "agent"),
      eq(principalPermissionGrants.principalId, input.agentId), eq(principalPermissionGrants.permissionKey, "company_scope:read")));
    if (!member || !grant || grant.scope !== null) throw forbidden("Approved preference use requires its explicit current company read grant");
  }
  const now = (input.now ?? new Date()).getTime();
  const memory: Array<{ recordId: string; version: string; title: string; body: string; bodyHash: string;
    sensitivity: "public" | "internal"; expiresAt: string; validFrom: string | null; validUntil: string | null }> = [];
  for (const id of [...ids].sort()) {
    const [retained] = await db.select({ record: memoryRecords, binding: memoryBindings }).from(memoryRecords)
      .innerJoin(memoryBindings, and(eq(memoryBindings.companyId, memoryRecords.companyId), eq(memoryBindings.id, memoryRecords.bindingId)))
      .where(and(eq(memoryRecords.companyId, input.companyId), eq(memoryRecords.id, id), memoryPayloadVisible())).for("share");
    const detail = retained ? await memoryService(db).get(input.companyId, id,
      { principal: { type: "user", userId: input.responsibleUserId } }) : null;
    const row = detail?.record;
    if (!row || !retained?.binding.enabled || row.scopeType !== "company" || row.memoryType !== "preference" ||
      row.reviewState !== "accepted" || row.verificationState !== "human_verified" || row.retentionState !== "active" ||
      row.revokedAt || row.supersededByRecordId || !row.content.trim() || !row.expiresAt || new Date(row.expiresAt).getTime() <= now ||
      row.validFrom && new Date(row.validFrom).getTime() > now || row.validUntil && new Date(row.validUntil).getTime() <= now)
      throw conflict("Selected preferences require current human approval, company scope and a bounded lifetime");
    if (row.sensitivityLabel !== "public" && row.sensitivityLabel !== "internal")
      throw conflict("The reviewed preference boundary supports public and internal company preferences");
    if (Buffer.byteLength(row.content, "utf8") > 16000) throw conflict("A selected preference exceeds the bounded evidence envelope");
    memory.push({ recordId: row.id, version: new Date(row.updatedAt).toISOString(), title: row.title ?? "Approved work preference",
      body: row.content, bodyHash: nativeSha256(row.content), sensitivity: row.sensitivityLabel,
      expiresAt: new Date(row.expiresAt).toISOString(), validFrom: row.validFrom ? new Date(row.validFrom).toISOString() : null,
      validUntil: row.validUntil ? new Date(row.validUntil).toISOString() : null });
  }
  return memory;
}
