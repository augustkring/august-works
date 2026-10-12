import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { agents, billingAccounts, billingAccountCompanies, billingSubscriptions, companyMemberships,
  principalPermissionGrants, type Db } from "@paperclipai/db";
import type { PackageRelease } from "@paperclipai/shared";
import { agentAuthoringService } from "../../services/agents/authoring-drafts.js";
import { agentPackageService } from "../../services/agent-packages/package-service.js";
import { rolePackService } from "../../services/role-packs.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { foundationService } from "../../services/foundation/foundation-service.js";
import { aiGovernanceService } from "../../services/ai-governance/governance-service.js";
import { purpose, oversight, reviews } from "./governance-fixture.js";
import type { seedV5Presences } from "./v5-fixtures.js";

/** Explicit software qualification metadata, billing and reviewed deployment
 * facts. Real package, inactive Agent, Foundation and governance owners follow;
 * this fixture is not provider, business-outcome, billing-provider or GA proof. */
export async function prepareHirePublicationFixture(db: Db, f: Awaited<ReturnType<typeof seedV5Presences>>) {
  await instanceSettingsService(db).updateExperimental({ free_core_commercial_v7: true,
    billing_entitlements_v6: true, billing_usage_v6: true, ai_use_cases_v7: true });
  const [account] = await db.insert(billingAccounts).values({ displayName: "Hire publication software fixture", payerUserId: f.userId }).returning();
  await db.insert(billingAccountCompanies).values({ companyId: f.home, billingAccountId: account!.id });
  await db.insert(billingSubscriptions).values({ billingAccountId: account!.id, providerSubscriptionId: `fixture-${randomUUID()}`,
    status: "active", productKeys: ["agent_package_research"], currentPeriodEnd: new Date(Date.now() + 3600000),
    providerUpdatedAt: new Date(), sourceHash: "native-hire-software-fixture" });
  const roles = rolePackService(db), role = await roles.create(f.actor, f.home, { key: "welcome-package", name: "Welcome procedures", description: "Software package component" });
  const version = await roles.createVersion(f.actor, f.home, role.id, { summary: "Policy-only package component",
    items: [{ type: "required_policy", ref: "approval_before_side_effects", operation: "add", versionId: null,
      loadPoint: "always", triggerTerms: [], excludeTerms: [] }] });
  await roles.publish(f.actor, f.home, role.id, version.id, null);
  const [hash] = await db.execute(sql`select aw_v7_package_component_hash(${f.home}::uuid,'role_pack',${role.id}::uuid,${version.id}::uuid) as hash`);
  const evidence = { uri: "https://qualification.test.invalid/qualification/hire-software-fixture", sha256: "b".repeat(64) };
  const release: PackageRelease = { packageKey: `welcome-${randomUUID()}`, name: "Welcome specialist", description: "Internal welcome drafts",
    category: "internal", version: "1.0.0", releaseNotes: "Software protocol fixture",
    manifest: { purpose: "Produce a short internal welcome draft", prohibitedUses: ["Do not contact anyone"], role: "general",
      audience: "customer", maximumRisk: "C1", actionClasses: ["internal_draft"], requiredKnowledge: [], requiredConnections: [],
      optionalConnections: [], memoryPolicy: "source_governed", humanApproval: "before_material_action", supervision: "bounded_native",
      verification: "independent_native", sandboxAssurance: "byo_customer_responsibility", runtimeProviders: ["paperclip_native"],
      onboardingQuestions: [], knownLimitations: ["Software fixture, not customer outcome or physical sandbox qualification"],
      sourceRevision: "a".repeat(40), license: "MIT", commercialProductKey: "agent_package_research" },
    components: [{ key: "welcome-role", type: "role_pack", sourceVersion: "1", contentHash: String(hash!.hash), source: evidence, required: true }],
    releaseEvidence: { sbom: evidence, provenance: evidence, signature: null, scan: evidence, evaluations: evidence,
      protectedHoldout: evidence, customerDemand: evidence, sandboxQualification: null, releaseAuthorization: evidence,
      unresolvedCritical: [], evaluatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() } };
  const packages = agentPackageService(db, { operatorUserIds: [f.userId], sourceSha: "a".repeat(40), protectedEvidenceOrigin: "https://qualification.test.invalid" });
  const published = await packages.publish(f.actor, release), drafts = agentAuthoringService(db);
  const initial = await drafts.create(f.actor, f.home, { requestId: randomUUID(), packageVersionId: published.id });
  const reviewed = await drafts.preparationReview(f.actor, f.home, initial.id);
  const draft = await drafts.prepare(f.actor, f.home, initial.id, { requestId: randomUUID(), expectedVersion: initial.version,
    expectedReviewHash: reviewed.reviewHash, confirmInactiveAgentPreparation: true });
  const [agent] = await db.select().from(agents).where(eq(agents.id, draft.preparation!.agentId));
  const principal = { principal: { type: "user" as const, userId: f.userId } }, foundation = foundationService(db);
  const companyProfile = await foundation.createDraft(f.home, { foundationKey: "company_profile", category: "company",
    documentType: "profile", body: "This software test company prepares internal welcome drafts", authorityLevel: "canonical", sensitivity: "internal" }, principal);
  await foundation.submitForReview(f.home, companyProfile.id, companyProfile.latestRevisionId!, principal);
  await foundation.approve(f.home, companyProfile.id, companyProfile.latestRevisionId!, principal);
  await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: agent!.id, status: "active" }).onConflictDoNothing();
  await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map(permissionKey => ({
    companyId: f.home, principalType: "agent", principalId: agent!.id, permissionKey }))).onConflictDoNothing();
  const governance = aiGovernanceService(db), profile = await governance.oversight(f.actor, f.home, oversight);
  let useCase = await governance.create(f.actor, f.home, { key: `welcome-${randomUUID()}`,
    purpose: { ...purpose(), intendedPurpose: release.manifest.purpose, riskClass: "C1", oversightProfileId: profile.id } });
  for (const assessment of reviews()) {
    await governance.assess(f.actor, f.home, useCase.id, { ...assessment, expectedVersion: useCase.version });
    useCase = { ...useCase, version: useCase.version + 1 };
  }
  useCase = await governance.decide(f.actor, f.home, useCase.id, "approve", { expectedVersion: useCase.version,
    rationale: "A human reviewed this exact software-fixture internal welcome purpose" });
  const installation = (await packages.list(f.actor, f.home)).find(row => row.agentId === agent!.id)!;
  const updated = await packages.update(f.actor, f.home, installation.id, { agentId: agent!.id, versionId: published.id,
    components: reviewed.packageInstallation!.components.map(({ key, resourceId, versionId }) => ({ key, resourceId, versionId })),
    aiUseCaseId: useCase.id, expectedVersion: installation.version, approveMaterialChange: true, reason: "Bind the exact human-reviewed software-fixture purpose" });
  return { draft, agent: agent!, release, published, installation: updated, packages };
}
