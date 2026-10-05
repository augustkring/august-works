import { and, eq, inArray, lte } from "drizzle-orm";
import {
  issues,
  orchestrationPlans,
  orchestrationModelReservations,
  type Db,
} from "@paperclipai/db";
import {
  modelTariffCeilingSchema,
  modelReservationQuoteSchema,
  type ModelTariffCeiling,
  type ModelReservationQuote,
} from "@paperclipai/shared";
import { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { conflict, forbidden, notFound } from "../../errors.js";

export function quoteModelReservation(
  input: {
    tariff: ModelTariffCeiling;
    sourceSha: string;
    inputTokensUpperBound: number;
    maxOutputTokens: number;
  },
  now = new Date(),
): ModelReservationQuote {
  const tariff = modelTariffCeilingSchema.parse(input.tariff);
  const testedAt = Date.parse(tariff.testedAt),
    expiresAt = Date.parse(tariff.expiresAt);
  if (
    tariff.sourceSha !== input.sourceSha ||
    testedAt > now.getTime() ||
    expiresAt <= now.getTime() ||
    expiresAt <= testedAt ||
    expiresAt - testedAt > 86400000 ||
    !Number.isSafeInteger(input.inputTokensUpperBound) ||
    input.inputTokensUpperBound < 1 ||
    input.inputTokensUpperBound > 2000000 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 65536
  )
    throw conflict(
      "Current qualified model price ceiling and bounded token envelope are required",
    );
  const metered =
    BigInt(input.inputTokensUpperBound) * BigInt(tariff.inputMinorPerMillion) +
    BigInt(input.maxOutputTokens) * BigInt(tariff.outputMinorPerMillion);
  const maximumMinor =
    BigInt(tariff.fixedMinor) + (metered + 999999n) / 1000000n;
  if (maximumMinor > 1000000n)
    throw forbidden(
      "The maximum model charge exceeds the plan's supported budget envelope",
    );
  return modelReservationQuoteSchema.parse({
    version: 1,
    provider: tariff.provider,
    model: tariff.model,
    currency: tariff.currency,
    inputTokensUpperBound: input.inputTokensUpperBound,
    maxOutputTokens: input.maxOutputTokens,
    maximumMinor: Number(maximumMinor),
    tariffHash: nativeSha256(tariff),
    qualificationHash: tariff.qualificationHash,
    sourceSha: tariff.sourceSha,
    expiresAt: tariff.expiresAt,
  });
}

const requestSchema = z
  .object({
    companyId: z.string().uuid(),
    planId: z.string().uuid(),
    expectedPlanVersion: z.number().int().positive(),
    purpose: z.enum([
      "worker_model",
      "read_only_verification",
      "read_only_trajectory",
    ]),
    workerId: z.string().uuid().nullable().default(null),
    workerAttemptId: z.string().uuid().nullable().default(null),
    idempotencyKey: z.string().min(1).max(200),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    authorityHash: z.string().regex(/^[a-f0-9]{64}$/),
    inputTokensUpperBound: z.number().int().min(1).max(2000000),
    maxOutputTokens: z.number().int().min(1).max(65536),
  })
  .strict();
type Request = z.input<typeof requestSchema>;
type Reservation = typeof orchestrationModelReservations.$inferSelect;
/** Internal broker primitive, not an HTTP quote endpoint. The caller cannot
 * choose a tariff or mint a provider qualification. SDK dispatch must separately
 * consume a reservation and its current original principal/source authority. */
export function modelReservationService(
  db: Db,
  options: {
    sourceSha: string;
    qualifiedTariff(
      input: { companyId: string; planId: string; purpose: Request["purpose"] },
      now: Date,
    ): Promise<ModelTariffCeiling | null>;
    currentAuthority(
      tx: Db,
      actor: AuthorizationActor,
      input: {
        companyId: string;
        planId: string;
        purpose: Request["purpose"];
        workerId: string | null;
        workerAttemptId: string | null;
      },
    ): Promise<string>;
  },
) {
  async function authority(
    tx: Db,
    actor: AuthorizationActor,
    companyId: string,
    planId: string,
    expectedVersion: number | null,
    dispatch: boolean,
    purpose: Request["purpose"],
    now: Date,
  ) {
    const userId = v7HumanActorId(actor);
    await assertV7Enabled(tx, "orchestration_v7");
    if (purpose === "read_only_verification")
      await assertV7Enabled(tx, "verifier_v7");
    if (purpose === "read_only_trajectory")
      await assertV7Enabled(tx, "supervision_v7");
    await assertV7Authorization(tx, actor, companyId, "company_scope:read");
    const [plan] = await tx
      .select()
      .from(orchestrationPlans)
      .where(
        and(
          eq(orchestrationPlans.companyId, companyId),
          eq(orchestrationPlans.id, planId),
        ),
      )
      .for("update");
    if (!plan || plan.erasedAt)
      throw notFound("Current model budget plan not found");
    const originalUserId =
      plan.executionPrincipal?.type === "user"
        ? plan.executionPrincipal.userId
        : !plan.executionPrincipal
          ? plan.createdBy
          : null;
    if (
      originalUserId !== userId ||
      (expectedVersion !== null && plan.version !== expectedVersion) ||
      ["completed", "cancelled", "failed"].includes(plan.status) ||
      (dispatch && !["running", "paused", "verifying"].includes(plan.status)) ||
      (dispatch && purpose === "worker_model" && plan.status !== "running") ||
      plan.riskClass === "C4"
    )
      throw forbidden(
        "Current initiating human and eligible plan are required for model spend",
      );
    if (plan.budgets.maxModelCostMinor === null)
      throw forbidden("Explicit model cost cap required for this broker");
    if (
      plan.startedAt &&
      now.getTime() >=
        plan.startedAt.getTime() + plan.budgets.maxWallClockSeconds * 1000
    )
      throw forbidden("The original model execution deadline expired");
    const [task] = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, plan.issueId)))
      .for("share");
    if (!task || task.hiddenAt || ["done", "cancelled"].includes(task.status))
      throw forbidden("Current canonical Task required for model spend");
    await assertV7Authorization(tx, actor, companyId, "issue:mutate", {
      type: "issue",
      companyId,
      issueId: task.id,
      projectId: task.projectId,
      parentIssueId: task.parentId,
      assigneeAgentId: task.assigneeAgentId,
      assigneeUserId: task.assigneeUserId,
      status: task.status,
    });
    return { plan, userId };
  }
  async function freshQuote(
    input: {
      companyId: string;
      planId: string;
      purpose: Request["purpose"];
      inputTokensUpperBound: number;
      maxOutputTokens: number;
    },
    now: Date,
  ) {
    const tariff = await options.qualifiedTariff(input, now);
    if (!tariff)
      throw forbidden("No current native model price ceiling is qualified");
    return quoteModelReservation(
      {
        tariff,
        sourceSha: options.sourceSha,
        inputTokensUpperBound: input.inputTokensUpperBound,
        maxOutputTokens: input.maxOutputTokens,
      },
      now,
    );
  }
  return {
    async reserve(actor: AuthorizationActor, raw: Request, now = new Date()) {
      const input = requestSchema.parse(raw),
        quote = await freshQuote(input, now);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, input.companyId);
        const { plan, userId } = await authority(
          tx,
          actor,
          input.companyId,
          input.planId,
          input.expectedPlanVersion,
          false,
          input.purpose,
          now,
        );
        if (
          (await options.currentAuthority(tx, actor, input)) !==
          input.authorityHash
        )
          throw conflict(
            "Model source or principal authority changed before reservation",
          );
        const requestHash = nativeSha256({
          ...input,
          principalUserId: userId,
          quote,
        });
        const [existing] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(
            and(
              eq(orchestrationModelReservations.companyId, input.companyId),
              eq(orchestrationModelReservations.planId, input.planId),
              eq(
                orchestrationModelReservations.idempotencyKey,
                input.idempotencyKey,
              ),
            ),
          );
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw conflict(
              "Model reservation key belongs to different immutable inputs",
            );
          return existing;
        }
        if (
          plan.modelCostReserved + quote.maximumMinor >
          plan.budgets.maxModelCostMinor!
        )
          throw forbidden("Cumulative model reservation budget exhausted");
        const expiresAt = new Date(
          Math.min(
            Date.parse(quote.expiresAt),
            now.getTime() + 300000,
            plan.startedAt
              ? plan.startedAt.getTime() +
                  plan.budgets.maxWallClockSeconds * 1000
              : Infinity,
          ),
        );
        const [reservation] = await tx
          .insert(orchestrationModelReservations)
          .values({
            companyId: input.companyId,
            planId: input.planId,
            workerId: input.workerId,
            workerAttemptId: input.workerAttemptId,
            purpose: input.purpose,
            principalUserId: userId,
            idempotencyKey: input.idempotencyKey,
            inputHash: input.inputHash,
            authorityHash: input.authorityHash,
            requestHash,
            quote,
            maximumMinor: quote.maximumMinor,
            expiresAt,
            createdAt: now,
          })
          .returning();
        // The native INSERT trigger charges the existing plan counter atomically.
        await logActivity(
          tx,
          {
            companyId: input.companyId,
            actorType: "user",
            actorId: userId,
            action: "orchestration.model_reserved",
            entityType: "orchestration_plan",
            entityId: plan.id,
            details: {
              reservationId: reservation!.id,
              purpose: input.purpose,
              maximumMinor: quote.maximumMinor,
              currency: quote.currency,
              tariffHash: quote.tariffHash,
            },
          },
          publications,
        );
        return reservation!;
      });
    },
    async claimForDispatch(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      now = new Date(),
    ): Promise<Reservation> {
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId);
        const [initial] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(
            and(
              eq(orchestrationModelReservations.companyId, companyId),
              eq(orchestrationModelReservations.id, id),
            ),
          );
        if (!initial) throw notFound("Model reservation not found");
        const { plan, userId } = await authority(
          tx,
          actor,
          companyId,
          initial.planId,
          null,
          true,
          initial.purpose,
          now,
        );
        const [record] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.id, initial.id))
          .for("update");
        if (
          !record ||
          record.status !== "reserved" ||
          record.expiresAt <= now ||
          record.principalUserId !== userId
        )
          throw conflict("This reservation cannot dispatch again");
        const quote = await freshQuote(
          {
            companyId,
            planId: plan.id,
            purpose: record.purpose,
            inputTokensUpperBound: record.quote.inputTokensUpperBound,
            maxOutputTokens: record.quote.maxOutputTokens,
          },
          now,
        );
        if (
          nativeSha256(quote) !== nativeSha256(record.quote) ||
          (await options.currentAuthority(tx, actor, record)) !==
            record.authorityHash
        )
          throw conflict(
            "Model tariff, source or principal authority changed before dispatch",
          );
        const [dispatched] = await tx
          .update(orchestrationModelReservations)
          .set({ status: "dispatched", dispatchedAt: now })
          .where(eq(orchestrationModelReservations.id, id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "orchestration.model_dispatch_claimed",
            entityType: "orchestration_plan",
            entityId: plan.id,
            details: { reservationId: id, maximumMinor: record.maximumMinor },
          },
          publications,
        );
        return dispatched!;
      });
    },
    async recordOutcome(
      companyId: string,
      id: string,
      raw: {
        status: "completed" | "failed" | "unknown";
        providerResponseHash: string | null;
        usage: { inputTokens: number; outputTokens: number } | null;
      },
      now = new Date(),
    ) {
      const input = z
        .object({
          status: z.enum(["completed", "failed", "unknown"]),
          providerResponseHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          usage: z
            .object({
              inputTokens: z.number().int().nonnegative(),
              outputTokens: z.number().int().nonnegative(),
            })
            .strict()
            .nullable(),
        })
        .strict()
        .parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [record] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(
            and(
              eq(orchestrationModelReservations.companyId, companyId),
              eq(orchestrationModelReservations.id, id),
            ),
          )
          .for("update");
        if (!record || record.status !== "dispatched")
          throw conflict(
            "Only an unreconciled dispatch may record a model outcome",
          );
        const exceedsQuote =
          input.usage &&
          (input.usage.inputTokens > record.quote.inputTokensUpperBound ||
            input.usage.outputTokens > record.quote.maxOutputTokens);
        const [updated] = await tx
          .update(orchestrationModelReservations)
          .set({
            ...input,
            status: exceedsQuote ? "unknown" : input.status,
            completedAt: now,
          })
          .where(eq(orchestrationModelReservations.id, id))
          .returning();
        await logActivity(
          tx,
          {
            companyId,
            actorType: "system",
            actorId: "model-broker",
            action: "orchestration.model_outcome_recorded",
            entityType: "orchestration_plan",
            entityId: record.planId,
            details: {
              reservationId: id,
              status: updated!.status,
              pricingEnvelopeExceeded: Boolean(exceedsQuote),
              maximumMinor: record.maximumMinor,
            },
          },
          publications,
        );
        return updated!;
      });
    },
    async expire(now = new Date()) {
      // Unknown dispatch retains its complete debit; neither a timeout nor a
      // cancelled preflight proves that provider billing is refundable.
      const reserved = await db
        .update(orchestrationModelReservations)
        .set({ status: "cancelled", completedAt: now })
        .where(
          and(
            eq(orchestrationModelReservations.status, "reserved"),
            lte(orchestrationModelReservations.expiresAt, now),
          ),
        )
        .returning({ id: orchestrationModelReservations.id });
      const dispatched = await db
        .update(orchestrationModelReservations)
        .set({ status: "unknown", completedAt: now })
        .where(
          and(
            eq(orchestrationModelReservations.status, "dispatched"),
            lte(orchestrationModelReservations.expiresAt, now),
          ),
        )
        .returning({ id: orchestrationModelReservations.id });
      return { cancelled: reserved.length, unknown: dispatched.length };
    },
  };
}
