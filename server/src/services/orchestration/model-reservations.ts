import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  issues,
  companies,
  orchestrationPlans,
  orchestrationModelReservations,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  orchestrationCompanyPurposeBudgets,
  orchestrationCompanyPurposeReservations,
  costEvents,
  agentConfigurationTests,
  heartbeatRuns,
  type Db,
} from "@paperclipai/db";
import {
  modelTariffCeilingSchema,
  modelReservationQuoteSchema,
  type ModelTariffCeiling,
  type ModelReservationQuote,
  companyPurposeFundingSchema,
  companyPurposeReservationInputSchema,
  type CompanyPurposeFunding,
} from "@paperclipai/shared";
import { z } from "zod";
import type { AuthorizationActor } from "../authorization.js";
import {
  assertV7Authorization,
  assertV7Enabled,
  v7HumanActorId,
} from "../v7-authorization.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { assertFirstPartySupportRelease, assertFirstPartySupportReservation } from "../agent-packages/execution-gate.js";
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
      "provider_conformance",
      "agent_safe_test",
      "decision_shadow",
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
const conversationRequestSchema = z.object({
  companyId: z.string().uuid(), conversationAgentId: z.string().uuid(), conversationRunId: z.string().uuid(),
  conversationIssueId: z.string().uuid(), conversationSessionGeneration: z.number().int().nonnegative(),
  executionManifestId: z.string().uuid(), executionManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(1).max(200), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  authorityHash: z.string().regex(/^[a-f0-9]{64}$/), inputTokensUpperBound: z.number().int().min(1).max(2000000),
  maxOutputTokens: z.number().int().min(1).max(65536),
}).strict();
type ConversationRequest = z.infer<typeof conversationRequestSchema>;
type Reservation = typeof orchestrationModelReservations.$inferSelect;
type CompanyPurposeRequest = z.infer<typeof companyPurposeReservationInputSchema>;
type CompanyPurposeReservation = typeof orchestrationCompanyPurposeReservations.$inferSelect;
type CompanyPurposeDispatchClaim = {
  reservation: CompanyPurposeReservation;
  funding: Pick<CompanyPurposeFunding,
    "funder" | "profileId" | "providerAccountId" | "credentialBindingHash" | "profileHash" | "tariff">;
};
type VerifiedLateCompanyPurposeOutcome = {
  companyId: string;
  reservationId: string;
  inputHash: string;
  authorityHash: string;
  profileHash: string;
  providerAccountId: string;
  credentialBindingHash: string;
  quoteHash: string;
  status: "completed" | "failed";
  providerResponseHash: string;
  usage: { inputTokens: number; outputTokens: number };
};

function companyPurposeProfileHash(input: CompanyPurposeFunding) {
  const { profileHash: _profileHash, ...immutableContract } = input;
  return nativeSha256(immutableContract);
}

/** Company deletion must not cascade away in-flight or uncertain platform
 * funding obligations. Budget/ledger FKs also hard-restrict deletion. */
export async function assertCompanyPurposeFundingQuiescent(db: Db, companyId: string) {
  const [row] = await db.select({ id: orchestrationCompanyPurposeReservations.id })
    .from(orchestrationCompanyPurposeReservations)
    .where(and(
      eq(orchestrationCompanyPurposeReservations.companyId, companyId),
      inArray(orchestrationCompanyPurposeReservations.status, ["reserved", "dispatched", "unknown"]),
    )).limit(1);
  if (row) throw conflict("Company offboarding is blocked while platform-funded model outcomes are unresolved");
}
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
    qualifiedConversationTariff?(
      input: { companyId: string; agentId: string; runId: string },
      now: Date,
    ): Promise<ModelTariffCeiling | null>;
    currentConversationAuthority?(
      tx: Db,
      actor: AuthorizationActor,
      input: ConversationRequest,
    ): Promise<string>;
    /** Private operator registry only. No customer-facing API supplies this
     * funding contract; a missing profile means taskless support inference is
     * unavailable. */
    qualifiedCompanyPurposeFunding?(
      input: { companyId: string; purpose: CompanyPurposeRequest["purpose"] },
      now: Date,
    ): CompanyPurposeFunding | null;
    /** Exact deployment-owned first-party package release. Required only for Support. */
    firstPartySupportVersionId?: string;
    /** Original support caller resolves current readable source authority under
     * this transaction. This server-held callback is required for taskless use. */
    currentCompanyPurposeAuthority?(
      tx: Db,
      actor: AuthorizationActor,
      input: CompanyPurposeRequest,
    ): Promise<string>;
    /** Trusted provider/account owner lookup for a late result to the exact
     * acknowledged request. No request or response body is accepted here. */
    reconcileCompanyPurposeOutcome?(
      tx: Db,
      input: {
        reservation: CompanyPurposeReservation;
        funding: typeof orchestrationCompanyPurposeBudgets.$inferSelect;
      },
    ): Promise<VerifiedLateCompanyPurposeOutcome | null>;
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
    workerId: string | null,
    workerAttemptId: string | null,
    now: Date,
  ) {
    let userId: string;
    if (purpose === "decision_shadow" && actor.type === "agent") {
      if (!actor.agentId || !actor.runId || actor.companyId !== companyId) throw forbidden("A current Agent run is required for shadow decisions");
      const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId),
        eq(heartbeatRuns.agentId, actor.agentId), eq(heartbeatRuns.status, "running"))).for("share");
      if (!run?.responsibleUserId || actor.onBehalfOfUserId !== run.responsibleUserId) throw forbidden("The current persisted run Human is required for shadow decisions");
      const [attempt] = await tx.select({ id: orchestrationWorkerAttempts.id, workerId: orchestrationWorkerAttempts.workerId }).from(orchestrationWorkerAttempts)
        .innerJoin(orchestrationWorkers, and(eq(orchestrationWorkers.companyId, orchestrationWorkerAttempts.companyId), eq(orchestrationWorkers.planId, orchestrationWorkerAttempts.planId), eq(orchestrationWorkers.id, orchestrationWorkerAttempts.workerId)))
        .where(and(eq(orchestrationWorkerAttempts.companyId, companyId), eq(orchestrationWorkerAttempts.planId, planId), eq(orchestrationWorkerAttempts.agentId, actor.agentId),
          eq(orchestrationWorkerAttempts.runId, run.id), eq(orchestrationWorkerAttempts.status, "running"), workerId ? eq(orchestrationWorkerAttempts.workerId, workerId) : undefined,
          workerAttemptId ? eq(orchestrationWorkerAttempts.id, workerAttemptId) : undefined)).for("share");
      if (!attempt) throw forbidden("The Agent run is not the active Worker attempt for this plan");
      userId = run.responsibleUserId;
    } else userId = v7HumanActorId(actor);
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
      (dispatch && ["worker_model", "decision_shadow"].includes(purpose) && plan.status !== "running") ||
      plan.riskClass === "C4"
    )
      throw forbidden(
        "Current initiating human and eligible plan are required for model spend",
      );
    if (["worker_model", "decision_shadow"].includes(purpose) && plan.budgets.maxModelCostMinor === null)
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
    const conformance = purpose === "provider_conformance";
    const authoringTest = purpose === "agent_safe_test";
    if (authoringTest) {
      const [test] = await tx.select().from(agentConfigurationTests).where(and(eq(agentConfigurationTests.companyId, companyId), eq(agentConfigurationTests.planId, planId)));
      if (!test || test.createdByUserId !== userId || task?.harnessKind !== "agent_safe_test" || plan.status !== "paused" ||
        plan.actionClass !== "internal_draft" || plan.riskClass !== "C0" || !plan.startedAt || plan.budgets.maxToolActions !== 0 || plan.executionPrincipal?.type !== "user")
        throw forbidden("Representative tests require their original paused, tool-free candidate harness");
    }
    if (conformance && (!task?.hiddenAt || task.harnessKind !== "provider_conformance" ||
        plan.status !== "paused" || plan.actionClass !== "internal_draft" || plan.riskClass !== "C0" ||
        !plan.startedAt || plan.budgets.maxToolActions !== 0 || plan.executionPrincipal?.type !== "user"))
      throw forbidden("Provider probes require their private paused tool-free harness");
    if (!task || (task.hiddenAt && !conformance && !authoringTest) || ["done", "cancelled"].includes(task.status))
      throw forbidden("Current canonical Task required for model spend");
    await assertV7Authorization(tx, actor, companyId, purpose === "decision_shadow" ? "issue:read" : "issue:mutate", {
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
  async function freshConversationQuote(input: ConversationRequest, now: Date) {
    if (!options.qualifiedConversationTariff) throw forbidden("Native conversation model pricing is not configured");
    const tariff = await options.qualifiedConversationTariff({
      companyId: input.companyId, agentId: input.conversationAgentId, runId: input.conversationRunId,
    }, now);
    if (!tariff) throw forbidden("No current Native conversation model price ceiling is qualified");
    return { tariff, quote: quoteModelReservation({ tariff, sourceSha: options.sourceSha,
      inputTokensUpperBound: input.inputTokensUpperBound, maxOutputTokens: input.maxOutputTokens }, now) };
  }
  function freshCompanyPurposeFunding(
    input: CompanyPurposeRequest,
    now: Date,
  ) {
    if (!options.qualifiedCompanyPurposeFunding) {
      throw forbidden("Company-purpose model funding is not configured");
    }
    const raw = options.qualifiedCompanyPurposeFunding(
      { companyId: input.companyId, purpose: input.purpose },
      now,
    );
    if (!raw) throw forbidden("No current company-purpose funding profile is qualified");
    const funding = companyPurposeFundingSchema.parse(raw);
    if (
      funding.companyId !== input.companyId ||
      funding.purpose !== input.purpose ||
      ((input.purpose === "first_party_support") !== (funding.funder === "blentera_platform")) ||
      funding.profileHash !== companyPurposeProfileHash(funding) ||
      funding.tariff.sourceSha !== options.sourceSha ||
      Date.parse(funding.periodStartsAt) > now.getTime() ||
      Date.parse(funding.periodEndsAt) <= now.getTime() ||
      Date.parse(funding.periodEndsAt) - Date.parse(funding.periodStartsAt) >
        366 * 24 * 60 * 60 * 1000
    ) {
      throw forbidden("The current company-purpose funding contract is invalid or expired");
    }
    const quote = quoteModelReservation(
      {
        tariff: funding.tariff,
        sourceSha: options.sourceSha,
        inputTokensUpperBound: input.inputTokensUpperBound,
        maxOutputTokens: input.maxOutputTokens,
      },
      now,
    );
    if (quote.maximumMinor > funding.maxCostMinor) {
      throw forbidden("The call exceeds its company-purpose budget period");
    }
    return { funding, quote };
  }
  async function assertCompanyPurposeAuthority(
    tx: Db,
    actor: AuthorizationActor,
    input: CompanyPurposeRequest,
  ) {
    if (!options.currentCompanyPurposeAuthority) {
      throw forbidden("Current company-purpose source authority is unavailable");
    }
    const userId = v7HumanActorId(actor);
    await assertV7Enabled(tx, "orchestration_v7");
    const [company] = await tx.select({ id: companies.id, status: companies.status })
      .from(companies).where(eq(companies.id, input.companyId)).for("share");
    if (!company || company.status !== "active") {
      throw forbidden("Company support is unavailable during offboarding");
    }
    await assertV7Authorization(tx, actor, input.companyId, "company_scope:read");
    const authorityHash = await options.currentCompanyPurposeAuthority(tx, actor, input);
    if (authorityHash !== input.authorityHash) {
      throw conflict("Company-purpose source or principal authority changed");
    }
    return userId;
  }
  async function ensureCompanyPurposeBudget(
    tx: Db,
    funding: CompanyPurposeFunding,
  ) {
    await tx.insert(orchestrationCompanyPurposeBudgets).values({
      companyId: funding.companyId,
      purpose: funding.purpose,
      funder: funding.funder,
      profileId: funding.profileId,
      profileHash: funding.profileHash,
      providerAccountId: funding.providerAccountId,
      credentialBindingHash: funding.credentialBindingHash,
      periodKey: funding.periodKey,
      periodStartsAt: new Date(funding.periodStartsAt),
      periodEndsAt: new Date(funding.periodEndsAt),
      provider: funding.tariff.provider,
      model: funding.tariff.model,
      sourceSha: funding.tariff.sourceSha,
      qualificationHash: funding.tariff.qualificationHash,
      tariffHash: nativeSha256(funding.tariff),
      maxCostMinor: funding.maxCostMinor,
      maxCalls: funding.maxCalls,
    }).onConflictDoNothing({
      target: [
        orchestrationCompanyPurposeBudgets.companyId,
        orchestrationCompanyPurposeBudgets.purpose,
        orchestrationCompanyPurposeBudgets.profileId,
        orchestrationCompanyPurposeBudgets.periodKey,
      ],
    });
    const [budget] = await tx.select().from(orchestrationCompanyPurposeBudgets).where(and(
      eq(orchestrationCompanyPurposeBudgets.companyId, funding.companyId),
      eq(orchestrationCompanyPurposeBudgets.purpose, funding.purpose),
      eq(orchestrationCompanyPurposeBudgets.profileId, funding.profileId),
      eq(orchestrationCompanyPurposeBudgets.periodKey, funding.periodKey),
    )).for("update");
    if (!budget ||
      budget.purpose !== funding.purpose || budget.funder !== funding.funder || budget.profileHash !== funding.profileHash ||
      budget.providerAccountId !== funding.providerAccountId ||
      budget.credentialBindingHash !== funding.credentialBindingHash ||
      budget.periodStartsAt.getTime() !== Date.parse(funding.periodStartsAt) ||
      budget.periodEndsAt.getTime() !== Date.parse(funding.periodEndsAt) ||
      budget.provider !== funding.tariff.provider || budget.model !== funding.tariff.model ||
      budget.sourceSha !== funding.tariff.sourceSha ||
      budget.qualificationHash !== funding.tariff.qualificationHash ||
      budget.tariffHash !== nativeSha256(funding.tariff) ||
      budget.maxCostMinor !== funding.maxCostMinor || budget.maxCalls !== funding.maxCalls) {
      throw conflict("The company-purpose funding period changed after reservations were recorded");
    }
    return budget;
  }
  return {
    async reserveCompanyPurpose(
      actor: AuthorizationActor,
      raw: CompanyPurposeRequest,
      now = new Date(),
    ): Promise<CompanyPurposeReservation> {
      const input = companyPurposeReservationInputSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, input.companyId);
        await lockMemoryPrivacy(tx, input.companyId);
        const userId = await assertCompanyPurposeAuthority(tx, actor, input);
        const { funding, quote } = freshCompanyPurposeFunding(input, now);
        const supportPackage = input.purpose === "first_party_support"
          ? await assertFirstPartySupportRelease(tx, options.firstPartySupportVersionId ?? "", funding.tariff.sourceSha, now)
          : null;
        const budget = await ensureCompanyPurposeBudget(tx, funding);
        const requestHash = nativeSha256({
          purpose: input.purpose,
          input,
          principalUserId: userId,
          funding: funding.profileHash,
          packageVersionId: supportPackage?.packageVersionId ?? null,
          quote,
        });
        const [existing] = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, input.companyId),
          eq(orchestrationCompanyPurposeReservations.idempotencyKey, input.idempotencyKey),
        ));
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw conflict("Company-purpose reservation key belongs to different immutable inputs");
          }
          return existing;
        }
        if (budget.reservedMinor + quote.maximumMinor > budget.maxCostMinor ||
          budget.reservedCalls + 1 > budget.maxCalls) {
          throw forbidden("The company-purpose budget period is exhausted");
        }
        const expiresAt = new Date(Math.min(
          Date.parse(quote.expiresAt),
          now.getTime() + 300_000,
          funding.periodEndsAt ? Date.parse(funding.periodEndsAt) : Infinity,
        ));
        if (expiresAt <= now) throw forbidden("The company-purpose reservation period has expired");
        const [reservation] = await tx.insert(orchestrationCompanyPurposeReservations).values({
          companyId: input.companyId,
          budgetId: budget.id,
          purpose: input.purpose,
          packageVersionId: supportPackage?.packageVersionId ?? null,
          principalUserId: userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          inputHash: input.inputHash,
          authorityHash: input.authorityHash,
          quote,
          maximumMinor: quote.maximumMinor,
          expiresAt,
          createdAt: now,
        }).returning();
        await logActivity(tx, {
          companyId: input.companyId,
          actorType: "user",
          actorId: userId,
          action: "orchestration.company_purpose_model_reserved",
          entityType: "company",
          entityId: input.companyId,
          details: {
            reservationId: reservation!.id,
            purpose: input.purpose,
            funder: funding.funder,
            maximumMinor: quote.maximumMinor,
            currency: quote.currency,
            tariffHash: quote.tariffHash,
          },
        }, publications);
        await assertCompanyPurposeAuthority(tx, actor, input);
        return reservation!;
      });
    },
    async claimCompanyPurposeForDispatch(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      now = new Date(),
    ): Promise<CompanyPurposeDispatchClaim> {
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId);
        await lockMemoryPrivacy(tx, companyId);
        const [initial] = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          eq(orchestrationCompanyPurposeReservations.id, id),
        ));
        if (!initial) throw notFound("Company-purpose model reservation not found");
        const input: CompanyPurposeRequest = {
          companyId,
          purpose: initial.purpose,
          idempotencyKey: initial.idempotencyKey,
          inputHash: initial.inputHash,
          authorityHash: initial.authorityHash,
          inputTokensUpperBound: initial.quote.inputTokensUpperBound,
          maxOutputTokens: initial.quote.maxOutputTokens,
        };
        const userId = await assertCompanyPurposeAuthority(tx, actor, input);
        if (initial.principalUserId !== userId) throw forbidden("Original company-purpose principal required");
        const { funding, quote } = freshCompanyPurposeFunding(input, now);
        if (input.purpose === "first_party_support") await assertFirstPartySupportReservation(
          tx, companyId, initial.id, options.firstPartySupportVersionId ?? "", funding.tariff.sourceSha, now,
        );
        const budget = await ensureCompanyPurposeBudget(tx, funding);
        if (budget.id !== initial.budgetId) throw conflict("The company-purpose funding profile changed before dispatch");
        const [record] = await tx.select().from(orchestrationCompanyPurposeReservations).where(eq(
          orchestrationCompanyPurposeReservations.id,
          initial.id,
        )).for("update");
        if (!record || record.status !== "reserved" || record.expiresAt <= now) {
          throw conflict("This company-purpose reservation cannot dispatch again");
        }
        if (nativeSha256(quote) !== nativeSha256(record.quote)) {
          throw conflict("Company-purpose funding tariff or profile changed before dispatch");
        }
        const [dispatched] = await tx.update(orchestrationCompanyPurposeReservations)
          .set({ status: "dispatched", dispatchedAt: now })
          .where(eq(orchestrationCompanyPurposeReservations.id, id))
          .returning();
        await logActivity(tx, {
          companyId,
          actorType: "user",
          actorId: userId,
          action: "orchestration.company_purpose_model_dispatch_claimed",
          entityType: "company",
          entityId: companyId,
          details: { reservationId: id, purpose: input.purpose, maximumMinor: record.maximumMinor },
        }, publications);
        await assertCompanyPurposeAuthority(tx, actor, input);
        if (input.purpose === "first_party_support") await assertFirstPartySupportReservation(
          tx, companyId, id, options.firstPartySupportVersionId ?? "", funding.tariff.sourceSha, now,
        );
        return {
          reservation: dispatched!,
          funding: {
            funder: funding.funder,
            profileId: funding.profileId,
            providerAccountId: funding.providerAccountId,
            credentialBindingHash: funding.credentialBindingHash,
            profileHash: funding.profileHash,
            tariff: funding.tariff,
          },
        };
      });
    },
    async recordCompanyPurposeOutcome(
      companyId: string,
      id: string,
      raw: {
        status: "completed" | "failed" | "unknown";
        providerResponseHash: string | null;
        usage: { inputTokens: number; outputTokens: number } | null;
        accounting?: { actualCostAmount: string | null; costStatus: "reported" | "estimated" | "unpriced" };
      },
      now = new Date(),
    ): Promise<CompanyPurposeReservation> {
      const input = z.object({
        status: z.enum(["completed", "failed", "unknown"]),
        providerResponseHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
        usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict().nullable(),
        accounting: z.object({ actualCostAmount: z.string().regex(/^\d+(?:\.\d{1,7})?(?:[eE][+-]?\d+)?$/).nullable(), costStatus: z.enum(["reported", "estimated", "unpriced"]) }).strict().optional(),
      }).strict().parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [record] = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          eq(orchestrationCompanyPurposeReservations.id, id),
        )).for("update");
        if (!record || record.status !== "dispatched") {
          throw conflict("Only an unreconciled company-purpose dispatch may record an outcome");
        }
        const overQuote = input.usage && (
          input.usage.inputTokens > record.quote.inputTokensUpperBound ||
          input.usage.outputTokens > record.quote.maxOutputTokens
        );
        const [updated] = await tx.update(orchestrationCompanyPurposeReservations).set({
          ...input,
          status: overQuote ? "unknown" : input.status,
          completedAt: now,
        }).where(eq(orchestrationCompanyPurposeReservations.id, id)).returning();
        await logActivity(tx, {
          companyId,
          actorType: "system",
          actorId: "model-broker",
          action: "orchestration.company_purpose_model_outcome_recorded",
          entityType: "company",
          entityId: companyId,
          details: {
            reservationId: id,
            purpose: record.purpose,
            status: updated!.status,
            pricingEnvelopeExceeded: Boolean(overQuote),
            maximumMinor: record.maximumMinor,
            actualCostAmount: input.accounting?.actualCostAmount ?? null,
            costStatus: input.accounting?.costStatus ?? "unpriced",
            debitRetained: true,
          },
        }, publications);
        return updated!;
      });
    },
    /** Reconcile an unknown dispatch only from the original trusted provider
     * account. This never retries the model call and never accepts a supplied
     * usage receipt or caller-created waiver. */
    async reconcileUnknownCompanyPurposeOutcome(
      companyId: string,
      id: string,
      now = new Date(),
    ): Promise<CompanyPurposeReservation> {
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const [record] = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          eq(orchestrationCompanyPurposeReservations.id, id),
        )).for("update");
        if (!record) throw notFound("Company-purpose model reservation not found");
        if (record.status === "completed" || record.status === "failed") return record;
        if (record.status !== "unknown" || record.providerResponseHash !== null || record.usage !== null) {
          throw conflict("This unknown company-purpose outcome has no safely reconcilable original dispatch proof");
        }
        if (!options.reconcileCompanyPurposeOutcome) {
          throw conflict("The original company-purpose provider account cannot prove this dispatch outcome");
        }
        const [funding] = await tx.select().from(orchestrationCompanyPurposeBudgets).where(and(
          eq(orchestrationCompanyPurposeBudgets.companyId, companyId),
          eq(orchestrationCompanyPurposeBudgets.id, record.budgetId),
        )).for("share");
        if (!funding) throw conflict("The original company-purpose funding receipt is unavailable");
        const verified = await options.reconcileCompanyPurposeOutcome(tx, { reservation: record, funding });
        const expected = {
          companyId,
          reservationId: record.id,
          inputHash: record.inputHash,
          authorityHash: record.authorityHash,
          profileHash: funding.profileHash,
          providerAccountId: funding.providerAccountId,
          credentialBindingHash: funding.credentialBindingHash,
          quoteHash: nativeSha256(record.quote),
        };
        if (!verified || Object.entries(expected).some(([key, value]) => verified[key as keyof typeof verified] !== value)) {
          throw conflict("The original provider account has no matching late outcome proof");
        }
        const proof = z.object({
          status: z.enum(["completed", "failed"]),
          providerResponseHash: z.string().regex(/^[a-f0-9]{64}$/),
          usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
        }).strict().parse({
          status: verified.status,
          providerResponseHash: verified.providerResponseHash,
          usage: verified.usage,
        });
        if (proof.usage.inputTokens > record.quote.inputTokensUpperBound || proof.usage.outputTokens > record.quote.maxOutputTokens) {
          throw conflict("The late provider outcome exceeded its immutable token envelope");
        }
        const [updated] = await tx.update(orchestrationCompanyPurposeReservations).set({
          status: proof.status,
          providerResponseHash: proof.providerResponseHash,
          usage: proof.usage,
          completedAt: now,
        }).where(eq(orchestrationCompanyPurposeReservations.id, id)).returning();
        await logActivity(tx, {
          companyId,
          actorType: "system",
          actorId: "model-broker",
          action: "orchestration.company_purpose_unknown_outcome_reconciled",
          entityType: "company",
          entityId: companyId,
          details: { reservationId: id, status: proof.status, debitRetained: true },
        }, publications);
        return updated!;
      });
    },
    /** Final server-side gate before a Support Assistant returns model-derived
     * content. The response body stays outside the financial ledger. */
    async assertCompanyPurposeResponseReturn(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      now = new Date(),
    ): Promise<void> {
      await withV7ActivityTransaction(db, async (tx) => {
        await lockAnalyticalCompany(tx, companyId);
        await lockMemoryPrivacy(tx, companyId);
        const [initial] = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          eq(orchestrationCompanyPurposeReservations.companyId, companyId),
          eq(orchestrationCompanyPurposeReservations.id, id),
        ));
        if (!initial) throw notFound("Company-purpose model reservation not found");
        const input: CompanyPurposeRequest = {
          companyId,
          purpose: initial.purpose,
          idempotencyKey: initial.idempotencyKey,
          inputHash: initial.inputHash,
          authorityHash: initial.authorityHash,
          inputTokensUpperBound: initial.quote.inputTokensUpperBound,
          maxOutputTokens: initial.quote.maxOutputTokens,
        };
        const userId = await assertCompanyPurposeAuthority(tx, actor, input);
        if (initial.principalUserId !== userId) throw forbidden("Original support principal required");
        const { funding, quote } = freshCompanyPurposeFunding(input, now);
        if (input.purpose === "first_party_support") await assertFirstPartySupportReservation(
          tx, companyId, initial.id, options.firstPartySupportVersionId ?? "", funding.tariff.sourceSha, now,
        );
        const budget = await ensureCompanyPurposeBudget(tx, funding);
        if (budget.id !== initial.budgetId) throw conflict("The company-purpose funding profile changed before content return");
        const [record] = await tx.select().from(orchestrationCompanyPurposeReservations).where(eq(
          orchestrationCompanyPurposeReservations.id,
          initial.id,
        )).for("update");
        if (!record || record.status !== "completed" || nativeSha256(quote) !== nativeSha256(record.quote)) {
          throw conflict("Current completed support funding is required before content return");
        }
        await assertCompanyPurposeAuthority(tx, actor, input);
        if (input.purpose === "first_party_support") await assertFirstPartySupportReservation(
          tx, companyId, id, options.firstPartySupportVersionId ?? "", funding.tariff.sourceSha, now,
        );
      });
    },
    async reserveConversation(actor: AuthorizationActor, raw: ConversationRequest, now = new Date()): Promise<Reservation> {
      const currentConversationAuthority = options.currentConversationAuthority;
      if (!currentConversationAuthority) throw forbidden("Native conversation model authority is not configured");
      const input = conversationRequestSchema.parse(raw), userId = v7HumanActorId(actor);
      const { quote, tariff } = await freshConversationQuote(input, now);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, input.companyId); await lockMemoryPrivacy(tx, input.companyId);
        await assertV7Enabled(tx, "orchestration_v7");
        await assertV7Authorization(tx, actor, input.companyId, "company_scope:read");
        if (await currentConversationAuthority(tx, actor, input) !== input.authorityHash)
          throw conflict("Native conversation source or Human authority changed before reservation");
        const requestHash = nativeSha256({ ...input, principalUserId: userId, purpose: "conversation_model", quote });
        const [existing] = await tx.select().from(orchestrationModelReservations).where(and(
          eq(orchestrationModelReservations.companyId, input.companyId),
          eq(orchestrationModelReservations.conversationRunId, input.conversationRunId),
          eq(orchestrationModelReservations.idempotencyKey, input.idempotencyKey),
        ));
        if (existing) {
          if (existing.requestHash !== requestHash) throw conflict("Conversation model reservation key belongs to different immutable inputs");
          return existing;
        }
        const expiresAt = new Date(Math.min(Date.parse(quote.expiresAt), now.getTime() + 300_000));
        if (expiresAt <= now) throw forbidden("The Native conversation model qualification has expired");
        const [reservation] = await tx.insert(orchestrationModelReservations).values({
          companyId: input.companyId, planId: null, workerId: null, workerAttemptId: null,
          conversationAgentId: input.conversationAgentId, conversationRunId: input.conversationRunId,
          conversationIssueId: input.conversationIssueId, conversationSessionGeneration: input.conversationSessionGeneration,
          executionManifestId: input.executionManifestId, executionManifestHash: input.executionManifestHash,
          conversationTariffSnapshot: tariff,
          purpose: "conversation_model", principalUserId: userId, idempotencyKey: input.idempotencyKey,
          requestHash, inputHash: input.inputHash, authorityHash: input.authorityHash, quote,
          maximumMinor: quote.maximumMinor, expiresAt, createdAt: now,
        }).returning();
        await logActivity(tx, { companyId: input.companyId, actorType: "user", actorId: userId,
          action: "orchestration.conversation_model_reserved", entityType: "issue", entityId: input.conversationIssueId,
          details: { reservationId: reservation!.id, purpose: "conversation_model", maximumMinor: quote.maximumMinor,
            currency: quote.currency, tariffHash: quote.tariffHash, executionManifestHash: input.executionManifestHash } }, publications);
        return reservation!;
      });
    },
    async reserve(actor: AuthorizationActor, raw: Request, now = new Date()) {
      const input = requestSchema.parse(raw),
        quote = await freshQuote(input, now);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, input.companyId); await lockMemoryPrivacy(tx, input.companyId);
        const { plan, userId } = await authority(
          tx,
          actor,
          input.companyId,
          input.planId,
          input.expectedPlanVersion,
          false,
          input.purpose,
          input.workerId,
          input.workerAttemptId,
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
          plan.budgets.maxModelCostMinor !== null &&
          plan.modelCostReserved + quote.maximumMinor > plan.budgets.maxModelCostMinor
        )
          throw forbidden("Cumulative model reservation budget exhausted");
        if (["read_only_verification", "read_only_trajectory"].includes(input.purpose) &&
          (plan.verifierCallsUsed >= plan.supervisionPolicy.maxVerifierCalls || plan.supervisionPolicy.maxVerificationDepth < 1))
          throw forbidden("The cumulative read-only model call budget is exhausted");
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
    async claimConversationForDispatch(actor: AuthorizationActor, companyId: string, id: string, now = new Date()): Promise<Reservation> {
      const currentConversationAuthority = options.currentConversationAuthority;
      if (!currentConversationAuthority) throw forbidden("Native conversation model authority is not configured");
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const [initial] = await tx.select().from(orchestrationModelReservations).where(and(
          eq(orchestrationModelReservations.companyId, companyId), eq(orchestrationModelReservations.id, id),
          eq(orchestrationModelReservations.purpose, "conversation_model"),
        ));
        if (!initial || !initial.conversationAgentId || !initial.conversationRunId || !initial.conversationIssueId ||
          initial.conversationSessionGeneration === null || !initial.executionManifestId || !initial.executionManifestHash)
          throw notFound("Native conversation model reservation not found");
        const input: ConversationRequest = {
          companyId, conversationAgentId: initial.conversationAgentId, conversationRunId: initial.conversationRunId,
          conversationIssueId: initial.conversationIssueId, conversationSessionGeneration: initial.conversationSessionGeneration,
          executionManifestId: initial.executionManifestId, executionManifestHash: initial.executionManifestHash,
          idempotencyKey: initial.idempotencyKey, inputHash: initial.inputHash, authorityHash: initial.authorityHash,
          inputTokensUpperBound: initial.quote.inputTokensUpperBound, maxOutputTokens: initial.quote.maxOutputTokens,
        };
        const userId = v7HumanActorId(actor);
        await assertV7Enabled(tx, "orchestration_v7");
        await assertV7Authorization(tx, actor, companyId, "company_scope:read");
        const { quote } = await freshConversationQuote(input, now);
        if (initial.principalUserId !== userId || nativeSha256(quote) !== nativeSha256(initial.quote) ||
          await currentConversationAuthority(tx, actor, input) !== initial.authorityHash)
          throw conflict("Native conversation model authority or qualification changed before dispatch");
        const [record] = await tx.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.id, id)).for("update");
        if (!record || record.status !== "reserved" || record.expiresAt <= now || record.principalUserId !== userId ||
          record.executionManifestHash !== input.executionManifestHash)
          throw conflict("This Native conversation model reservation cannot dispatch again");
        const [dispatched] = await tx.update(orchestrationModelReservations).set({ status: "dispatched", dispatchedAt: now })
          .where(eq(orchestrationModelReservations.id, id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: userId,
          action: "orchestration.conversation_model_dispatch_claimed", entityType: "issue", entityId: input.conversationIssueId,
          details: { reservationId: id, maximumMinor: record.maximumMinor, executionManifestHash: input.executionManifestHash } }, publications);
        return dispatched!;
      });
    },
    async claimForDispatch(
      actor: AuthorizationActor,
      companyId: string,
      id: string,
      now = new Date(),
    ): Promise<Reservation> {
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const [initial] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(
            and(
              eq(orchestrationModelReservations.companyId, companyId),
              eq(orchestrationModelReservations.id, id),
            ),
          );
        if (!initial || initial.purpose === "conversation_model" || !initial.planId)
          throw notFound("Worker model reservation not found");
        const { plan, userId } = await authority(
          tx,
          actor,
          companyId,
          initial.planId,
          null,
          true,
          initial.purpose,
          initial.workerId,
          initial.workerAttemptId,
          now,
        );
        const [record] = await tx
          .select()
          .from(orchestrationModelReservations)
          .where(eq(orchestrationModelReservations.id, initial.id))
          .for("update");
        if (
          !record ||
          record.purpose === "conversation_model" ||
          !record.planId ||
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
          (await options.currentAuthority(tx, actor, {
            companyId: record.companyId, planId: record.planId, purpose: record.purpose,
            workerId: record.workerId, workerAttemptId: record.workerAttemptId,
          })) !==
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
        const tariffSnapshot = record.purpose === "conversation_model"
          ? modelTariffCeilingSchema.safeParse(record.conversationTariffSnapshot) : null;
        const pricingCurrent = tariffSnapshot?.success === true &&
          nativeSha256(tariffSnapshot.data) === record.quote.tariffHash &&
          tariffSnapshot.data.provider === record.quote.provider && tariffSnapshot.data.model === record.quote.model &&
          tariffSnapshot.data.qualificationHash === record.quote.qualificationHash && tariffSnapshot.data.sourceSha === record.quote.sourceSha;
        const estimatedCostMinor = pricingCurrent && input.usage
          ? Number(BigInt(tariffSnapshot!.data.fixedMinor) +
            (BigInt(input.usage.inputTokens) * BigInt(tariffSnapshot!.data.inputMinorPerMillion) +
              BigInt(input.usage.outputTokens) * BigInt(tariffSnapshot!.data.outputMinorPerMillion) + 999_999n) / 1_000_000n)
          : null;
        const conversationUnsettled = record.purpose === "conversation_model" &&
          (input.status !== "completed" || !input.providerResponseHash || !input.usage || !pricingCurrent ||
            estimatedCostMinor === null || estimatedCostMinor > record.maximumMinor);
        const outcomeStatus = exceedsQuote || conversationUnsettled ? "unknown" : input.status;
        const [updated] = await tx
          .update(orchestrationModelReservations)
          .set({
            ...input,
            status: outcomeStatus,
            completedAt: now,
          })
          .where(eq(orchestrationModelReservations.id, id))
          .returning();
        if (record.purpose === "conversation_model" && outcomeStatus === "completed") {
          if (!record.conversationAgentId || !record.conversationRunId || !record.conversationIssueId || !input.usage || estimatedCostMinor === null)
            throw conflict("The settled Native conversation reservation lost its owner binding");
          await tx.insert(costEvents).values({
            companyId, agentId: record.conversationAgentId, issueId: record.conversationIssueId,
            heartbeatRunId: record.conversationRunId, provider: record.quote.provider, biller: "company_connection",
            billingType: "metered_api", billingCode: `native-conversation-model:${record.id}`,
            costStatus: "estimated", model: record.quote.model, inputTokens: input.usage.inputTokens,
            cachedInputTokens: 0, outputTokens: input.usage.outputTokens, costCents: estimatedCostMinor,
            occurredAt: now,
          }).onConflictDoNothing();
        }
        await logActivity(
          tx,
          {
            companyId,
            actorType: "system",
            actorId: "model-broker",
            action: record.purpose === "conversation_model"
              ? "orchestration.conversation_model_outcome_recorded" : "orchestration.model_outcome_recorded",
            entityType: record.planId ? "orchestration_plan" : "issue",
            entityId: record.planId ?? record.conversationIssueId ?? companyId,
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
    expire: (now = new Date(), limit = 20) => expireModelReservations(db, now, limit),
  };
}

/** Flag- and configuration-independent reconciliation of existing debits. */
export async function expireModelReservations(db: Db, now = new Date(), limit = 20) {
      // A bounded safety sweep remains active after rollout rollback. Expiry
      // never refunds an unknown provider charge or restores a call slot.
      return withV7ActivityTransaction(db, async (tx, publications) => {
        const rows = await tx.select().from(orchestrationModelReservations).where(and(
          inArray(orchestrationModelReservations.status, ["reserved", "dispatched"]),
          lte(orchestrationModelReservations.expiresAt, now),
        )).orderBy(asc(orchestrationModelReservations.expiresAt), asc(orchestrationModelReservations.id))
          .limit(Math.max(1, Math.min(100, Math.trunc(limit) || 20))).for("update", { skipLocked: true });
        let cancelled = 0, unknown = 0;
        for (const row of rows) {
          const status = row.status === "reserved" ? "cancelled" : "unknown";
          await tx.update(orchestrationModelReservations).set({ status, completedAt: now })
            .where(eq(orchestrationModelReservations.id, row.id));
          if (status === "cancelled") cancelled++; else unknown++;
          await logActivity(tx, { companyId: row.companyId, actorType: "system", actorId: "model-broker",
            action: row.purpose === "conversation_model" ? "orchestration.conversation_model_outcome_recorded" : "orchestration.model_reservation_expired",
            entityType: row.planId ? "orchestration_plan" : "issue", entityId: row.planId ?? row.conversationIssueId ?? row.companyId,
            details: { reservationId: row.id, status, maximumMinor: row.maximumMinor, debitRetained: true } }, publications);
        }
        const companyPurposeRows = await tx.select().from(orchestrationCompanyPurposeReservations).where(and(
          inArray(orchestrationCompanyPurposeReservations.status, ["reserved", "dispatched"]),
          lte(orchestrationCompanyPurposeReservations.expiresAt, now),
        )).orderBy(asc(orchestrationCompanyPurposeReservations.expiresAt), asc(orchestrationCompanyPurposeReservations.id))
          .limit(Math.max(1, Math.min(100, Math.trunc(limit) || 20))).for("update", { skipLocked: true });
        for (const row of companyPurposeRows) {
          const status = row.status === "reserved" ? "cancelled" : "unknown";
          await tx.update(orchestrationCompanyPurposeReservations).set({ status, completedAt: now })
            .where(eq(orchestrationCompanyPurposeReservations.id, row.id));
          if (status === "cancelled") cancelled++; else unknown++;
          await logActivity(tx, {
            companyId: row.companyId,
            actorType: "system",
            actorId: "model-broker",
            action: "orchestration.company_purpose_model_reservation_expired",
            entityType: "company",
            entityId: row.companyId,
            details: { reservationId: row.id, purpose: "first_party_support", status, maximumMinor: row.maximumMinor, debitRetained: true },
          }, publications);
        }
        return { cancelled, unknown };
      });
}
