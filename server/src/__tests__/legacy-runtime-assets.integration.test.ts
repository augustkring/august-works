import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { materializeAsset } from "../services/native-runtime/runtime-context.js";
import { nativeRuntimeAssetsRoot, reconcileLegacyNativeRuntimeAssets } from "../services/native-runtime/runtime-asset-retention.js";
import { removeRuntimeStorageTree } from "../services/runtime-skill-cache.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("Legacy runtime asset reconciliation on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>, home: string;
  const oldHome = process.env.PAPERCLIP_HOME, oldInstance = process.env.PAPERCLIP_INSTANCE_ID;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v8-legacy-runtime-assets-");
    db = createDb(database.connectionString);
    home = await fs.mkdtemp(path.join(os.tmpdir(), "aw-v8-legacy-runtime-assets-"));
    process.env.PAPERCLIP_HOME = home;
    process.env.PAPERCLIP_INSTANCE_ID = "legacy_asset_fixture";
  });
  afterAll(async () => {
    if (oldHome === undefined) delete process.env.PAPERCLIP_HOME; else process.env.PAPERCLIP_HOME = oldHome;
    if (oldInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID; else process.env.PAPERCLIP_INSTANCE_ID = oldInstance;
    if (home) await removeRuntimeStorageTree(home);
    await database?.cleanup();
  });
  it("waits for active runs, retains another tenant's terminal reference and owned copies, bounds orphan removal and refuses symlinks", async () => {
    const companyId = randomUUID(), otherCompany = randomUUID(), agentId = randomUUID(), runId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Paused software fixture", issuePrefix: randomUUID(), status: "paused" },
      { id: otherCompany, name: "Independent software tenant", issuePrefix: randomUUID() },
    ]);
    await db.insert(agents).values({ id: agentId, companyId: otherCompany, name: "Software agent", role: "engineer" });
    const asset = (text: string, owner?: { companyId: string; runId: string }) => materializeAsset([
      { path: "SKILL.md", content: Buffer.from(text), mode: 0o444 },
    ], owner);
    const retained = await asset("Software private retained legacy bytes");
    const retainedSkill = await asset("Software private retained legacy skill");
    const owned = await asset("Software private owned bytes", { companyId, runId: randomUUID() });
    await db.insert(heartbeatRuns).values({ id: runId, companyId: otherCompany, agentId, status: "running",
      runnerProfileJson: { nativeExecutionInput: { runtimeContext: { instructions: { bundle: retained }, skills: [{ bundle: retainedSkill }] } } } });
    const orphans = [];
    for (let i = 0; i < 17; i++) orphans.push(await asset(`Software orphan ${i}`));
    const root = nativeRuntimeAssetsRoot(), staging = path.join(root, ".staging", randomUUID());
    await fs.mkdir(staging); await fs.writeFile(path.join(staging, "partial"), "Old incomplete software publication");
    const canonical = path.join(home, "canonical-source.txt"); await fs.writeFile(canonical, "Canonical source remains");
    for (const status of ["running", "queued", "scheduled_retry"]) {
      await db.update(heartbeatRuns).set({ status }).where(eq(heartbeatRuns.id, runId));
      expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 0, deferredActiveRuns: true });
      expect(await fs.readFile(path.join(orphans[16]!.rootPath, "SKILL.md"), "utf8")).toBe("Software orphan 16");
    }
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('native-runtime-asset-reconciliation',0))`);
      expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 0, deferredConcurrentSweep: true });
    });
    // A historical manifest-only copy must also be reclaimed without reading its body.
    await removeRuntimeStorageTree(orphans[16]!.rootPath);
    // The inverse partial publication has a bundle but no manifest.
    await fs.unlink(path.join(root, "manifests", `${orphans[15]!.digest}.json`));
    expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 16, deferredActiveRuns: false });
    expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 2 });
    expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 0 });
    for (const orphan of orphans) {
      await expect(fs.stat(orphan.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(path.join(root, "manifests", `${orphan.digest}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await fs.readFile(path.join(retained.rootPath, "SKILL.md"), "utf8")).toBe("Software private retained legacy bytes");
    expect(await fs.readFile(path.join(retainedSkill.rootPath, "SKILL.md"), "utf8")).toBe("Software private retained legacy skill");
    expect(await fs.readFile(path.join(owned.rootPath, "SKILL.md"), "utf8")).toBe("Software private owned bytes");
    await expect(fs.stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
    const unsafe = path.join(root, "bundles", "f".repeat(64));
    await fs.symlink(home, unsafe);
    await expect(reconcileLegacyNativeRuntimeAssets(db)).rejects.toThrow("Unsafe");
    expect(await fs.readFile(canonical, "utf8")).toBe("Canonical source remains");
    await fs.unlink(unsafe);
    expect(await reconcileLegacyNativeRuntimeAssets(db)).toMatchObject({ removed: 0 });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId))).toHaveLength(1);
  });
});
