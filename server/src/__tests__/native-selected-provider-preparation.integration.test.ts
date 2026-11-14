import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { claimManagedNativeFixtureRun } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { prepareNativeHeartbeatRun } from "../services/native-runtime/prepare-native-run.js";
import { QUALIFIED_OPENCODE_RUNNER_VERSION } from "../services/native-runtime/provider-profile.js";

describe("Native launch preparation selected provider owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-provider-prep-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60_000);
  afterAll(async () => { await db?.$client.end({ timeout: 0 }); await database?.cleanup(); });
  async function fixture() {
    const f = await seedV5Presences(db);
    await db.update(agents).set({ adapterType: "paperclip_runner" }).where(eq(agents.id, f.presence.id));
    const [issue] = await db.insert(issues).values({ companyId: f.home, title: "Prepare the actual selected Native provider",
      assigneeAgentId: f.presence.id, responsibleUserId: f.userId }).returning();
    const run = await claimManagedNativeFixtureRun(db, { companyId: f.home, agentId: f.presence.id,
      issueId: issue!.id, responsibleUserId: f.userId, startedAt: new Date(), conversationSessionGeneration: null });
    return { db, run, issue: issue!, environmentLeaseId: randomUUID() };
  }
  const openCode = { provider: "opencode" as const, model: "anthropic/fixture-managed-opencode-v1" };
  async function current(id: string) { return (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)))[0]!; }
  it("keeps the default Codex representation for existing callers", async () => {
    const f = await fixture(); await prepareNativeHeartbeatRun(f);
    expect(await current(f.run.id)).toMatchObject({ driverKind: "codex", driverVersion: "codex-app-server-v1",
      runnerProfileJson: { provider: "codex" } });
  });
  it("persists OpenCode through the preparation owner before the remote locator predicate", async () => {
    const f = await fixture(); const prepared = await prepareNativeHeartbeatRun({ ...f, ...openCode });
    const [eligible] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, f.run.id),
      eq(heartbeatRuns.companyId, f.run.companyId), eq(heartbeatRuns.status, "running"),
      eq(heartbeatRuns.runtimeMode, "native"), eq(heartbeatRuns.driverKind, "opencode_server")));
    expect(eligible).toMatchObject({ driverKind: "opencode_server", driverVersion: QUALIFIED_OPENCODE_RUNNER_VERSION,
      nativeSessionId: prepared.normalizedSessionId, runnerInstanceId: prepared.runnerInstanceId,
      runnerProfileJson: { provider: "opencode", environmentLeaseId: f.environmentLeaseId } });
  });
  it("preserves compatible retained OpenCode identity and latest private profile fields", async () => {
    const f = await fixture(); await prepareNativeHeartbeatRun({ ...f, ...openCode });
    const retained = await current(f.run.id);
    await db.update(heartbeatRuns).set({ runnerProfileJson: { ...retained.runnerProfileJson,
      preparationOwnerSentinel: "latest-owned-field" } }).where(eq(heartbeatRuns.id, f.run.id));
    const before = await current(f.run.id);
    await prepareNativeHeartbeatRun({ ...f, run: retained, ...openCode });
    const after = await current(f.run.id);
    expect(after.runnerInstanceId).toBe(before.runnerInstanceId); expect(after.nativeSessionId).toBe(before.nativeSessionId);
    expect(after.driverKind).toBe(before.driverKind); expect(after.driverVersion).toBe(before.driverVersion);
    expect(after.runnerProfileJson).toEqual(before.runnerProfileJson);
  });
  for (const first of ["codex", "opencode"] as const) {
    it(`rejects changing retained ${first} provider before overwriting its binding`, async () => {
      const f = await fixture(); await prepareNativeHeartbeatRun({ ...f, ...(first === "opencode" ? openCode : {}) });
      const before = await current(f.run.id);
      await expect(prepareNativeHeartbeatRun({ ...f, run: before,
        ...(first === "codex" ? openCode : { provider: "codex" as const }) })).rejects.toThrow("native_runtime_provider_binding_conflict");
      expect(await current(f.run.id)).toEqual(before);
    });
  }
  it("rejects a retained OpenCode row with a conflicting driver", async () => {
    const f = await fixture(); await prepareNativeHeartbeatRun({ ...f, ...openCode });
    await db.update(heartbeatRuns).set({ driverKind: "codex" }).where(eq(heartbeatRuns.id, f.run.id));
    const before = await current(f.run.id);
    await expect(prepareNativeHeartbeatRun({ ...f, run: before, ...openCode })).rejects.toThrow("native_runtime_provider_binding_conflict");
    expect(await current(f.run.id)).toEqual(before);
  });
  it("rejects a retained OpenCode row with a conflicting driver version", async () => {
    const f = await fixture(); await prepareNativeHeartbeatRun({ ...f, ...openCode });
    await db.update(heartbeatRuns).set({ driverVersion: "codex-app-server-v1" }).where(eq(heartbeatRuns.id, f.run.id));
    const before = await current(f.run.id);
    await expect(prepareNativeHeartbeatRun({ ...f, run: before, ...openCode })).rejects.toThrow("native_runtime_provider_binding_conflict");
    expect(await current(f.run.id)).toEqual(before);
  });
  it("preserves the canonical Codex backend alias already owned by a retained run", async () => {
    const f = await fixture(); await prepareNativeHeartbeatRun(f);
    await db.update(heartbeatRuns).set({ driverKind: "codex_app_server", driverVersion: "phase6-v1" }).where(eq(heartbeatRuns.id, f.run.id));
    const before = await current(f.run.id); await prepareNativeHeartbeatRun({ ...f, run: before });
    const after = await current(f.run.id); expect(after.driverKind).toBe("codex_app_server"); expect(after.driverVersion).toBe("phase6-v1");
  });
});
