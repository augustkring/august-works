import {
  maintainFoundationFindings,
  maintainPackageUpdates,
  coreStewardSummary,
} from "../services/stewards/core-stewards.js";
import { evaluateSpecialistPackage } from "../services/agent-packages/specialist-evaluation.js";
import {
  readinessAssessments,
  knowledgeQualityFindings,
  companyMemberships,
  activityLog,
} from "@paperclipai/db";
import { learningService } from "../services/learning/learning-service.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { readinessService } from "../services/readiness/readiness-service.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { accessService } from "../services/access.js";
import { foundationDocuments } from "@paperclipai/db";
import { purgeMemoryRecords } from "../services/memory/memory-privacy.js";
import {
  memoryBindings,
  memoryRecords,
  memoryEvidence,
  learningDomainCandidates,
  agentPackageUpdateProposals,
} from "@paperclipai/db";
import { learningChangeSchema } from "@paperclipai/shared";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  principalPermissionGrants,
  connectionGrants,
  agentPackageVersions,
  agentPackageComponents,
  companyAgentPackageInstallations,
  heartbeatRuns,
  agents,
  agentPackageStopActions,
  issues,
} from "@paperclipai/db";
import {
  PROVIDER_CAPABILITY_FEATURES,
  type PackageRelease,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { rolePackService } from "../services/role-packs.js";
import { agentPackageService } from "../services/agent-packages/package-service.js";
import {
  assertPackageExecution,
  packageToolRestriction,
} from "../services/agent-packages/execution-gate.js";
import {
  reconcileAgentPackages,
  deliverAgentPackageStops,
} from "../services/agent-packages/package-jobs.js";
import {
  packageChangeIsMaterial,
  packageReleaseBlockers,
} from "../services/agent-packages/package-policy.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V7 native internal package installation and activation",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      f: Awaited<ReturnType<typeof seedV5Presences>>,
      service: ReturnType<typeof agentPackageService>,
      input: PackageRelease,
      versionId: string,
      roleId: string,
      roleVersionId: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v7-packages-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => database?.cleanup(), 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        agent_packages_v7: true,
        core_stewards_v7: false,
      });
      f = await seedV5Presences(db);
      service = agentPackageService(db, {
        operatorUserIds: [f.userId],
        protectedEvidenceOrigin: "https://qualification.test.invalid",
        sourceSha: "a".repeat(40),
      });
      const rp = rolePackService(db),
        pack = await rp.create(f.actor, f.home, {
          key: "internal-review",
          name: "Internal evaluation",
          description: "Read-only local test component",
        });
      roleId = pack.id;
      const version = await rp.createVersion(f.actor, f.home, roleId, {
        summary: "Native policy-only component",
        items: [
          {
            type: "required_policy",
            ref: "approval_before_side_effects",
            versionId: null,
            operation: "add",
            loadPoint: "always",
            triggerTerms: [],
            excludeTerms: [],
          },
        ],
      });
      roleVersionId = version.id;
      await rp.publish(f.actor, f.home, roleId, roleVersionId, null);
      const [digest] = await db.execute(
        sql`select aw_v7_package_component_hash(${f.home}::uuid,'role_pack',${roleId}::uuid,${roleVersionId}::uuid) as hash`,
      );
      const evidence = {
        uri: "https://qualification.test.invalid/qualification/local-test-fixture",
        sha256: "b".repeat(64),
      };
      input = {
        packageKey: `internal-review-${randomUUID()}`,
        name: "Internal review evaluation",
        description: "Local test package; no customer outcome qualification",
        category: "internal",
        version: "1.0.0",
        releaseNotes: "Protocol evaluation",
        manifest: {
          purpose: "Prepare an internal source-bound draft for human review",
          prohibitedUses: ["External sends", "Administrative actions"],
          role: "general",
          audience: "internal_test",
          maximumRisk: "C1",
          actionClasses: ["internal_draft"],
          requiredKnowledge: [],
          requiredConnections: [],
          optionalConnections: ["slack"],
          memoryPolicy: "source_governed",
          humanApproval: "before_material_action",
          supervision: "bounded_native",
          verification: "independent_native",
          sandboxAssurance: "byo_customer_responsibility",
          runtimeProviders: ["paperclip_native"],
          onboardingQuestions: [],
          knownLimitations: [
            "Local protocol fixture, not a business-output or physical-boundary qualification",
          ],
          sourceRevision: "a".repeat(40),
          license: "MIT",
          commercialProductKey: null,
        },
        components: [
          {
            key: "internal-role",
            type: "role_pack",
            sourceVersion: "1",
            contentHash: String(digest!.hash),
            source: evidence,
            required: true,
          },
        ],
        releaseEvidence: {
          sbom: null,
          provenance: evidence,
          signature: null,
          scan: null,
          evaluations: null,
          protectedHoldout: null,
          sandboxQualification: null,
          releaseAuthorization: evidence,
          unresolvedCritical: [],
          evaluatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      };
      versionId = (await service.publish(f.actor, input)).id;
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
          version: "local-package-protocol-fixture",
          features: Object.fromEntries(
            PROVIDER_CAPABILITY_FEATURES.map((k) => [k, false]),
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
    });
    const installInput = () => ({
      versionId,
      agentId: f.presence.id,
      components: [
        { key: "internal-role", resourceId: roleId, versionId: roleVersionId },
      ],
      acceptInternalEvaluation: true,
    });
    async function active() {
      const installed = await service.install(f.actor, f.home, installInput());
      return service.decide(f.actor, f.home, installed.id, "activate", {
        expectedVersion: installed.version,
        reason: "Explicit internal evaluation",
      });
    }
    async function run() {
      return (
        await db
          .insert(heartbeatRuns)
          .values({
            companyId: f.home,
            agentId: f.presence.id,
            invocationSource: "on_demand",
            status: "running",
          })
          .returning()
      )[0]!;
    }
    async function enableStewards() {
      await instanceSettingsService(db).updateExperimental({
        enableCollectiveMemoryV1: true,
        readiness_engine_v7: true,
        cognitive_memory_v7: true,
        memory_observations_v7: true,
        learning_engine_v7: true,
        ai_use_cases_v7: true,
        governance_evidence_v7: true,
        core_stewards_v7: true,
      });
    }
    it("Core Stewards configure only opted-in unchanged-content releases and retain a human activation boundary", async () => {
      await enableStewards();
      const installed = await service.install(f.actor, f.home, {
        ...installInput(),
        updatePolicy: "auto_low_risk",
      });
      const activated = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "activate",
        {
          expectedVersion: 1,
          reason: "Approve the explicit editorial update policy",
        },
      );
      const next = await service.publish(f.actor, {
        ...input,
        version: "1.0.1",
        releaseNotes: "Editorial correction",
      });
      const grants = await db.select().from(principalPermissionGrants);
      expect((await maintainPackageUpdates(db)).configured).toBeGreaterThan(0);
      const current = await service.get(f.actor, f.home, installed.id);
      expect(current.installedVersionId).toBe(next.id);
      expect(current.status).toBe("configuring");
      expect(current.activationHash).toBeNull();
      expect(current.version).toBe(activated.version + 1);
      expect(await db.select().from(principalPermissionGrants)).toHaveLength(
        grants.length,
      );
      const audit = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, installed.id));
      expect(
        audit.find(
          (a) => a.action === "agent_package.low_risk_update_configured",
        )?.actorType,
      ).toBe("system");
      await expect(run()).rejects.toMatchObject({
        cause: { code: "23514", message: "package_run_activation_required" },
      });
      expect((await maintainPackageUpdates(db)).configured).toBe(0);
    });
    it("automatic package stewardship cannot change material content, live work or revoked original-human authority", async () => {
      await enableStewards();
      const installed = await service.install(f.actor, f.home, {
        ...installInput(),
        updatePolicy: "auto_low_risk",
      });
      await service.decide(f.actor, f.home, installed.id, "activate", {
        expectedVersion: 1,
        reason: "Evaluate safe auto-update admission",
      });
      const next = await service.publish(f.actor, {
        ...input,
        version: "1.0.1",
        releaseNotes: "Editorial correction",
      });
      const live = await run();
      expect(
        await service.stewardUpdate(f.home, installed.id, next.id),
      ).toEqual({ updated: false });
      await db
        .update(heartbeatRuns)
        .set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, live.id));
      const material = await service.publish(f.actor, {
        ...input,
        version: "1.1.0",
        manifest: {
          ...input.manifest,
          knownLimitations: ["New limitation requiring explicit review"],
        },
      });
      expect(
        await service.stewardUpdate(f.home, installed.id, material.id),
      ).toEqual({ updated: false });
      await db
        .update(companyMemberships)
        .set({ status: "suspended" })
        .where(sql`company_id=${f.home}::uuid and principal_id=${f.userId}`);
      await expect(
        service.stewardUpdate(f.home, installed.id, next.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await db
            .select()
            .from(companyAgentPackageInstallations)
            .where(eq(companyAgentPackageInstallations.id, installed.id))
        )[0]!.installedVersionId,
      ).toBe(versionId);
      await reconcileAgentPackages(db);
    });
    it("metadata-only Foundation stewardship is bounded, idempotent, principal scoped and disabled by default", async () => {
      const assessedAt = new Date(Date.now() - 120000),
        expiresAt = new Date(Date.now() - 60000);
      const [assessment] = await db
        .insert(readinessAssessments)
        .values({
          companyId: f.home,
          agentId: f.presence.id,
          principalId: `user:${f.userId}`,
          subjectType: "agent",
          subjectId: f.presence.id,
          actionClass: "internal_draft",
          riskClass: "low",
          status: "ready_with_warnings",
          requirementSnapshotHash: "a".repeat(64),
          policySnapshotHash: "b".repeat(64),
          requirementSnapshot: [],
          assessment: {
            status: "ready_with_warnings",
            actionClass: "internal_draft",
            riskClass: "low",
            requirements: [],
            assessedAt: assessedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
          assessedAt,
          expiresAt,
        })
        .returning();
      await instanceSettingsService(db).updateExperimental({
        core_stewards_v7: false,
      });
      expect(await maintainFoundationFindings(db)).toEqual({
        findingsCreated: 0,
      });
      await enableStewards();
      await Promise.all([
        maintainFoundationFindings(db),
        maintainFoundationFindings(db),
      ]);
      const findings = await db
        .select()
        .from(knowledgeQualityFindings)
        .where(eq(knowledgeQualityFindings.assessmentId, assessment!.id));
      expect(findings).toHaveLength(1);
      expect(findings[0]!.evidenceRefs).toEqual([]);
      expect(
        (await coreStewardSummary(db, f.actor, f.home)).ownReadinessFindings,
      ).toBe(1);
      expect(
        (await coreStewardSummary(db, f.actor, f.guest)).ownReadinessFindings,
      ).toBe(0);
      expect((await maintainFoundationFindings(db)).findingsCreated).toBe(0);
    });
    it("specialist evaluation cannot synthesize a customer outcome from an installation or a foreign/missing review", async () => {
      const candidate = await service.publish(f.actor, {
        ...input,
        packageKey: "aw-research-specialist",
      });
      const installed = await service.install(f.actor, f.home, {
        ...installInput(),
        versionId: candidate.id,
      });
      await expect(
        evaluateSpecialistPackage(db, f.actor, f.home, {
          installationId: installed.id,
          cases: [{ caseKey: "synthesis", verificationRunId: randomUUID() }],
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        evaluateSpecialistPackage(db, f.actor, f.guest, {
          installationId: installed.id,
          cases: [{ caseKey: "synthesis", verificationRunId: randomUUID() }],
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("install configures native pins without granting company or connection authority; activation permits a bounded internal draft", async () => {
      const grants = await db.select().from(principalPermissionGrants),
        connections = await db.select().from(connectionGrants);
      const installed = await service.install(f.actor, f.home, installInput());
      expect(installed.status).toBe("configuring");
      expect(await db.select().from(principalPermissionGrants)).toHaveLength(
        grants.length,
      );
      expect(await db.select().from(connectionGrants)).toHaveLength(
        connections.length,
      );
      await expect(run()).rejects.toMatchObject({
        cause: { code: "23514", message: "package_run_activation_required" },
      });
      const activated = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "activate",
        { expectedVersion: 1, reason: "Activate internal draft evaluation" },
      );
      expect(activated.status).toBe("active");
      expect(activated.readiness?.warnings).toContain(
        "Advanced capability is unavailable without slack",
      );
      const current = await run();
      expect(current.contextSnapshot?.agentPackageInstallationId).toBe(
        installed.id,
      );
      await expect(
        assertPackageExecution(db, f.home, f.presence.id, current.id),
      ).resolves.toMatchObject({ audience: "internal_test" });
      expect(
        await packageToolRestriction(db, {
          companyId: f.home,
          agentId: f.presence.id,
          heartbeatRunId: current.id,
          riskLevel: "write",
        }),
      ).toHaveProperty("denyReason");
    });
    it("rejects cross-company component pins and agent self-installation", async () => {
      await expect(
        service.install(f.actor, f.guest, installInput()),
      ).rejects.toThrow();
      await expect(
        service.install(
          {
            type: "agent",
            agentId: f.presence.id,
            companyId: f.home,
            source: "agent_jwt",
          },
          f.home,
          installInput(),
        ),
      ).rejects.toThrow(/Human/);
      await expect(
        agentPackageService(db).publish(f.actor, input),
      ).rejects.toThrow(/publisher/);
    });
    it("retains immutable release and component hashes after publication", async () => {
      await expect(
        db
          .update(agentPackageVersions)
          .set({ release: { ...input, releaseNotes: "changed" } })
          .where(eq(agentPackageVersions.id, versionId)),
      ).rejects.toMatchObject({
        cause: { code: "23514", message: "package_release_content_immutable" },
      });
      await expect(
        db
          .delete(agentPackageComponents)
          .where(eq(agentPackageComponents.versionId, versionId)),
      ).rejects.toMatchObject({
        cause: { code: "23514", message: "package_components_immutable" },
      });
    });
    it("revocation fences running work, preserves native state, and retries failed Stop delivery", async () => {
      const installed = await active(),
        current = await run();
      const [task] = await db
        .insert(issues)
        .values({ companyId: f.home, title: "Customer-created business state" })
        .returning();
      await service.revoke(f.actor, versionId);
      await expect(
        assertPackageExecution(db, f.home, f.presence.id, current.id),
      ).rejects.toThrow(/current activation/);
      expect(
        (
          await db
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, current.id))
        )[0]?.resultJson?.executionCancellation,
      ).toMatchObject({ state: "requested" });
      const stop = vi
        .fn()
        .mockRejectedValueOnce(Error("Controller unavailable"))
        .mockResolvedValue(undefined);
      await deliverAgentPackageStops(db, stop);
      await deliverAgentPackageStops(db, stop);
      expect(stop).toHaveBeenCalledTimes(2);
      expect(
        (
          await db
            .select()
            .from(agentPackageStopActions)
            .where(eq(agentPackageStopActions.installationId, installed.id))
        )[0],
      ).toMatchObject({ status: "delivered", attempts: 2 });
      expect(
        (await db.select().from(issues).where(eq(issues.id, task!.id)))[0],
      ).toBeTruthy();
    });
    it("current agent/provider authority drift invalidates the package and cannot be healed by an old run pin", async () => {
      const installed = await active(),
        current = await run();
      await db
        .update(agents)
        .set({ runtimeConfig: { changed: true } })
        .where(eq(agents.id, f.presence.id));
      await expect(
        assertPackageExecution(db, f.home, f.presence.id, current.id),
      ).rejects.toThrow();
      expect(await reconcileAgentPackages(db)).toMatchObject({
        invalidated: 1,
      });
      expect(
        (
          await db
            .select()
            .from(companyAgentPackageInstallations)
            .where(eq(companyAgentPackageInstallations.id, installed.id))
        )[0]?.status,
      ).toBe("degraded");
      await expect(
        db
          .update(heartbeatRuns)
          .set({
            contextSnapshot: {
              agentPackageInstallationId: randomUUID(),
              agentPackageActivationHash: "c".repeat(64),
            },
          })
          .where(eq(heartbeatRuns.id, current.id)),
      ).rejects.toMatchObject({
        cause: { code: "23514", message: "package_run_pin_immutable" },
      });
    });
    it("material updates require explicit review and fresh activation, while uninstall keeps company resources", async () => {
      const installed = await active(),
        current = await run();
      const next = {
        ...input,
        version: "2.0.0",
        manifest: { ...input.manifest, optionalConnections: [] },
      };
      const nextId = (await service.publish(f.actor, next)).id;
      const update = {
        ...installInput(),
        versionId: nextId,
        expectedVersion: installed.version,
        approveMaterialChange: false,
        reason: "Review updated capability",
      };
      await expect(
        service.update(f.actor, f.home, installed.id, update),
      ).rejects.toThrow(/Material/);
      const updated = await service.update(f.actor, f.home, installed.id, {
        ...update,
        approveMaterialChange: true,
      });
      expect(updated.status).toBe("configuring");
      await expect(
        assertPackageExecution(db, f.home, f.presence.id, current.id),
      ).rejects.toThrow();
      const removed = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "uninstall",
        {
          expectedVersion: updated.version,
          reason: "Remove maintained package",
        },
      );
      expect(removed.status).toBe("uninstalled");
      expect(
        (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0],
      ).toBeTruthy();
    });
    it("Learning proposes a native update, requires human review and erases retained source prose with rollout disabled", async () => {
      await instanceSettingsService(db).updateExperimental({
        enableCollectiveMemoryV1: true,
        readiness_engine_v7: true,
        cognitive_memory_v7: true,
        memory_observations_v7: true,
        learning_engine_v7: true,
      });
      const installed = await service.install(f.actor, f.home, installInput()),
        nextId = (
          await service.publish(f.actor, {
            ...input,
            version: "1.1.0",
            releaseNotes: "Reviewed internal update",
          })
        ).id;
      const tasks: string[] = [];
      for (let n = 0; n < 4; n++) {
        const [t] = await db
          .insert(issues)
          .values({
            companyId: f.home,
            title: `Local paired output fixture ${n}`,
            status: "done",
            completedAt: new Date(),
          })
          .returning();
        tasks.push(t!.id);
      }
      const [binding] = await db
        .insert(memoryBindings)
        .values({
          companyId: f.home,
          key: "package-learning",
          name: "Local outcome fixture",
          providerKey: "local",
        })
        .returning();
      const roots: string[] = [];
      for (let n = 0; n < 2; n++) {
        const [root] = await db
          .insert(memoryRecords)
          .values({
            companyId: f.home,
            bindingId: binding!.id,
            providerKey: "local",
            memoryType: "outcome",
            scopeType: "company",
            content: `Local reviewed output fixture ${n}`,
            reviewState: "accepted",
            verificationState: "human_verified",
            observedAt: new Date(),
            createdByActorType: "user",
            createdByActorId: f.userId,
          })
          .returning();
        roots.push(root!.id);
        await db.insert(memoryEvidence).values({
          companyId: f.home,
          memoryRecordId: root!.id,
          sourceClass: "task",
          sourceProvider: "august_works_tasks",
          sourceType: "issue",
          sourceRef: `issue://${tasks[n]}`,
          sourceVersion: "1",
          observedAt: new Date(),
          excerptHash: String(n).repeat(64),
          citationJson: { label: "Local paired fixture" },
          trustLevel: "high",
          supportsOrContradicts: "supports",
        });
      }
      const learning = learningService(db),
        change = learningChangeSchema.parse({
          targetDomain: "agent_package",
          update: {
            ...installInput(),
            versionId: nextId,
            expectedVersion: installed.version,
            approveMaterialChange: true,
            reason: "Retained source recommends this evaluated internal update",
          },
        });
      const cycle = await learning.create(f.actor, f.home, {
        scope: { type: "company", id: null },
        purpose: "native_task_execution",
        trigger:
          "Repeated local review suggests evaluating an updated internal package",
        memoryRecordIds: roots,
      });
      const hypothesis = await learning.addHypothesis(
        f.actor,
        f.home,
        cycle.id,
        {
          expectedCycleVersion: 1,
          targetDomain: "agent_package",
          targetId: installed.id,
          riskClass: "material",
          claim:
            "The evaluated package update improves the reviewed output fixtures",
          predictedEffect:
            "Better reviewed outputs while preserving native approval gates",
          evaluationContract: {
            expectedImprovement: "Improves the local paired output fixtures",
            protectedInvariants: ["Human activation remains necessary"],
            baselineRef: `agent_package://${installed.id}/${installed.installedVersionId}/${installed.version}`,
            challengerHash: nativeSha256(change),
            minimumCases: 2,
            minimumQuality: 0.8,
            minimumImprovement: 0.05,
            rollbackPath:
              "Reject the proposal and retain the installed package version",
          },
        },
      );
      const judgment = (quality: number) => ({
        correctness: true,
        safety: true,
        policy: true,
        businessOutcome: quality,
        reliability: 1,
        latencyMs: 100,
        costCents: 10,
      });
      const evaluation = await learning.evaluate(
        f.actor,
        f.home,
        hypothesis.id,
        {
          expectedHypothesisVersion: 1,
          method: "manual_review",
          cases: [0, 1].map((n) => ({
            baselineTaskId: tasks[n * 2]!,
            challengerTaskId: tasks[n * 2 + 1]!,
            baseline: judgment(0.7),
            challenger: judgment(0.9),
            invariantResults: [true],
            rationale: "Compared the local saved-output fixture contracts",
          })),
          limitations: [
            "Local protocol fixtures; no customer or causal performance qualification",
          ],
        },
      );
      const link = await learning.proposeChange(
        f.actor,
        f.home,
        hypothesis.id,
        { expectedHypothesisVersion: 2, evaluationId: evaluation.id, change },
      );
      expect(
        (await service.get(f.actor, f.home, installed.id)).installedVersionId,
      ).toBe(versionId);
      await service.reviewProposal(f.actor, f.home, link.candidateId, "accept");
      const updated = await service.get(f.actor, f.home, installed.id);
      expect(updated.status).toBe("configuring");
      expect(updated.installedVersionId).toBe(nextId);
      await instanceSettingsService(db).updateExperimental({
        learning_engine_v7: false,
        agent_packages_v7: false,
      });
      await db.transaction((tx) =>
        purgeMemoryRecords(tx as unknown as typeof db, f.home, [roots[0]!]),
      );
      const [p] = await db
        .select()
        .from(agentPackageUpdateProposals)
        .where(eq(agentPackageUpdateProposals.id, link.candidateId));
      expect(p).toMatchObject({ status: "stale", proposal: null, reason: "" });
      await db
        .update(agentPackageUpdateProposals)
        .set({
          proposal:
            change.targetDomain === "agent_package" ? change.update : null,
          reason: "Restored sensitive source prose",
        })
        .where(eq(agentPackageUpdateProposals.id, link.candidateId));
      expect(
        (
          await db
            .select()
            .from(agentPackageUpdateProposals)
            .where(eq(agentPackageUpdateProposals.id, link.candidateId))
        )[0],
      ).toMatchObject({ proposal: null, reason: "" });
      expect((await service.get(f.actor, f.home, installed.id)).status).toBe(
        "degraded",
      );
    });
    it("a new activation cannot revive an earlier run even with the same package version", async () => {
      const installed = await active(),
        current = await run();
      const suspended = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "suspend",
        { expectedVersion: installed.version, reason: "Pause evaluation" },
      );
      const resumed = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "activate",
        {
          expectedVersion: suspended.version,
          reason: "Freshly checked evaluation",
        },
      );
      expect(resumed.status).toBe("active");
      await expect(
        assertPackageExecution(db, f.home, f.presence.id, current.id),
      ).rejects.toThrow(/earlier/);
    });
    it("missing mandatory connections block activation while preserving an installed lower-risk configuration", async () => {
      const next = {
        ...input,
        version: "1.2.0",
        manifest: {
          ...input.manifest,
          requiredConnections: ["slack"],
          optionalConnections: [],
        },
      };
      const id = (await service.publish(f.actor, next)).id;
      const installed = await service.install(f.actor, f.home, {
        ...installInput(),
        versionId: id,
      });
      const blocked = await service.decide(
        f.actor,
        f.home,
        installed.id,
        "activate",
        { expectedVersion: 1, reason: "Check mandatory connection" },
      );
      expect(blocked.status).toBe("readiness_blocked");
      expect(blocked.readiness?.reasons).toContain(
        "Explicit connection access is required: slack",
      );
    });
    it("package-specific required knowledge uses native Readiness and blocks only the declared capability", async () => {
      const next = {
          ...input,
          version: "1.3.0",
          manifest: {
            ...input.manifest,
            requiredKnowledge: ["brand_positioning"],
          },
        },
        id = (await service.publish(f.actor, next)).id;
      const preview = await service.preview(f.actor, f.home, {
        ...installInput(),
        versionId: id,
      });
      expect(preview.readiness.status).toBe("blocked");
      expect(preview.readiness.reasons).toContain(
        "Required approved knowledge is missing: brand_positioning",
      );
      const base = await service.preview(f.actor, f.home, installInput());
      expect(base.readiness.status).toBe("ready_with_warnings");
    });
    it("holds a material package update when model configuration changes and approved Foundation becomes stale together", async () => {
      await enableStewards();
      const foundation = foundationService(db), principal = { principal: { type: "user" as const, userId: f.userId } };
      const draft = await foundation.createDraft(f.home, { foundationKey: "company_profile", category: "company", documentType: "profile", body: "Reviewed native company baseline", authorityLevel: "canonical", sensitivity: "internal" }, principal);
      await foundation.submitForReview(f.home, draft.id, draft.latestRevisionId!, principal);
      await foundation.approve(f.home, draft.id, draft.latestRevisionId!, principal);
      await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
      await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map(permissionKey => ({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey }))).onConflictDoNothing();
      const sourceAccess = await accessService(db).decide({ actor: { type: "agent", agentId: f.presence.id, companyId: f.home, onBehalfOfUserId: f.userId, source: "agent_jwt" }, enforceResponsibleUserIntersection: true, action: "foundation:read", resource: { type: "company", companyId: f.home } });
      expect(sourceAccess.allowed, JSON.stringify(sourceAccess)).toBe(true);
      const installed = await active(), current = await run();
      const [subject] = await db.insert(issues).values({ companyId: f.home, title: "Review current company evidence", status: "todo", assigneeAgentId: f.presence.id }).returning();
      const assessment = await readinessService(db).assess(f.home, { agentId: f.presence.id, actionClass: "internal_draft", subjectType: "task", subjectId: subject!.id, query: "Review company evidence" }, { actor: f.actor, principalId: `user:${f.userId}`, userId: f.userId });
      expect(["ready", "ready_with_warnings"]).toContain(assessment.status);
      expect(assessment.assessment.requirements.flatMap(item => item.evidenceRefs).some(ref => ref.sourceRef.startsWith(`foundation://${draft.id}/`))).toBe(true);
      const next = await service.publish(f.actor, { ...input, version: "2.0.0", manifest: { ...input.manifest, requiredKnowledge: ["brand_positioning"] } });
      await db.update(agents).set({ adapterConfig: { model: "unqualified-replacement-model" } }).where(eq(agents.id, f.presence.id));
      await db.update(foundationDocuments).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(foundationDocuments.id, draft.id));
      await expect(assertPackageExecution(db, f.home, f.presence.id, current.id)).rejects.toBeDefined();
      expect((await service.preview(f.actor, f.home, { ...installInput(), versionId: next.id })).readiness.status).toBe("blocked");
      await maintainFoundationFindings(db, 100);
      const findings = await db.select().from(knowledgeQualityFindings).where(eq(knowledgeQualityFindings.assessmentId, assessment.id));
      expect(findings.filter(finding => finding.ruleVersion === "aw-v7-core-stewards-1")).toHaveLength(1);
      await instanceSettingsService(db).updateExperimental({ agent_packages_v7: false, core_stewards_v7: false });
      await reconcileAgentPackages(db, 100);
      const [held] = await db.select().from(companyAgentPackageInstallations).where(eq(companyAgentPackageInstallations.id, installed.id));
      expect(held).toMatchObject({ status: "degraded", installedVersionId: versionId });
      const stopped: string[] = [];
      await deliverAgentPackageStops(db, async runId => { stopped.push(runId); }, 100);
      expect(stopped).toContain(current.id);
      expect(await db.select().from(foundationDocuments).where(eq(foundationDocuments.id, draft.id))).toHaveLength(1);
    });
    it("concurrent Stop controllers cannot claim the same live lease and retry budgets remain cumulative", async () => {
      const installed = await active();
      const current = await run();
      await service.decide(f.actor, f.home, installed.id, "suspend", {
        expectedVersion: installed.version,
        reason: "Stop internal evaluation",
      });
      const stop = vi.fn(async (_runId: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await Promise.all([
        deliverAgentPackageStops(db, stop),
        deliverAgentPackageStops(db, stop),
      ]);
      expect(
        stop.mock.calls.filter((call) => call[0] === current.id),
      ).toHaveLength(1);
      const [action] = await db
        .select()
        .from(agentPackageStopActions)
        .where(eq(agentPackageStopActions.installationId, installed.id));
      await expect(
        db
          .update(agentPackageStopActions)
          .set({ status: "queued", attempts: 0 })
          .where(eq(agentPackageStopActions.id, action!.id)),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    });
    it("does not elevate fixture evidence to customer or high-assurance qualification", () => {
      expect(
        packageReleaseBlockers({
          ...input,
          manifest: {
            ...input.manifest,
            audience: "customer",
            commercialProductKey: "agent_package_research",
          },
        }),
      ).toContain(
        "Customer release requires separate protectedHoldout evidence",
      );
      expect(
        packageChangeIsMaterial(input, {
          ...input,
          version: "1.0.1",
          releaseNotes: "Editorial note",
        }),
      ).toBe(false);
    });
  },
);
