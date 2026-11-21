import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
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
import { planCountedModelCost, planModelReservationFits, type ModelReservationLedgerRow } from "./model-reservation-release.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres model reservation release tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

/** APR-E2E-22 (phase A, migration 0589). Drives the real reservation triggers
 * and checks that the TypeScript mirror agrees with the plan counter. */
describeEmbeddedPostgres("model reservation release (phase A)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID(), agentId = randomUUID(), userId = `user-${randomUUID()}`;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-model-reservation-release-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Release", issuePrefix: "REL" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", adapterType: "codex_local", status: "running" });
  }, 60_000);

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seedPlan(maxModelCostMinor = 3) {
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
        maxRetries: 0, maxWallClockSeconds: 3600, maxToolActions: 5, maxModelCostMinor } });
    const [worker] = await db.insert(orchestrationWorkers).values({ companyId, planId, issueId, agentId, completionContractId: contractId,
      workerKey: "writer", dependsOn: [], status: "running", attemptCount: 1 }).returning();
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
      executionPrincipal: { type: "user", userId } }).where(eq(orchestrationPlans.id, planId));
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
      contextSnapshot: { issueId } });
    const [attempt] = await db.insert(orchestrationWorkerAttempts).values({ companyId, planId, workerId: worker!.id, agentId, runId,
      attempt: 1 }).returning();
    return { planId, workerId: worker!.id, attemptId: attempt!.id, runId };
  }

  type Plan = Awaited<ReturnType<typeof seedPlan>>;
  async function reserve(plan: Plan) {
    const [row] = await db.insert(orchestrationModelReservations).values({ companyId, planId: plan.planId, workerId: plan.workerId,
      workerAttemptId: plan.attemptId, purpose: "worker_model", principalUserId: userId,
      idempotencyKey: `worker-model-messages:${plan.runId}:${randomUUID()}`, requestHash: "1".repeat(64), inputHash: "2".repeat(64),
      authorityHash: "3".repeat(64), maximumMinor: 1,
      quote: { version: 1, currency: "USD", provider: "anthropic", model: "fixture-model", maximumMinor: 1,
        inputTokensUpperBound: 100, maxOutputTokens: 100, sourceSha: "4".repeat(40), tariffHash: "5".repeat(64),
        qualificationHash: "6".repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString() } as never,
      expiresAt: new Date(Date.now() + 240_000) }).returning();
    return row!.id;
  }
  const dispatch = (id: string) => db.update(orchestrationModelReservations).set({ status: "dispatched", dispatchedAt: new Date() })
    .where(eq(orchestrationModelReservations.id, id));
  const receipt = (id: string) => db.update(orchestrationModelReservations).set({ providerWireReceipt: { version: 1, reservationId: id,
    requestHash: "1".repeat(64), method: "POST", endpoint: "https://api.anthropic.com/v1/messages", bodySha256: "7".repeat(64),
    callId: "call-1" } as never }).where(eq(orchestrationModelReservations.id, id));
  const settle = (id: string, status: "completed" | "failed" | "unknown" | "cancelled", usage: unknown = null,
    providerResponseHash: string | null = null) => db.update(orchestrationModelReservations)
    .set({ status, completedAt: new Date(), usage: usage as never, providerResponseHash })
    .where(eq(orchestrationModelReservations.id, id));

  async function counter(plan: Plan) {
    const [row] = await db.select({ reserved: orchestrationPlans.modelCostReserved, budgets: orchestrationPlans.budgets })
      .from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.planId));
    const rows: ModelReservationLedgerRow[] = (await db.select().from(orchestrationModelReservations).where(and(
      eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.planId, plan.planId))))
      .map(r => ({ status: r.status, purpose: r.purpose, providerWireReceipt: r.providerWireReceipt ?? null,
        providerResponseHash: r.providerResponseHash ?? null, usage: r.usage ?? null, maximumMinor: r.maximumMinor }));
    return { reserved: row!.reserved, mirror: planCountedModelCost(rows),
      fitsOneMore: planModelReservationFits(rows, 1, (row!.budgets as { maxModelCostMinor: number | null }).maxModelCostMinor) };
  }
  const pgCode = async (work: () => Promise<unknown>) => {
    try { await work(); return null; } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause;
      return cause?.message ?? (error as Error).message;
    }
  };

  it.each([
    ["cancelled from reserved", async (id: string) => { await settle(id, "cancelled"); }, 0],
    ["failed before dispatch (no receipt, intent or usage)", async (id: string) => { await dispatch(id); await settle(id, "failed"); }, 0],
    ["completed", async (id: string) => { await dispatch(id); await receipt(id); await settle(id, "completed", { inputTokens: 1, outputTokens: 1 }, "8".repeat(64)); }, 1],
    ["unknown", async (id: string) => { await dispatch(id); await settle(id, "unknown"); }, 1],
    ["failed after the wire receipt", async (id: string) => { await dispatch(id); await receipt(id); await settle(id, "failed"); }, 1],
    ["still dispatched", async (id: string) => { await dispatch(id); }, 1],
  ] as const)("counts %s as expected, and the mirror agrees", async (_name, arrange, expected) => {
    const plan = await seedPlan();
    const id = await reserve(plan);
    expect(await counter(plan)).toMatchObject({ reserved: 1, mirror: 1 });
    await arrange(id);
    const after = await counter(plan);
    expect(after.reserved).toBe(expected);
    expect(after.mirror).toBe(expected);
    expect(after.fitsOneMore).toBe(true);
  });

  it("keeps the hard stop on completed and unknown spend, and frees headroom only by a release", async () => {
    const plan = await seedPlan(2);
    const done = await reserve(plan); await dispatch(done); await receipt(done);
    await settle(done, "completed", { inputTokens: 1, outputTokens: 1 }, "8".repeat(64));
    const lost = await reserve(plan); await dispatch(lost); await settle(lost, "unknown");
    expect(await counter(plan)).toMatchObject({ reserved: 2, mirror: 2, fitsOneMore: false });
    expect(await pgCode(() => reserve(plan))).toContain("model_reservation_budget_exhausted");

    const released = await seedPlan(2);
    const kept = await reserve(released); await dispatch(kept); await settle(kept, "unknown");
    const unsent = await reserve(released);
    expect(await counter(released)).toMatchObject({ reserved: 2, fitsOneMore: false });
    await dispatch(unsent); await settle(unsent, "failed");
    expect(await counter(released)).toMatchObject({ reserved: 1, mirror: 1, fitsOneMore: true });
    await reserve(released);
    expect(await counter(released)).toMatchObject({ reserved: 2, mirror: 2 });
  });

  it("refuses a failed worker_model release when the Run holds a wire intent for it", async () => {
    const plan = await seedPlan();
    const id = await reserve(plan); await dispatch(id);
    await db.update(heartbeatRuns).set({ runnerProfileJson: { nativeAwModelWireIntents: [{ reservationId: id, callId: "call-1" }] } })
      .where(eq(heartbeatRuns.id, plan.runId));
    expect(await pgCode(() => settle(id, "failed"))).toContain("model_reservation_release_unproven");
    expect(await counter(plan)).toMatchObject({ reserved: 1, mirror: 1 });
  });

  it("backfills a plan whose counter still includes a released reservation (the migration's statement)", async () => {
    const plan = await seedPlan();
    const id = await reserve(plan); await reserve(plan);
    await settle(id, "cancelled");
    // The state before 0589: the cancelled reservation still counted.
    await db.execute(sql.raw("ALTER TABLE orchestration_plans DISABLE TRIGGER aw_v7_model_budget_counter_guard"));
    await db.update(orchestrationPlans).set({ modelCostReserved: 2 }).where(eq(orchestrationPlans.id, plan.planId));
    await db.execute(sql.raw("ALTER TABLE orchestration_plans ENABLE TRIGGER aw_v7_model_budget_counter_guard"));
    expect(await counter(plan)).toMatchObject({ reserved: 2, mirror: 1 });
    const migration = readFileSync(new URL("../../../../packages/db/src/migrations/0589_released_model_reservations.sql", import.meta.url), "utf8");
    const backfill = migration.split("--> statement-breakpoint")
      .map(part => part.split("\n").filter(line => !line.trim().startsWith("--")).join("\n").trim())
      .filter(part => part.startsWith("ALTER TABLE orchestration_plans") || part.startsWith("UPDATE orchestration_plans"));
    expect(backfill).toHaveLength(3);
    for (const statement of backfill) await db.execute(sql.raw(statement));
    expect(await counter(plan)).toMatchObject({ reserved: 1, mirror: 1 });
    await reserve(plan);
    expect(await counter(plan)).toMatchObject({ reserved: 2, mirror: 2 });
  });

  it("refuses forged counter decreases", async () => {
    const plan = await seedPlan();
    const other = await seedPlan();
    const id = await reserve(plan); await reserve(other);
    // No status change: a direct decrease, by the right amount or not.
    for (const amount of [1, 2]) {
      expect(await pgCode(() => db.update(orchestrationPlans)
        .set({ modelCostReserved: sql`${orchestrationPlans.modelCostReserved} - ${amount}` })
        .where(eq(orchestrationPlans.id, plan.planId)))).toContain("model_budget_counter_requires_native_reservations");
    }
    // A release on one plan never lowers another plan's counter.
    await settle(id, "cancelled");
    expect(await counter(plan)).toMatchObject({ reserved: 0, mirror: 0 });
    expect(await counter(other)).toMatchObject({ reserved: 1, mirror: 1 });
    expect(await pgCode(() => db.update(orchestrationPlans)
      .set({ modelCostReserved: sql`${orchestrationPlans.modelCostReserved} - 1` })
      .where(eq(orchestrationPlans.id, other.planId)))).toContain("model_budget_counter_requires_native_reservations");
  });
});
