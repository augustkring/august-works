import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  agents,
  issues,
  documents,
  documentRevisions,
  issueDocuments,
  companyMemberships,
  connectionGrants,
  orchestrationPlans,
  orchestrationWorkers,
  orchestrationWorkerAttempts,
  heartbeatRuns,
  orchestrationModelReservations,
  verificationRuns,
  supervisionInterventions,
  issueThreadInteractions,
} from "@paperclipai/db";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { readOnlyModelVerifier } from "../services/supervision/read-only-model-verifier.js";
import type { ReadOnlyModelProfile } from "../services/orchestration/read-only-model-profiles.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { supervisionService } from "../services/supervision/supervision-service.js";
import { ensureSupervisionSession } from "../services/supervision/supervision-outbox.js";
const sourceSha = "a".repeat(40),
  credential = "fixture-encrypted-secret-123456789";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "native read-only model consumer",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      home: string;
    let f: Awaited<ReturnType<typeof seedV5Presences>>,
      plan: typeof orchestrationPlans.$inferSelect,
      profile: ReadOnlyModelProfile;
    let calls: number,
      observedBody: string,
      observedKey: string,
      duringCall: (() => Promise<void>) | undefined;
    let inputUsage: number, stopReason: string;
    beforeAll(async () => {
      home = await mkdtemp(join(tmpdir(), "aw-v7-private-model-fixture-"));
      vi.stubEnv("PAPERCLIP_HOME", home);
      vi.stubEnv("PAPERCLIP_INSTANCE_ID", "v7-private-model-fixture");
      database = await startEmbeddedPostgresTestDatabase(
        "aw-v7-native-semantic-",
      );
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      vi.unstubAllEnvs();
      if (home) await rm(home, { recursive: true, force: true });
    }, 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        enableWorkflowsV1: true,
        readiness_engine_v7: true,
        orchestration_v7: true,
        supervision_v7: true,
        verifier_v7: true,
      });
      f = await seedV5Presences(db);
      const reviewer = await agentIdentityService(db).create(f.actor, {
        name: "Independent fixture reviewer",
        homeCompanyId: f.home,
      });
      await db
        .update(agents)
        .set({ adapterType: "claude_local" })
        .where(eq(agents.id, reviewer.presence.id));
      const connection = await aiConnectionService(db).save(
        f.home,
        f.userId,
        {
          provider: "anthropic",
          method: "api_key",
          ownership: "shared",
          name: "Private encrypted fixture provider",
          apiKey: "fixture",
          allAgents: false,
          agentIds: [reviewer.presence.id],
        },
        credential,
      );
      profile = {
        id: randomUUID(),
        companyId: f.home,
        reviewerAgentId: reviewer.presence.id,
        binding: {
          provider: "anthropic",
          method: "api_key",
          mode: "shared",
          ...connection,
        },
        contract: "anthropic-text-messages-2023-06-01",
        maximumEnvelopeBytes: 128000,
        inputTokensUpperBound: 500000,
        maxOutputTokens: 1024,
        tariff: {
          provider: "anthropic",
          model: "fixture-model-20261005",
          currency: "USD",
          inputMinorPerMillion: 0,
          outputMinorPerMillion: 0,
          fixedMinor: 3,
          qualificationHash: "b".repeat(64),
          sourceSha,
          testedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        qualificationEvidenceRef:
          "https://protected.test.invalid/qualification/fixture-only.json",
        qualificationArtifactSha256: "c".repeat(64),
        calibrationHash: "d".repeat(64),
      };
      const [task] = await db
        .insert(issues)
        .values({
          companyId: f.home,
          title: "Check a retained authorized fixture draft",
          status: "todo",
          assigneeAgentId: f.presence.id,
        })
        .returning();
      plan = await orchestrationService(db).create(f.actor, f.home, {
        issueId: task!.id,
        expectedIssueUpdatedAt: task!.updatedAt.toISOString(),
        riskClass: "C0",
        workload: "semantic",
        completionContract: {
          objective: "Save the retained evidence draft",
          requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Every claim uses authorized evidence"],
        },
        budgets: {},
        workers: [{ key: "worker", issueId: task!.id }],
      });
      // This local fixture exercises native consumer boundaries, not actual worker
      // execution, qualified pricing/calibration, provider billing or a pilot.
      await db
        .update(orchestrationPlans)
        .set({
          status: "running",
          startedAt: new Date(),
          executionPrincipal: { type: "user", userId: f.userId },
        })
        .where(eq(orchestrationPlans.id, plan.id));
      const [doc] = await db
        .insert(documents)
        .values({
          companyId: f.home,
          title: "Result",
          latestBody:
            "Retained source evidence for independent fixture assessment",
        })
        .returning();
      const [revision] = await db
        .insert(documentRevisions)
        .values({
          companyId: f.home,
          documentId: doc!.id,
          revisionNumber: 1,
          body: doc!.latestBody,
        })
        .returning();
      await db
        .update(documents)
        .set({ latestRevisionId: revision!.id })
        .where(eq(documents.id, doc!.id));
      await db
        .insert(issueDocuments)
        .values({
          companyId: f.home,
          issueId: task!.id,
          documentId: doc!.id,
          key: "result",
        });
      calls = 0;
      observedBody = "";
      observedKey = "";
      duringCall = undefined;
      inputUsage = 10;
      stopReason = "end_turn";
    });
    const fetch: typeof guardedRemoteHttpFetch = async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      observedBody = String(init.body);
      observedKey = new Headers(init.headers).get("x-api-key")!;
      const wire = JSON.parse(observedBody),
        packet = JSON.parse(wire.messages[0].content[0].text).packet;
      await duringCall?.();
      const assessment = {
        expectedPlanVersion: packet.planVersion,
        workerId: packet.workerId,
        expectedResultHash: packet.resultHash,
        result: "pass",
        rationale: "Local provider fixture recommends the retained draft",
        objectiveSatisfied: true,
        businessInvariants: [
          { index: 0, satisfied: true, evidenceRefs: [packet.evidence[0].ref] },
        ],
        evidenceRequirements: [],
        prohibitedOutcomes: [],
        uncertainties: [],
        explicitHighImpactApproval: false,
      };
      return new Response(
        JSON.stringify({
          type: "message",
          role: "assistant",
          model: wire.model,
          stop_reason: stopReason,
          content: [{ type: "text", text: JSON.stringify(assessment) }],
          usage: { input_tokens: inputUsage, output_tokens: 10 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const verifier = () =>
      readOnlyModelVerifier(db, {
        profiles: [profile],
        sourceSha,
        protectedEvidenceOrigin: "https://protected.test.invalid",
        fetch,
      });
    const request = (key = "native-fixture-review") => ({
      companyId: f.home,
      planId: plan.id,
      workerId: null,
      idempotencyKey: key,
    });
    const ledger = () =>
      db
        .select()
        .from(orchestrationModelReservations)
        .where(
          and(
            eq(orchestrationModelReservations.companyId, f.home),
            eq(orchestrationModelReservations.planId, plan.id),
          ),
        );
    it("uses the actual encrypted grant with a native debit and never lets model pass hide a missing canonical worker result", async () => {
      const service = verifier(),
        result = await service.verify(f.actor, request());
      expect(calls).toBe(1);
      expect(observedKey).toBe(credential);
      expect(observedBody).not.toContain(credential);
      expect(result.result).toBe("fail"); // No actual successful canonical attempt exists in this fixture.
      const [record] = await ledger();
      expect(record).toMatchObject({
        status: "completed",
        maximumMinor: 3,
        purpose: "read_only_verification",
        principalUserId: f.userId,
      });
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      expect(current).toMatchObject({
        modelCostReserved: 3,
        verifierCallsUsed: 1,
        status: "paused",
      });
      const [review] = await db
        .select()
        .from(verificationRuns)
        .where(eq(verificationRuns.id, result.id));
      expect(review).toMatchObject({
        reviewerType: "model",
        modelReservationId: record!.id,
        review: null,
        recommendation: "ESCALATE_HUMAN",
      });
      expect(JSON.stringify(review)).not.toContain(credential);
      await expect(
        db
          .update(verificationRuns)
          .set({ result: "pass" })
          .where(eq(verificationRuns.id, result.id)),
      ).rejects.toThrow();
      expect(
        (await db.select().from(issues).where(eq(issues.id, plan.issueId)))[0]!
          .status,
      ).toBe("todo");
      await expect(service.verify(f.actor, request())).rejects.toThrow();
      expect(calls).toBe(1);
    });
    it("serializes two consumers of one spend identity and refuses a new call beyond the cumulative verifier budget", async () => {
      const service = verifier(),
        outcomes = await Promise.allSettled([
          service.verify(f.actor, request()),
          service.verify(f.actor, request()),
        ]);
      expect(calls).toBe(1);
      expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
      expect(await ledger()).toHaveLength(1);
      await expect(
        service.verify(f.actor, request("different-call")),
      ).rejects.toThrow(/budget/);
      expect(calls).toBe(1);
    });
    it("retains human completion authority even when canonical fixture checks and the model recommendation both pass", async () => {
      const [worker] = await db
        .select()
        .from(orchestrationWorkers)
        .where(eq(orchestrationWorkers.planId, plan.id));
      // A persisted local canonical outcome, not actual provider/pilot evidence.
      const [run] = await db
        .insert(heartbeatRuns)
        .values({
          companyId: f.home,
          agentId: f.presence.id,
          responsibleUserId: f.userId,
          status: "succeeded",
          contextSnapshot: { issueId: plan.issueId },
        })
        .returning();
      await db
        .insert(orchestrationWorkerAttempts)
        .values({
          companyId: f.home,
          planId: plan.id,
          workerId: worker!.id,
          agentId: f.presence.id,
          runId: run!.id,
          attempt: 1,
          status: "succeeded",
          finishedAt: new Date(),
        });
      const result = await verifier().verify(f.actor, request());
      expect(result.result).toBe("needs_human");
      expect(calls).toBe(1);
      expect(
        (await db.select().from(issues).where(eq(issues.id, plan.issueId)))[0]!
          .status,
      ).toBe("todo");
      await expect(
        db
          .update(orchestrationPlans)
          .set({ status: "completed" })
          .where(eq(orchestrationPlans.id, plan.id)),
      ).rejects.toThrow();
      expect(await verifier().verify(f.actor, request())).toEqual(result);
      expect(calls).toBe(1);
    });
    it("rejects cross-company, expired/revision-drifted profiles and worker self-review before any credential use", async () => {
      await expect(
        verifier().verify(f.actor, { ...request(), companyId: f.guest }),
      ).rejects.toThrow();
      profile.reviewerAgentId = f.presence.id;
      await expect(verifier().verify(f.actor, request())).rejects.toThrow(
        /own semantic verifier/,
      );
      profile.tariff.sourceSha = "e".repeat(40);
      await expect(verifier().verify(f.actor, request())).rejects.toThrow(
        /qualification_unavailable/,
      );
      profile.tariff.sourceSha = sourceSha;
      profile.tariff.expiresAt = new Date(0).toISOString();
      await expect(verifier().verify(f.actor, request())).rejects.toThrow(
        /qualification_unavailable/,
      );
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
    });
    it.each(["grant", "membership", "flag", "source"])(
      "rejects a late result after native %s revocation and retains the uncertain debit",
      async (kind) => {
        duringCall = async () => {
          if (kind === "grant")
            await db
              .update(connectionGrants)
              .set({ status: "revoked" })
              .where(
                eq(
                  connectionGrants.id,
                  profile.binding.mode !== "responsible_user"
                    ? profile.binding.grantId
                    : "",
                ),
              );
          if (kind === "membership")
            await db
              .update(companyMemberships)
              .set({ status: "suspended" })
              .where(
                and(
                  eq(companyMemberships.companyId, f.home),
                  eq(companyMemberships.principalId, f.userId),
                ),
              );
          if (kind === "flag")
            await instanceSettingsService(db).updateExperimental({
              verifier_v7: false,
            });
          if (kind === "source") {
            const [link] = await db
              .select()
              .from(issueDocuments)
              .where(
                and(
                  eq(issueDocuments.companyId, f.home),
                  eq(issueDocuments.issueId, plan.issueId),
                  eq(issueDocuments.key, "result"),
                ),
              );
            await db
              .update(documents)
              .set({
                latestBody:
                  "The prior retained source changed during inference",
              })
              .where(eq(documents.id, link!.documentId));
          }
        };
        await expect(
          verifier().verify(f.actor, request()),
        ).rejects.toMatchObject({ status: 409 });
        expect(calls).toBe(1);
        expect((await ledger())[0]).toMatchObject({
          status: "unknown",
          maximumMinor: 3,
        });
        expect(
          await db
            .select()
            .from(verificationRuns)
            .where(eq(verificationRuns.planId, plan.id)),
        ).toHaveLength(0);
        await expect(verifier().verify(f.actor, request())).rejects.toThrow();
        expect(calls).toBe(1);
      },
    );
    it("does not refund or retry a usage-ceiling violation or truncated model answer", async () => {
      inputUsage = profile.inputTokensUpperBound + 1;
      await expect(verifier().verify(f.actor, request())).rejects.toMatchObject(
        { status: 409 },
      );
      expect((await ledger())[0]!.status).toBe("unknown");
      await expect(verifier().verify(f.actor, request())).rejects.toThrow();
      expect(calls).toBe(1);
      await expect(
        db
          .update(orchestrationPlans)
          .set({ verifierCallsUsed: 0, modelCostReserved: 0 })
          .where(eq(orchestrationPlans.id, plan.id)),
      ).rejects.toThrow();
    });
    it("consumes the existing leased START_VERIFIER delivery and retains the accountable human review request", async () => {
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      const session = await db.transaction((tx) =>
        ensureSupervisionSession(tx, current!),
      );
      const [job] = await db
        .insert(supervisionInterventions)
        .values({
          companyId: f.home,
          planId: plan.id,
          sessionId: session.id,
          recommendation: "START_VERIFIER",
          decisionAction: "START_VERIFIER",
          reasonCode: "fixture-independent-review",
          policySnapshotHash: "f".repeat(64),
          expectedPlanVersion: plan.version,
          requestedByType: "system",
          requestedById: "supervision",
          idempotencyKey: `fixture:${plan.id}`,
          status: "pending",
        })
        .returning();
      const supervisor = supervisionService(db, {
        semanticVerifier: verifier(),
      });
      expect(await supervisor.deliverStops(20, f.home)).toEqual({
        applied: 2,
        failed: 0,
      });
      expect(calls).toBe(1);
      expect(
        (
          await db
            .select()
            .from(supervisionInterventions)
            .where(eq(supervisionInterventions.id, job!.id))
        )[0]!.status,
      ).toBe("applied");
      expect(
        await db
          .select()
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, f.home),
              eq(issueThreadInteractions.issueId, plan.issueId),
            ),
          ),
      ).toHaveLength(1);
      expect(await supervisor.deliverStops(20, f.home)).toEqual({
        applied: 0,
        failed: 0,
      });
      expect(calls).toBe(1);
    });
    it("pauses and requests human review when configured model qualification expires without spending or retrying", async () => {
      profile.tariff.expiresAt = new Date(0).toISOString();
      const [current] = await db
        .select()
        .from(orchestrationPlans)
        .where(eq(orchestrationPlans.id, plan.id));
      const session = await db.transaction((tx) =>
        ensureSupervisionSession(tx as unknown as typeof db, current!),
      );
      await db
        .insert(supervisionInterventions)
        .values({
          companyId: f.home,
          planId: plan.id,
          sessionId: session.id,
          recommendation: "START_VERIFIER",
          decisionAction: "START_VERIFIER",
          reasonCode: "expired-private-model-qualification",
          policySnapshotHash: "f".repeat(64),
          expectedPlanVersion: plan.version,
          requestedByType: "system",
          requestedById: "supervision",
          idempotencyKey: `fixture-expired:${plan.id}`,
          status: "pending",
        });
      const supervisor = supervisionService(db, {
        semanticVerifier: verifier(),
      });
      expect(await supervisor.deliverStops(20, f.home)).toEqual({
        applied: 2,
        failed: 0,
      });
      expect(calls).toBe(0);
      expect(await ledger()).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(orchestrationPlans)
            .where(eq(orchestrationPlans.id, plan.id))
        )[0]!.status,
      ).toBe("paused");
      expect(
        await db
          .select()
          .from(issueThreadInteractions)
          .where(
            and(
              eq(issueThreadInteractions.companyId, f.home),
              eq(issueThreadInteractions.issueId, plan.issueId),
            ),
          ),
      ).toHaveLength(1);
      expect(await supervisor.deliverStops(20, f.home)).toEqual({
        applied: 0,
        failed: 0,
      });
    });
  },
);
