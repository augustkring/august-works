import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { companies, companySkillVersions, createDb, memoryJobs } from "@paperclipai/db";
import { createGovernedSkillSchema } from "@paperclipai/shared";
import { companySkillService } from "../services/company-skills.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Native Skill version filesystem deletion owners", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-skill-file-owners-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: true });
  });
  afterAll(async () => { await database?.cleanup(); });
  it.each(["skill_delete", "company_purge"] as const)("keeps scoped outbox cleanup after %s and preserves another tenant", async operation => {
    const previousHome = process.env.PAPERCLIP_HOME, previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aw-skill-file-owner-"));
    process.env.PAPERCLIP_HOME = home; process.env.PAPERCLIP_INSTANCE_ID = "skill-files";
    try {
      const create = async () => {
        const companyId = randomUUID();
        await db.insert(companies).values({ id: companyId, name: "Skill file owner", issuePrefix: randomUUID() });
        const created = await skillLifecycleService(db).createDraft({ type: "board", source: "local_implicit" }, companyId,
          createGovernedSkillSchema.parse({ slug: "native-procedure", name: "Native procedure", markdown: "Independent original procedure", sharing: "company_proposed" }));
        const service = companySkillService(db), skill = (await service.getById(companyId, created.skillId))!;
        const [entry] = await service.listRuntimeSkillEntries(companyId, { selectedSkillKeys: new Set([skill.key]),
          versionSelections: new Map([[skill.key, created.candidate.id]]), allowCandidateVersionsForTest: true });
        expect(entry).toMatchObject({ sourceStatus: "available" });
        return { companyId, skill, versionId: created.candidate.id, entry: entry! };
      };
      const erased = await create(), retained = await create();
      if (operation === "skill_delete") await companySkillService(db).deleteSkill(erased.companyId, erased.skill.id);
      else {
        await db.update(companies).set({ status: "paused" }).where(eq(companies.id, erased.companyId));
        await instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: false });
        await purgeCompanyContent(db, erased.companyId);
      }
      expect(await fs.readFile(path.join(erased.entry.source, "SKILL.md"), "utf8")).toContain("Independent");
      const [job] = await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey, `skill-version-file-erasure:v1:${erased.versionId}`));
      expect(job).toMatchObject({ status: "queued", sourceRefJson: { kind: "skill_version_file_erasure", skillId: erased.skill.id, versionId: erased.versionId } });
      expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, erased.versionId))).toHaveLength(0);
      await memoryJobService(db).tick({ limit: 100 });
      expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job!.id)))[0]!.status).toBe("succeeded");
      await expect(fs.stat(erased.entry.source)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(retained.entry.source, "SKILL.md"), "utf8")).toContain("Independent");
      await instanceSettingsService(db).updateExperimental({ skill_lifecycle_v5: true });
    } finally {
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = previousHome;
      if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID; else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
