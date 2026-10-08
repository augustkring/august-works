import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { companySkillVersions, memoryJobs, type Db } from "@paperclipai/db";
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
