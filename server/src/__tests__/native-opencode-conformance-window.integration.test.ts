import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, issues, orchestrationModelReservations, orchestrationPlans, orchestrationWorkers } from "@paperclipai/db";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { modelReservationService } from "../services/orchestration/model-reservations.js";
import { nativeOpenCodeConformanceQualifiedTariff } from "../services/orchestration/native-opencode-conformance-admission.js";
import { assertNativeOpenCodeConformanceProbeWindow, nativeOpenCodeConformanceHarnessBudgets,
  NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS,
  NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS } from "../services/orchestration/native-opencode-conformance-window.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";

// CONF15-P5 (the CONF15-P4 next stop): one managed OpenCode qualification runs six serial
// probes against harness plans that shared a single 300 s window, so a later
// probe's model reservation was refused ("The original model execution
// deadline expired", 331.5 s after the group start). The harness plans now carry
// the group total and each probe's reservations are bounded by its own window
// (the conformance lane's current authority, validateNativeOpenCodeConformanceHarness).
const sourceSha = "a".repeat(40);
const protectedEvidenceOrigin = "https://protected.test.invalid";
const authorityHash = "b".repeat(64);

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("managed OpenCode qualification reservation window", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-conformance-window-");
    db = createDb(database.connectionString, { maxConnections: 3 });
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true });
    f = await seedV5Presences(db);
  }, 60_000);
  afterAll(async () => {
    try { await db?.$client.end({ timeout: 0 }); } finally { await database?.cleanup(); }
  }, 30_000);

  /** A private paused tool-free harness plan started `startedAgoSeconds` ago. */
  async function harness(startedAgoSeconds: number, maxWallClockSeconds?: number) {
    // The budgets `prepare` gives a qualification's harness plan (or, for the
    // old shape, the single 300 s window).
    const budgets = { ...nativeOpenCodeConformanceHarnessBudgets(50), ...(maxWallClockSeconds ? { maxWallClockSeconds } : {}) };
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Synthetic provider qualification",
      assigneeAgentId: f.presence.id, status: "todo" }).returning();
    let plan = await orchestrationService(db).create(f.actor, f.home, {
      issueId: task!.id, expectedIssueUpdatedAt: task!.updatedAt.toISOString(), riskClass: "C0", workload: "semantic",
      completionContract: { objective: "Qualify bounded provider probes", requiredOutputs: [{ key: "result" }],
        businessInvariants: ["Use no tools"] },
      budgets, workers: [{ key: "worker", issueId: task!.id }],
    });
    await db.update(issues).set({ hiddenAt: new Date(), harnessKind: "provider_conformance" }).where(eq(issues.id, task!.id));
    await db.delete(orchestrationWorkers).where(eq(orchestrationWorkers.planId, plan.id));
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(Date.now() - startedAgoSeconds * 1000),
      executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, plan.id));
    [plan] = await db.update(orchestrationPlans).set({ status: "paused" })
      .where(eq(orchestrationPlans.id, plan.id)).returning() as [typeof plan];
    return plan;
  }
  const profile = (): WorkerModelProfile => ({ id: randomUUID(), companyId: f.home, workerAgentId: f.presence.id,
    providerBindingId: randomUUID(), providerSnapshotHash: "c".repeat(64), providerProfileRef: `private:${f.presence.id}`,
    qualifiedConfigurationHash: "d".repeat(64),
    binding: { provider: "anthropic", method: "api_key", mode: "shared", connectionId: randomUUID(), grantId: randomUUID() },
    transport: "server-anthropic-messages-v1", contract: "anthropic-messages-tools-2023-06-01", maximumEnvelopeBytes: 64_000,
    inputTokensUpperBound: 1000, maxOutputTokens: 256,
    tariff: { provider: "anthropic", model: "fixture-model", currency: "USD", fixedMinor: 3, inputMinorPerMillion: 0,
      outputMinorPerMillion: 0, sourceSha, qualificationHash: "e".repeat(64), testedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString() },
    qualificationEvidenceRef: `${protectedEvidenceOrigin}/qualification/conformance-window`, qualificationArtifactSha256: "f".repeat(64),
  } as WorkerModelProfile);

  /** The conformance lane's reservation service; its current authority applies
   * the probe window exactly as validateNativeOpenCodeConformanceHarness does. */
  async function reserveForProbe(plan: typeof orchestrationPlans.$inferSelect, probeStartedAgoSeconds: number) {
    const admitted = profile();
    const probeStartedAt = new Date(Date.now() - probeStartedAgoSeconds * 1000);
    const service = modelReservationService(db, {
      sourceSha,
      qualifiedTariff: async request => nativeOpenCodeConformanceQualifiedTariff({ request, companyId: f.home, planId: plan.id,
        admittedPlanId: plan.id, profile: admitted, sourceSha, protectedEvidenceOrigin }),
      currentAuthority: async () => {
        assertNativeOpenCodeConformanceProbeWindow({ planStartedAt: plan.startedAt,
          planWallClockSeconds: plan.budgets.maxWallClockSeconds, probeStartedAt, now: new Date() });
        return authorityHash;
      },
    });
    return service.reserve(f.actor, { companyId: f.home, planId: plan.id, expectedPlanVersion: plan.version,
      purpose: "provider_conformance", idempotencyKey: `opencode-conformance:${randomUUID()}`, inputHash: "1".repeat(64),
      authorityHash, inputTokensUpperBound: 1000, maxOutputTokens: 256 });
  }
  const reservationsOf = (planId: string) => db.select().from(orchestrationModelReservations)
    .where(eq(orchestrationModelReservations.planId, planId));

  it("admits a later probe's reservation past the old single 300 s window", async () => {
    // The old harness plan refused it at the plan window.
    const old = await harness(331, 300);
    await expect(reserveForProbe(old, 30)).rejects.toMatchObject({ status: 403,
      message: "The original model execution deadline expired" });
    // The group-total harness admits it inside the probe's own window.
    const plan = await harness(331);
    const reservation = await reserveForProbe(plan, 30);
    expect(reservation).toMatchObject({ purpose: "provider_conformance", status: "reserved" });
    // Never beyond the probe's or the group's window.
    expect(reservation.expiresAt.getTime()).toBeLessThanOrEqual(plan.startedAt!.getTime() +
      NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS * 1000);
    expect(reservation.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS * 1000);
  }, 60_000);

  it("refuses a reservation after the probe's own window", async () => {
    const plan = await harness(400);
    await expect(reserveForProbe(plan, NATIVE_OPENCODE_CONFORMANCE_PROBE_WALL_CLOCK_SECONDS + 1)).rejects.toMatchObject({
      status: 403, message: "The conformance probe's wall-clock window expired" });
    expect(await reservationsOf(plan.id)).toEqual([]);
  }, 60_000);

  it("refuses a reservation after the group total, even inside the probe's own window", async () => {
    const plan = await harness(NATIVE_OPENCODE_CONFORMANCE_GROUP_WALL_CLOCK_SECONDS + 1);
    await expect(reserveForProbe(plan, 10)).rejects.toMatchObject({ status: 403,
      message: "The original model execution deadline expired" });
    expect(await reservationsOf(plan.id)).toEqual([]);
  }, 60_000);
});
