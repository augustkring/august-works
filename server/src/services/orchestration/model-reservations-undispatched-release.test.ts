import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  completionContracts,
  createDb,
  heartbeatRuns,
  issues,
  orchestrationModelReservations,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { modelReservationService } from "./model-reservations.js";
import { workerModelAbortMayRelease } from "./worker-model-gateway.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres undispatched release tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describe("APR-E2E-22: which caller aborts may be released", () => {
  it("allows only a bound, unsettled worker_model call aborted by its caller before the transport step", () => {
    const base = { bound: true, financiallySettled: false, callerAborted: true };
    for (const stage of ["provider_authority_recheck", "credential_lookup", "credential_recheck"])
      expect(workerModelAbortMayRelease({ ...base, stage })).toBe(true);
    for (const stage of ["provider_transport", "wire_authority_recheck", "wire_intent_write", "reservation_settlement",
      "response_capture_write", "post_response_recheck"])
      expect(workerModelAbortMayRelease({ ...base, stage })).toBe(false);
    expect(workerModelAbortMayRelease({ ...base, callerAborted: false, stage: "provider_authority_recheck" })).toBe(false);
    expect(workerModelAbortMayRelease({ ...base, bound: false, stage: "provider_authority_recheck" })).toBe(false);
    expect(workerModelAbortMayRelease({ ...base, financiallySettled: true, stage: "provider_authority_recheck" })).toBe(false);
  });
});

/** APR-E2E-22 (option 1). A worker_model reservation is released as failed
 * only when the durable record proves the request never left. */
describeEmbeddedPostgres("APR-E2E-22: undispatched worker_model release", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID(), agentId = randomUUID(), userId = `user-${randomUUID()}`;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-undispatched-release-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Undispatched", issuePrefix: "UND" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", adapterType: "codex_local", status: "running" });
  }, 60_000);

  afterAll(async () => { await tempDb?.cleanup(); });

  const service = () => modelReservationService(db, { sourceSha: "4".repeat(40), qualifiedTariff: async () => null,
    currentAuthority: async () => "3".repeat(64) });

  async function seed(options: { wireReceipt?: boolean; wireIntent?: boolean } = {}) {
    const issueId = randomUUID(), contractId = randomUUID(), runId = randomUUID(), planId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Planned Task", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(completionContracts).values({ id: contractId, companyId, issueId, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "release-v1", risk: "standard",
      completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "release-v1", objective: "Finish", criteria: [{ id: "objective", requirement: "Complete" }] },
      canonicalSha256: `contract-${contractId}`, createdByActorType: "system", createdByActorId: "test" });
    await db.insert(orchestrationPlans).values({ id: planId, companyId, issueId, completionContractId: contractId,
      mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "deterministic",
      humanOversightMode: "human_review", createdBy: userId, budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1,
        maxRetries: 0, maxWallClockSeconds: 3600, maxToolActions: 5, maxModelCostMinor: 1000 } });
    const [worker] = await db.insert(orchestrationWorkers).values({ companyId, planId, issueId, agentId, completionContractId: contractId,
      workerKey: "writer", dependsOn: [], status: "running", attemptCount: 1 }).returning();
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
      executionPrincipal: { type: "user", userId } }).where(eq(orchestrationPlans.id, planId));
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
      contextSnapshot: { issueId } });
    const [attemptRow] = await db.insert(orchestrationWorkerAttempts).values({ companyId, planId, workerId: worker!.id, agentId, runId,
      attempt: 1 }).returning();
    const [reservation] = await db.insert(orchestrationModelReservations).values({ companyId, planId, workerId: worker!.id,
      workerAttemptId: attemptRow!.id, purpose: "worker_model", principalUserId: userId,
      idempotencyKey: `worker-model-messages:${runId}:${randomUUID()}`, requestHash: "1".repeat(64), inputHash: "2".repeat(64),
      authorityHash: "3".repeat(64), maximumMinor: 1,
      quote: { version: 1, currency: "USD", provider: "anthropic", model: "fixture-model", maximumMinor: 1,
        inputTokensUpperBound: 100, maxOutputTokens: 100, sourceSha: "4".repeat(40), tariffHash: "5".repeat(64),
        qualificationHash: "6".repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString() } as never,
      expiresAt: new Date(Date.now() + 240_000) }).returning();
    await db.update(orchestrationModelReservations).set({ status: "dispatched", dispatchedAt: new Date(),
      ...(options.wireReceipt ? { providerWireReceipt: { version: 1, reservationId: reservation!.id, requestHash: "1".repeat(64), method: "POST",
        endpoint: "https://api.anthropic.com/v1/messages", bodySha256: "7".repeat(64), callId: "call-1" } as never } : {}) })
      .where(eq(orchestrationModelReservations.id, reservation!.id));
    if (options.wireIntent)
      await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeAwModelWireIntents: [{ reservationId: reservation!.id }] } })
        .where(eq(heartbeatRuns.id, runId));
    return { runId, planId, reservationId: reservation!.id };
  }

  const statusOf = async (id: string) => (await db.select({ status: orchestrationModelReservations.status })
    .from(orchestrationModelReservations).where(eq(orchestrationModelReservations.id, id)))[0]?.status;
  const planStatus = async (id: string) => (await db.select({ status: orchestrationPlans.status })
    .from(orchestrationPlans).where(eq(orchestrationPlans.id, id)))[0]?.status;

  it("releases an abort before dispatch as failed and leaves the plan running", async () => {
    const fixture = await seed();
    const released = await service().releaseUndispatchedWorkerModel(companyId, fixture.reservationId, { runId: fixture.runId });
    expect(released).toMatchObject({ status: "failed", providerWireReceipt: null, usage: null });
    expect(await statusOf(fixture.reservationId)).toBe("failed");
    expect(await planStatus(fixture.planId)).toBe("running");
  });

  it("refuses once the provider wire receipt is recorded, so the call stays unknown and fences", async () => {
    const fixture = await seed({ wireReceipt: true });
    expect(await service().releaseUndispatchedWorkerModel(companyId, fixture.reservationId, { runId: fixture.runId })).toBeNull();
    expect(await statusOf(fixture.reservationId)).toBe("dispatched");
  });

  it("refuses once the Run holds a wire intent for the reservation", async () => {
    const fixture = await seed({ wireIntent: true });
    expect(await service().releaseUndispatchedWorkerModel(companyId, fixture.reservationId, { runId: fixture.runId })).toBeNull();
    expect(await statusOf(fixture.reservationId)).toBe("dispatched");
  });

  it("refuses for another Run than the reservation's worker attempt", async () => {
    const fixture = await seed();
    const otherRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: otherRunId, companyId, agentId, status: "running", contextSnapshot: {} });
    expect(await service().releaseUndispatchedWorkerModel(companyId, fixture.reservationId, { runId: otherRunId })).toBeNull();
    expect(await statusOf(fixture.reservationId)).toBe("dispatched");
  });
});
