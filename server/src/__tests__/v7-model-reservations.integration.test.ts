import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companyMemberships,
  createDb,
  issues,
  orchestrationPlans,
  orchestrationModelReservations,
} from "@paperclipai/db";
import type { ModelTariffCeiling } from "@paperclipai/shared";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import {
  modelReservationService,
  quoteModelReservation,
} from "../services/orchestration/model-reservations.js";
const sourceSha = "a".repeat(40),
  authorityHash = "b".repeat(64);
const tariff = (): ModelTariffCeiling => ({
  provider: "openai",
  model: "fixture-only-model",
  currency: "USD",
  inputMinorPerMillion: 30000000,
  outputMinorPerMillion: 0,
  fixedMinor: 0,
  qualificationHash: "c".repeat(64),
  sourceSha,
  testedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
describe("conservative native model cost quotes", () => {
  it("rounds fractional aggregate charges upward without floating-point under-reservation", () => {
    const price = {
      ...tariff(),
      inputMinorPerMillion: 1,
      outputMinorPerMillion: 1,
    };
    expect(
      quoteModelReservation({
        tariff: price,
        sourceSha,
        inputTokensUpperBound: 999999,
        maxOutputTokens: 2,
      }).maximumMinor,
    ).toBe(2);
    expect(() =>
      quoteModelReservation({
        tariff: { ...price, inputMinorPerMillion: 1000000000 },
        sourceSha,
        inputTokensUpperBound: 2000000,
        maxOutputTokens: 65536,
      }),
    ).toThrow(/exceeds/);
  });
  it("rejects expiry, future evidence, wrong revision, non-integer token limits and unsupported currency", () => {
    const current = tariff(),
      base = {
        tariff: current,
        sourceSha,
        inputTokensUpperBound: 1,
        maxOutputTokens: 1,
      };
    expect(() =>
      quoteModelReservation({
        ...base,
        tariff: { ...current, expiresAt: new Date(0).toISOString() },
      }),
    ).toThrow();
    expect(() =>
      quoteModelReservation({
        ...base,
        tariff: {
          ...current,
          testedAt: new Date(Date.now() + 10000).toISOString(),
        },
      }),
    ).toThrow();
    expect(() =>
      quoteModelReservation({ ...base, sourceSha: "d".repeat(40) }),
    ).toThrow();
    expect(() =>
      quoteModelReservation({ ...base, inputTokensUpperBound: 0.5 }),
    ).toThrow();
    expect(() =>
      quoteModelReservation({
        ...base,
        tariff: { ...current, currency: "EUR" as "USD" },
      }),
    ).toThrow();
  });
});
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "native model reservation ledger and dispatch boundary",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      plan: typeof orchestrationPlans.$inferSelect,
      price: ModelTariffCeiling | null,
      currentHash: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-model-budget-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        enableWorkflowsV1: true,
        readiness_engine_v7: true,
        orchestration_v7: true,
      });
      f = await seedV5Presences(db);
      price = tariff();
      currentHash = authorityHash;
      const [task] = await db
        .insert(issues)
        .values({
          companyId: f.home,
          title: "Private cost-boundary fixture",
          assigneeAgentId: f.presence.id,
          status: "todo",
        })
        .returning();
      plan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: task!.id,
        expectedIssueUpdatedAt: task!.updatedAt.toISOString(),
        riskClass: "C0",
        workload: "semantic",
        completionContract: {
          objective: "Save a current authorized draft",
          requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Keep claims bound to current authorized sources"],
        },
        budgets: { maxModelCostMinor: 50 },
        workers: [{ key: "worker", issueId: task!.id }],
      });
    });
    const service = () =>
      modelReservationService(db, {
        sourceSha,
        qualifiedTariff: async () => price,
        currentAuthority: async () => currentHash,
      });
    const request = (idempotencyKey = "fixture-reservation") => ({
      companyId: f.home,
      planId: plan.id,
      expectedPlanVersion: plan.version,
      purpose: "worker_model" as const,
      idempotencyKey,
      inputHash: "d".repeat(64),
      authorityHash,
      inputTokensUpperBound: 1,
      maxOutputTokens: 1,
    });
    async function dispatchFixturePlan() {
      // Only a local native-DB fixture enters running here. Production plan start
      // remains closed until every actual worker model call uses a qualified broker.
      await db
        .update(orchestrationPlans)
        .set({
          status: "running",
          startedAt: new Date(),
          executionPrincipal: { type: "user", userId: f.userId },
        })
        .where(eq(orchestrationPlans.id, plan.id));
    }
    it("serializes concurrent reservations before spend and debits the native counter exactly once", async () => {
      const broker = service(),
        outcomes = await Promise.allSettled([
          broker.reserve(f.actor, request("first")),
          broker.reserve(f.actor, request("second")),
        ]);
      expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((v) => v.status === "rejected")).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.modelCostReserved,
      ).toBe(30);
      const rows = await db
        .select()
        .from(orchestrationModelReservations)
        .where(eq(orchestrationModelReservations.planId, plan.id));
      expect(rows).toHaveLength(1);
      expect(
        (await broker.reserve(f.actor, request(rows[0]!.idempotencyKey))).id,
      ).toBe(rows[0]!.id);
      await expect(
        broker.reserve(f.actor, {
          ...request(rows[0]!.idempotencyKey),
          inputHash: "e".repeat(64),
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("requires a current price ceiling, original principal and current source at preflight", async () => {
      price = null;
      await expect(service().reserve(f.actor, request())).rejects.toMatchObject(
        { status: 403 },
      );
      price = tariff();
      currentHash = "f".repeat(64);
      await expect(service().reserve(f.actor, request())).rejects.toMatchObject(
        { status: 409 },
      );
      currentHash = authorityHash;
      await db
        .delete(companyMemberships)
        .where(eq(companyMemberships.companyId, f.home));
      await expect(service().reserve(f.actor, request())).rejects.toMatchObject(
        { status: 403 },
      );
      expect(
        await db
          .select()
          .from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.planId, plan.id)),
      ).toHaveLength(0);
    });
    it("rechecks price and source before a single irreversible dispatch claim", async () => {
      const broker = service(),
        reservation = await broker.reserve(f.actor, request());
      await dispatchFixturePlan();
      currentHash = "f".repeat(64);
      await expect(
        broker.claimForDispatch(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 409 });
      currentHash = authorityHash;
      const originalPrice = price;
      price = { ...price!, inputMinorPerMillion: 31000000 };
      await expect(
        broker.claimForDispatch(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 409 });
      price = originalPrice;
      const outcomes = await Promise.allSettled([
        broker.claimForDispatch(f.actor, f.home, reservation.id),
        broker.claimForDispatch(f.actor, f.home, reservation.id),
      ]);
      expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((v) => v.status === "rejected")).toHaveLength(1);
      await broker.recordOutcome(f.home, reservation.id, {
        status: "completed",
        providerResponseHash: "e".repeat(64),
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      await expect(
        broker.claimForDispatch(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.status,
      ).toBe("running");
    });
    it("retains the entire debit after unknown dispatch or expired preflight, without reopening retry spend", async () => {
      const broker = service(),
        reservation = await broker.reserve(f.actor, request());
      await dispatchFixturePlan();
      await broker.claimForDispatch(f.actor, f.home, reservation.id);
      await broker.expire(new Date(Date.now() + 60001));
      expect(
        (
          await db
            .select()
            .from(orchestrationModelReservations)
            .where(eq(orchestrationModelReservations.id, reservation.id))
        )[0]?.status,
      ).toBe("unknown");
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]?.modelCostReserved,
      ).toBe(30);
      await expect(
        broker.reserve(f.actor, request("retry")),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        db
          .update(orchestrationModelReservations)
          .set({ status: "reserved" })
          .where(eq(orchestrationModelReservations.id, reservation.id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(orchestrationPlans)
          .set({ modelCostReserved: 0 })
          .where(eq(orchestrationPlans.id, plan.id)),
      ).rejects.toThrow();
      await expect(
        db
          .delete(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.id, reservation.id)),
      ).rejects.toThrow();
    });
    it("blocks authority loss between reservation and dispatch while keeping immutable financial metadata", async () => {
      const broker = service(),
        reservation = await broker.reserve(f.actor, request());
      await dispatchFixturePlan();
      await instanceSettingsService(db).updateExperimental({
        orchestration_v7: false,
      });
      await expect(
        broker.claimForDispatch(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 404 });
      await broker.expire(new Date(Date.now() + 60001));
      expect(
        (
          await db
            .select()
            .from(orchestrationModelReservations)
            .where(eq(orchestrationModelReservations.id, reservation.id))
        )[0]?.status,
      ).toBe("cancelled");
      await expect(
        db
          .update(orchestrationModelReservations)
          .set({ maximumMinor: 0 })
          .where(eq(orchestrationModelReservations.id, reservation.id)),
      ).rejects.toThrow();
    });
  },
);
