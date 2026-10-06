import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, instanceSettings } from "@paperclipai/db";
import { assertV7FeatureDependencies, V7FeatureDependencyError } from "@paperclipai/shared";
import { HttpError } from "../errors.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("V7 admission against migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v7-flags-");
    db = createDb(database.connectionString);
  });
  afterAll(async () => {
    await database?.cleanup();
  });
  beforeEach(async () => {
    await db.delete(instanceSettings).where(eq(instanceSettings.singletonKey, "default"));
  });
  const service = () => instanceSettingsService(db, { runtimeEnv: {} });

  it("rejects invalid admission before persistence and accepts a dependency-complete patch", async () => {
    const svc = service();
    await expect(svc.updateExperimental({ hindsight_provider_v7: true }))
      .rejects.toMatchObject({ status: 400, details: { code: "V7_FEATURE_DEPENDENCY_INVALID" } });
    expect((await svc.getExperimental()).hindsight_provider_v7).toBe(false);
    await svc.updateExperimental({ enableCollectiveMemoryV1: true, enableContextEngineV1: true, cognitive_memory_v7: true, hindsight_provider_v7: true });
    expect(await service().getExperimental()).toMatchObject({ cognitive_memory_v7: true, hindsight_provider_v7: true });
    await expect(svc.updateExperimental({ enableCollectiveMemoryV1: false })).rejects.toBeInstanceOf(HttpError);
    expect((await svc.getExperimental()).enableCollectiveMemoryV1).toBe(true);
    await svc.updateExperimental({ cognitive_memory_v7: false, hindsight_provider_v7: false, enableCollectiveMemoryV1: false });
    expect((await svc.getExperimental()).enableCollectiveMemoryV1).toBe(false);
  });

  it("fails startup-style reads on invalid persisted or effective managed settings", async () => {
    await service().getExperimental();
    await db.update(instanceSettings).set({ experimental: { hindsight_provider_v7: true } })
      .where(eq(instanceSettings.singletonKey, "default"));
    await expect(service().getExperimental()).rejects.toBeInstanceOf(V7FeatureDependencyError);
    // A repairing patch can disable the invalid feature without reading an admitted view first.
    await service().updateExperimental({ hindsight_provider_v7: false });
    const managed = instanceSettingsService(db, { runtimeEnv: { PAPERCLIP_MANAGED_CONFIG: JSON.stringify({
      v: 1, mode: "cloud", catalogVersion: "v7-test", features: { openshell_v7: true }, plugins: { autoInstall: [] },
    }) } });
    await expect(managed.getExperimental()).rejects.toBeInstanceOf(V7FeatureDependencyError);
    await expect(managed.updateExperimental({ enableCases: true })).rejects.toMatchObject({ status: 400 });
    expect((await service().getExperimental()).enableCases).toBe(false);
  });

  it("serializes a concurrent dependent enable and prerequisite disable", async () => {
    await service().updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true, readiness_engine_v7: true });
    const outcomes = await Promise.allSettled([
      service().updateExperimental({ foundation_bootstrap_v7: true }),
      service().updateExperimental({ readiness_engine_v7: false }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const persisted = await service().getExperimental();
    expect(() => assertV7FeatureDependencies(persisted)).not.toThrow();
  });

  it("rolls back a caller-owned transaction when a sibling audit write fails", async () => {
    await service().getExperimental();
    await expect(db.transaction(async (tx) => {
      await service().updateExperimental({ ai_use_cases_v7: true }, { db: tx });
      throw new Error("audit unavailable");
    })).rejects.toThrow("audit unavailable");
    expect((await service().getExperimental()).ai_use_cases_v7).toBe(false);
  });

  it("retains independent concurrent patches across the locked singleton", async () => {
    await service().getExperimental();
    await Promise.all([
      service().updateExperimental({ ai_use_cases_v7: true }),
      service().updateExperimental({ sandbox_abstraction_v7: true }),
    ]);
    expect(await service().getExperimental()).toMatchObject({ ai_use_cases_v7: true, sandbox_abstraction_v7: true });
  });
});
