import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { automationArtifacts, automationArtifactVersions, authUsers, companyMemberships, createDb,
  principalPermissionGrants, workflowOptimizerSuggestions } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedV5Companies } from "./helpers/v5-fixtures.js";
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
      // This callback runs at the exact pre-0497 historical schema boundary.
      // Seed the rows the replay migration consumes using only columns that
      // exist there; current service projections can require later columns.
      const f = await seedV5Companies(legacy); companyId = f.home; userId = f.userId;
      const agentId = randomUUID(), sourceIssueId = randomUUID(), originRunId = randomUUID();
      privateWorkflowId = randomUUID();
      const sourceRevisionId = randomUUID(), parentId = randomUUID(), parentRevisionId = randomUUID();
      await legacy.execute(sql`insert into agents(id,company_id,name,role,status) values
        (${agentId}::uuid,${companyId}::uuid,'Historical Author','general','idle')`);
      await legacy.execute(sql`insert into company_memberships(company_id,principal_type,principal_id,status)
        values(${companyId}::uuid,'agent',${agentId},'active') on conflict do nothing`);
      await legacy.insert(principalPermissionGrants).values(["workflows:read", "workflows:edit"].map(permissionKey =>
        ({ companyId, principalType: "user", principalId: userId, permissionKey }))).onConflictDoNothing();
      await legacy.execute(sql`insert into issues(id,company_id,title,status,priority,assignee_agent_id,created_by_user_id,
        conversation_agent_id,conversation_user_id,conversation_state) values(${sourceIssueId}::uuid,${companyId}::uuid,
        'Owned historical private Source','in_review','medium',${agentId}::uuid,${userId},${agentId}::uuid,${userId},'waiting')`);
      await legacy.execute(sql`insert into heartbeat_runs(id,company_id,agent_id,invocation_source,status,responsible_user_id,
        native_issue_id,context_snapshot,finished_at) values(${originRunId}::uuid,${companyId}::uuid,${agentId}::uuid,
        'api','succeeded',${userId},${sourceIssueId}::uuid,${JSON.stringify({ issueId: sourceIssueId })}::jsonb,now())`);
      // Model a private conversation-authored Workflow and a separate public
      // replay target with their real immutable revision/run relationships.
      await legacy.transaction(async tx => {
        await tx.execute(sql`insert into workflows(id,company_id,name,status,created_by_agent_id,authoring_source_run_ids)
          values(${privateWorkflowId}::uuid,${companyId}::uuid,'Historical private workflow','active',${agentId}::uuid,'[]'::jsonb),
          (${parentId}::uuid,${companyId}::uuid,'Historical public parent','active',null,'[]'::jsonb)`);
        await tx.execute(sql`insert into workflow_revisions(id,company_id,workflow_id,revision_number,state,graph_json,
          created_by_agent_id,created_by_run_id) values(${sourceRevisionId}::uuid,${companyId}::uuid,${privateWorkflowId}::uuid,
            1,'draft','{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb,${agentId}::uuid,${originRunId}::uuid),
          (${parentRevisionId}::uuid,${companyId}::uuid,${parentId}::uuid,1,'draft',
            '{"version":1,"nodes":[],"edges":[],"variables":[],"settings":{}}'::jsonb,null,null)`);
        await tx.execute(sql`update workflows set draft_revision_id=${sourceRevisionId}::uuid where id=${privateWorkflowId}::uuid`);
        await tx.execute(sql`update workflows set draft_revision_id=${parentRevisionId}::uuid where id=${parentId}::uuid`);
      });
      const runs = Array.from({ length: 3 }, () => ({ id: randomUUID() }));
      for (const run of runs) await legacy.execute(sql`insert into workflow_runs(id,company_id,workflow_id,workflow_revision_id,source,status)
        values(${run.id}::uuid,${companyId}::uuid,${privateWorkflowId}::uuid,${sourceRevisionId}::uuid,'manual','queued')`);
      for (const [artifactId, versionId, sourceRuns] of [[completeId, completeVersion, runs.map(run => run.id)], [incompleteId, incompleteVersion, Array.from({ length: 3 }, () => randomUUID())]] as const) {
        const [suggestion] = await legacy.insert(workflowOptimizerSuggestions).values({ companyId, workflowId: parentId,
          workflowRevisionId: parentRevisionId, signatureHash: artifactId.replaceAll("-", "").repeat(2), status: "detected", candidateType: "transform",
          stepOrdinals: [1], operationTypes: ["core.transform"], capabilityRefs: [null], sideEffectRisk: "low", observationCount: 3,
          successRate: 1, humanCorrectionRate: null, humanCorrectionEvidenceCount: 0, humanCorrectionEvidenceCoverage: 0,
          inputShapeStability: 1, outputShapeStability: 1, averageDurationMs: 1, averageCost: null,
          estimatedLatencySavingsMs: 1, estimatedCostSavings: null, observedRunIds: [...sourceRuns] }).returning();
        // The new private column does not exist at this boundary. Native SQL
        // seeds the old records; there are no gate reports or runtime claims.
        await legacy.execute(sql`insert into automation_artifacts(id,company_id,name,kind,risk_class,side_effect_class,created_by_optimizer_suggestion_id,origin_workflow_id)
          values(${artifactId}::uuid,${companyId}::uuid,'Historical replay fixture','expression','C0','pure',${suggestion.id}::uuid,${parentId}::uuid)`);
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
