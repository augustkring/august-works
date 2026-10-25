import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  activityLog,
  companyMemberships,
  companyDeletionOperations,
  companies,
  createDb,
  issues,
  heartbeatRuns,
  orchestrationPlans,
  orchestrationModelReservations,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  orchestrationCompanyPurposeBudgets,
  orchestrationCompanyPurposeReservations,
} from "@paperclipai/db";
import type { CompanyPurposeFunding, ModelTariffCeiling } from "@paperclipai/shared";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { agentIdentityService } from "../services/agent-identities.js";
import {
  modelReservationService,
  quoteModelReservation,
} from "../services/orchestration/model-reservations.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { saasOffboardingService } from "../services/saas/offboarding.js";
import { agentPackageService } from "../services/agent-packages/package-service.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { COMPANY_SEARCH_HELP_ARTICLES } from "../services/company-search-help.generated.js";
import { supportGuideKnowledgePin } from "../services/experience/support-assistant-grounding.js";
import { firstPartySupportModelGateway, supportAssistantPolicyRevision } from "../services/orchestration/first-party-support-model-gateway.js";
import { searchAuthorizedSupportHelp } from "../services/experience/support-assistant-help.js";
import type { FirstPartySupportModelProfile } from "../services/orchestration/first-party-support-model-profiles.js";
const sourceSha = "a".repeat(40),
  authorityHash = "b".repeat(64);
const supportApiKey = "software-fixture-support-key-never-live";
const supportModelProfile = (companyId: string, packageVersionId: string): FirstPartySupportModelProfile => ({
  companyId,
  packageVersionId,
  purpose: "first_party_support",
  funder: "blentera_platform",
  profileId: "software-support-profile",
  providerAccountId: "software-platform-account-fixture",
  credentialBindingHash: createHash("sha256").update(supportApiKey).digest("hex"),
  privacyNoticeUrl: "https://support.example.test/privacy/ai-processing",
  periodKey: "software-fixture-period",
  periodStartsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  periodEndsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  maxCostMinor: 500,
  maxCalls: 10,
  contract: "anthropic-text-messages-2023-06-01",
  tariff: {
    provider: "anthropic",
    model: "software-fixture-model-20261025",
    currency: "USD",
    inputMinorPerMillion: 100,
    outputMinorPerMillion: 100,
    fixedMinor: 0,
    qualificationHash: "c".repeat(64),
    sourceSha,
    testedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  },
  maximumEnvelopeBytes: 262144,
  inputTokensUpperBound: 300000,
  maxOutputTokens: 512,
  qualificationEvidenceRef: "https://qualification.test.invalid/qualification/software-support-fixture.json",
  qualificationArtifactSha256: "d".repeat(64),
});
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
      currentHash: string,
      supportFunding: CompanyPurposeFunding | null,
      jevFunding: CompanyPurposeFunding | null,
      supportAuthorityHash: string,
      jevAuthorityHash: string,
      supportAuthorityResponses: string[] | null,
      supportPackageVersionId: string,
      lateProofEnabled: boolean,
      lateProofAccountMismatch: boolean;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-model-budget-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    let supportPackageSequence = 0;
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        enableWorkflowsV1: true,
        readiness_engine_v7: true,
        orchestration_v7: true,
        agent_packages_v7: true,
      });
      f = await seedV5Presences(db);
      f.actor.sessionId = await seedNativePasskeySession(db, f.userId);
      const qualification = { uri: "https://qualification.test.invalid/qualification/support-fixture", sha256: "d".repeat(64) };
      const packagePublisher = agentPackageService(db, {
        operatorUserIds: [f.userId],
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        sourceSha,
      });
      // The fixture exercises the original operator publication path. Its
      // synthetic evidence is software-test data, not release qualification.
      const publishedSupport = await packagePublisher.publish(f.actor, {
        packageKey: "paperclip-support",
        name: "Blentera Support (test fixture)",
        description: "Software-only fixture for taskless ledger tests",
        category: "support",
        version: `1.0.${++supportPackageSequence}`,
        releaseNotes: "Software-only integration fixture",
        manifest: {
          purpose: "Answer bounded customer questions from currently authorized sources",
          prohibitedUses: ["External communications", "Customer data mutation"],
          role: "Read-only support assistant",
          audience: "first_party_support",
          maximumRisk: "C1",
          actionClasses: ["internal_draft"],
          requiredKnowledge: [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)],
          requiredConnections: [],
          optionalConnections: [],
          memoryPolicy: "no_persistent_memory",
          humanApproval: "before_material_action",
          supervision: "bounded_native",
          verification: "independent_native",
          sandboxAssurance: "read_only_no_code_execution",
          runtimeProviders: ["paperclip_native"],
          onboardingQuestions: [],
          knownLimitations: ["Synthetic publication fixture; no production qualification claim"],
          sourceRevision: sourceSha,
          license: "MIT",
          commercialProductKey: null,
        },
        components: [{ key: "support-role", type: "role_pack", sourceVersion: "1", contentHash: "e".repeat(64), source: qualification, required: true }],
        releaseEvidence: {
          sbom: qualification,
          provenance: qualification,
          signature: qualification,
          scan: qualification,
          evaluations: qualification,
          protectedHoldout: qualification,
          sandboxQualification: null,
          releaseAuthorization: qualification,
          unresolvedCritical: [],
          evaluatedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      supportPackageVersionId = publishedSupport.id;
      price = tariff();
      currentHash = authorityHash;
      supportAuthorityHash = authorityHash;
      jevAuthorityHash = authorityHash;
      supportAuthorityResponses = null;
      lateProofEnabled = false;
      lateProofAccountMismatch = false;
      supportFunding = makeSupportFunding(f.home);
      jevFunding = null;
      jevFunding = null;
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
        qualifiedCompanyPurposeFunding: ({ purpose }) => purpose === "decision_skill_suggestion" ? jevFunding : supportFunding,
        firstPartySupportVersionId: supportPackageVersionId,
        currentCompanyPurposeAuthority: async (_tx, _actor, input) => input.purpose === "decision_skill_suggestion"
          ? jevAuthorityHash
          : supportAuthorityResponses?.shift() ?? supportAuthorityHash,
        reconcileCompanyPurposeOutcome: async (_tx, { reservation, funding }) => lateProofEnabled ? ({
          companyId: reservation.companyId,
          reservationId: reservation.id,
          inputHash: reservation.inputHash,
          authorityHash: reservation.authorityHash,
          profileHash: funding.profileHash,
          providerAccountId: lateProofAccountMismatch ? "wrong-account" : funding.providerAccountId,
          credentialBindingHash: funding.credentialBindingHash,
          quoteHash: nativeSha256(reservation.quote),
          status: "completed" as const,
          providerResponseHash: "e".repeat(64),
          usage: { inputTokens: 1, outputTokens: 1 },
        }) : null,
      });
    const supportGateway = (
      profiles: FirstPartySupportModelProfile[],
      fetch: typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch,
    ) => firstPartySupportModelGateway(db, {
      profiles,
      sourceSha,
      protectedEvidenceOrigin: "https://qualification.test.invalid",
      helpSearch: (tx, actor, input) => searchAuthorizedSupportHelp(tx, actor, input),
      credential: () => supportApiKey,
      fetch,
    });
    const supportTransportResponse = (init: RequestInit) => {
      const requestBody = JSON.parse(String(init.body)) as {
        model: string;
        messages: Array<{ content: Array<{ text: string }> }>;
      };
      const envelope = JSON.parse(requestBody.messages[0]!.content[0]!.text) as {
        approvedHelpEvidence: Array<{ id: string }>;
      };
      return new Response(JSON.stringify({
        type: "message",
        role: "assistant",
        model: requestBody.model,
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ evidenceIds: [envelope.approvedHelpEvidence[0]!.id] }) }],
        usage: { input_tokens: 100, output_tokens: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const mockSupportTransport = () => vi.fn(async (_url: string | URL, init: RequestInit) => supportTransportResponse(init));
    const makeSupportFunding = (companyId: string, overrides: Partial<CompanyPurposeFunding> = {}): CompanyPurposeFunding => {
      const base = {
        companyId,
        purpose: "first_party_support" as const,
        funder: "blentera_platform" as const,
        profileId: "fixture-support-profile",
        profileHash: "f".repeat(64),
        providerAccountId: "fixture-platform-account",
        credentialBindingHash: "a".repeat(64),
        periodKey: "fixture-period",
        periodStartsAt: new Date(Date.now() - 60_000).toISOString(),
        periodEndsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxCostMinor: 50,
        maxCalls: 10,
        tariff: { ...tariff(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() },
        ...overrides,
      };
      const { profileHash: _profileHash, ...immutable } = base;
      return { ...base, profileHash: nativeSha256(immutable) };
    };
    const makeJevFunding = (companyId: string, overrides: Partial<CompanyPurposeFunding> = {}): CompanyPurposeFunding => {
      const base = {
        companyId, purpose: "decision_skill_suggestion" as const, funder: "company_connection" as const,
        profileId: "fixture-jev-skill-profile", profileHash: "f".repeat(64), providerAccountId: "fixture-company-openrouter-account",
        credentialBindingHash: "a".repeat(64), periodKey: "fixture-jev-period", periodStartsAt: new Date(Date.now() - 60_000).toISOString(),
        periodEndsAt: new Date(Date.now() + 60 * 60_000).toISOString(), maxCostMinor: 5, maxCalls: 3,
        tariff: { ...tariff(), provider: "openrouter" as const, model: "typesafe/jev-1.13", inputMinorPerMillion: 1000, outputMinorPerMillion: 1000,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }, ...overrides,
      };
      const { profileHash: _profileHash, ...immutable } = base;
      return { ...base, profileHash: nativeSha256(immutable) };
    };
    const changeCurrentSupportFunding = (overrides: Partial<CompanyPurposeFunding>) => {
      const current = supportFunding!;
      return makeSupportFunding(f.home, {
        periodKey: current.periodKey,
        periodStartsAt: current.periodStartsAt,
        periodEndsAt: current.periodEndsAt,
        ...overrides,
      });
    };
    const supportRequest = (idempotencyKey = "support-fixture-reservation") => ({
      companyId: f.home,
      idempotencyKey,
      inputHash: "d".repeat(64),
      authorityHash,
      inputTokensUpperBound: 1,
      maxOutputTokens: 1,
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
    it("requires a current accountable Agent run and active Worker attempt for decision-shadow spend", async () => {
      const [task] = await db.select().from(issues).where(eq(issues.id, plan.issueId));
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
        status: "running", runtimeMode: "native", nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id } }).returning();
      await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), executionPrincipal: { type: "user", userId: f.userId } }).where(eq(orchestrationPlans.id, plan.id));
      await db.update(issues).set({ assigneeAgentId: f.presence.id, executionRunId: run!.id }).where(eq(issues.id, task!.id));
      const [worker] = await db.update(orchestrationWorkers).set({ status: "running", agentId: f.presence.id, attemptCount: 1 })
        .where(eq(orchestrationWorkers.planId, plan.id)).returning();
      const [attempt] = await db.insert(orchestrationWorkerAttempts).values({ companyId: f.home, planId: plan.id, workerId: worker!.id,
        agentId: f.presence.id, runId: run!.id, attempt: 1 }).returning();
      const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId: f.home, agentId: f.presence.id, runId: run!.id, onBehalfOfUserId: f.userId };
      const request = { companyId: f.home, planId: plan.id, expectedPlanVersion: plan.version, purpose: "decision_shadow" as const,
        workerId: worker!.id, workerAttemptId: attempt!.id, idempotencyKey: "decision-shadow-current-run", inputHash: "d".repeat(64), authorityHash,
        inputTokensUpperBound: 1, maxOutputTokens: 1 };
      const broker = service();
      const wrongRunActor = { ...actor, runId: randomUUID() };
      await expect(broker.reserve(wrongRunActor, { ...request, idempotencyKey: "decision-shadow-wrong-run" })).rejects.toMatchObject({ status: 403 });
      currentHash = "f".repeat(64);
      await expect(broker.reserve(actor, { ...request, idempotencyKey: "decision-shadow-stale-authority" })).rejects.toMatchObject({ status: 409 });
      currentHash = authorityHash;
      const reservation = await broker.reserve(actor, request);
      await expect(broker.claimForDispatch(actor, f.home, reservation.id)).resolves.toMatchObject({ status: "dispatched", purpose: "decision_shadow" });
      await expect(broker.reserve(actor, { ...request, idempotencyKey: "decision-shadow-over-cap" })).rejects.toMatchObject({ status: 403 });

      await db.update(orchestrationWorkerAttempts).set({ status: "failed", finishedAt: new Date() }).where(eq(orchestrationWorkerAttempts.id, attempt!.id));
      await expect(broker.claimForDispatch(actor, f.home, reservation.id)).rejects.toMatchObject({ status: 403 });
    });
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
    it("keeps taskless support funding closed without operator qualification and rejects customer-supplied funding", async () => {
      const broker = service();
      supportFunding = null;
      await expect(broker.reserveCompanyPurpose(f.actor, supportRequest())).rejects.toMatchObject({ status: 403 });
      supportFunding = makeSupportFunding(f.home);
      await expect(broker.reserveCompanyPurpose(f.actor, {
        ...supportRequest(), funder: "blentera_platform", tariff: supportFunding.tariff,
      } as never)).rejects.toThrow();
      await expect(broker.reserveCompanyPurpose(f.actor, {
        ...supportRequest(), companyId: f.guest,
      })).rejects.toMatchObject({ status: 403 });
      supportAuthorityResponses = [authorityHash, "e".repeat(64)];
      await expect(broker.reserveCompanyPurpose(f.actor, supportRequest())).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home))).toHaveLength(0);
      expect(await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home))).toHaveLength(0);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home))).toHaveLength(0);
    });
    it("admits only the registered Jev Skill purpose through the same taskless budget owner without a Support package pin", async () => {
      const broker = service(), requestInput = { ...supportRequest("jev-setup-sample"), purpose: "decision_skill_suggestion" as const };
      jevFunding = null;
      await expect(broker.reserveCompanyPurpose(f.actor, requestInput)).rejects.toMatchObject({ status: 403 });
      jevFunding = makeJevFunding(f.home, { maxCalls: 1 });
      const invalidFunding = makeJevFunding(f.home, { funder: "blentera_platform" as "company_connection" });
      jevFunding = invalidFunding;
      await expect(broker.reserveCompanyPurpose(f.actor, requestInput)).rejects.toThrow();
      expect(await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home))).toHaveLength(0);
      jevFunding = makeJevFunding(f.home, { maxCalls: 1 });
      const outcomes = await Promise.allSettled([
        broker.reserveCompanyPurpose(f.actor, { ...requestInput, idempotencyKey: "jev-setup-one" }),
        broker.reserveCompanyPurpose(f.actor, { ...requestInput, idempotencyKey: "jev-setup-two" }),
      ]);
      expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
      const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      const [budget] = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
      expect(reservation).toMatchObject({ purpose: "decision_skill_suggestion", packageVersionId: null, status: "reserved" });
      expect(budget).toMatchObject({ purpose: "decision_skill_suggestion", funder: "company_connection", reservedCalls: 1, maxCalls: 1, reservedMinor: 1, maxCostMinor: 5 });
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation!.id);
      await broker.recordCompanyPurposeOutcome(f.home, reservation!.id, { status: "failed", providerResponseHash: "a".repeat(64),
        usage: { inputTokens: 12, outputTokens: 2 }, accounting: { actualCostAmount: "0.0005166", costStatus: "reported" } });
      expect((await db.select().from(activityLog).where(eq(activityLog.action, "orchestration.company_purpose_model_outcome_recorded"))).map(row => row.details)).toContainEqual(expect.objectContaining({
        reservationId: reservation!.id, purpose: "decision_skill_suggestion", actualCostAmount: "0.0005166", costStatus: "reported", debitRetained: true,
      }));
      expect((await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, reservation!.id)))[0]).toMatchObject({ status: "unknown", purpose: "decision_skill_suggestion" });
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.id, budget!.id)))[0]).toMatchObject({ reservedMinor: 1, reservedCalls: 1 });
    });
    it("serializes concurrent platform budget-profile creation and rejects overlapping period keys", async () => {
      // Synthetic operator rows exercise only the native database budget guard.
      const first = makeSupportFunding(f.home, { profileId: "fixture-profile-a", periodKey: "period-a" });
      const second = makeSupportFunding(f.home, { profileId: "fixture-profile-b", periodKey: "period-b" });
      const values = (funding: CompanyPurposeFunding) => ({
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
      });
      const results = await Promise.allSettled([
        db.insert(orchestrationCompanyPurposeBudgets).values(values(first)).returning(),
        db.insert(orchestrationCompanyPurposeBudgets).values(values(second)).returning(),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const rows = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
      expect(rows).toHaveLength(1);
      await expect(db.insert(orchestrationCompanyPurposeBudgets).values({
        ...values(makeSupportFunding(f.guest, { profileId: "customer-self-grant", periodKey: "customer-period" })),
        funder: "customer",
      })).rejects.toThrow();
      await expect(db.update(orchestrationCompanyPurposeBudgets)
        .set({ profileHash: "0".repeat(64), maxCostMinor: 1_000_000 })
        .where(eq(orchestrationCompanyPurposeBudgets.id, rows[0]!.id))).rejects.toThrow();
    });
    it("atomically caps concurrent taskless company-purpose reservations and retains unknown exposure", async () => {
      const broker = service();
      const originalFunding = supportFunding;
      // Synthetic tariff/profile fixtures exercise the guards only; they are not
      // provider, account, or platform funding qualification evidence.
      const outcomes = await Promise.allSettled([
        broker.reserveCompanyPurpose(f.actor, supportRequest("support-one")),
        broker.reserveCompanyPurpose(f.actor, supportRequest("support-two")),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
      const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      const [budget] = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
      expect(reservation).toMatchObject({ companyId: f.home, budgetId: budget!.id, principalUserId: f.userId, maximumMinor: 30, status: "reserved" });
      expect(reservation?.packageVersionId).toBe(supportPackageVersionId);
      expect(budget).toMatchObject({ companyId: f.home, purpose: "first_party_support", funder: "blentera_platform", provider: "openai", reservedMinor: 30, reservedCalls: 1, maxCostMinor: 50, maxCalls: 10 });
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.companyId, f.home))).toHaveLength(0);
      supportFunding = makeSupportFunding(f.home, { profileId: "rotated-support-profile" });
      await expect(
        broker.reserveCompanyPurpose(f.actor, supportRequest("support-after-profile-rotation")),
      ).rejects.toThrow();
      expect(await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home))).toHaveLength(1);
      supportFunding = originalFunding;
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation!.id);
      await broker.recordCompanyPurposeOutcome(f.home, reservation!.id, { status: "unknown", providerResponseHash: null, usage: null });
      const [unknown] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(unknown?.status).toBe("unknown");
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home)))[0]?.reservedMinor).toBe(30);
      await expect(db.update(orchestrationCompanyPurposeReservations)
        .set({ status: "reserved" })
        .where(eq(orchestrationCompanyPurposeReservations.id, reservation!.id))).rejects.toThrow();
      await expect(db.update(orchestrationCompanyPurposeReservations)
        .set({ maximumMinor: 0 })
        .where(eq(orchestrationCompanyPurposeReservations.id, reservation!.id))).rejects.toThrow();
      await expect(db.update(orchestrationCompanyPurposeBudgets)
        .set({ reservedMinor: 0, reservedCalls: 0 })
        .where(eq(orchestrationCompanyPurposeBudgets.id, budget!.id))).rejects.toThrow();
      await expect(broker.reserveCompanyPurpose(f.actor, supportRequest("support-retry"))).rejects.toMatchObject({ status: 403 });
      await expect(db.delete(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, reservation!.id))).rejects.toThrow();
      await expect(db.delete(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.id, budget!.id))).rejects.toThrow();
    });
    it("requires the original company Human and unchanged source and funding profile at dispatch", async () => {
      const broker = service();
      const reservation = await broker.reserveCompanyPurpose(f.actor, supportRequest());
      supportAuthorityHash = "e".repeat(64);
      await expect(broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 409 });
      supportAuthorityHash = authorityHash;
      supportFunding = changeCurrentSupportFunding({ tariff: { ...supportFunding!.tariff, inputMinorPerMillion: 31_000_000 } });
      await expect(broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 409 });
      supportFunding = makeSupportFunding(f.home);
      await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.home));
      await expect(broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 403 });
      await broker.expire(new Date(Date.now() + 300_001));
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, reservation.id));
      expect(stored?.status).toBe("cancelled");
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home)))[0]?.reservedMinor).toBe(30);
    });
    it("keeps the exact package version pinned and refuses dispatch after that release is revoked", async () => {
      const broker = service();
      const reservation = await broker.reserveCompanyPurpose(f.actor, supportRequest("support-package-pin"));
      expect(reservation.packageVersionId).toBe(supportPackageVersionId);
      await expect(db.update(orchestrationCompanyPurposeReservations)
        .set({ packageVersionId: null })
        .where(eq(orchestrationCompanyPurposeReservations.id, reservation.id))).rejects.toThrow();
      await agentPackageService(db, {
        operatorUserIds: [f.userId],
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        sourceSha,
      }).revoke(f.actor, supportPackageVersionId);
      await expect(broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id)).rejects.toMatchObject({ status: 403 });
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, reservation.id));
      expect(stored).toMatchObject({ status: "reserved", packageVersionId: supportPackageVersionId });
    });
    it("keeps the taskless support release out of customer catalog and Agent installation", async () => {
      const publisher = agentPackageService(db, {
        operatorUserIds: [f.userId],
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        sourceSha,
      });
      expect(await publisher.catalog(f.actor)).not.toContainEqual(expect.objectContaining({ versionId: supportPackageVersionId }));
      await expect(publisher.preview(f.actor, f.home, {
        versionId: supportPackageVersionId,
        agentId: f.presence.id,
        components: [],
      })).rejects.toMatchObject({ status: 409 });
    });
    it("runs one software-only first-party Help answer through the original reservation and grounding owners", async () => {
      // This uses the real PostgreSQL publisher, reservation ledger, Human
      // session and authorized Find/Help owner. The profile and provider
      // response are explicit software fixtures; no real model is contacted.
      const profiles = [supportModelProfile(f.home, supportPackageVersionId)];
      const fetch = mockSupportTransport();
      const gateway = supportGateway(profiles, fetch as unknown as typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch);
      const consentPolicyRevision = supportAssistantPolicyRevision(profiles[0]!, sourceSha,
        [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)], "en");
      const request = {
        requestId: randomUUID(),
        expectedUserId: f.userId,
        question: "Start a company and reach your first result",
        locale: "en" as const,
        consent: true as const,
        consentPolicyRevision,
      };
      const response = await gateway.answer(f.actor, f.home, request);
      expect(response).toMatchObject({ requestId: request.requestId, kind: "guidance" });
      expect(response.citations).toHaveLength(1);
      expect(response.citations[0]).toMatchObject({
        articleId: COMPANY_SEARCH_HELP_ARTICLES[0]!.articleId,
        sourceHash: nativeSha256(COMPANY_SEARCH_HELP_ARTICLES[0]),
        locale: "en",
      });
      expect(response.citations[0]!.text).toBeTruthy();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [reservation] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(reservation).toMatchObject({
        status: "completed",
        principalUserId: f.userId,
        packageVersionId: supportPackageVersionId,
        providerResponseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        usage: { inputTokens: 100, outputTokens: 8 },
      });
      const replay = await gateway.answer(f.actor, f.home, request);
      expect(replay).toEqual({ requestId: request.requestId, kind: "already_processed", citations: [] });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it("keeps unknown transport outcomes held and does not retry, and spends nothing when Help evidence is outside the package pins", async () => {
      const profiles = [supportModelProfile(f.home, supportPackageVersionId)];
      const fetch = vi.fn(async () => { throw new Error("software transport failure"); });
      const gateway = supportGateway(profiles, fetch as unknown as typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch);
      const consentPolicyRevision = supportAssistantPolicyRevision(profiles[0]!, sourceSha,
        [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)], "en");
      const request = {
        requestId: randomUUID(), expectedUserId: f.userId,
        question: "Developer and advanced documentation", locale: "en" as const, consent: true as const, consentPolicyRevision,
      };
      const staleConsent = { ...request, requestId: randomUUID(), question: "Start a company and reach your first result",
        consentPolicyRevision: "f".repeat(64) };
      expect(await gateway.answer(f.actor, f.home, staleConsent)).toEqual({
        requestId: staleConsent.requestId, kind: "unavailable", citations: [],
      });
      await expect(gateway.answer(f.actor, f.home, { ...staleConsent, requestId: randomUUID(), expectedUserId: "different-human" }))
        .rejects.toMatchObject({ status: 403 });
      expect(await gateway.answer(f.actor, f.guest, { ...staleConsent, requestId: randomUUID(), expectedUserId: f.userId }))
        .toMatchObject({ kind: "unavailable" });
      expect(fetch).not.toHaveBeenCalled();
      const response = await gateway.answer(f.actor, f.home, request);
      expect(response).toEqual({ requestId: request.requestId, kind: "cannot_verify", citations: [] });
      expect(fetch).not.toHaveBeenCalled();
      expect(await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home))).toHaveLength(0);

      const approved = { ...request, requestId: randomUUID(), question: "Start a company and reach your first result" };
      expect(await gateway.answer(f.actor, f.home, approved)).toMatchObject({ kind: "unknown" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [unknown] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(unknown).toMatchObject({ status: "unknown", packageVersionId: supportPackageVersionId });
      expect(await gateway.answer(f.actor, f.home, approved)).toEqual({ requestId: approved.requestId, kind: "unknown", citations: [] });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    it("settles provider usage after Human membership is revoked during dispatch but withholds the Help quote", async () => {
      const profiles = [supportModelProfile(f.home, supportPackageVersionId)];
      let signalStarted!: () => void;
      const started = new Promise<void>(resolve => { signalStarted = resolve; });
      let releaseResponse!: () => void;
      const released = new Promise<void>(resolve => { releaseResponse = resolve; });
      const fetch = vi.fn(async (_url: string | URL, init: RequestInit) => {
        const response = supportTransportResponse(init);
        signalStarted();
        await released;
        return response;
      });
      const gateway = supportGateway(profiles, fetch as unknown as typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch);
      const consentPolicyRevision = supportAssistantPolicyRevision(profiles[0]!, sourceSha,
        [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)], "en");
      const request = {
        requestId: randomUUID(), expectedUserId: f.userId,
        question: "Start a company and reach your first result", locale: "en" as const, consent: true as const, consentPolicyRevision,
      };
      const pending = gateway.answer(f.actor, f.home, request);
      await started;
      await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.home));
      releaseResponse();
      expect(await pending).toEqual({ requestId: request.requestId, kind: "cannot_verify", citations: [] });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(stored).toMatchObject({ status: "completed", usage: { inputTokens: 100, outputTokens: 8 } });
    });
    it("withholds citations but settles actual usage when the pinned package is revoked in flight", async () => {
      const profiles = [supportModelProfile(f.home, supportPackageVersionId)];
      let signalStarted!: () => void;
      const started = new Promise<void>(resolve => { signalStarted = resolve; });
      let releaseResponse!: () => void;
      const released = new Promise<void>(resolve => { releaseResponse = resolve; });
      const fetch = vi.fn(async (_url: string | URL, init: RequestInit) => {
        const response = supportTransportResponse(init);
        signalStarted();
        await released;
        return response;
      });
      const gateway = supportGateway(profiles, fetch as unknown as typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch);
      const request = {
        requestId: randomUUID(), expectedUserId: f.userId,
        question: "Start a company and reach your first result", locale: "en" as const, consent: true as const,
        consentPolicyRevision: supportAssistantPolicyRevision(profiles[0]!, sourceSha,
          [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)], "en"),
      };
      const pending = gateway.answer(f.actor, f.home, request);
      await started;
      await agentPackageService(db, {
        operatorUserIds: [f.userId],
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        sourceSha,
      }).revoke(f.actor, supportPackageVersionId);
      releaseResponse();
      expect(await pending).toEqual({ requestId: request.requestId, kind: "cannot_verify", citations: [] });
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(stored).toMatchObject({ status: "completed", usage: { inputTokens: 100, outputTokens: 8 }, packageVersionId: supportPackageVersionId });
    });
    it("withholds citations but settles actual usage when the deployment funding profile disappears in flight", async () => {
      const profiles = [supportModelProfile(f.home, supportPackageVersionId)];
      let signalStarted!: () => void;
      const started = new Promise<void>(resolve => { signalStarted = resolve; });
      let releaseResponse!: () => void;
      const released = new Promise<void>(resolve => { releaseResponse = resolve; });
      const fetch = vi.fn(async (_url: string | URL, init: RequestInit) => {
        const response = supportTransportResponse(init);
        signalStarted();
        await released;
        return response;
      });
      const gateway = supportGateway(profiles, fetch as unknown as typeof import("../services/remote-http-fetch.js").guardedRemoteHttpFetch);
      const request = {
        requestId: randomUUID(), expectedUserId: f.userId,
        question: "Start a company and reach your first result", locale: "en" as const, consent: true as const,
        consentPolicyRevision: supportAssistantPolicyRevision(profiles[0]!, sourceSha,
          [supportGuideKnowledgePin(COMPANY_SEARCH_HELP_ARTICLES[0]!)], "en"),
      };
      const pending = gateway.answer(f.actor, f.home, request);
      await started;
      profiles.splice(0, 1);
      releaseResponse();
      expect(await pending).toEqual({ requestId: request.requestId, kind: "cannot_verify", citations: [] });
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations)
        .where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(stored).toMatchObject({ status: "completed", usage: { inputTokens: 100, outputTokens: 8 } });
    });
    it("bounds taskless invocations even when a qualified fixture tariff computes zero minor units", async () => {
      supportFunding = makeSupportFunding(f.home, {
        maxCalls: 1,
        tariff: { ...tariff(), inputMinorPerMillion: 0 },
      });
      const broker = service();
      const first = await broker.reserveCompanyPurpose(f.actor, supportRequest("zero-cost-first"));
      expect(first.maximumMinor).toBe(0);
      await expect(
        broker.reserveCompanyPurpose(f.actor, supportRequest("zero-cost-second")),
      ).rejects.toMatchObject({ status: 403 });
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home)))[0]).toMatchObject({
        reservedMinor: 0,
        reservedCalls: 1,
        maxCalls: 1,
      });
    });
    it("rechecks the original Human, source and funding profile before returning completed support content", async () => {
      const broker = service();
      const reservation = await broker.reserveCompanyPurpose(f.actor, supportRequest());
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id);
      await broker.recordCompanyPurposeOutcome(f.home, reservation.id, {
        status: "completed",
        providerResponseHash: "e".repeat(64),
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      await broker.assertCompanyPurposeResponseReturn(f.actor, f.home, reservation.id);
      supportAuthorityHash = "f".repeat(64);
      await expect(
        broker.assertCompanyPurposeResponseReturn(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 409 });
      supportAuthorityHash = authorityHash;
      supportFunding = changeCurrentSupportFunding({
        tariff: { ...supportFunding!.tariff, outputMinorPerMillion: 1 },
      });
      await expect(
        broker.assertCompanyPurposeResponseReturn(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 409 });
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(
        orchestrationCompanyPurposeReservations.id,
        reservation.id,
      ));
      expect(stored?.status).toBe("completed");
      expect(stored).not.toHaveProperty("response");
    });
    it("settles a dispatched call after principal revocation but refuses content return", async () => {
      const broker = service();
      const reservation = await broker.reserveCompanyPurpose(f.actor, supportRequest());
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id);
      await db.delete(companyMemberships).where(eq(companyMemberships.companyId, f.home));
      await expect(broker.recordCompanyPurposeOutcome(f.home, reservation.id, {
        status: "completed",
        providerResponseHash: "e".repeat(64),
        usage: { inputTokens: 1, outputTokens: 1 },
      })).resolves.toMatchObject({ status: "completed" });
      await expect(
        broker.assertCompanyPurposeResponseReturn(f.actor, f.home, reservation.id),
      ).rejects.toMatchObject({ status: 403 });
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home)))[0]).toMatchObject({ reservedMinor: 30, reservedCalls: 1 });
    });
    it("keeps unknown spend held when the original provider account cannot prove a late result", async () => {
      const broker = service();
      const reservation = await broker.reserveCompanyPurpose(f.actor, supportRequest("unknown-unproven"));
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, reservation.id);
      await broker.recordCompanyPurposeOutcome(f.home, reservation.id, { status: "unknown", providerResponseHash: null, usage: null });
      await expect(broker.reconcileUnknownCompanyPurposeOutcome(f.home, reservation.id)).rejects.toMatchObject({ status: 409 });
      const [stored] = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, reservation.id));
      expect(stored?.status).toBe("unknown");
      expect((await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home)))[0]).toMatchObject({ reservedMinor: 30, reservedCalls: 1 });
    });
    it("cancels undispatched holds, waits for dispatched outcomes, then purges only through the canonical offboarding receipt", async () => {
      supportFunding = makeSupportFunding(f.home, { maxCostMinor: 100 });
      const broker = service();
      const dispatched = await broker.reserveCompanyPurpose(f.actor, supportRequest("purge-dispatched"));
      const pending = await broker.reserveCompanyPurpose(f.actor, supportRequest("purge-pending"));
      await broker.claimCompanyPurposeForDispatch(f.actor, f.home, dispatched.id);
      await agentIdentityService(db).rehome(f.actor, f.home, f.identity.id, f.guest);
      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, f.home));
      let objectEraseCalls = 0;
      const offboarding = saasOffboardingService(db, {} as never, {} as never, {
        targets: () => ({ fixture: true }),
        erase: async () => { objectEraseCalls++; return { fixtureErased: true }; },
      } as never);
      await offboarding.request(f.home, f.userId, {
        confirmation: company!.name,
        acknowledgeExport: true,
        idempotencyKey: "fixture-offboarding-operation",
      });
      await db.update(companyDeletionOperations).set({ stage: "purge", status: "processing", notBefore: new Date(0) })
        .where(eq(companyDeletionOperations.companyId, f.home));
      await expect(broker.reserveCompanyPurpose(f.actor, supportRequest("late-after-offboarding"))).rejects.toMatchObject({ status: 403 });
      const [existingBudget] = await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home));
      await expect(db.insert(orchestrationCompanyPurposeBudgets).values({
        ...existingBudget!, id: randomUUID(), periodKey: "late-after-offboarding",
      })).rejects.toThrow();
      await expect(db.insert(orchestrationCompanyPurposeReservations).values({
        ...pending, id: randomUUID(), idempotencyKey: "late-after-offboarding",
        requestHash: nativeSha256("late-after-offboarding"),
      })).rejects.toThrow();
      await expect(purgeCompanyContent(db, f.home)).rejects.toMatchObject({ status: 409 });
      const afterRefusal = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home));
      expect(afterRefusal.find((row) => row.id === dispatched.id)?.status).toBe("dispatched");
      expect(afterRefusal.find((row) => row.id === pending.id)?.status).toBe("reserved");
      expect(await offboarding.processOne(new Date(Date.now() + 1000))).toBe(false);
      expect(objectEraseCalls).toBe(0);
      const cancelled = await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, pending.id));
      expect(cancelled[0]?.status).toBe("cancelled");
      await broker.recordCompanyPurposeOutcome(f.home, dispatched.id, { status: "unknown", providerResponseHash: null, usage: null });
      lateProofEnabled = true;
      lateProofAccountMismatch = true;
      await expect(broker.reconcileUnknownCompanyPurposeOutcome(f.home, dispatched.id)).rejects.toMatchObject({ status: 409 });
      expect((await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.id, dispatched.id)))[0]?.status).toBe("unknown");
      lateProofAccountMismatch = false;
      await expect(broker.reconcileUnknownCompanyPurposeOutcome(f.home, dispatched.id)).resolves.toMatchObject({ status: "completed" });
      expect(await offboarding.processOne(new Date(Date.now() + 2000))).toBe(true);
      expect(objectEraseCalls).toBe(1);
      expect(await offboarding.get(f.home)).toMatchObject({ status: "completed", stage: "completed", errorCode: null });
      expect(await db.select().from(orchestrationCompanyPurposeBudgets).where(eq(orchestrationCompanyPurposeBudgets.companyId, f.home))).toHaveLength(0);
      expect(await db.select().from(orchestrationCompanyPurposeReservations).where(eq(orchestrationCompanyPurposeReservations.companyId, f.home))).toHaveLength(0);
      const receipt = await offboarding.get(f.home);
      expect(receipt?.evidence).toMatchObject({ platformModelFunding: { budgets: "1", maximumReservedMinorExposure: "60", invocationCount: "2", completed: "1", cancelled: "1", settledInputTokens: "1", settledOutputTokens: "1" } });
    });
  },
);
