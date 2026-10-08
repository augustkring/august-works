import { disableV8Rollout } from "./helpers/v8-rollout.js";
import { nativeManagementSdkFixture } from "./helpers/native-management-sdk-fixture.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { companies, projects, issues, analyticalLineageManifests, analyticalLineageEdges, businessScenarioVersions, businessScenarioSourcePins, businessScenarioPublications, businessScenarioRuns, businessScenarios, createDb } from "@paperclipai/db";
import { businessMetricDefinitionSchema } from "@paperclipai/shared";
import { businessScenarioService } from "../services/business-scenarios/service.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { lockAnalyticalCompany } from "../services/analytical-privacy.js";
import { lockMemoryPrivacy } from "../services/memory/memory-privacy.js";
import { eraseAnalyticalSourcesUnderMemory } from "../services/analytical-source-erasure.js";
import { eraseExpiredAnalyticalLineage } from "../services/analytical-retention.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { metricDefinition, analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { scenarioDefinition } from "./helpers/business-scenario-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport(), suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, scenario_planning_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true };
suite("Governed native conditional scenarios on migrated PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, projectId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v8-scenario-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags); companyId = randomUUID(); otherId = randomUUID(); projectId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Native scenario test", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign tenant", issuePrefix: randomUUID() }]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Canonical source project" });
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "scenario"];
    policy.analyticalPurpose!.permittedSensitivity = ["internal", "confidential"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  const service = () => businessScenarioService(db);
  async function measurement(sensitivity: "internal" | "confidential" = "internal") {
    const [issue] = await db.insert(issues).values({ companyId, projectId, title: "Private canonical source prose", status: "done", createdAt: new Date("2026-01-01T12:00:00Z") }).returning();
    const definition = businessMetricDefinitionSchema.parse({ ...metricDefinition(policyId), sensitivity, valueType: "count", unit: "objects", calculation: { kind: "native_count", population: { entity: "issue", statuses: ["done"], projectId } } });
    const metric = await businessMetricService(db).create(companyId, actor, { key: `metric_${randomUUID().replaceAll("-", "")}`, definition });
    await businessMetricService(db).publish(companyId, actor, metric.metric.id, { expectedRevision: 1, versionId: metric.version.id });
    const query = { metricId: metric.metric.id, versionId: metric.version.id, from: "2026-01-01T00:00:00Z", until: "2026-01-02T00:00:00Z", dimensions: [], maxRows: 5000 };
    const observation = await businessMetricService(db).query(companyId, actor, query);
    return { issue, metric, observation, query };
  }
  async function draft(humanOnly = false) {
    const source = humanOnly ? null : await measurement();
    const definition = scenarioDefinition(policyId, source ? { kind: "metric_observation", key: "objects", metricId: source.metric.metric.id, metricVersionId: source.metric.version.id, observationId: source.observation.id, unit: { issue: 1 } } : null);
    const created = await service().create(companyId, actor, { key: `scenario_${randomUUID().replaceAll("-", "")}`, definition });
    return { ...created, source, definition };
  }
  async function published(humanOnly = false) {
    const d = await draft(humanOnly), scenario = await service().publish(companyId, actor, d.scenario.id, { expectedRevision: 1, versionId: d.version.id, rationale: "Human publication of this exact conditional model and native source pins" });
    const run = await service().run(companyId, actor, scenario.id, { expectedRevision: 2, versionId: d.version.id, seed: null }); return { ...d, scenario, run };
  }
  it("captures exact authorized sources and requires human publication before bounded arithmetic", async () => {
    const d = await draft(); expect(d.version.inputs[0]).toMatchObject({ value: 1, unit: { issue: 1 }, sourceId: d.source!.observation.id });
    expect(JSON.stringify(d.version)).not.toContain(d.source!.issue.title);
    await expect(service().run(companyId, actor, d.scenario.id, { expectedRevision: 1, versionId: d.version.id, seed: null })).rejects.toMatchObject({ status: 409 });
    const scenario = await service().publish(companyId, actor, d.scenario.id, { expectedRevision: 1, versionId: d.version.id, rationale: "Human publication of the exact conditional assumptions" });
    const run = await service().run(companyId, actor, scenario.id, { expectedRevision: scenario.revision, versionId: d.version.id, seed: null });
    expect(run).toMatchObject({ currentQualification: "current", result: { status: "calculated", uncertainty: { coverageLevel: null } } });
    expect(run.result.cases.map(item => item.outputs[0].nominal)).toEqual([2, 3]);
    expect((await service().listRuns(companyId, actor, scenario.id)).items.map(item => item.id)).toEqual([run.id]);
    expect((await service().list(companyId, actor)).items.map(item => item.scenario.id)).toContain(scenario.id);
    expect(await service().result(companyId, actor, scenario.id, run.id)).toMatchObject({ contentHash: run.contentHash });
  });
  it("compares exact actual scenario outputs through the SDK and erases its dependent answer without creating a commitment", async () => {
    const d = await published(), sdk = await nativeManagementSdkFixture(db, companyId);
    const sources = d.run.result.cases.map(item => ({ type: "scenario_run", id: d.run.id, scenarioId: d.scenario.id, versionId: d.version.id, caseKey: item.key, outputKey: item.outputs[0]!.key }));
    const before = await db.select().from(issues).where(eq(issues.id, d.source!.issue.id));
    const result = await sdk.read("compare_scenarios", { sources });
    expect(result).toMatchObject({ tool: "compare_scenarios", result: { grade: "conditional_scenario", sources: [{ facts: { nominal: 2 } }, { facts: { nominal: 3 } }] }, executionAuthority: "read_only_or_advisory" });
    expect((await sdk.roots())[0]!.authorityPins).toEqual(sources.map(source => ({ kind: "analytical_evidence", source })));
    await sdk.retainCopy(result); expect(await sdk.retained()).toBe(true);
    await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, d.source!.issue.id));
    await expect(sdk.read("compare_scenarios", { sources })).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ hiddenAt: null }).where(eq(issues.id, d.source!.issue.id));
    await disableV8Rollout(db);
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId); await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [d.source!.issue.id]); });
    expect(await sdk.retained()).toBe(false);
    expect(await db.select().from(issues).where(eq(issues.id, d.source!.issue.id))).toEqual(before);
  });
  it("retains reproducible seeded Monte Carlo and rejects seed policy mismatches", async () => {
    const d = await draft(true); d.definition.calculationType = "bounded_monte_carlo";
    d.definition.assumptions[0].distribution = { kind: "uniform", minimum: 1, maximum: 3, rationale: "Synthetic conditional distribution, without calibration claims" };
    d.definition.uncertaintyPolicy = { kind: "bounded_monte_carlo", samples: 1000, independenceRationale: "One uncertain assumption with no inferred correlations", stabilityAbsoluteTolerance: { capacity: 0.5 } };
    const revised = await service().revise(companyId, actor, d.scenario.id, { expectedRevision: 1, definition: d.definition });
    const scenario = await service().publish(companyId, actor, d.scenario.id, { expectedRevision: 2, versionId: revised.version.id, rationale: "Human publication of the exact seeded uncertainty policy" });
    await expect(service().run(companyId, actor, scenario.id, { expectedRevision: 3, versionId: revised.version.id, seed: null })).rejects.toMatchObject({ status: 409 });
    const first = await service().run(companyId, actor, scenario.id, { expectedRevision: 3, versionId: revised.version.id, seed: 0 });
    const repeat = await service().run(companyId, actor, scenario.id, { expectedRevision: 3, versionId: revised.version.id, seed: 0 });
    expect(first.result).toEqual(repeat.result); expect(first.contentHash).toBe(repeat.contentHash); expect(first.result.status).toBe("calculated");
  });
  it("preserves historical arithmetic but denies reuse after a native correction", async () => {
    const d = await published();
    await db.insert(issues).values({ companyId, projectId, title: "Later corrected source", status: "done", createdAt: new Date("2026-01-01T13:00:00Z") });
    // Equivalent timestamp spellings still denote a correction to the same
    // period; source admission must compare instants rather than JSON text.
    await businessMetricService(db).query(companyId, actor, { ...d.source!.query, from: "2026-01-01T00:00:00.000Z", until: "2026-01-02T00:00:00.000Z" });
    const historical = await service().result(companyId, actor, d.scenario.id, d.run.id);
    expect(historical.currentQualification).toBe("needs_revalidation"); expect(historical.contentHash).toBe(d.run.contentHash); expect(historical.result.cases[0].outputs[0].nominal).toBe(2);
    await expect(service().run(companyId, actor, d.scenario.id, { expectedRevision: 2, versionId: d.version.id, seed: null })).rejects.toMatchObject({ status: 409 });
  });
  it("does not permit a relabeled native unit, foreign observation, sensitivity downgrade or non-company owner", async () => {
    const d = await draft();
    const attempts = [
      { ...d.definition, ownerUserId: "outside-company" },
      { ...d.definition, assumptions: [{ ...d.definition.assumptions[0], ownerUserId: "outside-company" }] },
      { ...d.definition, inputs: [{ ...d.definition.inputs[0], unit: { project: 1 } }], outputs: [{ ...d.definition.outputs[0], unit: { project: 1 } }] },
    ];
    for (const definition of attempts) await expect(service().create(companyId, actor, { key: `deny_${randomUUID().replaceAll("-", "")}`, definition })).rejects.toMatchObject({ status: 409 });
    const foreignPolicy = analyticalPurpose(); foreignPolicy.analyticalPurpose!.capabilities = ["metrics", "scenario"];
    const foreignPurposeId = (await aiGovernanceService(db).obligation(actor, otherId, foreignPolicy)).id;
    await expect(service().create(otherId, actor, { key: "foreign_source", definition: { ...d.definition, governanceObligationRefs: [foreignPurposeId] } })).rejects.toMatchObject({ status: 409 });
    const secret = await measurement("confidential");
    const downgrade = scenarioDefinition(policyId, { kind: "metric_observation", key: "secret", metricId: secret.metric.metric.id, metricVersionId: secret.metric.version.id, observationId: secret.observation.id, unit: { issue: 1 } });
    await expect(service().create(companyId, actor, { key: "secret_downgrade", definition: downgrade })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects bare publication/revision changes, immutable definition/results and partial source pin deletion", async () => {
    const d = await published();
    await expect(db.update(businessScenarioVersions).set({ inputs: [] }).where(eq(businessScenarioVersions.id, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessScenarioRuns).set({ contentHash: "b".repeat(64) }).where(eq(businessScenarioRuns.id, d.run.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessScenarioSourcePins).where(eq(businessScenarioSourcePins.versionId, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.delete(businessScenarioPublications).where(eq(businessScenarioPublications.versionId, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessScenarios).set({ revision: 3, updatedAt: new Date() }).where(eq(businessScenarios.id, d.scenario.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const proposal = await draft(true);
    await expect(db.update(businessScenarios).set({ status: "published", revision: 2, publishedVersionId: proposal.version.id, updatedAt: new Date() }).where(eq(businessScenarios.id, proposal.scenario.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("enforces CAS under simultaneous human revisions without changing the published version", async () => {
    const d = await published();
    const results = await Promise.allSettled([service().revise(companyId, actor, d.scenario.id, { expectedRevision: 2, definition: d.definition }), service().revise(companyId, actor, d.scenario.id, { expectedRevision: 2, definition: d.definition })]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await service().detail(companyId, actor, d.scenario.id)).scenario.publishedVersionId).toBe(d.version.id);
  });
  it("rejects committing an otherwise valid proposal whose source-owner FK pins were omitted", async () => {
    const d = await draft(), rootId = randomUUID(), versionId = randomUUID(), manifestId = randomUUID(), now = new Date();
    const [original] = await db.select().from(businessScenarioVersions).where(eq(businessScenarioVersions.id, d.version.id));
    const [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, original.lineageManifestId));
    const edges = await db.select().from(analyticalLineageEdges).where(eq(analyticalLineageEdges.manifestId, manifest.id));
    await expect(db.transaction(async raw => {
      const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
      await tx.insert(businessScenarios).values({ id: rootId, companyId, key: "incomplete_source_replay", createdBy: "local-board", createdAt: now, updatedAt: now });
      await tx.insert(analyticalLineageManifests).values({ ...manifest, id: manifestId, analysisRef: versionId, createdAt: now });
      await tx.insert(analyticalLineageEdges).values(edges.map(edge => ({ ...edge, manifestId })));
      await tx.insert(businessScenarioVersions).values({ ...original, id: versionId, scenarioId: rootId, lineageManifestId: manifestId, createdAt: now });
      // A restored/native transaction must not retain prose while omitting the
      // exact source-owner cascade dependencies, even with valid captured facts.
    })).rejects.toMatchObject({ code: "23514", message: "scenario_complete_source_pins_required" });
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, rootId))).toHaveLength(0);
  });
  it("requires independent scenario purpose and denies disabled rollout while allowing authorized retirement", async () => {
    const d = await published(); const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics"];
    const noScenario = await aiGovernanceService(db).obligation(actor, companyId, { ...policy, citation: "Independent ordinary metric policy" });
    await expect(service().create(companyId, actor, { key: "ordinary_metric_only", definition: { ...d.definition, governanceObligationRefs: [noScenario.id] } })).rejects.toMatchObject({ status: 409 });
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ scenario_planning_v8: false });
    await expect(service().result(companyId, actor, d.scenario.id, d.run.id)).rejects.toMatchObject({ status: 404 });
    expect(await service().retire(companyId, actor, d.scenario.id, { expectedRevision: 2, rationale: "Authorized human retirement after rollback of the rollout flag" })).toMatchObject({ status: "retired", revision: 3 });
  });
  it("hides cached historical facts and lists after a source moves beyond current company authority", async () => {
    const d = await published(); const [foreign] = await db.insert(projects).values({ companyId: otherId, name: "Foreign private project" }).returning();
    await db.update(issues).set({ projectId: foreign.id }).where(eq(issues.id, d.source!.issue.id));
    await expect(service().result(companyId, actor, d.scenario.id, d.run.id)).rejects.toMatchObject({ status: 403 });
    expect((await service().list(companyId, actor)).items).toEqual([]); expect((await service().listRuns(companyId, actor, d.scenario.id)).items).toEqual([]);
  });
  it("erases the full scenario through source lineage while paused/disabled and keeps canonical issues", async () => {
    const d = await published(); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ scenario_planning_v8: false, business_metrics_v8: false });
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId); await eraseAnalyticalSourcesUnderMemory(tx, companyId, "issue", [d.source!.issue.id]); });
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, d.scenario.id))).toHaveLength(0);
    expect(await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.id, d.run.id))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.id, d.source!.issue.id))).toHaveLength(1);
  });
  it("erases proposal prose when its exact metric source manifest is deleted, including with rollout off", async () => {
    const d = await published(); await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ scenario_planning_v8: false });
    await db.delete(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, d.source!.observation.lineageManifestId));
    expect(await db.select().from(businessScenarioVersions).where(eq(businessScenarioVersions.id, d.version.id))).toHaveLength(0);
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, d.scenario.id))).toHaveLength(0);
  });
  it("expires inherited snapshots and purges company content without changing foreign tenant sources", async () => {
    const d = await published(), retainedHuman = await published(true); const [foreign] = await db.insert(projects).values({ companyId: otherId, name: "Foreign source must survive" }).returning();
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ scenario_planning_v8: false }); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await eraseExpiredAnalyticalLineage(db, new Date(Date.now() + 2 * 86400000));
    expect(await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.id, d.run.id))).toHaveLength(0);
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, retainedHuman.scenario.id))).toHaveLength(1);
    await purgeCompanyContent(db, companyId);
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(projects).where(and(eq(projects.id, foreign.id), eq(projects.companyId, otherId)))).toHaveLength(1);
  });
});
