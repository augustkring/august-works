import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { createDb, activityLog, companyMemberships, billingAccounts, billingAccountCompanies, runtimeCells, runtimeHosts, runtimeCapacityProfiles, runtimeVersionCatalog, runtimeSandboxBindings, sandboxQualificationRuns, runtimeOperations } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { executionSandboxService } from "../services/execution-sandbox/sandbox-service.js";
import { reconcileSandboxSafety } from "../services/execution-sandbox/sandbox-guardian.js";
import { runtimeControlService } from "../services/runtime/control.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
const support = await getEmbeddedPostgresTestSupport(), image = "fixture.invalid/sandbox@sha256:" + "a".repeat(64);
(support.supported ? describe : describe.skip)("V7 sandbox company scope, immutable evidence and rollback fences", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, f: Awaited<ReturnType<typeof seedV5Companies>>, cell: typeof runtimeCells.$inferSelect;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v7-sandbox-"); db = createDb(database.connectionString); await instanceSettingsService(db).getExperimental(); await db.insert(runtimeVersionCatalog).values({ imageDigest: image, providerVersion: "fixture", stateFormat: "v1", hostAgentMinimumVersion: "6.0.0", conformance: { fixtureOnly: true }, status: "approved" }); await db.insert(runtimeCapacityProfiles).values({ key: "sandbox-fixture", cpuMillis: 1000, memoryBytes: 1073741824n, diskBytes: 10737418240n, pidsLimit: 128, qualified: false }); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => { await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: true, openshell_v7: false }); f = await seedV5Companies(db); const [account] = await db.insert(billingAccounts).values({ displayName: "Fixture", payerUserId: f.userId }).returning(); await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id }); [cell] = await db.insert(runtimeCells).values({ companyId: f.home, billingAccountId: account!.id, capacityProfile: "sandbox-fixture", desiredImageDigest: image, status: "STOPPED", isolationMode: "company_cell" }).returning() as [typeof runtimeCells.$inferSelect]; });
  const create = () => executionSandboxService(db).create(f.actor, f.home, { runtimeCellId: cell.id, expectedCellGeneration: cell.generation.toString(), backend: "existing_cell_container", profile: "development", boundaryPolicy: policyFixture() });
  it("creates only current stopped company-owned bindings and exposes honest posture", async () => { const row = await create(); expect(row.status).toBe("requested"); expect(await executionSandboxService(db).posture(f.actor, f.home, cell.id)).toMatchObject({ state: "awaiting_qualification", executionEnforced: false }); await expect(create()).rejects.toThrow(); await expect(executionSandboxService(db).get(f.actor, f.guest, row.id)).rejects.toMatchObject({ status: 404 }); });
  it("does not earn readiness from the existing container lifecycle", async () => { const row = await create(); const qualified = await executionSandboxService(db).qualify(f.actor, f.home, row.id, 1); expect(qualified.status).toBe("requested"); expect(qualified.capabilitySnapshot).toBeNull(); const [report] = await db.select().from(sandboxQualificationRuns).where(eq(sandboxQualificationRuns.bindingId, row.id)); expect(report?.status).toBe("inconclusive"); expect(report?.results).toHaveLength(18); expect(report?.results.every(test => test.verdict === "unsupported")).toBe(true); await expect(db.update(sandboxQualificationRuns).set({ status: "passed" }).where(eq(sandboxQualificationRuns.id, report!.id))).rejects.toThrow(); await expect(db.update(runtimeSandboxBindings).set({ status: "ready" }).where(eq(runtimeSandboxBindings.id, row.id))).rejects.toThrow(); });
  it("rejects agent-controlled bindings and disabled OpenShell", async () => { await expect(executionSandboxService(db).create({ type: "agent", companyId: f.home, agentId: "11111111-1111-4111-8111-111111111111" }, f.home, { runtimeCellId: cell.id, expectedCellGeneration: "1", backend: "existing_cell_container", profile: "development", boundaryPolicy: policyFixture() })).rejects.toMatchObject({ status: 403 }); await expect(executionSandboxService(db).create(f.actor, f.home, { runtimeCellId: cell.id, expectedCellGeneration: "1", backend: "openshell", profile: "development", boundaryPolicy: policyFixture() })).rejects.toMatchObject({ status: 404 }); });
  it("invalidates a changed generation even after feature rollback and keeps the original boundary immutable", async () => { const row = await create(); await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false }); await db.update(runtimeCells).set({ generation: cell.generation + 1n }).where(eq(runtimeCells.id, cell.id)); const [fenced] = await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, row.id)); expect(fenced?.status).toBe("quarantined"); await expect(db.update(runtimeSandboxBindings).set({ cellGeneration: "2" }).where(eq(runtimeSandboxBindings.id, row.id))).rejects.toThrow(); expect((await executionSandboxService(db).posture(f.actor, f.home, cell.id)).state).toBe("quarantined"); await expect(create()).rejects.toMatchObject({ status: 404 }); });
  it("blocks native start bypasses on bound cells after feature rollback, and preserves Stop", async () => { await create(); await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false }); const operation = { companyId: f.home, runtimeCellId: cell.id, requestedByType: "user", requestedById: f.userId, operationType: "start", idempotencyKey: "fixture-start", requestHash: "fixture", status: "REQUESTED", deadlineAt: new Date(Date.now() + 60000) }; await expect(db.insert(runtimeOperations).values(operation)).rejects.toThrow(); await db.insert(runtimeOperations).values({ ...operation, operationType: "stop", idempotencyKey: "fixture-stop" }); });
  it("reconciles missing enforcement into quarantine independently of flag rollback", async () => { const row = await create(); await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false }); expect(await executionSandboxService(db).reconcile(f.actor, f.home, row.id, 1)).toMatchObject({ status: "quarantined", version: 2 }); });
  it("requires an actual owned manifest instead of caller policy pins", async () => { const row = await create(); await expect(executionSandboxService(db).compile(f.actor, f.home, row.id, { expectedVersion: 1, executionManifestId: "11111111-1111-4111-8111-111111111111", candidatePolicy: policyFixture() })).rejects.toMatchObject({ status: 404 }); await expect(executionSandboxService(db).qualify(f.actor, f.home, row.id, 2)).rejects.toMatchObject({ status: 409 }); });
  it("automatically quarantines a lifecycle bypass after rollout rollback and owner revocation, with a durable native system Stop", async () => {
    const binding = await create();
    await db.update(runtimeCells).set({ status: "HEALTHY" }).where(eq(runtimeCells.id, cell.id));
    await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false });
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.home));
    const runtime = runtimeControlService(db, { runtime: { suspectSeconds: 90, relayPort: 3102 } } as SaasPlatformConfig);
    const options = { requestStop: (input: { companyId: string; cellId: string; generation: string; idempotencyKey: string }) => runtime.request(input.companyId, input.cellId, "sandbox-guardian", { action: "stop" as const, idempotencyKey: input.idempotencyKey }, new Date(), "sandbox-guardian", input.generation) };
    const first = await reconcileSandboxSafety(db, options);
    expect(first).toMatchObject({ quarantined: 1, stopRequested: 1, stopPending: 0 });
    expect((await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, binding.id)))[0]).toMatchObject({ status: "quarantined", version: 2 });
    const [operation] = await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, cell.id));
    expect(operation).toMatchObject({ operationType: "stop", requestedByType: "system", requestedById: "sandbox-guardian", status: "REQUESTED", desiredState: { expectedCellGeneration: "1" } });
    expect((await reconcileSandboxSafety(db, options)).quarantined).toBe(0);
    expect(await db.select().from(runtimeOperations).where(eq(runtimeOperations.runtimeCellId, cell.id))).toHaveLength(1);
    const events = await db.select().from(activityLog).where(eq(activityLog.entityId, binding.id));
    expect(events.filter(event => event.action === "sandbox.authority_quarantined")).toHaveLength(1);
    expect(events.find(event => event.action === "sandbox.authority_quarantined")?.actorType).toBe("system");
    // The durable request is still not a physical Stop receipt. A generation
    // change before dispatch must cancel it without targeting the replacement.
    await db.update(runtimeCells).set({ generation: 2n }).where(eq(runtimeCells.id, cell.id));
    // This private database also contains earlier lifecycle fixtures; retire
    // their un-dispatched requests so the native global consumer selects ours.
    await db.update(runtimeOperations).set({ status: "CANCELED" }).where(and(ne(runtimeOperations.companyId, f.home), eq(runtimeOperations.status, "REQUESTED")));
    expect(await runtime.dispatchOne()).toBe(true);
    expect((await db.select().from(runtimeOperations).where(eq(runtimeOperations.id, operation!.id)))[0]).toMatchObject({ status: "CANCELED", errorCode: "stale_generation" });
    expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, cell.id)))[0]).toMatchObject({ generation: 2n, status: "HEALTHY" });
    expect((await reconcileSandboxSafety(db, options)).stopRequested).toBe(0);
    await runtime.relay.stop();
  });
  it("keeps failed Stop delivery visibly pending and retries without restoring sandbox authority", async () => {
    const binding = await create();
    await db.update(runtimeCells).set({ status: "DEGRADED" }).where(eq(runtimeCells.id, cell.id));
    const result = await reconcileSandboxSafety(db, { requestStop: async () => { throw new Error("fixture-native-controller-unavailable"); } });
    expect(result).toMatchObject({ quarantined: 1, stopPending: 1, stopRequested: 0 });
    const calls: string[] = [];
    await reconcileSandboxSafety(db, { requestStop: async input => { calls.push(input.idempotencyKey); return { id: "fixture-controller-receipt" }; } });
    expect(calls).toContain(`v7-sandbox-guardian:${binding.id}:1`);
    expect((await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, binding.id)))[0]?.status).toBe("quarantined");
  });
  it.each(["model", "provider", "isolation", "gateway credential"])("invalidates the bound %s change atomically with rollout disabled", async field => {
    const binding = await create();
    await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false });
    const change = field === "model" ? { modelId: "fixture-replacement-model" } : field === "provider" ? { runtimeProvider: "hermes" } : field === "isolation" ? { isolationMode: "dedicated_vm" } : { gatewaySecretRef: "fixture-different-credential-reference" };
    await db.update(runtimeCells).set(change).where(eq(runtimeCells.id, cell.id));
    expect((await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, binding.id)))[0]).toMatchObject({ status: "quarantined", version: 2 });
  });
  it("invalidates native host credential rotation and host loss without changing tenant cell generations", async () => {
    const [host] = await db.insert(runtimeHosts).values({ environment: "staging", region: "dk-cph1", capacityClass: "fixture", status: "READY", cpuTotalMillis: 4000, memoryTotalBytes: 8000000000n, diskTotalBytes: 40000000000n, lastHeartbeatAt: new Date() }).returning();
    await db.update(runtimeCells).set({ runtimeHostId: host!.id }).where(eq(runtimeCells.id, cell.id));
    const binding = await create();
    await instanceSettingsService(db).updateExperimental({ sandbox_abstraction_v7: false });
    await db.update(runtimeHosts).set({ credentialVersion: 2 }).where(eq(runtimeHosts.id, host!.id));
    expect((await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, binding.id)))[0]).toMatchObject({ status: "quarantined", version: 2 });
    await db.update(runtimeHosts).set({ status: "UNREACHABLE" }).where(eq(runtimeHosts.id, host!.id));
    expect((await db.select().from(runtimeSandboxBindings).where(eq(runtimeSandboxBindings.id, binding.id)))[0]!.version).toBe(2);
    expect((await db.select().from(runtimeCells).where(eq(runtimeCells.id, cell.id)))[0]!.generation).toBe(1n);
  });
});
