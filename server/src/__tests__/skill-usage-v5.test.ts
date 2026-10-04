import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companySkills, companySkillVersions, companySkillUsageEvents, heartbeatRuns, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { recordSkillExecutionCompletion } from "../services/skill-usage.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 terminal Skill usage", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-usage-"); db = createDb(database.connectionString); await enableV5ForTest(db); });
  afterAll(async () => { await database?.cleanup(); });

  it.each(["succeeded", "interrupted", "failed", "cancelled", "timed_out"])("retains unknown outcomes once for a %s execution and only for its local presence", async (status) => {
    const f = await seedV5Presences(db), skillId = randomUUID(), versionId = randomUUID();
    await db.insert(companySkills).values({ id: skillId, companyId: f.home, key: `company/${f.home}/${skillId}`, slug: skillId, name: "Loaded procedure", markdown: "Reviewed procedure", sourceType: "url" });
    await db.insert(companySkillVersions).values({ id: versionId, companyId: f.home, companySkillId: skillId, revisionNumber: 1, state: "active", fileInventory: [] });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, status: "running" }).returning();
    await db.insert(companySkillUsageEvents).values(["loaded", "used"].map((stage) => ({ companyId: f.home, agentId: f.presence.id, runId: run!.id, skillId, skillVersionId: versionId, selectionReason: "task trigger", stage })));
    const complete = () => recordSkillExecutionCompletion(db, f.home, run!.id, f.presence.id);
    await complete();
    const observations = () => db.select().from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.runId, run!.id), eq(companySkillUsageEvents.stage, "completed")));
    expect(await observations()).toEqual([]);
    await db.update(heartbeatRuns).set({ status, finishedAt: new Date() }).where(eq(heartbeatRuns.id, run!.id));
    await recordSkillExecutionCompletion(db, f.guest, run!.id, f.presence.id);
    await recordSkillExecutionCompletion(db, f.home, run!.id, f.guestPresence.id);
    expect(await observations()).toEqual([]);
    await Promise.all([complete(), complete()]);
    expect(await observations()).toMatchObject([{ companyId: f.home, agentId: f.presence.id, skillId, skillVersionId: versionId, stage: "completed", outcome: "unknown", selectionReason: "task trigger" }]);
    expect(await observations()).toHaveLength(1);
  });
});
