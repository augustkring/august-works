import { readActivationFirstValue } from "../services/saas/activation-first-value.js";
import { lockActivationSnapshot, readActivationOwner } from "../services/saas/activation-owner.js";
import { toolAccessRoutes } from "../routes/tool-access.js";
import { activationConnectionConsentService } from "../services/saas/activation-connection-consent.js";
import { toolAccessService } from "../services/tool-access.js";
import type { PaperclipCloudConnector } from "../services/paperclip-cloud-connector.js";
import { activationConnectionConsents, companySecrets } from "@paperclipai/db";
import { readExperienceMeasures } from "../services/experience/measures.js";
import { experienceMeasuresRoutes } from "../routes/experience-measures.js";
import { readPackageMaintenanceAttention } from "../services/experience/maintenance-attention.js";
import { experienceService } from "../services/experience/service.js";
import express from "express";
import request from "supertest";
import { maintenanceHistoryRoutes } from "../routes/maintenance-history.js";
import { errorHandler } from "../middleware/error-handler.js";
import { readMaintenanceHistory } from "../services/experience/maintenance-history.js";
import {businessMetricService} from "../services/business-metrics/service.js";
import {aiGovernanceService} from "../services/ai-governance/governance-service.js";
import {memoryJobService} from "../services/memory/memory-jobs.js";
import {metricDefinition,analyticalPurpose} from "./helpers/business-metric-fixture.js";
import {businessMetricObservations,companies} from "@paperclipai/db";
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
  approvals,
  agentApiKeys,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  activityLog,
} from "@paperclipai/db";
import { learningService } from "../services/learning/learning-service.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { activationService } from "../services/saas/activation.js";
import { readActivationRequiredAccess } from "../services/saas/activation-connections.js";
import { approvalService } from "../services/approvals.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { workerModelGateway } from "../services/orchestration/worker-model-gateway.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import { registerNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import type { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { initialActivationState, createOrchestrationPlanSchema, type CreateOrchestrationPlanInput } from "@paperclipai/shared";
import { purpose as governancePurpose, oversight as governanceOversight, reviews as governanceReviews } from "./helpers/governance-fixture.js";
import { billingAccounts, billingAccountCompanies, billingSubscriptions, companyOnboardingRuns,
  documents, documentRevisions, issueDocuments } from "@paperclipai/db";
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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  createDb,
  principalPermissionGrants,
  orchestrationPlans,
  connectionGrants,
  toolApplications,
  toolConnections,
  toolConnectionInstalls,
  agentPackageVersions,
  agentPackageComponents,
  companyAgentPackageInstallations,
  heartbeatRuns,
  agents,
  agentConfigurationDrafts,
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
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
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
      roleVersionId: string,
      fixtureHome: string;
    beforeAll(async () => {
      fixtureHome = await mkdtemp(join(tmpdir(), "aw-v9-first-preparation-"));
      vi.stubEnv("PAPERCLIP_HOME", fixtureHome);
      database = await startEmbeddedPostgresTestDatabase("aw-v7-packages-");
      db = createDb(database.connectionString);
      await instanceSettingsService(db).getExperimental();
      await enableV5ForTest(db);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      if (fixtureHome) await rm(fixtureHome, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }, 30000);
    beforeEach(async () => {
      await instanceSettingsService(db).updateExperimental({
        saas_deployment_profile_v6: true,
        billing_v6: true,
        agent_packages_v7: true,
        core_stewards_v7: false,
        maintenance_autopilot_v9: false,
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
    async function hireFixture(requiredConnections: string[] = [], packageKey = `hire-native-fixture-${randomUUID()}`) {
      await instanceSettingsService(db).updateExperimental({hire_agent_v9: true});
      const evidence = input.releaseEvidence.provenance;
      const release: PackageRelease = {
        ...input, packageKey,
        manifest: {...input.manifest, audience: "customer", requiredConnections, commercialProductKey: "agent_package_research"},
        releaseEvidence: {...input.releaseEvidence, sbom: evidence, scan: evidence, evaluations: evidence, protectedHoldout: evidence, customerDemand: evidence},
      };
      return {release, published: await service.publish(f.actor, release), hire: agentAuthoringService(db)};
    }
    it("saves a pinned unpublished Hire setup once without installing, granting or creating an agent", async () => {
      const {release, published, hire} = await hireFixture();
      const beforeAgents = (await db.select().from(agents)).length;
      const beforeInstallations = (await db.select().from(companyAgentPackageInstallations)).length;
      const input = {requestId: randomUUID(), packageVersionId: published.id};
      const [first, repeated] = await Promise.all([hire.create(f.actor, f.home, input), hire.create(f.actor, f.home, input)]);
      expect(first.id).toBe(repeated.id);
      expect(first.kind).toBe("hire"); expect(first.step).toBe("hire_access"); expect(first.agentId).toBeNull();
      expect(first.package).toMatchObject({key: release.packageKey, versionId: published.id, contentHash: published.contentHash});
      expect(first.content!.ownerUserId).toBe(f.userId);
      const body = {requestId: randomUUID(), expectedVersion: 1, step: "hire_authority", content: first.content};
      const saved = await hire.save(f.actor, f.home, first.id, body);
      expect(saved.version).toBe(2);
      expect((await hire.save(f.actor, f.home, first.id, body)).version).toBe(2);
      await expect(hire.save(f.actor, f.home, first.id, {...body, requestId: randomUUID(), expectedVersion: 2, step: "tools"})).rejects.toMatchObject({status: 422});
      await expect(hire.save(f.actor, f.home, first.id, {...body, requestId: randomUUID(), expectedVersion: 2, content: {...first.content!, capabilities: [{operation: "external_send", autonomy: "ask_first"}]}})).rejects.toMatchObject({status: 422});
      const review = await hire.review(f.actor, f.home, first.id);
      expect(review.publishAllowed).toBe(false); expect(review.test.status).toBe("unqualified");
      expect(await db.select().from(agents)).toHaveLength(beforeAgents);
      expect(await db.select().from(companyAgentPackageInstallations)).toHaveLength(beforeInstallations);
      const audit = await db.select().from(activityLog).where(eq(activityLog.entityId, first.id));
      expect(audit.filter((event) => event.action === "agent_configuration.draft_created")).toHaveLength(1);
      expect(audit.filter((event) => event.action === "agent_configuration.draft_saved")).toHaveLength(1);
    });
    it("retains readable Hire pins through withdrawal and flag rollback, fences native pin/step substitution and permits discard", async () => {
      const {published, hire} = await hireFixture();
      const request = {requestId: randomUUID(), packageVersionId: published.id};
      const draft = await hire.create(f.actor, f.home, request);
      await expect(db.update(agentConfigurationDrafts).set({packageContentHash: "f".repeat(64), version: 2}).where(eq(agentConfigurationDrafts.id, draft.id))).rejects.toMatchObject({cause: {code: "23514"}});
      await expect(db.update(agentConfigurationDrafts).set({step: "outcome", version: 2}).where(eq(agentConfigurationDrafts.id, draft.id))).rejects.toMatchObject({cause: {code: "23514"}});
      await service.revoke(f.actor, published.id);
      expect((await hire.create(f.actor, f.home, request)).id).toBe(draft.id);
      expect((await hire.hireCapability(f.actor, f.home, draft.id)).available).toBe(false);
      expect((await hire.review(f.actor, f.home, draft.id)).blockers.map((blocker) => blocker.code)).toContain("hire_release_unavailable");
      await expect(hire.save(f.actor, f.home, draft.id, {requestId: randomUUID(), expectedVersion: 1, step: "hire_review", content: draft.content})).rejects.toMatchObject({status: 422});
      await instanceSettingsService(db).updateExperimental({hire_agent_v9: false});
      expect((await hire.get(f.actor, f.home, draft.id)).package?.versionId).toBe(published.id);
      const removed = await hire.discard(f.actor, f.home, draft.id, {requestId: randomUUID(), expectedVersion: 1});
      expect(removed.content).toBeNull(); expect(removed.package?.versionId).toBe(published.id);
      await expect(hire.get({...f.actor, userId: "foreign-author", isInstanceAdmin: true}, f.home, draft.id)).rejects.toMatchObject({status: 403});
    });
    it("projects only available customer releases for Hire Agent and does not expose internal evaluation or release evidence", async () => {
      await instanceSettingsService(db).updateExperimental({ hire_agent_v9: true });
      const hire = agentAuthoringService(db);
      expect((await hire.hireCatalog(f.actor, f.home)).some((row) => row.key === input.packageKey)).toBe(false);
      const evidence = input.releaseEvidence.provenance;
      const customer: PackageRelease = {
        ...input,
        packageKey: `customer-catalog-fixture-${randomUUID()}`,
        manifest: { ...input.manifest, audience: "customer", commercialProductKey: "agent_package_research" },
        releaseEvidence: { ...input.releaseEvidence, sbom: evidence, scan: evidence, evaluations: evidence, protectedHoldout: evidence, customerDemand: evidence },
      };
      const published = await service.publish(f.actor, customer);
      const rows = await hire.hireCatalog(f.actor, f.home);
      const capability = rows.find((row) => row.key === customer.packageKey)!;
      expect(capability.versionId).toBe(published.id);
      expect(capability.outcome).toBe(customer.manifest.purpose);
      expect(capability.declaredAccess).toMatchObject({
        maximumRisk: customer.manifest.maximumRisk,
        optionalConnections: customer.manifest.optionalConnections,
        memoryPolicy: customer.manifest.memoryPolicy,
        sandboxAssurance: customer.manifest.sandboxAssurance,
        runtimeProviders: customer.manifest.runtimeProviders,
        scopeAssessment: "unavailable",
        authorityEffect: "none",
      });
      expect(capability).not.toHaveProperty("releaseEvidence");
      expect(capability).not.toHaveProperty("components");
      const agentCount = (await db.select().from(agents)).length;
      await service.revoke(f.actor, published.id);
      expect((await hire.hireCatalog(f.actor, f.home)).some((row) => row.key === customer.packageKey)).toBe(false);
      expect(await db.select().from(agents)).toHaveLength(agentCount);
      await expect(hire.hireCatalog({ ...f.actor, userId: "unknown-account", isInstanceAdmin: true }, f.home)).rejects.toMatchObject({ status: 403 });
      await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
      await expect(hire.hireCatalog(f.actor, f.home)).rejects.toMatchObject({ status: 404 });
    });
    it("reconciles concurrent installation acknowledgements without duplicate installation or audit", async () => {
      const body = { ...installInput(), installationRequestId: randomUUID() };
      const [first, second] = await Promise.all([
        service.install(f.actor, f.home, body, input.packageKey),
        service.install(f.actor, f.home, body, input.packageKey),
      ]);
      expect(first.id).toBe(second.id);
      expect(first.installationRequestId).toBe(body.installationRequestId);
      expect(first).not.toHaveProperty("installationRequestHash");
      expect(first.status).toBe("configuring");
      expect(first.activationHash).toBeNull();
      expect(await db.select().from(companyAgentPackageInstallations).where(eq(companyAgentPackageInstallations.agentId, f.presence.id))).toHaveLength(1);
      const audit = await db.select().from(activityLog).where(eq(activityLog.entityId, first.id));
      expect(audit.filter((event) => event.action === "agent_package.installed")).toHaveLength(1);
      await expect(service.install(f.actor, f.home, { ...body, updatePolicy: "auto_low_risk" }, input.packageKey)).rejects.toMatchObject({status: 409, details: {code: "PACKAGE_INSTALL_REQUEST_CONFLICT"}});
      await expect(service.install(f.actor, f.home, body, "other-package")).rejects.toMatchObject({status: 409});
    });
    it("retains the installation receipt after release withdrawal and uninstall, but requires current authority", async () => {
      const body = { ...installInput(), installationRequestId: randomUUID() };
      const first = await service.install(f.actor, f.home, body, input.packageKey);
      await service.revoke(f.actor, versionId);
      const withdrawn = await service.install(f.actor, f.home, body, input.packageKey);
      expect(withdrawn.id).toBe(first.id);
      expect(withdrawn.status).not.toBe("active");
      const removed = await service.decide(f.actor, f.home, first.id, "uninstall", {expectedVersion: withdrawn.version, reason: "Retire withdrawn evaluation"});
      expect((await service.install(f.actor, f.home, body, input.packageKey)).status).toBe("uninstalled");
      expect(removed.id).toBe(first.id);
      await db.update(companyMemberships).set({status: "suspended"}).where(sql`company_id=${f.home}::uuid and principal_id=${f.userId}`);
      await expect(service.install(f.actor, f.home, body, input.packageKey)).rejects.toMatchObject({status: 403});
    });
    it("rejects package-path substitution and immutable installation request rewrites at the native database", async () => {
      const body = { ...installInput(), installationRequestId: randomUUID() };
      await expect(service.install(f.actor, f.home, body, "other-package")).rejects.toMatchObject({status: 404});
      const first = await service.install(f.actor, f.home, body, input.packageKey);
      await expect(db.update(companyAgentPackageInstallations).set({installationRequestId: randomUUID(), version: first.version + 1}).where(eq(companyAgentPackageInstallations.id, first.id))).rejects.toMatchObject({cause: {code: "23514", message: "package_installation_request_immutable"}});
      await expect(db.update(companyAgentPackageInstallations).set({installationRequestHash: null, version: first.version + 1}).where(eq(companyAgentPackageInstallations.id, first.id))).rejects.toMatchObject({cause: {code: "23514"}});
      const other = await seedV5Presences(db);
      await expect(service.install(other.actor, other.home, body, input.packageKey)).rejects.toMatchObject({status: 404});
    });
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
    async function enableV9Maintenance() {
      await enableStewards();
      await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, maintenance_autopilot_v9: true });
    }
    async function reviewedMaintenance(installedId: string, next: { id: string; contentHash: string }) {
      const [current] = await db.select().from(companyAgentPackageInstallations).where(eq(companyAgentPackageInstallations.id, installedId));
      return { expectedInstallationVersion: current!.version, expectedInstalledVersionId: current!.installedVersionId,
        expectedUpdatedAt: current!.updatedAt.toISOString(), expectedReleaseContentHash: next.contentHash };
    }
    it("V9 maintenance refuses unreviewed, stale-version, changed-time and changed-release observations before native mutation", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review bounded source admission" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      expect(await service.stewardUpdate(f.home, installed.id, next.id)).toEqual({ updated: false });
      for (const change of [{ expectedInstallationVersion: review.expectedInstallationVersion + 1 },
        { expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }, { expectedReleaseContentHash: "0".repeat(64) }])
        expect(await service.stewardUpdate(f.home, installed.id, next.id, { ...review, ...change })).toEqual({ updated: false });
      const current = await service.get(f.actor, f.home, installed.id);
      expect(current.installedVersionId).toBe(installed.installedVersionId); expect(current.status).toBe("active");
      expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.low_risk_update_configured")))).toHaveLength(0);
    });
    it("V9 maintenance retains a durable unknown attempt when the native effect transaction rolls back", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review unknown outcome admission" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      await db.execute(sql`create function aw_v9_attempt_rollback() returns trigger language plpgsql as $$ begin
        if new.action='agent_package.low_risk_update_configured' and new.entity_id=${sql.raw("'" + installed.id + "'")} then
          raise exception 'Native configured receipt unavailable' using errcode='23514'; end if; return new; end $$`);
      await db.execute(sql`create trigger aw_v9_attempt_rollback before insert on activity_log for each row execute function aw_v9_attempt_rollback()`);
      try {
        await expect(service.stewardUpdate(f.home, installed.id, next.id, review)).rejects.toMatchObject({ cause: { code: "23514" } });
      } finally {
        await db.execute(sql`drop trigger aw_v9_attempt_rollback on activity_log`);
        await db.execute(sql`drop function aw_v9_attempt_rollback()`);
      }
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId, version: review.expectedInstallationVersion });
      // Observe the actual unchanged five-second native lease before escalation.
      await new Promise(resolve => setTimeout(resolve, 6000));
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false });
      const events = await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id));
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_started")).toHaveLength(1);
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_finished")).toHaveLength(0);
      expect(events.find(e => e.action === "agent_package.maintenance_loop_blocked")?.details).toMatchObject({ reason: "unknown_outcome", humanReviewRequired: true });
      const unknownHistory = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      expect(unknownHistory.entries).toMatchObject([{ outcome: "human_review_required" }]);
      expect(unknownHistory.attemptHistory).toMatchObject({ hasMore: false, entries: [{ outcome: "unconfirmed", finishedAt: null, sourceMatchesCurrent: true }] });
      expect(unknownHistory.attemptHistory?.observedAt).toBe(unknownHistory.observedAt);
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, new AbortController().signal)).needsYou[0]?.evidence).toEqual(["unknown_outcome"]);
      // An explicit native owner source transition supersedes, but does not erase, the old attempt.
      const suspended = await service.decide(f.actor, f.home, installed.id, "suspend", { expectedVersion: review.expectedInstallationVersion, reason: "Owner reviews retained unknown outcome" });
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, new AbortController().signal)).needsYou).toEqual([]);
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: suspended.version, reason: "Owner explicitly reauthorizes current configuration" });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, await reviewedMaintenance(installed.id, next))).toEqual({ updated: true });
      expect((await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.maintenance_attempt_started"))))).toHaveLength(2);
    });
    it.each([1, 2])("V9 maintenance does not repeat an effect after transaction %s acknowledgement is lost", async (lostTransaction) => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review original native acknowledgement" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      const transact = db.transaction.bind(db);
      let completed = 0;
      const dropAck = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
        const result = await transact(callback, config);
        if (++completed === lostTransaction) throw new Error("Lost native transaction acknowledgement");
        return result;
      });
      try { await expect(service.stewardUpdate(f.home, installed.id, next.id, review)).rejects.toThrow("Lost native transaction acknowledgement"); }
      finally { dropAck.mockRestore(); }
      const current = await service.get(f.actor, f.home, installed.id);
      expect(current).toMatchObject(lostTransaction === 1
        ? { status: "active", installedVersionId: review.expectedInstalledVersionId, version: review.expectedInstallationVersion }
        : { status: "configuring", installedVersionId: next.id, version: review.expectedInstallationVersion + 1, activationHash: null });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false });
      const events = await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id));
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_started")).toHaveLength(1);
      expect(events.filter(e => e.action === "agent_package.low_risk_update_configured")).toHaveLength(lostTransaction === 2 ? 1 : 0);
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_finished")).toHaveLength(lostTransaction === 2 ? 1 : 0);
      const history = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      const attempt = history.attemptHistory?.entries[0];
      expect(attempt).toMatchObject({ sourceMatchesCurrent: lostTransaction === 1 });
      expect(attempt?.outcome).toBe(lostTransaction === 2 ? "configuration_recorded"
        : Date.parse(history.observedAt) >= Date.parse(attempt!.leaseExpiresAt) ? "unconfirmed" : "awaiting_receipt");
      expect(await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id))).toHaveLength(events.length);
    });
    it("V9 maintenance rechecks original human authority after durable reservation", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review current human authority" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      const transact = db.transaction.bind(db);
      let completed = 0;
      const withdraw = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
        const result = await transact(callback, config);
        if (++completed === 1) await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
        return result;
      });
      try { await expect(service.stewardUpdate(f.home, installed.id, next.id, review)).rejects.toMatchObject({ status: 403 }); }
      finally {
        withdraw.mockRestore();
        await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      }
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false });
    });
    it("V9 maintenance fences a late reserved worker and counts its known no-effect attempt", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review native attempt lease" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      const transact = db.transaction.bind(db);
      let completed = 0;
      const delay = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
        const result = await transact(callback, config);
        if (++completed === 1) await new Promise(resolve => setTimeout(resolve, 6000));
        return result;
      });
      try { expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false }); }
      finally { delay.mockRestore(); }
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: true });
      const events = await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id));
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_started")).toHaveLength(2);
      expect(events.filter(e => e.action === "agent_package.low_risk_update_configured")).toHaveLength(1);
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_finished").map(e => e.details?.outcome).sort()).toEqual(["configured_activation_required", "no_effect"]);
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).attemptHistory?.entries.map(entry => entry.outcome).sort()).toEqual(["configuration_recorded", "no_effect"]);
    });
    it("V9 maintenance retains an unknown original tuple after its daily budget window has elapsed", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review retained unknown native source" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      // Retained original audit fixture exercises time-window semantics, not execution evidence.
      await db.insert(activityLog).values({ companyId: f.home, actorType: "system", actorId: "core-stewards",
        entityType: "agent_package_installation", entityId: installed.id, action: "agent_package.maintenance_attempt_started",
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), details: { attemptId: randomUUID(), candidateVersion: next.id,
          reviewedSource: review, policyVersion: "aw-v9-package-maintenance-1", maintenanceClass: "M2", policyOwnerUserId: f.userId } });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false });
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId });
      const blocked = await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.maintenance_loop_blocked")));
      expect(blocked).toHaveLength(1); expect(blocked[0]!.details).toMatchObject({ reason: "unknown_outcome" });
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, new AbortController().signal)).needsYou).toHaveLength(1);
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).attemptHistory).toMatchObject({ entries: [{ outcome: "unconfirmed", finishedAt: null, sourceMatchesCurrent: true }] });
    });
    it("V9 maintenance counts known no-effect attempts and never falls back to V7 authority", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review bounded attempt costs" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      for (let attempt = 0; attempt < 3; attempt++) {
        const transact = db.transaction.bind(db);
        let completed = 0;
        const rollbackFlag = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
          const result = await transact(callback, config);
          if (++completed === 1) await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: false });
          return result;
        });
        try { expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false }); }
        finally { rollbackFlag.mockRestore(); await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: true }); }
      }
      expect(await service.stewardUpdate(f.home, installed.id, next.id, review)).toEqual({ updated: false });
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId, version: review.expectedInstallationVersion });
      const events = await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id));
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_started")).toHaveLength(3);
      expect(events.filter(e => e.action === "agent_package.maintenance_attempt_finished").map(e => e.details?.outcome)).toEqual(["no_effect", "no_effect", "no_effect"]);
      expect(events.filter(e => e.action === "agent_package.low_risk_update_configured")).toHaveLength(0);
      expect(events.find(e => e.action === "agent_package.maintenance_loop_blocked")?.details).toMatchObject({ reason: "attempt_budget" });
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).attemptHistory?.entries.map(entry => entry.outcome)).toEqual(["no_effect", "no_effect", "no_effect"]);
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, new AbortController().signal)).needsYou[0]?.evidence).toEqual(["attempt_budget"]);
    });
    it("V9 maintenance concurrent scans configure once with a native verified configuration receipt and retain activation", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Opt in to bounded unchanged-content updates" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const scans = await Promise.all([maintainPackageUpdates(db), maintainPackageUpdates(db)]);
      // The native scanner also services retained fixtures in other companies.
      // Exactly-once is asserted below on this installation's real mutation receipt.
      expect(scans.some(scan => scan.configured > 0)).toBe(true);
      const current = await service.get(f.actor, f.home, installed.id);
      expect(current).toMatchObject({ installedVersionId: next.id, status: "configuring", activationHash: null, version: 3 });
      const receipts = await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.low_risk_update_configured")));
      expect(receipts).toHaveLength(1); expect(receipts[0]!.details).toMatchObject({ maintenanceClass: "M2", policyVersion: "aw-v9-package-maintenance-1", postcondition: "configured_activation_required", activationRequired: true });
      const history = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      expect(history).toMatchObject({ companyId: f.home, installationId: installed.id, installationVersion: 3,
        installationStatus: "configuring", hasMore: false, entries: [{ receiptId: receipts[0]!.id, maintenanceClass: "M2", outcome: "configured_activation_required" }] });
      expect(JSON.stringify(history)).not.toContain("policyOwnerUserId");
      expect(history.attemptHistory).toMatchObject({ hasMore: false, entries: [{ outcome: "configuration_recorded", sourceMatchesCurrent: false }] });
      // Additional unlinked historical receipt fixtures exercise only bounded projection.
      // They must not duplicate the original attempt-bound configured receipt.
      const { attemptId: _attemptId, ...historicalDetails } = receipts[0]!.details!;
      await db.insert(activityLog).values(Array.from({ length: 11 }, (_, index) => ({
        companyId: f.home, actorType: "system", actorId: "core-stewards", entityType: "agent_package_installation", entityId: installed.id,
        action: "agent_package.low_risk_update_configured", details: historicalDetails, createdAt: new Date(Date.now() + index),
      })));
      const bounded = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      expect(bounded.entries).toHaveLength(10); expect(bounded.hasMore).toBe(true);
      await expect(run()).rejects.toMatchObject({ cause: { code: "23514", message: "package_run_activation_required" } });
    });
    it("V9 maintenance attempt projection bounds retained original starts without writing or inventing outcomes", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Read retained native attempt history" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      // Original audit fixtures qualify read projection, not package execution or recovery.
      await db.insert(activityLog).values(Array.from({ length: 11 }, (_, index) => ({
        companyId: f.home, actorType: "system", actorId: "core-stewards", entityType: "agent_package_installation", entityId: installed.id,
        action: "agent_package.maintenance_attempt_started", createdAt: new Date(Date.now() - 60000 - index * 1000),
        details: { attemptId: randomUUID(), candidateVersion: next.id, reviewedSource: review,
          policyVersion: "aw-v9-package-maintenance-1", maintenanceClass: "M2", policyOwnerUserId: f.userId },
      })));
      const before = await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id));
      const history = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      expect(history.attemptHistory?.hasMore).toBe(true);
      expect(history.attemptHistory?.entries).toHaveLength(10);
      expect(history.attemptHistory?.entries.every(entry => entry.outcome === "unconfirmed" && entry.finishedAt === null && entry.sourceMatchesCurrent)).toBe(true);
      expect(JSON.stringify(history)).not.toContain(f.userId);
      expect(await db.select().from(activityLog).where(eq(activityLog.entityId, installed.id))).toHaveLength(before.length);
      expect(await service.get(f.actor, f.home, installed.id)).toMatchObject({ status: "active", installedVersionId: review.expectedInstalledVersionId });
    });
    it("V9 maintenance attempt projection refuses duplicate terminal evidence instead of choosing an outcome", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Review original native terminal evidence" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      expect(await service.stewardUpdate(f.home, installed.id, next.id, await reviewedMaintenance(installed.id, next))).toEqual({ updated: true });
      const [terminal] = await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.maintenance_attempt_finished")));
      // Deliberately inconsistent original-namespace fixture: no synthetic execution claim.
      const [duplicate] = await db.insert(activityLog).values({ companyId: f.home, actorType: "system", actorId: "core-stewards",
        entityType: "agent_package_installation", entityId: installed.id, action: terminal!.action, details: terminal!.details }).returning();
      try { await expect(readMaintenanceHistory(db, f.actor, f.home, installed.id)).rejects.toMatchObject({ status: 404 }); }
      finally { await db.delete(activityLog).where(eq(activityLog.id, duplicate!.id)); }
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).attemptHistory?.entries[0]?.outcome).toBe("configuration_recorded");
    });
    it("V9 maintenance breaks repeated configured-change recurrence without activating or granting work", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      let version = installed.version;
      const grants = await db.select().from(principalPermissionGrants);
      for (let patch = 1; patch <= 4; patch++) {
        await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: version, reason: "Explicit fixture human activation after each unchanged-content update" });
        const next = await service.publish(f.actor, { ...input, version: `1.0.${patch}`, releaseNotes: "Editorial correction" });
        expect(await service.stewardUpdate(f.home, installed.id, next.id, await reviewedMaintenance(installed.id, next))).toEqual({ updated: patch <= 3 });
        const current = await service.get(f.actor, f.home, installed.id); version = current.version;
        if (patch === 4) {
          expect(current.installedVersionId).not.toBe(next.id); expect(current.status).toBe("active");
          expect(await service.stewardUpdate(f.home, installed.id, next.id, await reviewedMaintenance(installed.id, next))).toEqual({ updated: false });
        }
      }
      expect(await db.select().from(principalPermissionGrants)).toHaveLength(grants.length);
      const blocked = await db.select().from(activityLog).where(and(eq(activityLog.entityId, installed.id), eq(activityLog.action, "agent_package.maintenance_loop_blocked")));
      expect(blocked).toHaveLength(1); expect(blocked[0]!.details).toMatchObject({ reason: "attempt_budget", humanReviewRequired: true });
      const history = await readMaintenanceHistory(db, f.actor, f.home, installed.id);
      expect(history.installationStatus).toBe("active");
      expect(history.entries.filter(entry => entry.outcome === "human_review_required")).toHaveLength(1);
      expect(history.entries.filter(entry => entry.outcome === "configured_activation_required")).toHaveLength(3);
      const signal = new AbortController().signal;
      const attention = await readPackageMaintenanceAttention(db, f.actor, f.home, signal);
      expect(attention.needsYou).toHaveLength(1);
      expect(attention.needsYou[0]).toMatchObject({ kind: "maintenance", source: { domain: "agent_package_installation", resourceId: installed.id }, actions: [{ operation: "open", href: `/agents/packages/installations/${installed.id}/maintenance` }] });
      const projection = await experienceService(db).home(f.actor, f.home);
      expect(projection.needsYou.some(card => card.source.domain === "agent_package_installation" && card.source.resourceId === installed.id)).toBe(true);
      const aborted = new AbortController(); aborted.abort();
      await expect(readPackageMaintenanceAttention(db, f.actor, f.home, aborted.signal)).rejects.toBeDefined();
      await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: false });
      await expect(readPackageMaintenanceAttention(db, f.actor, f.home, signal)).rejects.toMatchObject({ status: 404 });
      await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: true });
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, signal)).needsYou).toHaveLength(1);
      // A withdrawn actual candidate cannot keep an old escalation actionable.
      const candidateId = blocked[0]!.details!.candidateVersion as string;
      await service.revoke(f.actor, candidateId);
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, signal)).needsYou).toEqual([]);
      // A real later native source change makes the original blocked review stale.
      await service.decide(f.actor, f.home, installed.id, "suspend", { expectedVersion: history.installationVersion, reason: "Native owner suspension supersedes the original automatic repair observation" });
      expect((await readPackageMaintenanceAttention(db, f.actor, f.home, signal)).needsYou).toEqual([]);
      await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      await expect(readPackageMaintenanceAttention(db, { ...f.actor, isInstanceAdmin: true }, f.home, signal)).rejects.toMatchObject({ status: 403 });
    });
    it("V9 maintenance retains the native database refusal of cross-company agent references", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await expect(db.insert(companyAgentPackageInstallations).values({
        companyId: f.home, packageId: installed.packageId, installedVersionId: installed.installedVersionId,
        agentId: f.guestPresence.id, installedByUserId: f.userId, components: [], status: "configuring", updatePolicy: "auto_low_risk",
      })).rejects.toMatchObject({ cause: { code: "23503" } });
      // The migrated native composite foreign key owns this tenant invariant.
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).agentId).toBe(f.presence.id);
    });
    it("V9 maintenance history requires current native tenant and agent read authority and closes on rollback", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      expect((await readMaintenanceHistory(db, f.actor, f.home, installed.id)).entries).toEqual([]);
      const api = express(); api.use(express.json()); api.use((req, _res, next) => { req.actor = f.actor; next(); });
      api.use("/api", maintenanceHistoryRoutes(db)); api.use(errorHandler);
      const url = `/api/companies/${f.home}/agent-package-installations/${installed.id}/experience/maintenance`;
      const response = await request(api).get(url + `?expectedUserId=${f.userId}`).expect(200);
      expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.body.entries).toEqual([]);
      const changed = await request(api).get(url + "?expectedUserId=another-account").expect(409);
      expect(changed.headers["cache-control"]).toBe("private, no-store");
      await request(api).get(url + `?expectedUserId=${f.userId}&details=true`).expect(400);
      await request(api).get(url).expect(400);

      await expect(readMaintenanceHistory(db, f.actor, f.guest, installed.id)).rejects.toMatchObject({ status: 404 });
      await expect(readMaintenanceHistory(db, f.actor, f.home, randomUUID())).rejects.toMatchObject({ status: 404 });
      await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: false });
      await expect(readMaintenanceHistory(db, f.actor, f.home, installed.id)).rejects.toMatchObject({ status: 404 });
      await instanceSettingsService(db).updateExperimental({ maintenance_autopilot_v9: true });
      await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      await expect(readMaintenanceHistory(db, { ...f.actor, isInstanceAdmin: true }, f.home, installed.id)).rejects.toMatchObject({ status: 403 });
    });
    it("V9 maintenance cannot bypass the native Core Steward kill path with a retained review", async () => {
      await enableV9Maintenance();
      const installed = await service.install(f.actor, f.home, { ...installInput(), updatePolicy: "auto_low_risk" });
      await service.decide(f.actor, f.home, installed.id, "activate", { expectedVersion: 1, reason: "Explicit bounded update admission" });
      const next = await service.publish(f.actor, { ...input, version: "1.0.1", releaseNotes: "Editorial correction" });
      const review = await reviewedMaintenance(installed.id, next);
      await instanceSettingsService(db).updateExperimental({ core_stewards_v7: false, maintenance_autopilot_v9: false });
      await expect(service.stewardUpdate(f.home, installed.id, next.id, review)).rejects.toMatchObject({ status: 404 });
      expect((await service.get(f.actor, f.home, installed.id)).installedVersionId).toBe(installed.installedVersionId);
    });
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
    it.each([false,true])("Learning proposes a native update with analytical signal %s, requires human review and erases derived prose with rollout disabled", async (withSignal) => {
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
      let signal:{sourceId:string;observationId:string;pin:{kind:"analytical_evidence";source:{type:"metric_observation";id:string;metricId:string;metricVersionId:string}}}|undefined;
      if(withSignal){
        await instanceSettingsService(db).updateExperimental({analytical_lineage_v8:true,business_metrics_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true});
        const purpose=analyticalPurpose(),policy=await aiGovernanceService(db).obligation(f.actor,f.home,purpose),metrics=businessMetricService(db),metric=await metrics.create(f.home,f.actor,{key:"package_analytical_signal",definition:{...metricDefinition(policy.id),ownerUserId:f.userId}});
        await metrics.publish(f.home,f.actor,metric.metric.id,{expectedRevision:1,versionId:metric.version.id});
        const sourceId=randomUUID();await db.insert(issues).values({id:sourceId,companyId:f.home,title:"Independent native package analytical Source",status:"done",completedAt:new Date()});
        const now=Date.now(),observation=await metrics.query(f.home,f.actor,{metricId:metric.metric.id,versionId:metric.version.id,from:new Date(now-86400000).toISOString(),until:new Date(now+1000).toISOString(),dimensions:[],maxRows:100});
        signal={sourceId,observationId:observation.id,pin:{kind:"analytical_evidence",source:{type:"metric_observation",id:observation.id,metricId:observation.metricId,metricVersionId:observation.versionId}}};
      }
      const cycle = await learning.create(f.actor, f.home, {
        scope: { type: "company", id: null },
        purpose: "native_task_execution",
        trigger:
          "Repeated local review suggests evaluating an updated internal package",
        memoryRecordIds: roots,
        ...(signal?{analyticalSources:[signal.pin]}:{}),
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
      if(signal){
        expect((await service.proposals(f.actor,f.home)).some(proposal=>proposal.id===link.candidateId)).toBe(true);
        await db.update(issues).set({hiddenAt:new Date()}).where(eq(issues.id,signal.sourceId));
        expect(await service.proposals(f.actor,f.home)).toEqual([]);await expect(service.reviewProposal(f.actor,f.home,link.candidateId,"accept")).rejects.toMatchObject({details:{code:"analytical_source_access_lost"}});
        expect((await service.get(f.actor,f.home,installed.id)).installedVersionId).toBe(versionId);await db.update(issues).set({hiddenAt:null}).where(eq(issues.id,signal.sourceId));
      }
      await service.reviewProposal(f.actor, f.home, link.candidateId, "accept");
      const updated = await service.get(f.actor, f.home, installed.id);
      expect(updated.status).toBe("configuring");
      expect(updated.installedVersionId).toBe(nextId);
      await instanceSettingsService(db).updateExperimental({
        learning_engine_v7: false,
        agent_packages_v7: false,
      });
      if(signal){
        await instanceSettingsService(db).updateExperimental({business_metrics_v8:false,analytical_lineage_v8:false});await db.update(companies).set({status:"paused"}).where(eq(companies.id,f.home));await db.delete(businessMetricObservations).where(eq(businessMetricObservations.id,signal.observationId));await memoryJobService(db).tick({limit:10});
        expect((await db.select().from(memoryRecords).where(eq(memoryRecords.id,roots[0]!)))[0]!.content).toContain("Local reviewed output fixture");expect((await db.select().from(issues).where(eq(issues.id,tasks[0]!)))[0]!.status).toBe("done");
      }else await db.transaction((tx) =>
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
    async function prepareFirstValueFixture(budgets: CreateOrchestrationPlanInput["budgets"] = {}, configurePresence?: () => Promise<void>) {
      await instanceSettingsService(db).updateExperimental({
        activation_v9: true, experience_analytics_v9: true, free_core_commercial_v7: true, billing_entitlements_v6: true,
        billing_usage_v6: true, enableWorkflowsV1: true,
        transactional_email_v6: true, email_verification_required_v6: true, server_onboarding_v6: true,
        readiness_engine_v7: true, orchestration_v7: true, supervision_v7: true, verifier_v7: true,
        ai_use_cases_v7: true,
      });
      const { published } = await hireFixture();
      versionId = published.id;
      // Seed the original onboarding owner at review, and a bounded native test
      // entitlement. All package activation, orchestration, admission and review
      // below use their original writers; this is not a live customer outcome.
      const [account] = await db.insert(billingAccounts).values({ displayName: "First value fixture", payerUserId: f.userId }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
      await db.insert(billingSubscriptions).values({ billingAccountId: account!.id,
        providerSubscriptionId: `native-test-fixture-${randomUUID()}`, status: "active", productKeys: ["agent_package_research"],
        currentPeriodEnd: new Date(Date.now() + 3600000), providerUpdatedAt: new Date(), sourceHash: "native-test-fixture" });
      const intent = "Prepare a source-bound customer research draft";
      const [onboarding] = await db.insert(companyOnboardingRuns).values({ companyId: f.home, billingAccountId: account!.id,
        createdByUserId: f.userId, idempotencyKey: randomUUID(), requestHash: "a".repeat(64), currentStage: "v9_review",
        activationState: { ...initialActivationState(), step: "review", intent, packageVersionId: versionId } }).returning();
      const foundation = foundationService(db), principal = { principal: { type: "user" as const, userId: f.userId } };
      const companyProfile = await foundation.createDraft(f.home, { foundationKey: "company_profile", category: "company",
        documentType: "profile", body: "Native test company prepares source-bound customer research drafts",
        authorityLevel: "canonical", sensitivity: "internal" }, principal);
      await foundation.submitForReview(f.home, companyProfile.id, companyProfile.latestRevisionId!, principal);
      await foundation.approve(f.home, companyProfile.id, companyProfile.latestRevisionId!, principal);
      await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
      await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map(permissionKey => ({
        companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey,
      }))).onConflictDoNothing();
      await configurePresence?.();
      const governance = aiGovernanceService(db);
      const oversight = await governance.oversight(f.actor, f.home, governanceOversight);
      let useCase = await governance.create(f.actor, f.home, { key: `first-value-${randomUUID()}`, purpose: {
        ...governancePurpose(), intendedPurpose: published.release.manifest.purpose, riskClass: "C1", oversightProfileId: oversight.id,
      } });
      for (const assessment of governanceReviews()) {
        await governance.assess(f.actor, f.home, useCase.id, { ...assessment, expectedVersion: useCase.version });
        useCase = { ...useCase, version: useCase.version + 1 };
      }
      useCase = await governance.decide(f.actor, f.home, useCase.id, "approve", { expectedVersion: useCase.version,
        rationale: "Native fixture human reviewed this precise internal draft purpose" });
      const installed = await service.install(f.actor, f.home, { ...installInput(), aiUseCaseId: useCase.id });
      const installation = await service.decide(f.actor, f.home, installed.id, "activate", {
        expectedVersion: installed.version, reason: "Explicit native fixture reviewed-purpose activation",
      });
      expect(installation.status, JSON.stringify(installation.readiness)).toBe("active");
      const [task] = await db.insert(issues).values({ companyId: f.home, title: "Private first-result draft", status: "todo",
        assigneeAgentId: f.presence.id, createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
      const orchestration = orchestrationService(db);
      const created = await orchestration.create(f.actor, f.home, createOrchestrationPlanSchema.parse({
        issueId: task!.id, expectedIssueUpdatedAt: task!.updatedAt.toISOString(), riskClass: "C1", workload: "semantic",
        completionContract: { objective: intent, requiredOutputs: [{ key: "result" }],
          businessInvariants: ["Every claim cites an authorized retained source"] }, budgets, workers: [{ key: "worker", issueId: task!.id }],
      }));
      return { onboarding: onboarding!, installation, task: task!, created, intent, orchestration, useCase };
    }
    async function noChargePreparationFixture() {
      const modelProfileId = randomUUID();
      const transport = vi.fn<typeof guardedRemoteHttpFetch>(async () => { throw new Error("Preparation must never call a model transport"); });
      let profile!: WorkerModelProfile;
      const fixture = await prepareFirstValueFixture({}, async () => {
        const connection = await aiConnectionService(db).save(f.home, f.userId, {
          provider: "anthropic", method: "api_key", ownership: "shared", name: "No-charge preparation software fixture",
          apiKey: "fixture", allAgents: false, agentIds: [f.presence.id],
        }, "fixture-private-preparation-credential-123456");
        await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: {
          provider: "aw_text_only", workerModelProfileId: modelProfileId, model: "fixture-preparation-model-20261010",
          maxOutputTokens: 256, lifecycleMode: "per_turn",
        }, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } } }).where(eq(agents.id, f.presence.id));
        const [presence] = await db.select().from(agents).where(eq(agents.id, f.presence.id));
        const providers = agentProviderBindingService(db);
        const discovery = await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config: presence!.adapterConfig });
        const recorded = await providers.recordDiscovery(f.home, f.presence.id, discovery, {
          connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true,
        });
        await providers.revalidate(f.actor, f.home, f.presence.id, recorded.capabilitySnapshotHash!,
          "Original Native software fixture review of exact text-only configuration; no provider delivery qualification claimed");
        const bound = await providers.assertRuntime(f.home, f.presence.id);
        profile = { id: modelProfileId, companyId: f.home, workerAgentId: f.presence.id,
          providerBindingId: bound.provider.id, providerSnapshotHash: bound.provider.capabilitySnapshotHash!,
          providerProfileRef: bound.runtime.providerProfileRef, qualifiedConfigurationHash: bound.runtime.qualifiedConfigurationHash!,
          binding: { provider: "anthropic", method: "api_key", mode: "shared", ...connection },
          transport: "server-text-only-v1", contract: "anthropic-text-messages-2023-06-01",
          maximumEnvelopeBytes: 64000, inputTokensUpperBound: 100000, maxOutputTokens: 1024,
          tariff: { provider: "anthropic", model: "fixture-preparation-model-20261010", currency: "USD",
            inputMinorPerMillion: 0, outputMinorPerMillion: 0, fixedMinor: 0, qualificationHash: "b".repeat(64), sourceSha: "a".repeat(40),
            testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString() },
          qualificationEvidenceRef: "https://qualification.test.invalid/qualification/preparation-software-fixture.json",
          qualificationArtifactSha256: "c".repeat(64),
        };
        registerNativeDraftGateway(db, workerModelGateway(db, { profiles: [profile], sourceSha: "a".repeat(40),
          protectedEvidenceOrigin: "https://qualification.test.invalid", fetch: transport }));
      });
      const activation = activationService(db);
      const view = await activation.get(f.actor, f.home);
      const option = view.firstTask!.preparationOptions[0]!;
      expect(option).toMatchObject({ installationId: fixture.installation.id, maximumModelCostMinor: 0 });
      const input = { operation: "prepare_first_task" as const, requestId: randomUUID(), expectedVersion: view.version,
        installationId: option.installationId, expectedInstallationVersion: option.installationVersion,
        expectedInstallationHash: option.installationHash, expectedUseCaseVersion: option.useCaseVersion,
        expectedPurposeVersion: option.purposeVersion, confirmCurrentPurpose: true as const };
      return { ...fixture, activation, input, transport, profile };
    }

    // Original publisher/account/onboarding rows, no installed package/runtime.
    // This qualifies paused provisioning, not hosted compute or first value.
    async function firstAgentPreparationFixture(answers: Record<string, unknown> = {}, step: "review" | "access" = "review", requiredConnections: string[] = []) {
      await instanceSettingsService(db).updateExperimental({ activation_v9: true, free_core_commercial_v7: true,
        billing_entitlements_v6: true, billing_usage_v6: true, transactional_email_v6: true,
        email_verification_required_v6: true, server_onboarding_v6: true });
      const { published } = await hireFixture(requiredConnections); versionId = published.id;
      const [account] = await db.insert(billingAccounts).values({ displayName: "Paused preparation fixture", payerUserId: f.userId }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
      const [onboarding] = await db.insert(companyOnboardingRuns).values({ companyId: f.home, billingAccountId: account!.id,
        createdByUserId: f.userId, idempotencyKey: randomUUID(), requestHash: "a".repeat(64), currentStage: "v9_review", answers,
        activationState: { ...initialActivationState(), step, intent: "PRIVATE preparation goal", packageVersionId: versionId } }).returning();
      const activation = activationService(db), input = { operation: "prepare_first_agent" as const,
        requestId: randomUUID(), expectedVersion: onboarding!.version, confirmPausedPreparation: true as const };
      return { published, onboarding: onboarding!, activation, input };
    }
    // Original Apps rows are software fixtures for setup projection, never
    // provider-health, credential-resolution or representative-execution proof.
    async function connectionSetupFixture(companyId = f.home, key = "linear") {
      const [app] = await db.insert(toolApplications).values({ companyId, applicationKey: key, name: `App ${randomUUID()}`, type: "mcp_http" }).returning();
      const observed = new Date();
      const [connection] = await db.insert(toolConnections).values({ companyId, applicationId: app!.id, name: "Recorded setup", uid: randomUUID(),
        transport: "rest_api", authKind: "none", status: "active", enabled: true, healthStatus: "ok", healthCheckedAt: observed, updatedAt: observed,
        config: { private: "PRIVATE endpoint configuration" }, healthMessage: "PRIVATE provider observation" }).returning();
      await db.insert(toolConnectionInstalls).values({ companyId, connectionId: connection!.id, targetType: "company", targetId: companyId });
      return { app: app!, connection: connection! };
    }
    const readRequiredSetup = (required = ["linear"]) => db.transaction(tx => readActivationRequiredAccess(tx as unknown as Db, f.actor, f.home, required));
    async function connectionConsentFixture(authorizeOwnedFixture = false) {
      const key = `required-gmail-${randomUUID()}`;
      const fixture = await firstAgentPreparationFixture({}, "access", [key]);
      const [app] = await db.insert(toolApplications).values({ companyId: f.home, applicationKey: key, name: `Personal Gmail ${randomUUID()}`,
        type: "mcp_http", status: "active", metadata: { sourceTemplateKey: "gmail", galleryKey: "gmail" } }).returning();
      const connector: PaperclipCloudConnector = {
        getCapabilities: vi.fn(async () => ["gmail.read", "gmail.draft"]),
        startAuthorization: vi.fn(async ({ returnState }) => {
          if (!authorizeOwnedFixture) throw new Error("No real provider authorization in this owner fixture");
          return { authorizationUrl: `https://accounts.google.com/owned-fixture?state=${encodeURIComponent(returnState)}`, expiresAt: new Date(Date.now() + 600000).toISOString() };
        }),
        claim: vi.fn(async () => {
          if (!authorizeOwnedFixture) throw new Error("No provider credential claim in this owner fixture");
          return { v: 1 as const, provider: "google" as const, profile: "gmail.read", accessToken: "owned-software-access-token",
            refreshToken: "owned-software-refresh-token", tokenType: "Bearer", accessTokenExpiresAt: null, refreshTokenExpiresAt: null,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"], subject: f.userId, companyId: f.home,
            instanceId: "owned-fixture", environment: "development" as const };
        }),
        refresh: vi.fn(async () => { throw new Error("No provider refresh in this owner fixture"); }),
        revoke: vi.fn(async () => { throw new Error("No provider revocation in this owner fixture"); }),
      };
      const apps = toolAccessService(db, { paperclipCloudConnector: connector,
        remoteHttpEndpointLookup: async () => [{ address: "8.8.8.8", family: 4 }],
        remoteHttpRequest: async () => {
          if (!authorizeOwnedFixture) throw new Error("No provider HTTP execution in this ownership fixture");
          return Response.json({ jsonrpc: "2.0", id: "paperclip-catalog-refresh", result: { tools: [] } });
        } });
      const owner = activationConnectionConsentService(db, apps);
      const review = await owner.getReview(f.actor, f.home, key);
      const command = { requestKey: randomUUID(), confirmConnectionAuthorization: true as const, expectedReviewHash: review.reviewHash };
      return { ...fixture, key, app: app!, connector, apps, owner, review, command };
    }
    it("records one distinct current purpose consent without credentials, provider authorization or Agent reach", async () => {
      const c = await connectionConsentFixture();
      expect(Object.keys(c.review.preview)).toHaveLength(8);
      expect(c.review).toMatchObject({ applicationId: c.app.id, applicationKey: c.key, grantKind: "user", deferAgentAccess: true,
        scopeProfile: "gmail.read", providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
      const before = { agents: await db.select().from(agents), secrets: await db.select().from(companySecrets), grants: await db.select().from(connectionGrants) };
      const [first, replay] = await Promise.all([c.owner.approve(f.actor, f.home, c.key, c.command), c.owner.approve(f.actor, f.home, c.key, c.command)]);
      expect(first).toEqual(replay); expect(first).toMatchObject({ status: "approved", connectionId: null });
      expect(await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).toEqual(first);
      expect(await db.select().from(agents)).toEqual(before.agents);
      expect(await db.select().from(companySecrets)).toEqual(before.secrets);
      expect(await db.select().from(connectionGrants)).toEqual(before.grants);
      expect(c.connector.startAuthorization).not.toHaveBeenCalled(); expect(c.connector.claim).not.toHaveBeenCalled();
      expect((await db.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.onboardingRunId, c.onboarding.id)))).toHaveLength(1);
      await expect(c.owner.approve(f.actor, f.home, c.key, { ...c.command, expectedReviewHash: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
    });
    it("rejects stale reviews after Native package, application or onboarding changes without creating an approval", async () => {
      const c = await connectionConsentFixture();
      await db.update(toolApplications).set({ name: "Changed provider explanation", updatedAt: new Date() }).where(eq(toolApplications.id, c.app.id));
      await expect(c.owner.approve(f.actor, f.home, c.key, c.command)).rejects.toMatchObject({ status: 409 });
      const refreshed = await c.owner.getReview(f.actor, f.home, c.key);
      const reselected = await c.activation.command(f.actor, f.home, { operation: "reselect_capability", requestId: randomUUID(), expectedVersion: c.onboarding.version });
      await c.activation.command(f.actor, f.home, { operation: "select_capability", requestId: randomUUID(), expectedVersion: reselected.version, packageVersionId: c.published.id });
      await expect(c.owner.approve(f.actor, f.home, c.key, { ...c.command, expectedReviewHash: refreshed.reviewHash })).rejects.toMatchObject({ status: 409 });
      await service.revoke(f.actor, c.published.id);
      await expect(c.owner.getReview(f.actor, f.home, c.key)).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.onboardingRunId, c.onboarding.id))).toEqual([]);
    });
    it("keeps the actual original allocation on an unknown reply and refuses a second connection or credential owner", async () => {
      const c = await connectionConsentFixture();
      await c.owner.approve(f.actor, f.home, c.key, c.command);
      const input = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey);
      const connected = await c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey));
      const receipt = await c.owner.getReceipt(f.actor, f.home, c.command.requestKey);
      expect(receipt).toMatchObject({ status: "allocated", connectionId: connected.connectionId, connectedAt: null });
      expect(JSON.stringify(receipt)).not.toMatch(/reservedConnectionId|credential|methodHash|subjectUserId/);
      await expect(c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey))).rejects.toMatchObject({ status: 409 });
      await expect(c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId })).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(toolConnections).where(eq(toolConnections.applicationId, c.app.id))).toHaveLength(1);
      expect(await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, connected.connectionId))).toEqual([]);
      expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, connected.connectionId))).toEqual([]);
      expect(c.connector.startAuthorization).not.toHaveBeenCalled(); expect(c.connector.claim).not.toHaveBeenCalled();
    });
    it("uses the original HTTP allocator once and leaves provider sign-in to the explicit setup flow", async () => {
      const c = await connectionConsentFixture(); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => { req.actor = { ...f.actor, memberships: [{ companyId: f.home, membershipRole: "owner", status: "active" }] }; next(); });
      app.use("/api", toolAccessRoutes(db, { paperclipCloudConnector: c.connector,
        remoteHttpEndpointLookup: async () => [{ address: "8.8.8.8", family: 4 }],
        remoteHttpRequest: async () => { throw new Error("No live provider HTTP in this ownership fixture"); } }));
      app.use(errorHandler);
      const path = `/api/companies/${f.home}/activation/connection-consents/${c.command.requestKey}/connect`;
      expect((await request(app).post(path).send({ confirmProviderSetup: true, grantKind: "organization" })).status).toBe(400);
      const allocated = await request(app).post(path).send({ confirmProviderSetup: true });
      expect(allocated.status).toBe(201); expect(allocated.body.connection.credentialPolicy).toBe("per_user");
      expect(allocated.body.auth.startUrl).toBeNull();
      expect(c.connector.startAuthorization).not.toHaveBeenCalled(); expect(c.connector.claim).not.toHaveBeenCalled();
      expect((await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).connectionId).toBe(allocated.body.connectionId);
      expect((await request(app).post(path).send({ confirmProviderSetup: true })).status).toBe(409);
      expect(await db.select().from(toolConnections).where(eq(toolConnections.applicationId, c.app.id))).toHaveLength(1);
    });
    it("rechecks membership after the original claim before committing the Native connection binding", async () => {
      const c = await connectionConsentFixture(); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const input = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey);
      const original = c.owner.allocationOwner(f.actor, f.home, c.command.requestKey);
      const interrupted = { ...original, claim: async (...args: Parameters<typeof original.claim>) => {
        const id = await original.claim(...args);
        await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
        return id;
      } };
      await expect(c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId }, interrupted)).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(toolConnections).where(eq(toolConnections.applicationId, c.app.id))).toEqual([]);
      const [receipt] = await db.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.requestKey, c.command.requestKey));
      expect(receipt).toMatchObject({ status: "allocating", connectionId: null });
      await expect(c.owner.getReceipt({ ...f.actor, isInstanceAdmin: true }, f.home, c.command.requestKey)).rejects.toMatchObject({ status: 403 });
      expect(c.connector.startAuthorization).not.toHaveBeenCalled();
    });
    it("rolls back the original connection insert with a failed receipt bind and never invents positive allocation evidence", async () => {
      const c = await connectionConsentFixture(); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const input = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey), original = c.owner.allocationOwner(f.actor, f.home, c.command.requestKey);
      await expect(c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId }, { ...original, bind: async () => { throw new Error("Owned binding failure"); } })).rejects.toThrow("Owned binding failure");
      expect(await db.select().from(toolConnections).where(eq(toolConnections.applicationId, c.app.id))).toEqual([]);
      expect(await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).toMatchObject({ status: "allocating", connectionId: null });
      await expect(c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey)).rejects.toMatchObject({ status: 409 });
    });
    it("refuses a different original method before P2 allocation rather than silently broadening approved scopes", async () => {
      const c = await connectionConsentFixture(); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const input = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey);
      await expect(c.apps.connectGalleryApp(f.home, { ...input, connectionMethodKey: "paperclip-draft" }, { actorType: "user", actorId: f.userId },
        c.owner.allocationOwner(f.actor, f.home, c.command.requestKey))).rejects.toMatchObject({ status: 409 });
      expect(await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).toMatchObject({ status: "approved", connectionId: null });
      expect(await db.select().from(toolConnections).where(eq(toolConnections.applicationId, c.app.id))).toEqual([]);
    });
    it("enforces immutable consent and zero company or Agent installation on the Native owner", async () => {
      const c = await connectionConsentFixture(); const consent = await c.owner.approve(f.actor, f.home, c.key, c.command);
      await expect(db.update(activationConnectionConsents).set({ reviewHash: "c".repeat(64) }).where(eq(activationConnectionConsents.id, consent.id))).rejects.toMatchObject({ cause: { code: "23514" } });
      const input = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey);
      const connected = await c.apps.connectGalleryApp(f.home, input, { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey));
      for (const target of [{ targetType: "company" as const, targetId: f.home }, { targetType: "agent" as const, targetId: f.presence.id }])
        await expect(db.insert(toolConnectionInstalls).values({ companyId: f.home, connectionId: connected.connectionId, ...target })).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(db.insert(connectionGrants).values({ companyId: f.home, connectionId: connected.connectionId, kind: "organization", isDefault: true })).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(c.apps.finalizeOAuthAccess(f.home, connected.connectionId, { grantKind: "organization" }, { actorType: "user", actorId: f.userId })).rejects.toMatchObject({ status: 409 });
      await expect(c.apps.finishGalleryAppConnection(f.home, connected.connectionId, { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: "all_agents" }, { actorType: "user", actorId: f.userId })).rejects.toMatchObject({ status: 409 });
      expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, connected.connectionId))).toEqual([]);
    });
    async function allocatedPersonalSetup() {
      const c = await connectionConsentFixture();
      await c.owner.approve(f.actor, f.home, c.key, c.command);
      const setup = await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey);
      const allocated = await c.apps.connectGalleryApp(f.home, setup, { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey));
      return { ...c, allocated, finish: () => c.apps.finishGalleryAppConnection(f.home, allocated.connectionId,
        { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: { agentIds: [] } }, { actorType: "user", actorId: f.userId }) };
    }
    // Owned Native metadata fixtures, never provider credentials or sign-in.
    async function recordOwnedPersonalSetup(c: Awaited<ReturnType<typeof allocatedPersonalSetup>>) {
      const [secret] = await db.insert(companySecrets).values({ companyId: f.home, name: `Owned metadata ${randomUUID()}`, key: randomUUID(), createdByUserId: f.userId }).returning();
      const [grant] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: c.allocated.connectionId,
        kind: "user", subjectUserId: f.userId, createdByUserId: f.userId, providerTenant: { oauth: { scopes: c.review.providerScopes } },
        credentialSecretRefs: [{ configPath: "oauth.access_token", secretId: secret!.id, version: "latest" }] }).returning();
      const observed = new Date();
      await db.update(toolConnections).set({ status: "active", enabled: true, healthStatus: "ok", healthCheckedAt: observed, updatedAt: observed })
        .where(eq(toolConnections.id, c.allocated.connectionId));
      return grant!;
    }
    it("requires actual personal health and profile evidence before Native connected status or activation continuation", async () => {
      const c = await allocatedPersonalSetup();
      const originalAgents = await db.select().from(agents).where(eq(agents.companyId, f.home));
      await expect(c.finish()).rejects.toMatchObject({ status: 409 });
      const receipt = await c.owner.getReceipt(f.actor, f.home, c.command.requestKey);
      await expect(db.update(activationConnectionConsents).set({ status: "connected", connectionHash: "a".repeat(64), connectedAt: new Date() })
        .where(eq(activationConnectionConsents.id, receipt.id))).rejects.toMatchObject({ cause: { code: "23514" } });
      await recordOwnedPersonalSetup(c);
      expect((await c.activation.get(f.actor, f.home)).requiredAccess[0]?.status).toBe("needs_review");
      await c.finish();
      const connected = await c.owner.getReceipt(f.actor, f.home, c.command.requestKey);
      expect(connected).toMatchObject({ status: "connected", connectionId: c.allocated.connectionId });
      expect(connected.connectedAt).not.toBeNull();
      expect((await c.activation.get(f.actor, f.home)).requiredAccess[0]?.status).toBe("recorded");
      const continued = await c.activation.command(f.actor, f.home, { operation: "continue_access", requestId: randomUUID(), expectedVersion: c.onboarding.version });
      expect(continued.state.step).toBe("review"); expect(continued.requiredAccess[0]?.status).toBe("recorded");
      expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, c.allocated.connectionId))).toEqual([]);
      expect(await db.select().from(agents).where(eq(agents.companyId, f.home))).toEqual(originalAgents);
      expect(c.connector.startAuthorization).not.toHaveBeenCalled(); expect(c.connector.claim).not.toHaveBeenCalled();
    });
    it("withdraws the exact purpose without deleting history or credentials and refuses future setup and provider callbacks", async () => {
      const c = await allocatedPersonalSetup(), grant = await recordOwnedPersonalSetup(c); await c.finish();
      const connected = await c.owner.getReceipt(f.actor, f.home, c.command.requestKey);
      const command = { confirmWithdrawal: true as const, expectedReviewHash: connected.reviewHash };
      const withdrawn = await c.owner.withdraw(f.actor, f.home, c.command.requestKey, command);
      expect(withdrawn).toMatchObject({ status: "withdrawn", connectionId: connected.connectionId, connectedAt: connected.connectedAt });
      expect(await c.owner.withdraw(f.actor, f.home, c.command.requestKey, command)).toEqual(withdrawn);
      expect(await c.owner.getCurrentReceipt(f.actor, f.home, c.key)).toBeNull();
      await expect(c.finish()).rejects.toMatchObject({ status: 409 });
      await expect(c.apps.startOAuth(f.home, c.allocated.connectionId, { redirectUri: "https://owned-fixture.invalid/oauth/callback", subjectUserId: f.userId, actor: { actorType: "user", actorId: f.userId } })).rejects.toMatchObject({ status: 409 });
      await expect(db.update(connectionGrants).set({ updatedAt: new Date() }).where(eq(connectionGrants.id, grant.id))).rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(c.activation.command(f.actor, f.home, { operation: "continue_access", requestId: randomUUID(), expectedVersion: c.onboarding.version }))
        .rejects.toMatchObject({ status: 409, details: { code: "REQUIRED_ACCESS_PENDING" } });
      expect((await db.select().from(connectionGrants).where(eq(connectionGrants.id, grant.id)))[0]?.credentialSecretRefs).toEqual(grant.credentialSecretRefs);
      expect(c.connector.startAuthorization).not.toHaveBeenCalled();
      await db.update(connectionGrants).set({ status: "revoked", revokedAt: new Date() }).where(eq(connectionGrants.id, grant.id));
    });
    it("ignores unrelated original application activity clocks but refuses changed material scopes before setup", async () => {
      const c = await allocatedPersonalSetup();
      await db.update(toolApplications).set({ updatedAt: new Date() }).where(eq(toolApplications.id, c.app.id));
      expect((await c.owner.getReview(f.actor, f.home, c.key)).reviewHash).toBe(c.review.reviewHash);
      await recordOwnedPersonalSetup(c);
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, c.allocated.connectionId));
      await db.update(toolConnections).set({ config: { ...connection!.config, oauth: { ...(connection!.config.oauth as object), scopes: ["broader-unapproved-scope"] } } })
        .where(eq(toolConnections.id, c.allocated.connectionId));
      await expect(c.finish()).rejects.toMatchObject({ status: 409 });
      expect(await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).toMatchObject({ status: "allocated", connectedAt: null });
    });
    it("refuses a vanished initiating membership before original finish and retains only the actual allocation", async () => {
      const c = await allocatedPersonalSetup(); await recordOwnedPersonalSetup(c);
      await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      await expect(c.finish()).rejects.toMatchObject({ status: 403 });
      const [receipt] = await db.select().from(activationConnectionConsents).where(eq(activationConnectionConsents.requestKey, c.command.requestKey));
      expect(receipt).toMatchObject({ status: "allocated", connectedAt: null, connectionId: c.allocated.connectionId });
    });
    it("completes the original managed OAuth callback with owned software credentials and zero Agent reach", async () => {
      const c = await connectionConsentFixture(true); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const allocated = await c.apps.connectGalleryApp(f.home, await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey),
        { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey));
      const actor = { actorType: "user" as const, actorId: f.userId };
      const start = await c.apps.startOAuth(f.home, allocated.connectionId, { redirectUri: "https://owned-fixture.invalid/callback", subjectUserId: f.userId, actor });
      const state = new URL(start.authorizationUrl).searchParams.get("state")!;
      await c.apps.completePaperclipCloudConnectorCallback({ state, claimId: "owned-claim", actor });
      expect(await c.owner.getReceipt(f.actor, f.home, c.command.requestKey)).toMatchObject({ status: "connected", connectionId: allocated.connectionId });
      expect((await c.activation.get(f.actor, f.home)).requiredAccess[0]?.status).toBe("recorded");
      expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, allocated.connectionId))).toEqual([]);
      const grants = await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, allocated.connectionId));
      expect(grants).toHaveLength(1); expect(grants[0]).toMatchObject({ kind: "user", subjectUserId: f.userId, isDefault: false });
      expect(c.connector.claim).toHaveBeenCalledTimes(1);
    });
    it("refuses a withdrawn original callback before the owned broker claim", async () => {
      const c = await connectionConsentFixture(true); await c.owner.approve(f.actor, f.home, c.key, c.command);
      const allocated = await c.apps.connectGalleryApp(f.home, await c.owner.getApprovedSetup(f.actor, f.home, c.command.requestKey),
        { actorType: "user", actorId: f.userId }, c.owner.allocationOwner(f.actor, f.home, c.command.requestKey));
      const actor = { actorType: "user" as const, actorId: f.userId };
      const start = await c.apps.startOAuth(f.home, allocated.connectionId, { redirectUri: "https://owned-fixture.invalid/callback", subjectUserId: f.userId, actor });
      const state = new URL(start.authorizationUrl).searchParams.get("state")!;
      await c.owner.withdraw(f.actor, f.home, c.command.requestKey, { confirmWithdrawal: true, expectedReviewHash: c.review.reviewHash });
      await expect(c.apps.completePaperclipCloudConnectorCallback({ state, claimId: "owned-claim", actor })).rejects.toMatchObject({ status: 409 });
      expect(c.connector.claim).not.toHaveBeenCalled();
      expect(await db.select().from(connectionGrants).where(eq(connectionGrants.connectionId, allocated.connectionId))).toEqual([]);
    });
    it("retains the exact qualified onboarding choice outside the bounded discovery page and refuses it after original revocation", async () => {
      const selected = await firstAgentPreparationFixture({}, "access");
      for (let index = 0; index < 21; index++) await hireFixture([], `aa-before-selection-${randomUUID()}`);
      const view = await selected.activation.get(f.actor, f.home);
      expect(view.capabilities).toHaveLength(20);
      expect(view.capabilities[0]?.versionId).toBe(selected.published.id);
      expect(view.blockers).not.toContain("no_qualified_capability");
      await service.revoke(f.actor, selected.published.id);
      const revoked = await selected.activation.get(f.actor, f.home);
      expect(revoked.capabilities).toHaveLength(20);
      expect(revoked.capabilities.some(capability => capability.versionId === selected.published.id)).toBe(false);
      expect(revoked.blockers).toContain("no_qualified_capability");
      await expect(selected.activation.command(f.actor, f.home, { operation: "continue_access", requestId: randomUUID(), expectedVersion: selected.onboarding.version }))
        .rejects.toMatchObject({ status: 409, details: { code: "CAPABILITY_UNAVAILABLE" } });
    });
    it("preserves the original outcome and company purpose when Not now returns to capability choice without granting access", async () => {
      const fixture = await firstAgentPreparationFixture({}, "access", ["linear"]);
      const before = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home));
      const original = await fixture.activation.get(f.actor, f.home);
      const command = { operation: "reselect_capability" as const, expectedVersion: fixture.onboarding.version, requestId: randomUUID() };
      const [first, replay] = await Promise.all([fixture.activation.command(f.actor, f.home, command), fixture.activation.command(f.actor, f.home, command)]);
      expect(first.state).toMatchObject({ step: "capability", packageVersionId: null, intent: original.state.intent, companyPurpose: original.state.companyPurpose });
      expect(replay.version).toBe(first.version);
      expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home))).toEqual(before);
      expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.companyId, f.home))).toEqual([]);
      expect(await db.select().from(connectionGrants).where(eq(connectionGrants.companyId, f.home))).toEqual([]);
      await expect(fixture.activation.command(f.actor, f.home, { ...command, requestId: randomUUID(), expectedVersion: first.version }))
        .rejects.toMatchObject({ status: 409, details: { code: "ACTIVATION_STEP_CONFLICT" } });
    });
    it("projects only current company setup and continues to review once without native access changes", async () => {
      const fixture = await firstAgentPreparationFixture({}, "access", ["linear"]);
      const setup = await connectionSetupFixture();
      const beforeAgents = await db.select().from(agents).where(eq(agents.companyId, f.home));
      const beforeGrants = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home));
      const beforeApps = await db.select().from(toolConnections).where(eq(toolConnections.companyId, f.home));
      const view = await fixture.activation.get(f.actor, f.home);
      expect(view.requiredAccess).toEqual([{ key: "linear", status: "recorded", checkedAt: setup.connection.healthCheckedAt!.toISOString() }]);
      expect(view.blockers).not.toContain("required_access_pending");
      expect(JSON.stringify(view.requiredAccess)).not.toMatch(/PRIVATE|credential|agentAccess|connectionId/);
      const command = { operation: "continue_access" as const, expectedVersion: fixture.onboarding.version, requestId: randomUUID() };
      const [first, replay] = await Promise.all([fixture.activation.command(f.actor, f.home, command), fixture.activation.command(f.actor, f.home, command)]);
      expect(first.state.step).toBe("review"); expect(replay.version).toBe(first.version);
      expect(first.blockers).toContain("safe_execution_unqualified");
      expect(await db.select().from(agents).where(eq(agents.companyId, f.home))).toEqual(beforeAgents);
      expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home))).toEqual(beforeGrants);
      expect(await db.select().from(toolConnections).where(eq(toolConnections.companyId, f.home))).toEqual(beforeApps);
      expect(await db.select().from(connectionGrants).where(eq(connectionGrants.companyId, f.home))).toEqual([]);
      expect(await readRequiredSetup(["linear", "linear"])).toHaveLength(1);
      await expect(readRequiredSetup(Array.from({ length: 21 }, (_, index) => `app-${index}`))).rejects.toThrow("original package bound");
    });
    it("rechecks connection changes after the displayed review and preserves the onboarding step", async () => {
      const fixture = await firstAgentPreparationFixture({}, "access", ["linear"]);
      const setup = await connectionSetupFixture();
      expect((await fixture.activation.get(f.actor, f.home)).requiredAccess?.[0]?.status).toBe("recorded");
      await db.update(toolConnections).set({ enabled: false, updatedAt: new Date() }).where(eq(toolConnections.id, setup.connection.id));
      await expect(fixture.activation.command(f.actor, f.home, { operation: "continue_access", expectedVersion: fixture.onboarding.version, requestId: randomUUID() }))
        .rejects.toMatchObject({ status: 409, details: { code: "REQUIRED_ACCESS_PENDING" } });
      expect((await fixture.activation.get(f.actor, f.home)).state.step).toBe("access");
      const [original] = await db.select().from(companyOnboardingRuns).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      expect(original!.version).toBe(fixture.onboarding.version);
    });
    it("does not substitute another company's connection or a duplicate account for required setup", async () => {
      await connectionSetupFixture(f.guest);
      expect(await readRequiredSetup()).toEqual([{ key: "linear", status: "not_connected", checkedAt: null }]);
      const setup = await connectionSetupFixture();
      await db.insert(toolConnections).values({ companyId: f.home, applicationId: setup.app.id, name: "Other account", uid: randomUUID(), transport: "rest_api" });
      expect(await readRequiredSetup()).toEqual([{ key: "linear", status: "needs_review", checkedAt: null }]);
    });
    it("does not reuse stale health or an absent company installation", async () => {
      const setup = await connectionSetupFixture();
      await db.update(toolConnections).set({ updatedAt: new Date(setup.connection.healthCheckedAt!.getTime() + 1) }).where(eq(toolConnections.id, setup.connection.id));
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
      await db.update(toolConnections).set({ updatedAt: setup.connection.updatedAt }).where(eq(toolConnections.id, setup.connection.id));
      await db.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, setup.connection.id));
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
    });
    it("keeps per-user credentials separate from company and other-user grants", async () => {
      const setup = await connectionSetupFixture();
      await db.update(toolConnections).set({ authKind: "api_key", credentialPolicy: "per_user" }).where(eq(toolConnections.id, setup.connection.id));
      const refs = [{ configPath: "headers.Authorization", secretId: randomUUID() }];
      await db.insert(connectionGrants).values([{ companyId: f.home, connectionId: setup.connection.id, kind: "organization", isDefault: true, credentialSecretRefs: refs },
        { companyId: f.home, connectionId: setup.connection.id, kind: "user", subjectUserId: "another-user", credentialSecretRefs: refs }]);
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
      const [personal] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: setup.connection.id, kind: "user", subjectUserId: f.userId, credentialSecretRefs: refs }).returning();
      expect((await readRequiredSetup())[0]?.status).toBe("recorded");
      await db.update(connectionGrants).set({ status: "needs_reauthorization" }).where(eq(connectionGrants.id, personal!.id));
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
    });
    it("does not borrow a personal or organization credential for a dedicated future agent", async () => {
      const setup = await connectionSetupFixture();
      await db.update(toolConnections).set({ authKind: "api_key", credentialPolicy: "per_agent" }).where(eq(toolConnections.id, setup.connection.id));
      await db.insert(connectionGrants).values({ companyId: f.home, connectionId: setup.connection.id, kind: "organization", isDefault: true,
        credentialSecretRefs: [{ configPath: "headers.Authorization", secretId: randomUUID() }] });
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
    });
    it("records shared credentials only under their original policy and honors personal fallback explicitly", async () => {
      const setup = await connectionSetupFixture();
      await db.update(toolConnections).set({ authKind: "api_key", credentialPolicy: "shared" }).where(eq(toolConnections.id, setup.connection.id));
      const [personal] = await db.insert(connectionGrants).values({ companyId: f.home, connectionId: setup.connection.id, kind: "user", subjectUserId: f.userId,
        credentialSecretRefs: [{ configPath: "headers.Authorization", secretId: randomUUID() }] }).returning();
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
      await db.update(toolConnections).set({ credentialPolicy: "per_user_with_fallback" }).where(eq(toolConnections.id, setup.connection.id));
      expect((await readRequiredSetup())[0]?.status).toBe("recorded");
      await db.update(connectionGrants).set({ status: "revoked", revokedAt: new Date() }).where(eq(connectionGrants.id, personal!.id));
      expect((await readRequiredSetup())[0]?.status).toBe("needs_review");
      await db.update(toolConnections).set({ credentialPolicy: "shared", credentialSecretRefs: [{ configPath: "headers.Authorization", secretId: randomUUID() }] })
        .where(eq(toolConnections.id, setup.connection.id));
      expect((await readRequiredSetup())[0]?.status).toBe("recorded");
    });
    it("hides observations after current tools authority is withdrawn despite instance-admin flags", async () => {
      const setup = await connectionSetupFixture();
      await db.update(companyMemberships).set({ membershipRole: "operator" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home), eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "tools:admin")));
      const result = await db.transaction(tx => readActivationRequiredAccess(tx as unknown as Db, { ...f.actor, isInstanceAdmin: true }, f.home, ["linear"]));
      expect(result).toEqual([{ key: "linear", status: "unavailable", checkedAt: null }]);
      expect(await db.select().from(toolConnections).where(eq(toolConnections.id, setup.connection.id))).toHaveLength(1);
    });
    it("prepares one original paused agent across concurrent clicks and lost replies without work, credentials, grants or installation", async () => {
      const fixture = await firstAgentPreparationFixture();
      const before = await db.execute(sql`select
        (select count(*) from agents where company_id=${f.home}::uuid) as agents,
        (select count(*) from heartbeat_runs where company_id=${f.home}::uuid) as runs,
        (select count(*) from agent_api_keys where company_id=${f.home}::uuid) as keys,
        (select count(*) from principal_permission_grants where company_id=${f.home}::uuid) as grants,
        (select count(*) from company_agent_package_installations where company_id=${f.home}::uuid) as installs,
        (select count(*) from agent_presence_runtime_bindings where company_id=${f.home}::uuid) as bindings`);
      const [first, replay] = await Promise.all([fixture.activation.command(f.actor, f.home, fixture.input), fixture.activation.command(f.actor, f.home, fixture.input)]);
      expect(first.version).toBe(fixture.onboarding.version + 1); expect(replay.version).toBe(first.version);
      expect(first.firstAgent).toMatchObject({ status: "prepared", canPrepare: false });
      expect(replay.firstAgent?.agentId).toBe(first.firstAgent?.agentId);
      const targetId = first.firstAgent!.agentId!;
      const [target] = await db.select().from(agents).where(eq(agents.id, targetId));
      expect(target).toMatchObject({ companyId: f.home, status: "paused", role: "general", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } } });
      const after = await db.execute(sql`select
        (select count(*) from agents where company_id=${f.home}::uuid) as agents,
        (select count(*) from heartbeat_runs where company_id=${f.home}::uuid) as runs,
        (select count(*) from agent_api_keys where company_id=${f.home}::uuid) as keys,
        (select count(*) from principal_permission_grants where company_id=${f.home}::uuid) as grants,
        (select count(*) from company_agent_package_installations where company_id=${f.home}::uuid) as installs,
        (select count(*) from agent_presence_runtime_bindings where company_id=${f.home}::uuid) as bindings`);
      expect(Number(after[0]!.agents)).toBe(Number(before[0]!.agents) + 1);
      for (const key of ["runs", "keys", "grants", "installs"] as const) expect(after[0]![key]).toBe(before[0]![key]);
      // The original V5 INSERT trigger creates a local unqualified provider
      // placeholder for every agent. Preserve that owner and prove it cannot run.
      expect(Number(after[0]!.bindings)).toBe(Number(before[0]!.bindings) + 1);
      const [binding] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, targetId));
      expect(binding).toMatchObject({ companyId: f.home, providerBindingId: targetId,
        qualifiedConfigurationHash: null, conformanceSnapshotHash: null, conformanceReport: null });
      const [provider] = await db.select().from(agentProviderBindings).where(eq(agentProviderBindings.id, targetId));
      expect(provider).toMatchObject({ status: "unqualified", capabilitySnapshot: null, conformance: {} });
      await expect(agentProviderBindingService(db).assertRuntime(f.home, targetId)).rejects.toMatchObject({ status: 409 });
      const [stored] = await db.select().from(companyOnboardingRuns).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      expect(stored!.activationState!.firstAgent!.agentId).toBe(targetId);
      expect(JSON.stringify(first)).not.toContain(stored!.activationState!.firstAgent!.configurationHash);
      expect(first.state).not.toHaveProperty("firstAgent");
      const receipts = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "agent.hire_created")));
      expect(receipts).toHaveLength(1); expect(JSON.stringify(receipts)).not.toContain("PRIVATE preparation goal");
      await expect(fixture.activation.command(f.actor, f.home, { ...fixture.input, requestId: randomUUID(), expectedVersion: first.version })).rejects.toMatchObject({ status: 409 });
      await expect(fixture.activation.command(f.actor, f.home, { operation: "change_setup", requestId: randomUUID(), expectedVersion: first.version })).rejects.toMatchObject({ status: 409 });
      expect((await fixture.activation.command(f.actor, f.home, fixture.input)).firstAgent?.agentId).toBe(targetId);
    }, 60000);
    it("keeps the original board-approval owner and treats later agent changes or withdrawal as review, not readiness", async () => {
      const fixture = await firstAgentPreparationFixture();
      await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, f.home));
      const first = await fixture.activation.command(f.actor, f.home, fixture.input), targetId = first.firstAgent!.agentId!;
      expect(first.firstAgent?.status).toBe("pending_approval");
      const requests = await db.select().from(approvals).where(eq(approvals.companyId, f.home));
      expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ type: "hire_agent", status: "pending", requestedByUserId: f.userId, payload: { agentId: targetId } });
      // The original approval owner can change the Native row. Its approval
      // is not a representative safe-test, runtime or first-value receipt.
      await approvalService(db).approve(requests[0]!.id, f.userId);
      expect((await fixture.activation.get(f.actor, f.home)).firstAgent?.status).toBe("needs_review");
      await db.update(agents).set({ title: "Changed native preparation" }).where(eq(agents.id, targetId));
      expect((await fixture.activation.get(f.actor, f.home)).firstAgent?.status).toBe("needs_review");
      await service.revoke(f.actor, fixture.published.id);
      expect((await fixture.activation.get(f.actor, f.home)).firstAgent?.status).toBe("needs_review");
      await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, targetId));
      expect((await fixture.activation.get(f.actor, f.home)).firstAgent).toEqual({ status: "unavailable", agentId: null, name: null, canPrepare: false });
      expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, targetId)))).toEqual([]);
      const [binding] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, targetId));
      expect(binding).toMatchObject({ qualifiedConfigurationHash: null, conformanceReport: null });
      await expect(agentProviderBindingService(db).assertRuntime(f.home, targetId)).rejects.toMatchObject({ status: 409 });
    }, 60000);
    it("rejects current permission loss, rollout withdrawal and revoked capability without creating a target", async () => {
      const fixture = await firstAgentPreparationFixture();
      const count = () => db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, f.home));
      const before = await count();
      await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      const removedGrants = await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
        eq(principalPermissionGrants.principalType, "user"), eq(principalPermissionGrants.principalId, f.userId), eq(principalPermissionGrants.permissionKey, "agents:create"))).returning();
      await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toMatchObject({ status: 403 });
      await db.update(companyMemberships).set({ membershipRole: "owner" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      expect(removedGrants).toHaveLength(1);
      await db.insert(principalPermissionGrants).values(removedGrants);
      await instanceSettingsService(db).updateExperimental({ activation_v9: false });
      await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toMatchObject({ status: 404 });
      await instanceSettingsService(db).updateExperimental({ activation_v9: true });
      await service.revoke(f.actor, fixture.published.id);
      await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toMatchObject({ status: 409 });
      expect(await count()).toEqual(before);
      const [stored] = await db.select().from(companyOnboardingRuns).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      expect(stored!.version).toBe(fixture.onboarding.version); expect(stored!.activationState).not.toHaveProperty("firstAgent");
    }, 60000);
    it.each(["legacy", "installed"] as const)("does not replace an existing %s preparation whose safe-task option is unavailable", async kind => {
      const fixture = await firstAgentPreparationFixture(kind === "legacy" ? { createdFirstAgentId: f.presence.id } : {});
      if (kind === "installed") await service.install(f.actor, f.home, installInput());
      const before = await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, f.home));
      const current = await fixture.activation.get(f.actor, f.home);
      expect(current.firstTask?.preparationOptions).toEqual([]);
      expect(current.firstAgent).toEqual({ status: "not_created", agentId: null, name: null, canPrepare: false });
      await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toMatchObject({ status: 409 });
      expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, f.home))).toEqual(before);
    }, 60000);
    it("rolls back the original agent, approval and audit when preparation fails before commit", async () => {
      const fixture = await firstAgentPreparationFixture();
      await db.update(companies).set({ requireBoardApprovalForNewAgents: true }).where(eq(companies.id, f.home));
      const counts = async () => (await db.execute(sql`select
        (select count(*) from agents where company_id=${f.home}::uuid) as agents,
        (select count(*) from approvals where company_id=${f.home}::uuid) as approvals,
        (select count(*) from activity_log where company_id=${f.home}::uuid) as audits`))[0];
      const before = await counts(), transact = db.transaction.bind(db);
      const fault = vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) => transact(async tx => {
        await callback(tx);
        throw new Error("Owned preparation fixture failure before Native commit");
      }, config));
      try { await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toThrow("Owned preparation fixture failure before Native commit"); }
      finally { fault.mockRestore(); }
      expect(await counts()).toEqual(before);
      const [stored] = await db.select().from(companyOnboardingRuns).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      expect(stored!.version).toBe(fixture.onboarding.version); expect(stored!.activationState).not.toHaveProperty("firstAgent");
      const retried = await fixture.activation.command(f.actor, f.home, fixture.input);
      expect(retried.firstAgent?.status).toBe("pending_approval");
      expect(Number((await counts())!.agents)).toBe(Number(before!.agents) + 1);
    }, 60000);
    async function firstValueFixture() {
      const { onboarding, installation, task, created, intent, orchestration } = await prepareFirstValueFixture();
      const plan = await orchestration.decide(f.actor, f.home, created.id, { expectedVersion: created.version, action: "start",
        rationale: "Start the explicitly bounded native fixture draft" });
      const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
        status: "running", contextSnapshot: { issueId: task!.id } }).returning();
      await agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id,
        responsibleUserId: f.userId, issueId: task!.id, query: intent });
      const [document] = await db.insert(documents).values({ companyId: f.home, title: "Research result",
        latestBody: "Native fixture output for an independent human review", createdByAgentId: f.presence.id }).returning();
      const [revision] = await db.insert(documentRevisions).values({ companyId: f.home, documentId: document!.id,
        revisionNumber: 1, body: document!.latestBody }).returning();
      await db.update(documents).set({ latestRevisionId: revision!.id }).where(eq(documents.id, document!.id));
      await db.insert(issueDocuments).values({ companyId: f.home, issueId: task!.id, documentId: document!.id, key: "result" });
      await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, run!.id));
      const worker = (await orchestration.get(f.actor, f.home, plan.id)).workers[0]!;
      const verifier = verificationService(db), packet = await verifier.packet(f.actor, f.home, plan.id, worker.id);
      const review = await verifier.review(f.actor, f.home, plan.id, { expectedPlanVersion: packet.planVersion, workerId: worker.id,
        expectedResultHash: packet.resultHash, result: "pass", objectiveSatisfied: true,
        rationale: "Independently inspected the saved native draft against the declared invariant",
        businessInvariants: [{ index: 0, satisfied: true, evidenceRefs: [packet.evidence[0]!.ref] }] });
      expect(review.result).toBe("pass");
      return { onboarding: onboarding!, installation, task: task!, run: run!, document: document!, revision: revision!, review: review! };
    }
    it("records only a current native first-result task/run/review and replays without executing or granting", async () => {
      const fixture = await firstValueFixture(), activation = activationService(db);
      const beforeRuns = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).length;
      const candidate = (await activation.get(f.actor, f.home)).firstValue!.candidates[0]!;
      expect(candidate).toMatchObject({ issueId: fixture.task.id, runId: fixture.run.id, verificationRunId: fixture.review.id,
        installationId: fixture.installation.id, artifacts: [{ documentId: fixture.document.id, documentKey: "result", revisionId: fixture.revision.id }] });
      const input = { operation: "record_verified_result" as const, expectedVersion: fixture.onboarding.version, requestId: randomUUID(),
        installationId: fixture.installation.id, verificationRunId: fixture.review.id };
      const [first, replay] = await Promise.all([activation.command(f.actor, f.home, input), activation.command(f.actor, f.home, input)]);
      expect(first.state.step).toBe("result");
      expect(first.firstValue?.status).toBe("verified");
      expect(first.state.firstValueAt).toBe(replay.state.firstValueAt);
      expect(first.version).toBe(replay.version);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).length).toBe(beforeRuns);
      const audits = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "activation.step_completed")));
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]!.details)).not.toContain("Private first-result");
      await expect(activation.command(f.actor, f.home, { ...input, verificationRunId: randomUUID() })).rejects.toMatchObject({ status: 409 });
      await expect(activation.command(f.actor, f.guest, input)).rejects.toMatchObject({ status: 404 });
      const completion = { operation: "complete_activation" as const, expectedVersion: first.version, requestId: randomUUID() };
      const completed = await activation.command(f.actor, f.home, completion);
      expect(completed.state.step).toBe("activated");
      expect(completed.status).toBe("completed");
      expect(completed.firstValue?.status).toBe("verified");
      const completionReplay = await activation.command(f.actor, f.home, completion);
      expect(completionReplay.version).toBe(completed.version);
      expect(completionReplay.state.firstValueAt).toBe(first.state.firstValueAt);
    }, 60000);
    it("measures original independently reviewed output without exporting content, inventing TTFO or writing analytics", async () => {
      const fixture = await firstValueFixture(), activation = activationService(db);
      await activation.command(f.actor, f.home, { operation: "record_verified_result", expectedVersion: fixture.onboarding.version,
        requestId: randomUUID(), installationId: fixture.installation.id, verificationRunId: fixture.review.id });
      const before = await db.select().from(activityLog).where(eq(activityLog.companyId, f.home));
      const view = await readExperienceMeasures(db, f.actor, f.home);
      expect(view).toMatchObject({ companyId: f.home, status: "verified", setupWindow: "complete", usableBaseline: "unavailable" });
      expect(view.creationToVerificationBucket).not.toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.companyId, f.home))).toEqual(before);
      const payload = JSON.stringify(view);
      for (const privateValue of [f.userId, fixture.task.id, fixture.run.id, fixture.document.id, fixture.review.id, fixture.document.latestBody!, fixture.task.title])
        expect(payload).not.toContain(privateValue);
      const app = express();
      app.use((req, _res, next) => { req.actor = { ...f.actor, companyIds: [f.home] }; next(); });
      app.use("/api", experienceMeasuresRoutes(db)); app.use(errorHandler);
      const response = await request(app).get(`/api/companies/${f.home}/experience/analytics`).query({ expectedUserId: f.userId });
      expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body.status).toBe("verified");
      expect((await request(app).get(`/api/companies/${f.home}/experience/analytics`).query({ expectedUserId: "another-account" })).status).toBe(409);
      expect((await request(app).get(`/api/companies/${f.guest}/experience/analytics`).query({ expectedUserId: f.userId })).status).toBe(403);
      // Original metadata fixtures qualify bounded inspection, not real customer effort.
      await db.insert(activityLog).values(Array.from({ length: 129 }, (_, index) => ({ companyId: f.home,
        actorType: "user", actorId: f.userId, action: "activation.step_completed", entityType: "onboarding", entityId: fixture.onboarding.id,
        createdAt: fixture.onboarding.createdAt, details: { from: "intent", to: "company", version: index + 2 } })));
      expect(await readExperienceMeasures(db, f.actor, f.home)).toMatchObject({ setupWindow: "bounded", recordedSetupChangesBucket: null });
    }, 60000);
    it("withdraws reviewed output links when the original saved document changes", async () => {
      const fixture = await firstValueFixture(), activation = activationService(db);
      const recorded = await activation.command(f.actor, f.home, {
        operation: "record_verified_result", expectedVersion: fixture.onboarding.version,
        requestId: randomUUID(), installationId: fixture.installation.id, verificationRunId: fixture.review.id,
      });
      expect(recorded.firstValue?.result?.artifacts[0]?.documentKey).toBe("result");
      const [changedRevision] = await db.insert(documentRevisions).values({
        companyId: f.home, documentId: fixture.document.id, revisionNumber: 2,
        body: "Changed saved output requires an independent new review",
      }).returning();
      await db.update(documents).set({ latestBody: changedRevision!.body,
        latestRevisionId: changedRevision!.id, latestRevisionNumber: 2, updatedAt: new Date(),
      }).where(eq(documents.id, fixture.document.id));
      const current = await activation.get(f.actor, f.home);
      expect(current.firstValue).toEqual({ status: "withdrawn", result: null, candidates: [], hasMore: false });
      expect(current.state.firstValueAt).toBe(recorded.state.firstValueAt);
      expect(await readExperienceMeasures(db, f.actor, f.home)).toMatchObject({ status: "withdrawn", creationToVerificationBucket: null,
        recordedSetupChangesBucket: null, setupWindow: "not_applicable", usableBaseline: "unavailable" });
      await expect(activation.command(f.actor, f.home, { operation: "complete_activation",
        expectedVersion: current.version, requestId: randomUUID(),
      })).rejects.toMatchObject({ status: 409 });
    }, 60000);
    it("withdraws first-result presentation on package revocation and cannot renew its original receipt", async () => {
      const fixture = await firstValueFixture(), activation = activationService(db);
      const input = { operation: "record_verified_result" as const, expectedVersion: fixture.onboarding.version, requestId: randomUUID(),
        installationId: fixture.installation.id, verificationRunId: fixture.review.id };
      const recorded = await activation.command(f.actor, f.home, input);
      await service.revoke(f.actor, versionId);
      const current = await activation.get(f.actor, f.home);
      expect(current.firstValue).toEqual({ status: "withdrawn", result: null, candidates: [], hasMore: false });
      expect(current.blockers).toContain("safe_execution_unqualified");
      await expect(activation.command(f.actor, f.home, { operation: "complete_activation", expectedVersion: current.version,
        requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
      const replay = await activation.command(f.actor, f.home, input);
      expect(replay.state.firstValueAt).toBe(recorded.state.firstValueAt);
      expect(replay.firstValue?.status).toBe("withdrawn");
      expect((await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "activation.step_completed"))))).toHaveLength(1);
    }, 60000);
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
    it("atomically prepares one original canonical Task, purpose deployment and bounded plan, then replays without execution", async () => {
      try {
        const fixture = await noChargePreparationFixture();
        const beforeTasks = await db.select().from(issues).where(eq(issues.companyId, f.home));
        const beforePlans = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.companyId, f.home));
        const grants = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home));
        const [prepared, replay] = await Promise.all([fixture.activation.command(f.actor, f.home, fixture.input), fixture.activation.command(f.actor, f.home, fixture.input)]);
        expect(prepared.version).toBe(fixture.onboarding.version + 1);expect(replay.version).toBe(prepared.version);
        expect(prepared.state.step).toBe("review");expect(prepared.state.firstTask).toBeUndefined();expect(prepared.state.preparedFirstTask).toBeDefined();
        const reference = prepared.state.preparedFirstTask!;
        expect(prepared.firstTask!.preparationOptions).toEqual([]);
        expect(prepared.firstTask!.candidates).toHaveLength(1);expect(prepared.firstTask!.candidates[0]!.planId).toBe(reference.planId);
        const task = (await db.select().from(issues).where(eq(issues.id, reference.issueId)))[0]!;
        expect(task).toMatchObject({ createdByUserId: f.userId, responsibleUserId: f.userId, assigneeAgentId: f.presence.id,
          originKind: "v9_activation", originId: fixture.onboarding.id, status: "todo", executionRunId: null, checkoutRunId: null });
        const plan = (await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, reference.planId)))[0]!;
        expect(plan).toMatchObject({ status: "draft", mode: "single_worker", riskClass: "C1", actionClass: "internal_draft", executionPrincipal: null, startedAt: null });
        expect(plan.budgets).toEqual({ maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 0, maxRetries: 0,
          maxWallClockSeconds: 300, maxModelCostMinor: 0, maxToolActions: 2 });
        const detail = await fixture.orchestration.get(f.actor, f.home, plan.id);
        expect(detail.completionContract!.objective).toBe(fixture.intent);expect(detail.completionContract!.requiredOutputs).toHaveLength(1);
        expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toHaveLength(beforeTasks.length + 1);
        expect(await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.companyId, f.home))).toHaveLength(beforePlans.length + 1);
        expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toEqual([]);
        expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, f.home))).toEqual(grants);
        expect(fixture.transport).not.toHaveBeenCalled();
        await fixture.activation.get(f.actor, f.home);expect(fixture.transport).not.toHaveBeenCalled();
        await expect(fixture.activation.command(f.actor, f.home, { ...fixture.input, requestId: randomUUID(), expectedVersion: prepared.version })).rejects.toMatchObject({ status: 409 });
        const changed = await fixture.activation.command(f.actor, f.home, { operation: "change_setup", requestId: randomUUID(), expectedVersion: prepared.version });
        expect(changed.state.step).toBe("intent");expect(changed.state.preparedFirstTask).toBeUndefined();
        expect((await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, plan.id)))[0]!.status).toBe("cancelled");
        expect(fixture.transport).not.toHaveBeenCalled();
      } finally { registerNativeDraftGateway(db, undefined); }
    });
    it("refuses a stale reviewed purpose before creating a first Task and preserves original authorities", async () => {
      try {
        const fixture = await noChargePreparationFixture();
        const before = await db.select().from(issues).where(eq(issues.companyId, f.home));
        await expect(fixture.activation.command(f.actor, f.home, { ...fixture.input, expectedPurposeVersion: fixture.input.expectedPurposeVersion + 1 })).rejects.toMatchObject({ status: 409 });
        expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toEqual(before);
        expect((await fixture.activation.get(f.actor, f.home)).version).toBe(fixture.onboarding.version);
        expect(fixture.transport).not.toHaveBeenCalled();
        registerNativeDraftGateway(db, undefined);
        await expect(fixture.activation.command(f.actor, f.home, fixture.input)).rejects.toMatchObject({ status: 409 });
        expect(await db.select().from(issues).where(eq(issues.companyId, f.home))).toEqual(before);
      } finally { registerNativeDraftGateway(db, undefined); }
    });
    it("does not start an unqualified default first task or change the original owners", async () => {
      const fixture = await prepareFirstValueFixture({ maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 0,
        maxRetries: 0, maxToolActions: 2, maxModelCostMinor: 0 });
      const input = { operation: "start_first_task", requestId: randomUUID(), expectedVersion: fixture.onboarding.version,
        installationId: fixture.installation.id, planId: fixture.created.id, expectedPlanVersion: fixture.created.version,
        expectedInstallationHash: fixture.installation.activationHash!, expectedMaximumModelCostMinor: 0 };
      const before = await db.execute(sql`select (select count(*) from heartbeat_runs where company_id=${f.home}::uuid) as runs,
        (select count(*) from orchestration_worker_attempts where company_id=${f.home}::uuid) as attempts,
        (select count(*) from principal_permission_grants where company_id=${f.home}::uuid) as grants`);
      await expect(activationService(db).command(f.actor, f.home, input)).rejects.toMatchObject({ status: 409 });
      const [stored] = await db.select().from(companyOnboardingRuns).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      expect(stored!.version).toBe(fixture.onboarding.version);expect(stored!.activationState!.firstTask).toBeUndefined();
      expect((await orchestrationService(db).get(f.actor, f.home, fixture.created.id)).status).toBe("draft");
      expect(await db.execute(sql`select (select count(*) from heartbeat_runs where company_id=${f.home}::uuid) as runs,
        (select count(*) from orchestration_worker_attempts where company_id=${f.home}::uuid) as attempts,
        (select count(*) from principal_permission_grants where company_id=${f.home}::uuid) as grants`)).toEqual(before);
    });
    it("cancels a recorded original first plan after rollout withdrawal and replays its receipt without another decision", async () => {
      // Historical original-plan reference fixture, not qualification of the
      // new default's no-charge controller or real provider delivery.
      const fixture = await prepareFirstValueFixture();
      const plan = await fixture.orchestration.decide(f.actor, f.home, fixture.created.id, { expectedVersion: fixture.created.version,
        action: "start", rationale: "Explicit original historical plan fixture before rollout withdrawal" });
      await db.update(companyOnboardingRuns).set({ activationState: { ...fixture.onboarding.activationState!, step: "running",
        firstTask: { installationId: fixture.installation.id, installationHash: fixture.installation.activationHash!, planId: plan.id, issueId: fixture.task.id } },
        currentStage: "v9_running", version: fixture.onboarding.version + 1 }).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      await instanceSettingsService(db).updateExperimental({ activation_v9: false, orchestration_v7: false, supervision_v7: false, verifier_v7: false });
      const input = { operation: "stop_first_task", requestId: randomUUID(), expectedVersion: fixture.onboarding.version + 1, expectedPlanVersion: plan.version };
      const activation = activationService(db);
      const [stopped, replay] = await Promise.all([activation.command(f.actor, f.home, input), activation.command(f.actor, f.home, input)]);
      expect(stopped.version).toBe(fixture.onboarding.version + 2);expect(replay.version).toBe(stopped.version);
      expect(stopped.firstTask?.current).toMatchObject({ planId: plan.id, status: "cancelled", planVersion: plan.version + 1 });
      const audits = await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "orchestration.cancel_requested")));
      expect(audits).toHaveLength(1);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.home))).toHaveLength(0);
    });
    it.each(["firstTask", "preparedFirstTask"] as const)("requires the exact %s plan when recording its independently reviewed output", async (referenceKind) => {
      const fixture = await firstValueFixture();
      await db.update(companyOnboardingRuns).set({ activationState: { ...fixture.onboarding.activationState!, step: referenceKind === "firstTask" ? "running" : "review",
        [referenceKind]: { installationId: fixture.installation.id, installationHash: fixture.installation.activationHash!, planId: fixture.review.planId, issueId: fixture.task.id } },
        currentStage: referenceKind === "firstTask" ? "v9_running" : "v9_review", version: fixture.onboarding.version + 1 }).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      const activation = activationService(db), current = await activation.get(f.actor, f.home);
      if (!current.firstValue?.candidates.length) {
        // Inspect the same original refusal only when projection is empty.
        // Preserve the assertion and every authority/clock budget below.
        await db.transaction(async transaction => {
          const tx = transaction as unknown as Db;
          await lockActivationSnapshot(tx, f.home);
          const original = await readActivationOwner(tx, f.actor, f.home, true);
          await readActivationFirstValue(tx, f.actor, f.home, { createdAt: original.run.createdAt,
            createdByUserId: original.userId, activationState: original.state }, fixture.installation.id, fixture.review.id);
        });
      }
      expect(current.firstValue?.candidates).toHaveLength(1);
      const recorded = await activation.command(f.actor, f.home, { operation: "record_verified_result", requestId: randomUUID(),
        expectedVersion: current.version, installationId: fixture.installation.id, verificationRunId: fixture.review.id });
      expect(recorded.firstValue?.status).toBe("verified");expect(recorded.state.step).toBe("result");
      await db.update(companyOnboardingRuns).set({ activationState: { ...fixture.onboarding.activationState!, step: referenceKind === "firstTask" ? "running" : "review",
        [referenceKind]: { installationId: fixture.installation.id, installationHash: fixture.installation.activationHash!, planId: randomUUID(), issueId: fixture.task.id } },
        version: recorded.version + 1, currentStage: referenceKind === "firstTask" ? "v9_running" : "v9_review" }).where(eq(companyOnboardingRuns.id, fixture.onboarding.id));
      await expect(activation.command(f.actor, f.home, { operation: "record_verified_result", requestId: randomUUID(), expectedVersion: recorded.version + 1,
        installationId: fixture.installation.id, verificationRunId: fixture.review.id })).rejects.toMatchObject({ status: 409 });
    });
  },
);
