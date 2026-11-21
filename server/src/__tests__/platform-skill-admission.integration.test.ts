import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, companyMemberships, companySkills, companySkillVersions, heartbeatRuns, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
import { companySkillService } from "../services/company-skills.js";
import { blenteraPlatformContractHashes } from "../services/tool-gateway.js";
import { preparePlatformSkillAdmission, assertPlatformSkillAdmission } from "../services/platform-skill-admission.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("required platform procedure admission", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("platform-procedure-"); db = createDb(database.connectionString); });
  afterAll(async () => { await database?.cleanup(); });
  async function fixture() {
    const companyId = randomUUID(), agentId = randomUUID(), responsibleUserId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Procedure admission", issuePrefix: `P${companyId.slice(0, 6)}` });
    await seedCurrentHumanSourceActor(db, [companyId], responsibleUserId);
    await db.insert(agents).values({ id: agentId, companyId, name: "Procedure worker", role: "engineer", adapterType: "codex_local", adapterConfig: {} });
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, responsibleUserId, status: "running", runtimeMode: "native" }).returning();
    const input = { companyId, agentId, runId: run!.id, responsibleUserId, requireExisting: false };
    const actor = { type: "agent" as const, source: "none" as const, companyId, agentId, runId: run!.id, onBehalfOfUserId: responsibleUserId };
    return { input, actor, contracts: blenteraPlatformContractHashes() };
  }
  it("pins the real immutable package without Fabric, reads its root and a focused reference, and validates material admission", async () => {
    const f = await fixture();
    const platform = await preparePlatformSkillAdmission(db, f.input, f.contracts);
    expect(platform.pin).toMatchObject({ key: "blentera-platform", selection: "required", loadPoint: "task_relevant" });
    const entries = await companySkillService(db).listRuntimeSkillEntries(f.input.companyId, {
      actor: f.actor, readScope: "task", selectedSkillKeys: new Set([platform.pin.key]),
      versionSelections: new Map([[platform.pin.key, platform.pin.versionId]]),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.missingDetail).toBeNull();
    expect(entries[0]).toMatchObject({ key: "blentera-platform", versionId: platform.pin.versionId, sourceStatus: "available" });
    expect(await fs.readFile(path.join(entries[0]!.source, "SKILL.md"), "utf8")).toContain("# Blentera Platform");
    expect(await fs.readFile(path.join(entries[0]!.source, "references/work.md"), "utf8")).toContain("Task");
    await expect(db.transaction(tx => assertPlatformSkillAdmission(tx as unknown as typeof db, f.actor, f.contracts))).resolves.toBeUndefined();
  });
  it("refuses missing legacy pins and changed contracts instead of silently readmitting a material effect", async () => {
    const f = await fixture();
    await preparePlatformSkillAdmission(db, f.input, f.contracts);
    await expect(assertPlatformSkillAdmission(db, f.actor, { ...f.contracts, toolCatalogContractHash: "a".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await db.update(heartbeatRuns).set({ runnerProfileJson: sql`${heartbeatRuns.runnerProfileJson} - 'platformSkillAdmission'` }).where(eq(heartbeatRuns.id, f.input.runId));
    await expect(assertPlatformSkillAdmission(db, f.actor, f.contracts)).rejects.toMatchObject({ status: 409, details: { code: "platform_skill_readmission_required" } });
    await expect(preparePlatformSkillAdmission(db, { ...f.input, requireExisting: true }, f.contracts)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps lifecycle revalidation and revoked Human membership authoritative", async () => {
    const f = await fixture();
    const platform = await preparePlatformSkillAdmission(db, f.input, f.contracts);
    await db.update(companySkills).set({ lifecycleState: "needs_revalidation" }).where(eq(companySkills.id, platform.pin.skillId));
    await companySkillService(db).listFull(f.input.companyId);
    await expect(assertPlatformSkillAdmission(db, f.actor, f.contracts)).rejects.toMatchObject({ status: 409 });
    const current = await db.select().from(companySkills).where(eq(companySkills.id, platform.pin.skillId));
    expect(current[0]?.lifecycleState).toBe("needs_revalidation");
    const other = await fixture();
    await preparePlatformSkillAdmission(db, other.input, other.contracts);
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, other.input.companyId), eq(companyMemberships.principalId, other.input.responsibleUserId)));
    await expect(assertPlatformSkillAdmission(db, other.actor, other.contracts)).rejects.toMatchObject({ status: 403 });
  });

  it("refreshes identical procedure bytes only for a fresh admission and never repins the old Run", async () => {
    const f = await fixture();
    const service = companySkillService(db);
    const skill = (await service.listFull(f.input.companyId)).find(row => row.key === "blentera-platform")!;
    const registry = JSON.parse(readFileSync(new URL("../../../skills-releases/blentera-platform/releases.json", import.meta.url), "utf8"));
    const prior = registry[0], latest = registry.at(-1);
    expect(latest.id).not.toBe(prior.id);
    const oldAdmission = { schemaVersion: 1, platformSkill: { key: "blentera-platform", version: prior.id,
      digest: prior.contentDigest, sourceSha: prior.sourceSha }, operationManifestHash: prior.operationManifestHash,
      toolCatalogContractHash: prior.toolCatalogContractHash, runtimeAdapter: "codex_local" };
    await db.update(heartbeatRuns).set({ runnerProfileJson: { platformSkillAdmission: oldAdmission } }).where(eq(heartbeatRuns.id, f.input.runId));
    const [fresh] = await db.insert(heartbeatRuns).values({ companyId: f.input.companyId, agentId: f.input.agentId,
      responsibleUserId: f.input.responsibleUserId, status: "running", runtimeMode: "native" }).returning();
    await preparePlatformSkillAdmission(db, { ...f.input, runId: fresh!.id }, f.contracts);
    const [current] = await db.select().from(companySkills).where(eq(companySkills.id, skill.id));
    const versions = await db.select().from(companySkillVersions).where(eq(companySkillVersions.companySkillId, skill.id));
    expect(versions.find(version => version.id === current!.activeVersionId)).toMatchObject({ releaseId: latest.id, state: "active" });
    expect(versions.find(version => version.releaseId === prior.id)).toMatchObject({ state: "superseded" });
    const [oldRun] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.input.runId));
    expect(oldRun!.runnerProfileJson).toEqual({ platformSkillAdmission: oldAdmission });
    await expect(preparePlatformSkillAdmission(db, { ...f.input, requireExisting: true }, f.contracts)).rejects.toMatchObject({ status: 409 });
    await expect(assertPlatformSkillAdmission(db, f.actor, f.contracts)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps two company admissions isolated while delivering the same immutable release", async () => {
    const first = await fixture(), second = await fixture();
    const [firstPlatform, secondPlatform] = await Promise.all([
      preparePlatformSkillAdmission(db, first.input, first.contracts),
      preparePlatformSkillAdmission(db, second.input, second.contracts),
    ]);
    const runtimeEntries = async (f: Awaited<ReturnType<typeof fixture>>, platform: Awaited<ReturnType<typeof preparePlatformSkillAdmission>>) =>
      companySkillService(db).listRuntimeSkillEntries(f.input.companyId, {
        actor: f.actor,
        readScope: "task",
        selectedSkillKeys: new Set([platform.pin.key]),
        versionSelections: new Map([[platform.pin.key, platform.pin.versionId]]),
      });
    const [firstEntries, secondEntries] = await Promise.all([
      runtimeEntries(first, firstPlatform), runtimeEntries(second, secondPlatform),
    ]);
    expect(firstPlatform.identity).toEqual(secondPlatform.identity);
    expect(firstPlatform.pin.skillId).not.toBe(secondPlatform.pin.skillId);
    expect(firstPlatform.pin.versionId).not.toBe(secondPlatform.pin.versionId);
    expect(firstEntries).toHaveLength(1);
    expect(secondEntries).toHaveLength(1);
    expect(firstEntries[0]).toMatchObject({ key: "blentera-platform", versionId: firstPlatform.pin.versionId, sourceStatus: "available" });
    expect(secondEntries[0]).toMatchObject({ key: "blentera-platform", versionId: secondPlatform.pin.versionId, sourceStatus: "available" });
    expect(path.resolve(firstEntries[0]!.source)).not.toBe(path.resolve(secondEntries[0]!.source));
    await expect(assertPlatformSkillAdmission(db, first.actor, first.contracts)).resolves.toBeUndefined();
    await expect(assertPlatformSkillAdmission(db, second.actor, second.contracts)).resolves.toBeUndefined();
  });
});
