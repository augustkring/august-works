import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, issues, orchestrationPlans, orchestrationWorkers } from "@paperclipai/db";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { modelReservationService } from "../services/orchestration/model-reservations.js";
import { nativeOpenCodeConformanceQualifiedTariff } from "../services/orchestration/native-opencode-conformance-admission.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";

// CONF10. claimForDispatch (and recordWireDispatch) call the lane's
// qualifiedTariff inside their transaction, after the company locks and the
// plan row lock. The managed OpenCode conformance lane's tariff re-ran the
// whole harness validation on a second connection, which waited on the claim
// transaction's own locks, so the six-probe case hung between `reserved` and
// `claimed`. The lane's tariff is now pure (the admitted profile, checked with
// assertWorkerModelProfileCurrent, for the exact company, plan and purpose).
const sourceSha = "a".repeat(40);
const protectedEvidenceOrigin = "https://protected.test.invalid";
const authorityHash = "b".repeat(64);
const settleWithin = <T>(promise: Promise<T>, ms: number) => Promise.race([
  promise.then(value => ({ settled: true as const, value })),
  new Promise<{ settled: false }>(resolve => setTimeout(() => resolve({ settled: false }), ms)),
]);

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("managed OpenCode conformance dispatch claim", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  let plan: typeof orchestrationPlans.$inferSelect;
  beforeEach(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-conformance-claim-");
    // Same pool size as the six-probe case.
    db = createDb(database.connectionString, { maxConnections: 3 });
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true });
    f = await seedV5Presences(db);
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Synthetic provider qualification",
      assigneeAgentId: f.presence.id, status: "todo" }).returning();
    plan = await orchestrationService(db).create(f.actor, f.home, {
      issueId: task!.id, expectedIssueUpdatedAt: task!.updatedAt.toISOString(), riskClass: "C0", workload: "semantic",
      completionContract: { objective: "Qualify one bounded provider probe", requiredOutputs: [{ key: "result" }],
        businessInvariants: ["Use no tools"] },
      budgets: { maxModelCostMinor: 50, maxToolActions: 0 }, workers: [{ key: "worker", issueId: task!.id }],
    });
    // The private paused tool-free harness the reservation owner requires for
    // provider_conformance spend (model-reservations.ts authority()).
    await db.update(issues).set({ hiddenAt: new Date(), harnessKind: "provider_conformance" }).where(eq(issues.id, task!.id));
    // A conformance harness plan has no Worker (aw_v7_conformance_reservation_guard).
    await db.delete(orchestrationWorkers).where(eq(orchestrationWorkers.planId, plan.id));
    // The plan pin guard admits the execution principal only on the start to
    // running; the conformance owner then holds the started plan paused.
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(),
      executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, plan.id));
    [plan] = await db.update(orchestrationPlans).set({ status: "paused" })
      .where(eq(orchestrationPlans.id, plan.id)).returning() as [typeof plan];
  }, 60_000);
  afterEach(async () => {
    try { await db?.$client.end({ timeout: 0 }); } finally { await database?.cleanup(); }
  }, 30_000);

  const profile = (fixedMinor = 3): WorkerModelProfile => ({ id: randomUUID(), companyId: f.home, workerAgentId: f.presence.id,
    providerBindingId: randomUUID(), providerSnapshotHash: "c".repeat(64), providerProfileRef: `private:${f.presence.id}`,
    qualifiedConfigurationHash: "d".repeat(64),
    binding: { provider: "anthropic", method: "api_key", mode: "shared", connectionId: randomUUID(), grantId: randomUUID() },
    transport: "server-anthropic-messages-v1", contract: "anthropic-messages-tools-2023-06-01", maximumEnvelopeBytes: 64_000,
    inputTokensUpperBound: 1000, maxOutputTokens: 256,
    tariff: { provider: "anthropic", model: "fixture-model", currency: "USD", fixedMinor, inputMinorPerMillion: 0,
      outputMinorPerMillion: 0, sourceSha, qualificationHash: "e".repeat(64), testedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString() },
    qualificationEvidenceRef: `${protectedEvidenceOrigin}/qualification/conformance-claim`, qualificationArtifactSha256: "f".repeat(64),
  } as WorkerModelProfile);

  /** The conformance lane's reservation service, as callNativeOpenCodeConformanceMessages builds it. */
  const conformanceReservations = (bound: { current: () => WorkerModelProfile; companyId?: string; planId?: string;
    authority?: () => string }) => modelReservationService(db, {
    sourceSha,
    qualifiedTariff: async request => nativeOpenCodeConformanceQualifiedTariff({ request,
      companyId: bound.companyId ?? f.home, planId: bound.planId ?? plan.id, admittedPlanId: bound.planId ?? plan.id,
      profile: bound.current(), sourceSha, protectedEvidenceOrigin }),
    currentAuthority: async () => bound.authority?.() ?? authorityHash,
  });
  const reserve = (service: ReturnType<typeof modelReservationService>, key = randomUUID()) => service.reserve(f.actor, {
    companyId: f.home, planId: plan.id, expectedPlanVersion: plan.version, purpose: "provider_conformance",
    idempotencyKey: `opencode-conformance:${key}`, inputHash: "1".repeat(64), authorityHash,
    inputTokensUpperBound: 1000, maxOutputTokens: 256,
  });

  it("claims a conformance reservation without waiting on a second connection", async () => {
    const admitted = profile();
    const service = conformanceReservations({ current: () => admitted });
    const reservation = await reserve(service);
    expect(reservation).toMatchObject({ purpose: "provider_conformance", status: "reserved" });
    const claimed = await settleWithin(service.claimForDispatch(f.actor, f.home, reservation.id), 15_000);
    expect(claimed).toMatchObject({ settled: true, value: { status: "dispatched", purpose: "provider_conformance" } });
  }, 60_000);

  it("shows the hazard: a tariff that needs the plan lock on a second connection cannot finish inside the claim", async () => {
    // Control for the old shape. The second connection waits on the plan row
    // the claim transaction holds; a lock timeout on that connection is the
    // only thing that ends the wait, and the claim then fails.
    const admitted = profile();
    const pure = conformanceReservations({ current: () => admitted });
    const reservation = await reserve(pure);
    const blocking = modelReservationService(db, {
      sourceSha,
      qualifiedTariff: async request => db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.select({ id: orchestrationPlans.id }).from(orchestrationPlans)
          .where(and(eq(orchestrationPlans.companyId, request.companyId), eq(orchestrationPlans.id, request.planId))).for("update");
        return admitted.tariff;
      }),
      currentAuthority: async () => authorityHash,
    });
    const started = Date.now();
    await expect(blocking.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toBeTruthy();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    // The pure lane still claims the same reservation afterwards.
    await expect(pure.claimForDispatch(f.actor, f.home, reservation.id)).resolves.toMatchObject({ status: "dispatched" });
  }, 60_000);

  it("refuses the claim when the profile's tariff changed after the reservation", async () => {
    let admitted = profile(3);
    const service = conformanceReservations({ current: () => admitted });
    const reservation = await reserve(service);
    admitted = profile(4);
    await expect(service.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it("refuses the claim when the admitted profile is no longer current", async () => {
    let admitted = profile();
    const service = conformanceReservations({ current: () => admitted });
    const reservation = await reserve(service);
    admitted = { ...admitted, tariff: { ...admitted.tariff, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    await expect(service.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toThrow();
    admitted = { ...profile(), qualificationEvidenceRef: "https://elsewhere.test.invalid/qualification/x" };
    await expect(service.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toThrow();
  }, 60_000);

  it.each([
    ["another plan", { planId: randomUUID() }],
    ["another company", { companyId: randomUUID() }],
  ])("refuses the claim when the admission was for %s", async (_label, binding) => {
    const admitted = profile();
    const reservation = await reserve(conformanceReservations({ current: () => admitted }));
    const other = conformanceReservations({ current: () => admitted, ...binding });
    await expect(other.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 403 });
  }, 60_000);

  it("refuses the claim when the in-transaction authority changed", async () => {
    const admitted = profile();
    let current = authorityHash;
    const service = conformanceReservations({ current: () => admitted, authority: () => current });
    const reservation = await reserve(service);
    current = "9".repeat(64);
    await expect(service.claimForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 409 });
  }, 60_000);

  it("returns no tariff for another purpose, company or plan", () => {
    const admitted = profile();
    const base = { companyId: f.home, planId: plan.id, admittedPlanId: plan.id, profile: admitted, sourceSha, protectedEvidenceOrigin };
    expect(nativeOpenCodeConformanceQualifiedTariff({ ...base, request: { companyId: f.home, planId: plan.id, purpose: "provider_conformance" } }))
      .toEqual(admitted.tariff);
    for (const request of [
      { companyId: f.home, planId: plan.id, purpose: "worker_model" },
      { companyId: randomUUID(), planId: plan.id, purpose: "provider_conformance" },
      { companyId: f.home, planId: randomUUID(), purpose: "provider_conformance" },
    ]) expect(nativeOpenCodeConformanceQualifiedTariff({ ...base, request })).toBeNull();
    expect(nativeOpenCodeConformanceQualifiedTariff({ ...base, admittedPlanId: randomUUID(),
      request: { companyId: f.home, planId: plan.id, purpose: "provider_conformance" } })).toBeNull();
  });
});
