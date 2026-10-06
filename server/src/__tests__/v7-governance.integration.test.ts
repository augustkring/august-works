import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  issues,
  agents,
  heartbeatRuns,
  aiUseCases,
  aiUseCaseVersions,
  aiUseCaseAssessments,
  aiUseCaseDeployments,
  governanceStopActions,
  companySkills,
  aiUseCaseChangeEvents,
  governanceObligations,
} from "@paperclipai/db";
import {
  PROVIDER_CAPABILITY_FEATURES,
  type AIUseCaseView,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { purpose, oversight, reviews } from "./helpers/governance-fixture.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import {
  assertExecutionGovernance,
  governanceToolRestriction,
  governedNativeTaskRunFields,
} from "../services/ai-governance/execution-gate.js";
import { governanceEvidencePack } from "../services/ai-governance/evidence-pack.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import {
  reconcileGovernanceDeployments,
  deliverGovernanceStops,
} from "../services/ai-governance/governance-jobs.js";
import { assertAgentRunWriteAllowed } from "../agent-run-cancellation.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V7 versioned intended-purpose governance and durable native Stop",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      task: typeof issues.$inferSelect,
      useCase: AIUseCaseView;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-governance-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        ai_use_cases_v7: true,
        governance_evidence_v7: false,
      });
      f = await seedV5Presences(db);
      const provider = agentProviderBindingService(db),
        binding = await provider.create(f.actor, f.home, f.presence.id, {
          providerType: "paperclip_native",
          providerAgentRef: f.presence.id,
          isolationMode: "isolated_per_presence",
          providerEndpointRef: null,
        });
      await provider.attach(f.actor, f.home, f.presence.id, {
        providerBindingId: binding.id,
        providerProfileRef: f.presence.id,
      });
      await provider.recordDiscovery(
        f.home,
        f.presence.id,
        {
          provider: "paperclip_native",
          version: "local-governance-protocol-fixture",
          features: Object.fromEntries(
            PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false]),
          ) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>,
          skills: [],
          tools: [],
          discoveredAt: new Date().toISOString(),
        },
        {
          connect: true,
          identity: true,
          start: true,
          stream: true,
          wait: true,
          cancel: true,
          memoryScoping: true,
        },
      );
      [task] = (await db
        .insert(issues)
        .values({
          companyId: f.home,
          title: "Prepare a reviewed campaign analysis",
          status: "in_progress",
          assigneeAgentId: f.presence.id,
        })
        .returning()) as [typeof task];
      const profile = await aiGovernanceService(db).oversight(
        f.actor,
        f.home,
        oversight,
      );
      useCase = await aiGovernanceService(db).create(f.actor, f.home, {
        key: "campaign-analysis",
        purpose: {
          ...purpose(),
          riskClass: "C0",
          oversightProfileId: profile.id,
        },
      });
    });
    const decision = (expectedVersion: number) => ({
      expectedVersion,
      rationale:
        "Review the exact deployment facts and current intended purpose",
    });
    async function approve() {
      for (const review of reviews()) {
        await aiGovernanceService(db).assess(f.actor, f.home, useCase.id, {
          ...review,
          expectedVersion: useCase.version,
        });
        useCase.version++;
      }
      useCase = await aiGovernanceService(db).decide(
        f.actor,
        f.home,
        useCase.id,
        "approve",
        decision(useCase.version),
      );
    }
    const bind = () =>
      aiGovernanceService(db).bind(f.actor, f.home, useCase.id, {
        expectedVersion: useCase.version,
        issueId: task.id,
        agentId: f.presence.id,
      });
    const run = async () =>
      (
        await db
          .insert(heartbeatRuns)
          .values({
            companyId: f.home,
            agentId: f.presence.id,
            nativeIssueId: task.id,
            responsibleUserId: f.userId,
            invocationSource: "on_demand",
            status: "running",
          })
          .returning()
      )[0]!;
    it("pins real native queue provenance and does not let an old session adopt a newly approved purpose", async () => {
      const [legacy] = await db
        .insert(heartbeatRuns)
        .values({
          companyId: f.home,
          agentId: f.presence.id,
          invocationSource: "on_demand",
          status: "running",
          contextSnapshot: { issueId: task.id },
        })
        .returning();
      expect(
        await governedNativeTaskRunFields(db, f.home, f.presence.id, task.id),
      ).toEqual({});
      await approve();
      const deployment = await bind();
      const fields = await governedNativeTaskRunFields(
        db,
        f.home,
        f.presence.id,
        task.id,
      );
      expect(fields).toEqual({ nativeIssueId: task.id });
      const [queued] = await db
        .insert(heartbeatRuns)
        .values({
          ...fields,
          companyId: f.home,
          agentId: f.presence.id,
          invocationSource: "on_demand",
          status: "queued",
          contextSnapshot: { issueId: task.id },
        })
        .returning();
      expect(queued!.contextSnapshot?.governanceDeploymentId).toBe(
        deployment.id,
      );
      await db
        .update(heartbeatRuns)
        .set({ contextSnapshot: { issueId: task.id, nativeProgress: true } })
        .where(eq(heartbeatRuns.id, queued!.id));
      expect(
        (
          await db
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, queued!.id))
        )[0]!.contextSnapshot?.governanceDeploymentId,
      ).toBe(deployment.id);
      await expect(
        db
          .update(heartbeatRuns)
          .set({
            contextSnapshot: {
              issueId: task.id,
              governanceDeploymentId: deployment.id,
            },
          })
          .where(eq(heartbeatRuns.id, legacy!.id)),
      ).rejects.toThrow();
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, legacy!.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db
          .select()
          .from(governanceStopActions)
          .where(eq(governanceStopActions.runId, legacy!.id)),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "queued" })]),
      );
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, queued!.id),
      ).rejects.toMatchObject({ status: 403 });
      await db
        .update(heartbeatRuns)
        .set({ status: "running" })
        .where(eq(heartbeatRuns.id, queued!.id));
      await assertExecutionGovernance(db, f.home, f.presence.id, queued!.id);
    });
    it("keeps versioned obligation reviews and closes execution until uncertainty is resolved", async () => {
      await approve();
      await bind();
      const execution = await run();
      await instanceSettingsService(db).updateExperimental({
        governance_evidence_v7: true,
      });
      const obligation = {
        framework: "company_policy" as const,
        authority: "Company accountable owner",
        citation: "Reviewed campaign policy",
        jurisdictionOrScope: "This company and its governed campaign Tasks",
        applicabilityFacts:
          "Campaign purpose needs a current company-policy review",
        applicabilityState: "uncertain" as const,
        effectiveFrom: new Date().toISOString(),
        effectiveUntil: null,
        requiredControl: "Review the exact intended purpose before activation",
        evidenceRequired: ["Human purpose review"],
        controlRefs: ["AI use-case registry"],
        nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
        reviewTrigger: "Material campaign purpose or authority changes",
        sourceVersionOrDate: "2026-10-05",
        sourceUrl: "https://example.com/company-policy",
      };
      const record = await aiGovernanceService(db).obligation(
        f.actor,
        f.home,
        obligation,
      );
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, execution.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        db
          .update(governanceObligations)
          .set({ obligationHash: "overwrite" })
          .where(eq(governanceObligations.id, record.id)),
      ).rejects.toThrow();
      expect(await reconcileGovernanceDeployments(db)).toMatchObject({
        invalidated: 1,
      });
      await expect(bind()).rejects.toMatchObject({ status: 409 });
      await aiGovernanceService(db).obligation(f.actor, f.home, {
        ...obligation,
        applicabilityState: "applicable",
      });
      expect((await bind()).status).toBe("active");
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, execution.id),
      ).rejects.toMatchObject({ status: 403 });
      const replacement = await run();
      await assertExecutionGovernance(
        db,
        f.home,
        f.presence.id,
        replacement.id,
      );
      expect(
        await db
          .select()
          .from(governanceObligations)
          .where(eq(governanceObligations.companyId, f.home)),
      ).toHaveLength(2);
    });
    it("projects current authoritative evidence without exporting source bodies or granting authority", async () => {
      await approve();
      await bind();
      await instanceSettingsService(db).updateExperimental({
        governance_evidence_v7: true,
      });
      const pack = await governanceEvidencePack(
        db,
        f.actor,
        f.home,
        useCase.id,
      );
      expect(pack.detail.useCase.ownerUserId).toBe(f.userId);
      expect(pack.inventory).toHaveLength(1);
      expect(pack.inventory[0]).toMatchObject({
        issueId: task.id,
        agentId: f.presence.id,
        currentAuthority: true,
      });
      expect(pack.detail.assessments).toHaveLength(3);
      const { packHash, ...content } = pack;
      expect(packHash).toBe(nativeSha256(content));
      expect(pack.limitations.join(" ")).toContain("Private Memory");
      await expect(
        governanceEvidencePack(db, f.actor, f.guest, useCase.id),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("enforces reviewed catalog risk even when ordinary tool access would permit a call", async () => {
      await approve();
      await bind();
      const execution = await run();
      const input = {
        heartbeatRunId: execution.id,
        companyId: f.home,
        issueId: task.id,
        agentId: f.presence.id,
      };
      expect(
        (
          await governanceToolRestriction(db, {
            ...input,
            heartbeatRunId: null,
            riskLevel: "read",
          })
        ).denyReason,
      ).toContain("actual run context");
      const [forged] = await db
        .insert(heartbeatRuns)
        .values({
          companyId: f.home,
          agentId: f.presence.id,
          status: "running",
          invocationSource: "on_demand",
          contextSnapshot: { issueId: task.id },
        })
        .returning();
      expect(
        (
          await governanceToolRestriction(db, {
            ...input,
            heartbeatRunId: forged!.id,
            riskLevel: "read",
          })
        ).denyReason,
      ).toContain("no longer current");
      expect(
        await governanceToolRestriction(db, { ...input, riskLevel: "read" }),
      ).toEqual({ denyReason: null, requireHumanApproval: false });
      expect(
        (await governanceToolRestriction(db, { ...input, riskLevel: "write" }))
          .denyReason,
      ).toContain("risk envelope");
      expect(
        (await governanceToolRestriction(db, { ...input, riskLevel: null }))
          .denyReason,
      ).toContain("not qualified");
      expect(
        (
          await governanceToolRestriction(db, {
            ...input,
            issueId: null,
            riskLevel: "read",
          })
        ).denyReason,
      ).toContain("Task context");
    });
    it("requires actual independent orchestration for a material use case", async () => {
      useCase = await aiGovernanceService(db).update(
        f.actor,
        f.home,
        useCase.id,
        {
          expectedVersion: useCase.version,
          purpose: { ...useCase.purpose, riskClass: "C2" },
          changeReason:
            "Material business actions require independent orchestration",
        },
      );
      await approve();
      await expect(bind()).rejects.toMatchObject({ status: 409 });
    });
    it("records explicit reassessment when native skill authority changes", async () => {
      await approve();
      await bind();
      const execution = await run();
      await db.insert(companySkills).values({
        companyId: f.home,
        key: "governance-fixture",
        slug: "governance-fixture",
        name: "Private source fixture",
        markdown: "Private source body must not be exported",
        ownerAgentId: f.presence.id,
      });
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, execution.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(await reconcileGovernanceDeployments(db)).toMatchObject({
        invalidated: 1,
      });
      expect(
        await db
          .select()
          .from(aiUseCaseChangeEvents)
          .where(eq(aiUseCaseChangeEvents.useCaseId, useCase.id)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "deployment_authority_or_review_changed",
            classification: "review_required",
          }),
        ]),
      );
    });
    it("preserves cumulative Stop retries and immutable scope after suspension", async () => {
      await approve();
      await bind();
      const execution = await run();
      await aiGovernanceService(db).decide(
        f.actor,
        f.home,
        useCase.id,
        "suspend",
        decision(useCase.version),
      );
      await deliverGovernanceStops(db, async () => undefined);
      const [request] = await db
        .select()
        .from(governanceStopActions)
        .where(eq(governanceStopActions.runId, execution.id));
      expect(request).toMatchObject({ status: "delivered", attempts: 1 });
      await expect(
        db
          .update(governanceStopActions)
          .set({ attempts: 0, status: "queued" })
          .where(eq(governanceStopActions.id, request!.id)),
      ).rejects.toThrow();
      await expect(
        db
          .delete(governanceStopActions)
          .where(eq(governanceStopActions.id, request!.id)),
      ).rejects.toThrow();
    });
    it("requires every current human assessment and exact company scope", async () => {
      await expect(bind()).rejects.toMatchObject({ status: 409 });
      await expect(
        aiGovernanceService(db).decide(
          f.actor,
          f.home,
          useCase.id,
          "approve",
          decision(1),
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        db
          .update(aiUseCases)
          .set({ status: "approved" })
          .where(eq(aiUseCases.id, useCase.id)),
      ).rejects.toThrow();
      await expect(
        aiGovernanceService(db).decide(
          f.actor,
          f.guest,
          useCase.id,
          "suspend",
          decision(1),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await approve();
      expect((await bind()).status).toBe("active");
    });
    it("preserves immutable purpose and assessment versions and rejects stale approvals", async () => {
      await approve();
      await bind();
      const changed = await aiGovernanceService(db).update(
        f.actor,
        f.home,
        useCase.id,
        {
          expectedVersion: useCase.version,
          purpose: {
            ...useCase.purpose,
            intendedPurpose:
              "Prepare campaigns for a new customer-facing purpose",
          },
          changeReason: "Accountable owner changed the business purpose",
        },
      );
      expect(changed.status).toBe("assessing");
      expect(changed.purposeVersion).toBe(2);
      expect(
        await db
          .select()
          .from(aiUseCaseVersions)
          .where(eq(aiUseCaseVersions.useCaseId, useCase.id)),
      ).toHaveLength(2);
      await expect(
        db
          .update(aiUseCaseAssessments)
          .set({ assessmentHash: "restore" })
          .where(eq(aiUseCaseAssessments.useCaseId, useCase.id)),
      ).rejects.toThrow();
      await expect(
        db
          .update(aiUseCaseDeployments)
          .set({ status: "active" })
          .where(eq(aiUseCaseDeployments.issueId, task.id)),
      ).rejects.toThrow();
      await expect(
        aiGovernanceService(db).decide(
          f.actor,
          f.home,
          useCase.id,
          "approve",
          decision(useCase.version),
        ),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("fences writes and late native admission on suspension after feature rollback", async () => {
      await approve();
      const deployment = await bind(),
        execution = await run();
      await assertExecutionGovernance(db, f.home, f.presence.id, execution.id);
      await instanceSettingsService(db).updateExperimental({
        ai_use_cases_v7: false,
        governance_evidence_v7: false,
      });
      await aiGovernanceService(db).decide(
        f.actor,
        f.home,
        useCase.id,
        "suspend",
        decision(useCase.version),
      );
      await expect(
        assertAgentRunWriteAllowed(db, f.home, {
          agentId: f.presence.id,
          runId: execution.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(run()).rejects.toThrow();
      const [fenced] = await db
        .select()
        .from(aiUseCaseDeployments)
        .where(eq(aiUseCaseDeployments.id, deployment.id));
      expect(fenced?.status).toBe("suspended");
      const [request] = await db
        .select()
        .from(governanceStopActions)
        .where(eq(governanceStopActions.runId, execution.id));
      expect(request?.status).toBe("queued");
      expect(
        (
          await db
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, execution.id))
        )[0]?.status,
      ).toBe("running");
    });
    it("detects current provider/configuration drift and recovers native Stop delivery without fabricated status", async () => {
      await approve();
      await bind();
      const execution = await run();
      await db
        .update(agents)
        .set({ runtimeConfig: { materialPurposeChange: true } })
        .where(eq(agents.id, f.presence.id));
      await expect(
        assertExecutionGovernance(db, f.home, f.presence.id, execution.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(await reconcileGovernanceDeployments(db)).toMatchObject({
        invalidated: 1,
      });
      let fail = true;
      const cancel = vi.fn(async (id: string) => {
        if (id === execution.id && fail) {
          fail = false;
          throw new Error("fixture-native-stop-down");
        }
      });
      await deliverGovernanceStops(db, cancel);
      const [pending] = await db
        .select()
        .from(governanceStopActions)
        .where(eq(governanceStopActions.runId, execution.id));
      expect(pending).toMatchObject({
        status: "queued",
        attempts: 1,
        errorCode: "native_stop_delivery_failed",
      });
      await deliverGovernanceStops(db, cancel);
      const [delivered] = await db
        .select()
        .from(governanceStopActions)
        .where(eq(governanceStopActions.runId, execution.id));
      expect(delivered).toMatchObject({ status: "delivered", attempts: 2 });
      expect(
        (
          await db
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, execution.id))
        )[0]?.status,
      ).toBe("running");
    });
  },
);
