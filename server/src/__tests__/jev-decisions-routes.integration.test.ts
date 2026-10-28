import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  companyMemberships,
  createDb,
  enterpriseIdentityPolicies,
  jevDecisionSettings,
  orchestrationCompanyPurposeBudgets,
  orchestrationCompanyPurposeReservations,
} from "@paperclipai/db";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { jevDecisionRoutes } from "../routes/jev-decisions.js";
import { errorHandler } from "../middleware/error-handler.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { jevCredentialBindingHash, type JevSkillSuggestionProfile } from "../services/jev-skill-suggestions.js";

const connectionMocks = vi.hoisted(() => ({ selectDecision: vi.fn(), credential: vi.fn() }));
vi.mock("../services/ai-connections.js", () => ({ aiConnectionService: () => connectionMocks }));

const pg = await getEmbeddedPostgresTestSupport();
(pg.supported ? describe.sequential : describe.skip)("Jev setup-test HTTP boundary", () => {
  const sourceSha = "a".repeat(40), key = "local-no-network-test-key";
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  let connectionId: string, grantId: string, profile: JevSkillSuggestionProfile;
  let wire: ReturnType<typeof vi.fn<typeof fetch>>;
  let app: express.Express;

  function profileFor(expiresAt = new Date(Date.now() + 60_000).toISOString()): JevSkillSuggestionProfile {
    const testedAt = new Date(Date.now() - 1_000).toISOString(), qualificationHash = "b".repeat(64);
    const base = {
      companyId: f.home, connectionId, grantId, profileId: `jev-route-${f.home.slice(0, 8)}`,
      credentialBindingHash: jevCredentialBindingHash(key), sourceSha, qualificationHash,
      processor: "openrouter" as const, processorTermsHash: "c".repeat(64), retentionPolicyHash: "d".repeat(64), retentionDays: 0,
      testedAt, expiresAt, processingRegion: "us" as const, setupCostCapMinor: 5, setupMaxCalls: 3,
      tariff: { provider: "openrouter" as const, model: "typesafe/jev-1.13", currency: "USD" as const,
        inputMinorPerMillion: 1000, outputMinorPerMillion: 1000, fixedMinor: 0, qualificationHash, sourceSha, testedAt, expiresAt },
      inputTokensUpperBound: 100, maxOutputTokens: 16,
    };
    return { ...base, profileHash: nativeSha256(base) };
  }
  function response(answer: unknown = { type: "choice", choice: "yes", probabilities: { yes: 1, no: 0 } }) {
    return Response.json({ id: "local-decision-receipt", model: "typesafe/jev-1.13", usage: { input_tokens: 12, output_tokens: 2, cost: 0.0005166 }, answers: { sample: answer } });
  }
  async function setup() {
    await enableV5ForTest(db);
    f = await seedV5Presences(db);
    f.actor.sessionId = await seedNativePasskeySession(db, f.userId);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true, readiness_engine_v7: true, orchestration_v7: true });
    connectionId = randomUUID(); grantId = randomUUID();
    profile = profileFor();
    await db.insert(jevDecisionSettings).values({ companyId: f.home, mode: "off", allowBackground: false, connectionId, grantId, updatedByUserId: f.userId });
    const now = new Date();
    await db.insert(enterpriseIdentityPolicies).values({
      companyId: f.home, providerId: `jev-policy-${f.home}`, issuer: "https://identity.test.invalid",
      configuration: { protocol: "saml", issuer: "https://identity.test.invalid", domain: "test.invalid", entryPoint: "https://identity.test.invalid/sso", certificate: "x".repeat(120) },
      operatingEnvelope: { awProcessingRegions: ["us"], providers: [], dedicatedPlacement: "none", retentionPolicyDescription: "local software test",
        contractEvidence: null, supportAccess: "native_scoped_owner_approval", limitations: ["Software fixture; not a provider qualification"] },
      status: "qualified", qualification: { uri: "https://qualification.test.invalid/qualification/fixture", sha256: "e".repeat(64), sourceRevision: sourceSha,
        qualifiedByUserId: f.userId, expiresAt: new Date(now.getTime() + 60_000).toISOString(), signingKey: null },
      createdByUserId: f.userId,
    });
    connectionMocks.selectDecision.mockReset().mockImplementation(async () => ({
      connection: { id: connectionId, companyId: f.home, provider: "openrouter", ownership: "shared", method: "api_key", status: "active" },
      grant: { id: grantId, providerTenant: null },
    }));
    connectionMocks.credential.mockReset().mockResolvedValue(key);
    wire = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return response();
    });
    const actor = { ...f.actor, isInstanceAdmin: false, companyIds: [f.home] } as Request["actor"];
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", jevDecisionRoutes(db, { sourceSha, profiles: [profile], fetch: wire })); app.use(errorHandler);
  }
  const path = () => `/api/companies/${f.home}/jev-decisions/test`;
  const body = (overrides: Record<string, unknown> = {}) => ({ disclosedPaidTestConsent: true, connectionId, grantId, profileHash: profile.profileHash, requestId: randomUUID(), ...overrides });

  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("jev-decisions-http-"); db = createDb(fixture.connectionString);
    await instanceSettingsService(db).getExperimental();
  }, 60_000);
  beforeEach(setup);
  afterAll(async () => { await fixture?.cleanup(); }, 30_000);

  it("uses the real Decisions adapter over a mock wire, settles its original company-purpose reservation, and never resends an idempotent request", async () => {
    const command = body();
    wire.mockImplementationOnce(async () => {
      const [admitted] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(admitted).toMatchObject({ status: "dispatched", providerWireReceipt: {
        method: "POST", endpoint: "https://openrouter.ai/api/alpha/decisions",
      } });
      return response();
    });
    const first = await request(app).post(path()).send(command).expect(200);
    expect(first.body).toMatchObject({ status: "completed", model: "typesafe/jev-1.13", inputTokens: 12, outputTokens: 2, costAmount: "0.0005166", costStatus: "reported" });
    expect(wire).toHaveBeenCalledTimes(1);
    const [url, init] = wire.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(init?.body)).model).toBe("typesafe/jev-1.13");
    const replay = await request(app).post(path()).send(command).expect(200);
    expect(replay.body).toMatchObject({ status: "completed", inputTokens: 12, outputTokens: 2 });
    expect(wire).toHaveBeenCalledTimes(1);
    const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
    const [budget] = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
    expect(reservation).toMatchObject({ purpose: "decision_skill_suggestion", packageVersionId: null, status: "completed", usage: { inputTokens: 12, outputTokens: 2 } });
    expect(budget).toMatchObject({ purpose: "decision_skill_suggestion", funder: "company_connection", reservedCalls: 1, maxCalls: 3 });
    const receipt = await db.select().from(activityLog).where(eq(activityLog.action, "orchestration.company_purpose_model_outcome_recorded"));
    expect(receipt[0]?.details).toMatchObject({ purpose: "decision_skill_suggestion", actualCostAmount: "0.0005166", costStatus: "reported", debitRetained: true });
  });

  it("rejects missing consent, caller-supplied principal, unsaved account, and mismatched profile before any provider request", async () => {
    await request(app).post(path()).send(body({ disclosedPaidTestConsent: false })).expect(400);
    await request(app).post(path()).send(body({ expectedUserId: "other-human" })).expect(400);
    await request(app).post(path()).send(body({ connectionId: randomUUID(), grantId: randomUUID() })).expect(409);
    await request(app).post(path()).send(body({ profileHash: "f".repeat(64) })).expect(409);
    expect(wire).not.toHaveBeenCalled();
    expect(await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home))).toHaveLength(0);
  });

  it("retains an unknown charge and stable idempotency receipt without a second dispatch", async () => {
    wire.mockResolvedValue(Response.json({ error: { type: "server_error", message: "private transport failure" } }, { status: 500 }));
    const command = body();
    await request(app).post(path()).send(command).expect(200).then(result => expect(result.body).toMatchObject({ status: "unknown", costStatus: "unpriced" }));
    await request(app).post(path()).send(command).expect(200).then(result => expect(result.body.status).toBe("unknown"));
    expect(wire).toHaveBeenCalledTimes(1);
    const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
    const [budget] = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
    expect(reservation?.status).toBe("unknown"); expect(budget).toMatchObject({ reservedCalls: 1, reservedMinor: reservation?.maximumMinor });
  });

  it("records known usage and cost for an invalid answer without returning provider content", async () => {
    wire.mockResolvedValue(response({ type: "choice", choice: "private-invalid-answer" }));
    const result = await request(app).post(path()).send(body()).expect(200);
    expect(result.body).toMatchObject({ status: "failed", inputTokens: 12, outputTokens: 2, costAmount: "0.0005166", costStatus: "reported" });
    expect(JSON.stringify(result.body)).not.toContain("private-invalid-answer");
    const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
    expect(reservation).toMatchObject({ status: "failed", usage: { inputTokens: 12, outputTokens: 2 } });
  });

  it("holds a reported provider charge above the immutable reservation quote", async () => {
    wire.mockResolvedValue(Response.json({ id: "over-quote", model: "typesafe/jev-1.13", usage: { input_tokens: 12, output_tokens: 2, cost: 0.02 },
      answers: { sample: { type: "boolean", probability: 1 } } }));
    const result = await request(app).post(path()).send(body()).expect(200);
    expect(result.body).toMatchObject({ status: "unknown", costAmount: "0.0200000", costStatus: "reported" });
    const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
    expect(reservation).toMatchObject({ status: "unknown", usage: { inputTokens: 12, outputTokens: 2 } });
  });

  it("aborts a single in-flight request when the current company manager is revoked", async () => {
    let sawSignal: AbortSignal | undefined;
    wire.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      sawSignal = init?.signal ?? undefined;
      sawSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const pending = request(app).post(path()).send(body()).then(result => result);
    await vi.waitFor(() => expect(wire).toHaveBeenCalledTimes(1));
    await db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.companyId, f.home));
    const result = await pending;
    expect(sawSignal?.aborted).toBe(true);
    expect(result.body.status).toBe("unknown");
    expect(wire).toHaveBeenCalledTimes(1);
    const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
    expect(reservation?.status).toBe("unknown");
  });

  it("aborts at the profile expiry instead of allowing a late setup result", async () => {
    profile = profileFor(new Date(Date.now() + 4_000).toISOString());
    let signal: AbortSignal | undefined;
    const abortingFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { ...f.actor, isInstanceAdmin: false, companyIds: [f.home] } as Request["actor"]; next(); });
    app.use("/api", jevDecisionRoutes(db, { sourceSha, profiles: [profile], fetch: abortingFetch })); app.use(errorHandler);
    const pending = request(app).post(path()).send(body()).then(result => result);
    await vi.waitFor(() => expect(signal).toBeDefined());
    const result = await pending;
    expect(signal?.aborted).toBe(true); expect(result.body.status).toBe("unknown");
    expect(await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home))).toHaveLength(1);
  }, 15_000);
});
