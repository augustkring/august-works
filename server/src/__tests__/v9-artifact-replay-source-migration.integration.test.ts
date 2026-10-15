import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { automationArtifacts, automationArtifactVersions, authUsers, companyMemberships, createDb, heartbeatRuns,
  principalPermissionGrants, workflowOptimizerSuggestions, workflowRuns } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Presences, enableV5ForTest } from "./helpers/v5-fixtures.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { issueService } from "../services/issues.js";
import { workflowService } from "../services/workflows/workflow-service.js";
import { workflowAuthoringToolsService } from "../services/workflows/workflow-authoring-tools.js";
import { automationArtifactService, automationArtifactVersionContentHash } from "../services/automation-artifacts/automation-artifact-service.js";

it("upgrades actual historical replay relationships and quarantines missing legacy provenance without inventing an empty Source set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aw-artifact-source-history-"));
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let companyId!: string, userId!: string, privateWorkflowId!: string;
  const completeId = randomUUID(), incompleteId = randomUUID(), completeVersion = randomUUID(), incompleteVersion = randomUUID();
  try {
    database = await startEmbeddedPostgresTestDatabase("aw-artifact-source-upgrade-", { beforeMigrations: async connection => {
      const root = new URL("../../../packages/db/src/migrations/", import.meta.url);
      const journal = JSON.parse(await readFile(new URL("meta/_journal.json", root), "utf8"));
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 497);
      const prior = join(directory, "migrations"); await mkdir(join(prior, "meta"), { recursive: true });
      for (const entry of entries) await copyFile(new URL(`${entry.tag}.sql`, root), join(prior, `${entry.tag}.sql`));
      await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      const legacy = createDb(connection); await migrate(legacy, { migrationsFolder: prior });
      await instanceSettingsService(legacy).getExperimental(); await enableV5ForTest(legacy);
      const f = await seedV5Presences(legacy); companyId = f.home; userId = f.userId;
      await instanceSettingsService(legacy).updateExperimental({ enableWorkflowsV1: true, enableWorkflowBuilderV1: true,
        enableAiWorkflowAuthoring: true, enableAgentChat: true, enableAutomationArtifactsV1: true });
      await legacy.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: f.presence.id, status: "active" }).onConflictDoNothing();
      await legacy.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].flatMap(permissionKey => [
        { companyId, principalType: "agent", principalId: f.presence.id, permissionKey }, { companyId, principalType: "user", principalId: userId, permissionKey },
      ])).onConflictDoNothing();
      const source = await issueService(legacy).create(companyId, { title: "Owned historical private Source", assigneeAgentId: f.presence.id,
        conversationAgentId: f.presence.id, conversationUserId: userId, conversationState: "waiting", status: "in_review", createdByUserId: userId });
      const [origin] = await legacy.insert(heartbeatRuns).values({ companyId, agentId: f.presence.id, responsibleUserId: userId,
        status: "running", contextSnapshot: { issueId: source.id, conversationSessionGeneration: 0 } }).returning();
      const privateWorkflow = (await workflowAuthoringToolsService(legacy).create({ companyId, agentId: f.presence.id, runId: origin.id },
        { name: "Historical private workflow", idempotencyKey: randomUUID() })).workflow;
      privateWorkflowId = privateWorkflow.id;
      const human = { principal: { type: "user" as const, userId } }, owner = workflowService(legacy);
      const parent = await owner.create(companyId, { name: "Historical public parent" }, human);
      // Structural upgrade data only, not an executed or qualified outcome.
      const runs = await legacy.insert(workflowRuns).values(Array.from({ length: 3 }, () => ({ companyId, workflowId: parent.id,
        workflowRevisionId: parent.draftRevisionId!, source: "manual", status: "queued", authoringSourceWorkflowIds: [privateWorkflowId] }))).returning();
      for (const [artifactId, versionId, sourceRuns] of [[completeId, completeVersion, runs.map(run => run.id)], [incompleteId, incompleteVersion, Array.from({ length: 3 }, () => randomUUID())]] as const) {
        const [suggestion] = await legacy.insert(workflowOptimizerSuggestions).values({ companyId, workflowId: parent.id,
          workflowRevisionId: parent.draftRevisionId!, signatureHash: artifactId.replaceAll("-", "").repeat(2), status: "detected", candidateType: "transform",
          stepOrdinals: [1], operationTypes: ["core.transform"], capabilityRefs: [null], sideEffectRisk: "low", observationCount: 3,
          successRate: 1, humanCorrectionRate: null, humanCorrectionEvidenceCount: 0, humanCorrectionEvidenceCoverage: 0,
          inputShapeStability: 1, outputShapeStability: 1, averageDurationMs: 1, averageCost: null,
          estimatedLatencySavingsMs: 1, estimatedCostSavings: null, observedRunIds: [...sourceRuns] }).returning();
        // The new private column does not exist at this boundary. Native SQL
        // seeds the old records; there are no gate reports or runtime claims.
        await legacy.execute(sql`insert into automation_artifacts(id,company_id,name,kind,risk_class,side_effect_class,created_by_optimizer_suggestion_id,origin_workflow_id)
          values(${artifactId}::uuid,${companyId}::uuid,'Historical replay fixture','expression','C0','pure',${suggestion.id}::uuid,${parent.id}::uuid)`);
        const testSpec = { cases: [{ input: artifactId === completeId ? "PRIVATE HISTORICAL REPLAY" : "UNRESOLVED HISTORICAL REPLAY" }] };
        const hash = automationArtifactVersionContentHash({ kind: "expression", language: null, sourceCode: "input.value", inputSchema: {}, outputSchema: {}, dependencyManifest: {}, testSpec });
        await legacy.execute(sql`insert into automation_artifact_versions(id,company_id,artifact_id,version_number,source_code,input_schema,output_schema,dependency_manifest,test_spec,content_hash)
          values(${versionId}::uuid,${companyId}::uuid,${artifactId}::uuid,1,'input.value','{}','{}','{}',${JSON.stringify(testSpec)}::jsonb,${hash})`);
        await legacy.execute(sql`update automation_artifacts set latest_version_id=${versionId}::uuid where id=${artifactId}::uuid`);
      }
    } });
    const db = createDb(database.connectionString), artifacts = automationArtifactService(db), human = { principal: { type: "user" as const, userId } };
    const rows = await db.select().from(automationArtifacts).where(eq(automationArtifacts.companyId, companyId));
    expect(rows.find(row => row.id === completeId)!.authoringSourceWorkflowIds).toEqual([privateWorkflowId]);
    expect(rows.find(row => row.id === incompleteId)!.authoringSourceWorkflowIds).toBeNull();
    expect(JSON.stringify(await artifacts.getDetail(companyId, completeId, human))).toContain("PRIVATE HISTORICAL REPLAY");
    await expect(artifacts.getDetail(companyId, incompleteId, human)).rejects.toMatchObject({ status: 403 });
    const [unresolved] = await db.select().from(automationArtifactVersions).where(eq(automationArtifactVersions.id, incompleteVersion));
    expect(JSON.stringify(unresolved.testSpec)).toContain("UNRESOLVED HISTORICAL REPLAY"); // unavailable, not falsely erased
    expect(await db.execute(sql`select aw_learning_asset_current(${companyId}::uuid,'automation_artifact_version',${incompleteVersion}::uuid) as current`)).toEqual([{ current: false }]);
    const foreignId = randomUUID(), now = new Date();
    await db.insert(authUsers).values({ id: foreignId, name: "Other migration reader", email: `${foreignId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: foreignId, membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "user", principalId: foreignId, permissionKey: "workflows:read" });
    await expect(artifacts.getDetail(companyId, completeId, { principal: { type: "user", userId: foreignId } })).rejects.toMatchObject({ status: 403 });
    await expect(db.update(automationArtifacts).set({ authoringSourceWorkflowIds: [] }).where(and(eq(automationArtifacts.companyId, companyId), eq(automationArtifacts.id, incompleteId)))).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally { await database?.cleanup(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
