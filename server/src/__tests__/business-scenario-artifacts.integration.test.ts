import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { companies, projects, automationArtifacts, businessScenarios, businessScenarioVersions, businessScenarioCalculationPins, businessScenarioRuns, analyticalLineageManifests, createDb } from "@paperclipai/db";
import { businessScenarioService } from "../services/business-scenarios/service.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowExecutorService } from "../services/workflows/workflow-executor.js";
import { assertScenarioArtifactSchema } from "../services/business-scenarios/artifacts.js";
import { automationArtifactService } from "../services/automation-artifacts/automation-artifact-service.js";
import { automationArtifactSecurityService } from "../services/automation-artifacts/automation-artifact-security.js";
import * as artifactRuntime from "../services/automation-artifacts/automation-artifact-runtime.js";
import * as codeRuntime from "../services/automation-artifacts/automation-artifact-code-runtime.js";
import { artifactWorkspaceDirectory, eraseArtifactWorkspace } from "../services/automation-artifacts/automation-artifact-workspace.js";
import { assertRuntimeStorageDirectories, removeRuntimeStorageTree } from "../services/runtime-skill-cache.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { memoryJobs } from "@paperclipai/db";
import fs from "node:fs/promises";
import path from "node:path";
import { instanceSettingsService } from "../services/instance-settings.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { purgeCompanyContent } from "../services/saas/company-purge.js";
import { analyticalPurpose } from "./helpers/business-metric-fixture.js";
import { scenarioDefinition } from "./helpers/business-scenario-fixture.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport(), suite = support.supported ? describe : describe.skip;
const actor = { type: "board" as const, source: "local_implicit" as const }, artifactActor = { principal: { type: "system" as const, service: "local-board" } };
const flags = { analytical_lineage_v8: true, business_metrics_v8: true, scenario_planning_v8: true, ai_use_cases_v7: true, governance_evidence_v7: true, enableAutomationArtifactsV1: true, enableAutomationArtifactCodeExecutionV1: true };
const schema = (name: string, unit = {}) => ({ type: "object", properties: { [name]: { type: "number" } }, required: [name], additionalProperties: false, "x-aw-scenario-units": { [name]: unit } });
describe("Exact scenario artifact unit contract", () => {
  it("rejects wildcard/nullable/incomplete numeric names, unknown units and currency relabeling", () => {
    expect(() => assertScenarioArtifactSchema(schema("factor"), { factor: {} })).not.toThrow();
    for (const value of [{}, { ...schema("factor"), additionalProperties: true }, { ...schema("factor"), required: [] }, { ...schema("factor"), properties: { factor: { type: ["number", "null"] } } }, schema("factor", { currency_EUR: 1 }), schema("factor", { unsupported: 1 })]) expect(() => assertScenarioArtifactSchema(value, { factor: {} })).toThrow();
  });
});
suite("Native scenario consumption of validated Automation Artifacts", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string, otherId: string, policyId: string;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-scenario-artifact-"); db = createDb(database.connectionString); });
  afterAll(async () => database?.cleanup());
  beforeEach(async () => {
    await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental(flags);
    companyId = randomUUID(); otherId = randomUUID();
    await db.insert(companies).values([{ id: companyId, name: "Artifact scenario", issuePrefix: randomUUID() }, { id: otherId, name: "Foreign retained tenant", issuePrefix: randomUUID() }]);
    const policy = analyticalPurpose(); policy.analyticalPurpose!.capabilities = ["metrics", "scenario"];
    policyId = (await aiGovernanceService(db).obligation(actor, companyId, policy)).id;
  });
  async function artifact(owner = companyId, activate = true, outputUnit = {}, kind: "transform" | "typescript" = "transform") {
    const input = { name: "Explicit numeric capacity artifact", kind, language: kind === "typescript" ? "typescript" as const : null, sourceCode: kind === "typescript" ? "export default (input: { factor: number }) => ({ capacity: input.factor * input.factor });" : JSON.stringify({ capacity: "{{input.factor}}" }), inputSchema: schema("factor"), outputSchema: schema("capacity", outputUnit), riskClass: "C0" as const, sideEffectClass: "pure" as const, dependencyManifest: {}, testSpec: { cases: [{ name: "declared nominal numeric transformation", input: { factor: 2 }, output: { capacity: kind === "typescript" ? 4 : 2 } }] } };
    const created = await automationArtifactService(db).create(owner, input, artifactActor);
    if (activate) {
      const checked = await automationArtifactSecurityService(db).evaluateLatestVersion(owner, created.artifact.id, { principal: { type: "system", service: "artifact-security-evaluator" } });
      expect(checked.latestVersion!.validationReport!.status).toBe("passed"); expect(checked.latestVersion!.securityReport!.status).toBe("passed");
      await automationArtifactService(db).transitionStatus(owner, created.artifact.id, { expectedStatus: "candidate", expectedLatestVersionId: created.latestVersion!.id, status: "testing" }, artifactActor);
      await automationArtifactService(db).transitionStatus(owner, created.artifact.id, { expectedStatus: "testing", expectedLatestVersionId: created.latestVersion!.id, status: "active" }, artifactActor);
    }
    return { ...created, input };
  }
  function definition(a: Awaited<ReturnType<typeof artifact>>) {
    const def = scenarioDefinition(policyId); def.calculationType = "validated_automation_artifact"; def.formula = []; def.outputs[0].nodeKey = def.outputs[0].key;
    def.calculationRef = { artifactId: a.artifact.id, versionId: a.latestVersion!.id, contentHash: a.latestVersion!.contentHash }; return def;
  }
  async function published(a: Awaited<ReturnType<typeof artifact>>) {
    const d = await businessScenarioService(db).create(companyId, actor, { key: `artifact_${randomUUID().replaceAll("-", "")}`, definition: definition(a) });
    const root = await businessScenarioService(db).publish(companyId, actor, d.scenario.id, { expectedRevision: 1, versionId: d.version.id, rationale: "Human publication of the exact validated numeric artifact and unit contract" });
    const run = await businessScenarioService(db).run(companyId, actor, root.id, { expectedRevision: 2, versionId: d.version.id, seed: null }); return { ...d, root, run };
  }
  async function artifactWorkflow(a: Awaited<ReturnType<typeof artifact>>) {
    const workflows = workflowService(db);
    const created = await workflows.create(companyId, { name: "Exact Artifact consumer" }, artifactActor);
    const draft = await workflows.updateDraft(companyId, created.id, {
      expectedRevisionId: created.draftRevisionId!, graph: {
        version: 1, nodes: [
          { id: "start", type: "core.manual_trigger", name: "Start", position: { x: 0, y: 0 }, config: {} },
          { id: "calculate", type: "automation.artifact", name: "Capacity", position: { x: 100, y: 0 },
            config: { artifactId: a.artifact.id, artifactVersionId: a.latestVersion!.id } },
        ], edges: [{ id: "flow", source: "start", target: "calculate" }], variables: [], settings: {},
      },
    }, artifactActor);
    await workflows.publish(companyId, created.id, {
      expectedDraftRevisionId: draft.draftRevisionId!, expectedPublishedRevisionId: null, approvalId: null,
    }, artifactActor);
    return created;
  }
  it("retains the actual Artifact version on the original Workflow step before publishing its result", async () => {
    const a = await artifact(), created = await artifactWorkflow(a), executor = workflowExecutorService(db);
    const completed = await executor.startManualRun(companyId, created.id, { input: { factor: 7 } }, artifactActor, "exact-artifact-consumer");
    expect(completed.run.status).toBe("succeeded");
    expect(completed.steps.find(step => step.nodeId === "calculate")).toMatchObject({
      status: "succeeded", automationArtifactVersionId: a.latestVersion!.id, outputJson: { capacity: 7 },
    });
    const replay = await executor.startManualRun(companyId, created.id, { input: { factor: 7 } }, artifactActor, "exact-artifact-consumer");
    expect(replay.steps.map(step => step.id)).toEqual(completed.steps.map(step => step.id));
    await automationArtifactService(db).transitionStatus(companyId, a.artifact.id, {
      expectedStatus: "active", expectedLatestVersionId: a.latestVersion!.id, status: "revoked",
    }, artifactActor);
    const denied = await executor.startManualRun(companyId, created.id, { input: { factor: 9 } }, artifactActor, "revoked-artifact-consumer");
    expect(denied.run.status).toBe("failed");
    expect(denied.steps.find(step => step.nodeId === "calculate")?.outputJson).toBeNull();
  });
  it("withholds a computed result when the original Artifact is revoked before checkpoint publication", async () => {
    const a = await artifact(), created = await artifactWorkflow(a);
    const originalRuntime = artifactRuntime.automationArtifactRuntimeService;
    const spy = vi.spyOn(artifactRuntime, "automationArtifactRuntimeService").mockImplementation(scopedDb => {
      const runtime = originalRuntime(scopedDb);
      return { ...runtime, execute: async (...args) => {
        const result = await runtime.execute(...args);
        await automationArtifactService(db).transitionStatus(companyId, a.artifact.id, {
          expectedStatus: "active", expectedLatestVersionId: a.latestVersion!.id, status: "revoked",
        }, artifactActor);
        return result;
      } };
    });
    try {
      const denied = await workflowExecutorService(db).startManualRun(companyId, created.id,
        { input: { factor: 11 } }, artifactActor, "revoked-after-computation");
      expect(denied.run.status).toBe("failed");
      expect(denied.steps.find(step => step.nodeId === "calculate")).toMatchObject({
        automationArtifactVersionId: a.latestVersion!.id, outputJson: null,
      });
    } finally { spy.mockRestore(); }
  });
  it("executes actual native hash-gated transforms only after separate human publication", async () => {
    const a = await artifact(), d = await published(a);
    expect(d.run.result).toMatchObject({ status: "calculated", calculationArtifact: definition(a).calculationRef, uncertainty: { coverageLevel: null } });
    expect(d.run.result.cases.map(item => item.outputs[0].nominal)).toEqual([2, 3]);
    expect((await db.select().from(businessScenarioCalculationPins).where(eq(businessScenarioCalculationPins.versionId, d.version.id)))).toHaveLength(1);
    expect(JSON.stringify(d.version)).not.toContain(a.input.sourceCode);
    expect((await businessScenarioService(db).result(companyId, actor, d.root.id, d.run.id)).contentHash).toBe(d.run.contentHash);
  });
  it("executes and replays actual validated numerical TypeScript through the existing deterministic sandbox", async () => {
    const a = await artifact(companyId, true, {}, "typescript"), d = await published(a);
    expect(d.run.result.cases.map(item => item.outputs[0].nominal)).toEqual([4, 9]);
    const repeat = await businessScenarioService(db).run(companyId, actor, d.root.id, { expectedRevision: 2, versionId: d.version.id, seed: null });
    expect(repeat.result).toEqual(d.run.result); expect(repeat.contentHash).toBe(d.run.contentHash);
    await instanceSettingsService(db).updateExperimental({ enableAutomationArtifactCodeExecutionV1: false });
    await expect(businessScenarioService(db).run(companyId, actor, d.root.id, { expectedRevision: 2, versionId: d.version.id, seed: null })).rejects.toMatchObject({ status: 404 });
  });
  it("executes actual sandbox code in its native version directory and clears the copy before returning", async () => {
    const a = await artifact(companyId, true, {}, "typescript"), versionId = a.latestVersion!.id;
    const directory = artifactWorkspaceDirectory({ companyId, versionId });
    expect(artifactWorkspaceDirectory({ companyId: companyId.toUpperCase(), versionId: versionId.toUpperCase() })).toBe(directory);
    const originalSandbox = codeRuntime.executeAutomationArtifactTypeScriptSandbox;
    let observed = false;
    const spy = vi.spyOn(codeRuntime, "executeAutomationArtifactTypeScriptSandbox").mockImplementation(async input => {
      expect(input.workspaceDirectory).toBe(directory);
      const output = await originalSandbox(input);
      expect(await fs.readFile(path.join(directory, "artifact.mjs"), "utf8")).toContain("input.factor * input.factor");
      observed = true;
      return output;
    });
    try {
      expect((await artifactRuntime.automationArtifactRuntimeService(db).execute(companyId, a.artifact.id, versionId,
        { factor: 3 }, artifactActor, { deterministic: true })).output).toEqual({ capacity: 9 });
      expect(observed).toBe(true);
      await expect(fs.lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(eraseArtifactWorkspace(db, { companyId, versionId })).rejects.toThrow("no Source erasure receipt");
    } finally { spy.mockRestore(); }
  });
  it("queues native version cleanup on deletion with flags off and a paused company, preserving another tenant", async () => {
    const a = await artifact(companyId, true, {}, "typescript"), foreign = await artifact(otherId, true, {}, "typescript");
    const owner = { companyId, versionId: a.latestVersion!.id }, other = { companyId: otherId, versionId: foreign.latestVersion!.id };
    const directory = artifactWorkspaceDirectory(owner), foreignDirectory = artifactWorkspaceDirectory(other);
    for (const target of [directory, foreignDirectory]) {
      await assertRuntimeStorageDirectories(target, resolvePaperclipInstanceRoot(), true);
      // Explicit interrupted-process file prerequisite, not a performed crash.
      await fs.writeFile(path.join(target, "artifact.mjs"), "Retained software crash-copy fixture", { mode: 0o400 });
      await fs.chmod(target, 0o555);
    }
    try {
      await instanceSettingsService(db).updateExperimental({ enableAutomationArtifactsV1: false, enableAutomationArtifactCodeExecutionV1: false });
      await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
      await db.delete(automationArtifacts).where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, a.artifact.id)));
      const [job] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, `artifact-workspace-erasure:v1:${owner.versionId}`)));
      expect(job.sourceRefJson).toEqual({ kind: "artifact_workspace_erasure", versionId: owner.versionId });
      await memoryJobService(db).tick({ limit: 100 });
      await expect(fs.lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(foreignDirectory, "artifact.mjs"), "utf8")).toBe("Retained software crash-copy fixture");
    } finally { await removeRuntimeStorageTree(directory); await removeRuntimeStorageTree(foreignDirectory); }
  });
  it("rejects a symlink workspace without touching its target and retries the same content-free owner", async () => {
    const a = await artifact(), owner = { companyId, versionId: a.latestVersion!.id }, directory = artifactWorkspaceDirectory(owner);
    const outside = await fs.mkdtemp(path.join(process.env.TMPDIR ?? "/tmp", "aw-artifact-foreign-"));
    await fs.writeFile(path.join(outside, "owned-by-user.txt"), "Preserve this unrelated file");
    await assertRuntimeStorageDirectories(path.dirname(directory), resolvePaperclipInstanceRoot(), true);
    await fs.symlink(outside, directory, "dir");
    try {
      await db.delete(automationArtifacts).where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, a.artifact.id)));
      await memoryJobService(db).tick({ limit: 100 });
      const [job] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId), eq(memoryJobs.jobKey, `artifact-workspace-erasure:v1:${owner.versionId}`)));
      expect(job.status).toBe("failed");
      expect(job.sourceRefJson).toEqual({ kind: "artifact_workspace_erasure", versionId: owner.versionId });
      await memoryJobService(db).tick({ limit: 100 });
      expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job.id)))[0].status).toBe("failed");
      expect(await fs.readFile(path.join(outside, "owned-by-user.txt"), "utf8")).toBe("Preserve this unrelated file");
      await fs.unlink(directory);
      await db.update(memoryJobs).set({ updatedAt: new Date(Date.now() - 61_000) }).where(eq(memoryJobs.id, job.id));
      await memoryJobService(db).tick({ limit: 100 });
      expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job.id)))[0].status).toBe("succeeded");
    } finally { await fs.unlink(directory).catch(() => {}); await fs.rm(outside, { recursive: true, force: true }); }
  });
  it("rejects unvalidated, foreign, mismatched-hash and incompatible-unit bindings", async () => {
    const valid = await artifact(), candidate = await artifact(companyId, false), foreign = await artifact(otherId), relabeled = await artifact(companyId, true, { currency_EUR: 1 });
    for (const def of [definition(candidate), definition(foreign), definition(relabeled), { ...definition(valid), calculationRef: { ...definition(valid).calculationRef!, contentHash: "a".repeat(64) } }]) {
      await expect(businessScenarioService(db).create(companyId, actor, { key: `denied_${randomUUID().replaceAll("-", "")}`, definition: def })).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.companyId, companyId))).toHaveLength(0);
  });
  it("retains historical arithmetic after revocation but denies new runs and publication", async () => {
    const a = await artifact(), d = await published(a);
    await automationArtifactService(db).transitionStatus(companyId, a.artifact.id, { expectedStatus: "active", expectedLatestVersionId: a.latestVersion!.id, status: "revoked" }, artifactActor);
    const historical = await businessScenarioService(db).result(companyId, actor, d.root.id, d.run.id);
    expect(historical).toMatchObject({ contentHash: d.run.contentHash, currentQualification: "needs_revalidation" });
    await expect(businessScenarioService(db).run(companyId, actor, d.root.id, { expectedRevision: 2, versionId: d.version.id, seed: null })).rejects.toMatchObject({ status: 409 });
    expect((await businessScenarioService(db).detail(companyId, actor, d.root.id)).versions[0].currentQualification).toBe("needs_revalidation");
  });
  it("requires immutable complete artifact FK pins and exact result provenance in PostgreSQL", async () => {
    const a = await artifact(), d = await published(a);
    await expect(db.delete(businessScenarioCalculationPins).where(eq(businessScenarioCalculationPins.versionId, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessScenarioCalculationPins).set({ artifactHash: "b".repeat(64) }).where(eq(businessScenarioCalculationPins.versionId, d.version.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(businessScenarioRuns).set({ result: { ...d.run.result, calculationArtifact: { ...d.run.result.calculationArtifact!, versionId: randomUUID() } } }).where(eq(businessScenarioRuns.id, d.run.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const [source] = await db.select().from(businessScenarioVersions).where(eq(businessScenarioVersions.id, d.version.id));
    const [manifest] = await db.select().from(analyticalLineageManifests).where(eq(analyticalLineageManifests.id, source.lineageManifestId));
    const rootId = randomUUID(), versionId = randomUUID(), manifestId = randomUUID(), now = new Date();
    await expect(db.transaction(async tx => {
      await tx.insert(businessScenarios).values({ id: rootId, companyId, key: `missing_${rootId.replaceAll("-", "")}`, createdBy: "local-board", createdAt: now, updatedAt: now });
      await tx.insert(analyticalLineageManifests).values({ ...manifest, id: manifestId, analysisRef: versionId, createdAt: now, sourceWatermark: now.toISOString() });
      await tx.insert(businessScenarioVersions).values({ ...source, id: versionId, scenarioId: rootId, lineageManifestId: manifestId, createdAt: now });
    })).rejects.toMatchObject({ code: "23514", message: "scenario_complete_source_pins_required" });
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, rootId))).toHaveLength(0);
  });
  it("erases dependent prose through the canonical artifact FK cascade with rollout off and paused companies", async () => {
    const a = await artifact(), d = await published(a); const [project] = await db.insert(projects).values({ companyId, name: "Unrelated native canonical project" }).returning();
    await instanceSettingsService(db).updateExperimental({ scenario_planning_v8: false, enableAutomationArtifactsV1: false });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await db.delete(automationArtifacts).where(eq(automationArtifacts.id, a.artifact.id));
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.id, d.root.id))).toHaveLength(0);
    expect(await db.select().from(businessScenarioRuns).where(eq(businessScenarioRuns.id, d.run.id))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
  });
  it("does not authorize direct artifact history deletion through ordinary company archival", async () => {
    const a = await artifact(); await published(a);
    await db.update(companies).set({ status: "archived" }).where(eq(companies.id, companyId));
    await expect(db.execute(sql`delete from automation_artifact_versions where id=${a.latestVersion!.id}::uuid`)).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("purges retained artifact scenarios through existing company ownership and preserves another company", async () => {
    const a = await artifact(companyId, true, {}, "typescript"); await published(a);
    const foreign = await artifact(otherId, true, {}, "typescript");
    const directory = artifactWorkspaceDirectory({ companyId, versionId: a.latestVersion!.id });
    const foreignDirectory = artifactWorkspaceDirectory({ companyId: otherId, versionId: foreign.latestVersion!.id });
    for (const target of [directory, foreignDirectory]) {
      await assertRuntimeStorageDirectories(target, resolvePaperclipInstanceRoot(), true);
      await fs.writeFile(path.join(target, "artifact.mjs"), "Interrupted native code-copy prerequisite", { mode: 0o400 });
      await fs.chmod(target, 0o555);
    }
    const [otherProject] = await db.insert(projects).values({ companyId: otherId, name: "Foreign canonical project" }).returning();
    await instanceSettingsService(db).updateExperimental({ scenario_planning_v8: false, enableAutomationArtifactsV1: false });
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    await db.transaction(async raw => { const tx = raw as unknown as typeof db; await tx.execute(sql`select set_config('aw.company_purge_id',${companyId},true)`); await purgeCompanyContent(tx, companyId); });
    expect(await db.select().from(businessScenarios).where(eq(businessScenarios.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(businessScenarioCalculationPins).where(eq(businessScenarioCalculationPins.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.id, otherProject.id))).toHaveLength(1);
    try {
      const [job] = await db.select().from(memoryJobs).where(and(eq(memoryJobs.companyId, companyId),
        eq(memoryJobs.jobKey, `artifact-workspace-erasure:v1:${a.latestVersion!.id}`)));
      expect(job.sourceRefJson).toEqual({ kind: "artifact_workspace_erasure", versionId: a.latestVersion!.id });
      await memoryJobService(db).tick({ limit: 100 });
      await expect(fs.lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(path.join(foreignDirectory, "artifact.mjs"), "utf8")).toBe("Interrupted native code-copy prerequisite");
    } finally { await removeRuntimeStorageTree(directory); await removeRuntimeStorageTree(foreignDirectory); }
  });
});
