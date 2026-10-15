import { and, eq, sql } from "drizzle-orm";
import { agentConfigRevisions, heartbeatRuns, type Db } from "@paperclipai/db";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../memory/memory-privacy.js";

/** Deleted Original revisions erase only their actual consuming runs. The
 * generic Source tombstone excludes dispatch immediately; the existing privacy
 * outbox then removes retained payload and native assets without financial loss. */
export async function eraseAuthoredDefinitionRuntimeCopies(db: Db, companyId: string, runId: string, revisionId: string) {
  if (![companyId, runId, revisionId].every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)))
    throw new Error("Invalid authored definition erasure identity");
  await db.transaction(async raw => {
    const tx = raw as unknown as Db;
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const [revision] = await tx.select({ id: agentConfigRevisions.id }).from(agentConfigRevisions)
      .where(and(eq(agentConfigRevisions.companyId, companyId), eq(agentConfigRevisions.id, revisionId)));
    const [receipt] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from memory_deletion_markers
      where company_id=${companyId}::uuid and kind='source' and key=${`native-runtime-source-version-erasure:v1:${runId}:${revisionId}`}) as present`);
    if (revision || !receipt?.present) throw new Error("The exact Original definition has no Source erasure receipt");
    const [run] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
    if (!run) return;
    await purgeDerivedWorkflowMemory(tx, companyId, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
  });
}
