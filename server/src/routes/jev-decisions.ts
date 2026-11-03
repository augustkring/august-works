import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { activityLog, companyMemberships, enterpriseIdentityPolicies, jevDecisionSettings, orchestrationCompanyPurposeReservations, type Db } from "@paperclipai/db";
import { companyPurposeFundingSchema, companyPurposeReservationInputSchema, jevDecisionRequestSchema, jevDecisionSettingsUpdateSchema, JEV_DECISION_MODEL } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { accessService } from "../services/access.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { logActivity } from "../services/activity-log.js";
import { conflict, forbidden } from "../errors.js";
import { modelReservationService } from "../services/orchestration/model-reservations.js";
import { runJevDecision } from "../services/jev-decision-provider.js";
import { jevCredentialBindingHash, jevProfileCurrent, type JevSkillSuggestionProfile } from "../services/jev-skill-suggestions.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import type { AuthorizationActor } from "../services/authorization.js";

const jevSetupConsentSchema = z.object({ disclosedPaidTestConsent: z.literal(true), connectionId: z.string().uuid(), grantId: z.string().uuid(),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() }).strict();

export function jevDecisionRoutes(db: Db, options: { sourceSha?: string; profiles?: readonly JevSkillSuggestionProfile[]; fetch?: typeof fetch } = {}) {
  const router = Router();
  async function manager(companyId: string, userId: string, reader: Db = db) {
    const access = accessService(reader);
    const [member] = await reader.select().from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
    )).limit(1);
    if (!member || member.membershipRole === "viewer") throw forbidden();
    if (member.membershipRole === "owner" || member.membershipRole === "admin" ||
      await access.hasPermission(companyId, "user", userId, "tools:manage_connections")) return;
    throw forbidden("A company connection manager is required");
  }
  router.get("/companies/:companyId/jev-decisions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    await manager(companyId, userId);
    const [row] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
    const connections = await aiConnectionService(db).list(companyId, userId);
    const choices = connections.filter(item => item.provider === "openrouter" && item.method === "api_key" && item.ownership === "shared")
      .map(item => ({ id: item.id, grantId: item.grantId, name: item.name, status: item.status, model: JEV_DECISION_MODEL }));
    const saved = row ?? { companyId, mode: "off", allowBackground: false, connectionId: null, grantId: null, updatedAt: new Date(0) };
    const qualification = options.sourceSha && saved.connectionId && saved.grantId ? (options.profiles ?? []).filter(profile =>
      profile.companyId === companyId && profile.connectionId === saved.connectionId && profile.grantId === saved.grantId &&
      jevProfileCurrent(profile, { companyId, connectionId: saved.connectionId!, grantId: saved.grantId!, sourceSha: options.sourceSha! }, new Date())) : [];
    const [identityPolicy] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.companyId, companyId));
    const identityQualification = identityPolicy?.qualification;
    const policyCurrent = identityPolicy?.status === "qualified" && Boolean(identityQualification) && identityQualification!.sourceRevision === options.sourceSha &&
      Date.parse(identityQualification!.expiresAt) > Date.now();
    const testProfile = qualification.length === 1 && policyCurrent && identityPolicy.operatingEnvelope.awProcessingRegions.includes(qualification[0]!.processingRegion)
      ? { profileHash: qualification[0]!.profileHash, costCapMinor: qualification[0]!.setupCostCapMinor, currency: qualification[0]!.tariff.currency } : null;
    res.json({ settings: saved, choices, suggestionsQualified: false, testProfile });
  });
  router.get("/companies/:companyId/jev-decisions/history", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    await manager(companyId, getActorInfo(req).actorId);
    const rows = await db.select({ reservation: orchestrationCompanyPurposeReservations })
      .from(orchestrationCompanyPurposeReservations).where(and(
        eq(orchestrationCompanyPurposeReservations.companyId, companyId),
        eq(orchestrationCompanyPurposeReservations.purpose, "decision_skill_suggestion"),
      )).orderBy(desc(orchestrationCompanyPurposeReservations.createdAt)).limit(50);
    const accountingRows = await db.select({ details: activityLog.details }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.action, "orchestration.company_purpose_model_outcome_recorded"),
    )).orderBy(desc(activityLog.createdAt)).limit(250);
    const accounting = new Map(accountingRows.flatMap(({ details }) => typeof details?.reservationId === "string" &&
      details.purpose === "decision_skill_suggestion" ? [[details.reservationId, details] as const] : []));
    res.json(rows.map(({ reservation }) => ({ id: reservation.id, model: reservation.quote.model, status: reservation.status,
      reservedCostCents: (reservation.maximumMinor / 100).toFixed(2), currency: reservation.quote.currency,
      actualCostAmount: accounting.get(reservation.id)?.actualCostAmount ?? null,
      costStatus: accounting.get(reservation.id)?.costStatus ?? "unpriced",
      inputTokens: reservation.usage?.inputTokens ?? null, outputTokens: reservation.usage?.outputTokens ?? null,
      createdAt: reservation.createdAt.toISOString(), completedAt: reservation.completedAt?.toISOString() ?? null })));
  });
  router.put("/companies/:companyId/jev-decisions", validate(jevDecisionSettingsUpdateSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    await manager(companyId, userId);
    const input = jevDecisionSettingsUpdateSchema.parse(req.body);
    if (input.mode === "suggestions") throw conflict("User-visible Jev suggestions are not qualified for activation");
    if (input.mode !== "off" && !input.connectionId) throw conflict("Select a company-shared OpenRouter API-key connection first");
    if (input.connectionId && input.grantId) await aiConnectionService(db).selectDecision({ companyId, userId, connectionId: input.connectionId, grantId: input.grantId });
    const [previous] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
    const values = { companyId, mode: input.mode, allowBackground: input.allowBackground ?? previous?.allowBackground ?? false,
      connectionId: input.connectionId, grantId: input.grantId, updatedByUserId: userId, updatedAt: new Date() };
    const saved = await db.transaction(async tx => {
      const [row] = await tx.insert(jevDecisionSettings).values(values).onConflictDoUpdate({ target: jevDecisionSettings.companyId, set: values }).returning();
      await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "jev_skill_decisions.configured", entityType: "company", entityId: companyId,
        details: { mode: row!.mode, allowBackground: row!.allowBackground, connectionId: row!.connectionId } });
      return row!;
    });
    res.json({ settings: saved, suggestionsQualified: false });
  });
  router.post("/companies/:companyId/jev-decisions/test", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    await manager(companyId, userId);
    const consent = jevSetupConsentSchema.parse(req.body);
    if (consent.disclosedPaidTestConsent !== true)
      throw forbidden("Explicit consent to send the disclosed Jev sample and pay its capped provider charge is required");
    const [settings] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
    if (!settings?.connectionId || !settings.grantId) throw conflict("Save a company-shared OpenRouter account before running the setup test");
    if (settings.connectionId !== consent.connectionId || settings.grantId !== consent.grantId) throw conflict("The displayed company account changed. Review the current disclosure again before testing.");
    const sourceSha = options.sourceSha;
    const matches = (options.profiles ?? []).filter(profile => profile.companyId === companyId && profile.connectionId === settings.connectionId && profile.grantId === settings.grantId &&
      sourceSha && jevProfileCurrent(profile, { companyId, connectionId: settings.connectionId!, grantId: settings.grantId!, sourceSha }, new Date()));
    if (matches.length !== 1 || matches[0]!.profileHash !== consent.profileHash) throw conflict("The displayed Jev profile changed. Review the current disclosure again before testing.");
    const profile = matches[0]!;
    const selected = await aiConnectionService(db).selectDecision({ companyId, userId, connectionId: settings.connectionId, grantId: settings.grantId });
    const apiKey = await aiConnectionService(db).credential(selected, { responsibleUserId: userId, actorType: "user", actorId: userId });
    if (jevCredentialBindingHash(apiKey) !== profile.credentialBindingHash) throw forbidden("The selected account does not match the qualified Jev profile");
    const [policy] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.companyId, companyId));
    const qualification = policy?.qualification;
    if (policy?.status !== "qualified" || !qualification || qualification.sourceRevision !== sourceSha || Date.parse(qualification.expiresAt) <= Date.now() || !policy.operatingEnvelope.awProcessingRegions.includes(profile.processingRegion))
      throw forbidden("The company processing policy does not permit this Jev provider route");
    const request = jevDecisionRequestSchema.parse({ state: { purpose: "disclosed Jev connection setup test", sample: "Choose yes only when 2 is greater than 1." },
      questions: { sample: { type: "choice", instructions: "For this harmless setup sample only, choose yes if 2 is greater than 1; otherwise choose no. Do not infer permissions, settings, or actions.",
        criteria: { yes: "2 is greater than 1", no: "2 is not greater than 1" } } } });
    const inputHash = nativeSha256({ request, profileHash: profile.profileHash, model: JEV_DECISION_MODEL });
    const now = new Date(), dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const periodEndsAt = new Date(Math.min(dayStart.getTime() + 86_400_000, Date.parse(profile.expiresAt), Date.parse(profile.tariff.expiresAt)));
    if (periodEndsAt <= now) throw conflict("The qualified Jev funding period has expired");
    const fundingBody = { companyId, purpose: "decision_skill_suggestion" as const, funder: "company_connection" as const,
      profileId: profile.profileId, providerAccountId: `openrouter:${settings.connectionId}:${settings.grantId}`, credentialBindingHash: profile.credentialBindingHash,
      periodKey: `${profile.profileId}:${dayStart.toISOString().slice(0, 10)}`, periodStartsAt: dayStart.toISOString(), periodEndsAt: periodEndsAt.toISOString(),
      maxCostMinor: profile.setupCostCapMinor, maxCalls: profile.setupMaxCalls, tariff: profile.tariff };
    const funding = companyPurposeFundingSchema.parse({ ...fundingBody, profileHash: nativeSha256(fundingBody) });
    const authorityHash = nativeSha256({ companyId, userId, purpose: "decision_skill_suggestion", connectionId: settings.connectionId, grantId: settings.grantId,
      profileHash: funding.profileHash, setupRequestId: consent.requestId, consent: true });
    const actor: AuthorizationActor = req.actor;
    const broker = modelReservationService(db, {
      sourceSha: sourceSha!, qualifiedTariff: async () => null, currentAuthority: async () => { throw forbidden(); },
      qualifiedCompanyPurposeFunding: ({ companyId: target, purpose }, at) => target === companyId && purpose === "decision_skill_suggestion" && at < periodEndsAt ? funding : null,
      currentCompanyPurposeAuthority: async (tx, currentActor, reservationInput) => {
        if (currentActor.type !== "board" || currentActor.userId !== userId || reservationInput.purpose !== "decision_skill_suggestion") return "";
        await manager(companyId, userId, tx);
        const [currentSettings] = await tx.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
        if (currentSettings?.connectionId !== settings.connectionId || currentSettings.grantId !== settings.grantId) return "";
        const currentSelection = await aiConnectionService(db).selectDecision({ companyId, userId, connectionId: settings.connectionId!, grantId: settings.grantId! }, tx);
        const currentKey = await aiConnectionService(db).credential(currentSelection, { responsibleUserId: userId, actorType: "user", actorId: userId }, tx);
        if (jevCredentialBindingHash(currentKey) !== profile.credentialBindingHash) return "";
        const [currentPolicy] = await tx.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.companyId, companyId));
        const currentQualification = currentPolicy?.qualification;
        if (currentPolicy?.status !== "qualified" || !currentQualification || currentQualification.sourceRevision !== sourceSha ||
          Date.parse(currentQualification.expiresAt) <= Date.now() || !currentPolicy.operatingEnvelope.awProcessingRegions.includes(profile.processingRegion)) return "";
        return authorityHash;
      },
    });
    const reservationInput = companyPurposeReservationInputSchema.parse({ companyId, purpose: "decision_skill_suggestion", idempotencyKey: `jev-setup:${consent.requestId}`,
      inputHash, authorityHash, inputTokensUpperBound: profile.inputTokensUpperBound, maxOutputTokens: Math.min(16, profile.maxOutputTokens) });
    await db.transaction(tx => logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "jev_skill_decisions.setup_test_consented", entityType: "company", entityId: companyId,
      details: { purpose: "decision_skill_suggestion", setupRequestId: consent.requestId, profileHash: funding.profileHash,
        connectionId: settings.connectionId, maximumCostMinor: funding.maxCostMinor, currency: funding.tariff.currency } }));
    const reservation = await broker.reserveCompanyPurpose(actor, reservationInput);
    if (reservation.status !== "reserved") {
      return res.json({ status: reservation.status, model: JEV_DECISION_MODEL, inputTokens: reservation.usage?.inputTokens ?? null,
        outputTokens: reservation.usage?.outputTokens ?? null, costAmount: null, costStatus: "unpriced", errorCode: reservation.status === "unknown" ? "unknown_outcome" : null });
    }
    await broker.claimCompanyPurposeForDispatch(actor, companyId, reservation.id);
    const oauth = (selected.grant.providerTenant as { oauth?: { accessTokenExpiresAt?: string | null } } | null)?.oauth;
    const credentialExpiresAt = oauth?.accessTokenExpiresAt ? Date.parse(oauth.accessTokenExpiresAt) : Number.POSITIVE_INFINITY;
    const deadlineAt = Math.min(Date.now() + 30_000, Date.parse(profile.expiresAt), Date.parse(profile.tariff.expiresAt),
      Number.isFinite(credentialExpiresAt) ? credentialExpiresAt : Number.POSITIVE_INFINITY, reservation.expiresAt.getTime());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadlineAt - Date.now())); timer.unref();
    const checkCurrent = async () => {
      if (controller.signal.aborted || Date.now() >= deadlineAt || !jevProfileCurrent(profile,
        { companyId, connectionId: settings.connectionId!, grantId: settings.grantId!, sourceSha: sourceSha! }, new Date())) throw forbidden("The Jev setup-test authority or qualification expired");
      await manager(companyId, userId);
      const [currentSettings] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
      if (currentSettings?.connectionId !== settings.connectionId || currentSettings.grantId !== settings.grantId) throw forbidden("The saved Jev company account changed");
      const currentSelection = await aiConnectionService(db).selectDecision({ companyId, userId, connectionId: settings.connectionId!, grantId: settings.grantId! });
      const currentKey = await aiConnectionService(db).credential(currentSelection, { responsibleUserId: userId, actorType: "user", actorId: userId });
      if (jevCredentialBindingHash(currentKey) !== profile.credentialBindingHash) throw forbidden("The qualified Jev account credential changed");
      const [currentPolicy] = await db.select().from(enterpriseIdentityPolicies).where(eq(enterpriseIdentityPolicies.companyId, companyId));
      const currentQualification = currentPolicy?.qualification;
      if (currentPolicy?.status !== "qualified" || !currentQualification || currentQualification.sourceRevision !== sourceSha ||
        Date.parse(currentQualification.expiresAt) <= Date.now() || !currentPolicy.operatingEnvelope.awProcessingRegions.includes(profile.processingRegion)) throw forbidden("The company processing policy changed");
      return currentKey;
    };
    let providerStarted = false, checking = false;
    const watch = setInterval(() => { if (checking) return; checking = true; void checkCurrent().catch(() => controller.abort()).finally(() => { checking = false; }); }, 1000); watch.unref();
    try {
      const latestKey = await checkCurrent();
      providerStarted = true;
      const result = await runJevDecision({ model: JEV_DECISION_MODEL, apiKey: latestKey, request,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()))]) }, {
        ...(options.fetch ? { fetch: options.fetch } : {}),
        onWireDispatch: async wire => { await broker.recordCompanyPurposeWireDispatch(actor, companyId, reservation.id, wire); },
      });
      const knownUsage = result.receipt.inputTokens !== null && result.receipt.outputTokens !== null;
      const knownCost = result.receipt.costAmount !== null && result.receipt.costStatus !== "unpriced";
      const reportedCost = result.receipt.costAmount === null ? null : Number(result.receipt.costAmount);
      const overPrice = reportedCost !== null && (!Number.isFinite(reportedCost) || reportedCost > reservation.maximumMinor / 100 || reportedCost > funding.maxCostMinor / 100);
      const status = result.noProviderWork ? "failed" : overPrice ? "unknown" : result.answers ? "completed" : knownUsage || knownCost ? "failed" : "unknown";
      const usage = knownUsage ? { inputTokens: result.receipt.inputTokens!, outputTokens: result.receipt.outputTokens! } : null;
      const outcome = await broker.recordCompanyPurposeOutcome(companyId, reservation.id, { status,
        providerResponseHash: providerStarted ? nativeSha256({ reservationId: reservation.id, errorCode: result.errorCode ?? null,
          inputTokens: result.receipt.inputTokens, outputTokens: result.receipt.outputTokens, costAmount: result.receipt.costAmount, costStatus: result.receipt.costStatus }) : null,
        usage, accounting: { actualCostAmount: result.receipt.costAmount, costStatus: result.receipt.costStatus } });
      if (outcome.status === "completed") await broker.assertCompanyPurposeResponseReturn(actor, companyId, reservation.id);
      res.json({ status: outcome.status, model: JEV_DECISION_MODEL, inputTokens: result.receipt.inputTokens, outputTokens: result.receipt.outputTokens,
        costAmount: result.receipt.costAmount, costStatus: result.receipt.costStatus, errorCode: result.errorCode ?? null });
    } catch (error) {
      await broker.recordCompanyPurposeOutcome(companyId, reservation.id, { status: providerStarted ? "unknown" : "failed",
        providerResponseHash: null, usage: null }).catch(() => {});
      if (!providerStarted) throw error;
      res.json({ status: "unknown", model: JEV_DECISION_MODEL, inputTokens: null, outputTokens: null, costAmount: null, costStatus: "unpriced", errorCode: "provider_failed" });
    } finally { clearTimeout(timer); clearInterval(watch); }
  });
  return router;
}
