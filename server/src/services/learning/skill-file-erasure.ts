import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { companySkillVersions, heartbeatRuns, memoryJobs, type Db } from "@paperclipai/db";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { removeRuntimeSkillVersionDirectory } from "../runtime-skill-cache.js";

/** Native version rows own generated snapshots; arbitrary imported paths are never accepted. */
export async function enqueueSkillVersionFileErasure(tx: Db, companyId: string, versionIds?: string[]) {
  if (versionIds && !versionIds.length) return;
  const versions = await tx.select({ id: companySkillVersions.id, skillId: companySkillVersions.companySkillId })
    .from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId),
      versionIds ? inArray(companySkillVersions.id, versionIds) : undefined));
  for (const version of versions) {
    const jobKey = `skill-version-file-erasure:v1:${version.id}`;
    await tx.insert(memoryJobs).values({ companyId, operationType: "retention", jobKey,
      sourceRefJson: { kind: "skill_version_file_erasure", skillId: version.skillId, versionId: version.id } }).onConflictDoNothing();
    await tx.update(memoryJobs).set({ status: "queued", finishedAt: null, resultJson: null, resultSummary: null,
      error: null, errorCode: null, updatedAt: new Date() })
      .where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, jobKey), eq(memoryJobs.attemptNumber, 1),
        inArray(memoryJobs.status, ["succeeded", "failed", "cancelled"])));
  }
}

export async function eraseSkillVersionFiles(db: Db, companyId: string, skillId: string, versionId: string) {
  if (![companyId, skillId, versionId].every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) {
    throw new Error("Invalid native Skill version erasure identity");
  }
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId);
    await lockMemoryPrivacy(tx, companyId);
    const [version] = await tx.select().from(companySkillVersions).where(and(
      eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, skillId), eq(companySkillVersions.id, versionId)));
    if (version) {
      const [source] = await tx.execute<{ erased: boolean }>(sql`select aw_skill_version_source_erased(${companyId}::uuid,${versionId}::uuid) as erased`);
      if (!source?.erased) throw new Error("Native Skill version has no erasure receipt");
    }
    await removeRuntimeSkillVersionDirectory(path.resolve(resolvePaperclipInstanceRoot(), "skills", companyId), skillId, versionId);
  });
}

/** Version deletion retires only actual consuming runtime copies, never independent verified Learning outcomes. */
export async function eraseSkillRuntimeCopies(db: Db, companyId: string, runId: string, versionId: string) {
  if (![companyId, runId, versionId].every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) throw new Error("Invalid native Skill runtime erasure identity");
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)));
    if (!run) return; // Native company/run deletion already removed the database copies.
    const [receipt] = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from memory_deletion_markers
      where company_id=${companyId}::uuid and kind='source' and key=${`native-runtime-source-version-erasure:v1:${runId}:${versionId}`}) as present`);
    if (!receipt?.present) throw new Error("Native Skill runtime has no Source erasure receipt");
    const roots = await tx.execute<{ id: string }>(sql`select distinct r.id from memory_records r
      join analytical_context_roots a on a.company_id=r.company_id and a.memory_record_id=r.id
      join context_manifest_memory_roots edge on edge.company_id=r.company_id and edge.memory_record_id=r.id
      join context_manifests context on context.company_id=edge.company_id and context.id=edge.manifest_id
      where r.company_id=${companyId}::uuid and r.scope_type='agent' and r.owner_agent_id=${run.agentId}::uuid
        and r.review_state='rejected' and r.verification_state='unverified' and (context.run_id=${runId}::uuid or exists(
          select 1 from agent_execution_manifests e where e.company_id=context.company_id and e.run_id=${runId}::uuid and e.context_manifest_id=context.id))`);
    const { purgeMemoryRecords, purgeDerivedWorkflowMemory } = await import("../memory/memory-privacy.js");
    if (roots.length) await purgeMemoryRecords(tx, companyId, roots.map(root => root.id));
    await purgeDerivedWorkflowMemory(tx, companyId, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId] });
  });
}
