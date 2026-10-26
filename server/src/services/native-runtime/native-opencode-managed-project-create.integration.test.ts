import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, completionContracts, createDb, orchestrationPlans, projectWorkspaces, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { instanceSettingsService } from "../instance-settings.js";
import { canActorReadProjectPrivacy } from "../authorization.js";
import { resolveManagedProjectWorkspaceDir } from "../../home-paths.js";
import { createManagedNativeProjectOutput } from "../native-project-output.js";
import { nativePayloadSourceSnapshotSchema, orchestrationCompletionSchema } from "@paperclipai/shared";

const QUALIFIED_OPENCODE_SHA256 = "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode private Project creation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-opencode-project-create-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `managed-opencode-project-create-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-project-e2e-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-project-create-e2e-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
      enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true });
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (root) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("creates a private Project with a local workspace, then consumes that exact result on the next provider request", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createCallId = `managed-project-create-${suffix}`;
    const projectName = `Managed private Project ${suffix}`;
    const workspaceName = `Local workspace ${suffix}`;
    let projectCreateReplayEvidence: Record<string, unknown> | null = null;
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, steps: [
        { tool: "create_project", id: createCallId, input: { name: projectName,
          description: "Created by the qualified managed Native tool path.",
          workspace: { name: workspaceName }, idempotencyKey: randomUUID() } },
        { tool: "paperclip_finish", id: `managed-project-finish-${suffix}` },
      ],
      afterManagedProjectCreate: async ({ actor, companyId, issueId, capture, callId, arguments: args, result: created }) => {
        const [projectsBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(projects).where(and(
          eq(projects.companyId, companyId), eq(projects.id, created.receipt.projectId)));
        const [workspacesBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(projectWorkspaces).where(and(
          eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, created.receipt.projectId)));
        const [activitiesBefore] = await db.select({ count: sql<number>`count(*)::int` }).from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.entityType, "project"),
          eq(activityLog.entityId, created.receipt.projectId), eq(activityLog.action, "project.created")));
        const replay = await createManagedNativeProjectOutput({ db, actor, companyId, issueId, callId,
          arguments: args as Parameters<typeof createManagedNativeProjectOutput>[0]["arguments"], capture });
        const [projectsAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(projects).where(and(
          eq(projects.companyId, companyId), eq(projects.id, created.receipt.projectId)));
        const [workspacesAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(projectWorkspaces).where(and(
          eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, created.receipt.projectId)));
        const [activitiesAfter] = await db.select({ count: sql<number>`count(*)::int` }).from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.entityType, "project"),
          eq(activityLog.entityId, created.receipt.projectId), eq(activityLog.action, "project.created")));
        expect(replay.project).toEqual(created.project);
        expect(replay.receipt).toEqual(created.receipt);
        expect([projectsBefore?.count, projectsAfter?.count]).toEqual([1, 1]);
        expect([workspacesBefore?.count, workspacesAfter?.count]).toEqual([1, 1]);
        expect([activitiesBefore?.count, activitiesAfter?.count]).toEqual([1, 1]);
        projectCreateReplayEvidence = { sameProject: replay.project.id === created.project.id,
          sameReceipt: JSON.stringify(replay.receipt) === JSON.stringify(created.receipt),
          noAdditionalProjectWorkspaceActivity: projectsAfter?.count === projectsBefore?.count &&
            workspacesAfter?.count === workspacesBefore?.count && activitiesAfter?.count === activitiesBefore?.count };
      },
    });

    expect(result.completedRun?.status).toBe("succeeded");
    const finalization = result.nativeFinalization as { result?: { completionClaim?: { criteria?: Array<{ criterionId: string }> } } } | null;
    expect(finalization?.result?.completionClaim?.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: "output_project" }),
    ]));
    const [plan] = await db.select().from(orchestrationPlans).where(eq(orchestrationPlans.id, result.planId!));
    const [contractRow] = await db.select().from(completionContracts).where(eq(completionContracts.id, plan!.completionContractId));
    const contract = orchestrationCompletionSchema.parse(contractRow!.contractJson.v7);
    expect(contract.requiredOutputs).toContainEqual({ kind: "private_project", key: "project", jsonSchema: null });
    expect(result.managedProjectCreateEvidence).toMatchObject({ providerContinued: true, toolSchemaPinned: true,
      providerConsumedExactNonErrorToolResult: true, projectIsPrivate: true, sourceSetBound: true,
      hasSnapshotDigest: true, aliceAuthenticatedRead: true, bobAuthenticatedReadDenied: true,
      matchingManagedCapture: true, exactAdditionalInputClosure: true });
    const privacyRead = result.managedProjectPrivacyRead;
    if (!privacyRead) throw new Error("managed_project_privacy_probe_missing");
    expect(privacyRead).toMatchObject({ aliceStatus: 200 });
    expect([403, 404]).toContain(privacyRead.bobStatus);
    expect(projectCreateReplayEvidence).toEqual({ sameProject: true, sameReceipt: true,
      noAdditionalProjectWorkspaceActivity: true });
    const consumers = result.projectCreateResultConsumers ?? [];
    expect(consumers).toHaveLength(1);
    const consumer = consumers[0];
    if (!consumer) throw new Error("managed_project_create_consumer_missing");
    expect(consumer).toMatchObject({ callId: createCallId, consumed: true, privateProject: true });
    const projectId = consumer.projectId;
    if (typeof projectId !== "string") throw new Error("managed_project_create_id_missing");

    const [project] = await db.select().from(projects).where(and(eq(projects.companyId, result.companyId), eq(projects.id, projectId)));
    expect(project as unknown as Record<string, unknown>).toMatchObject({ name: projectName, description: "Created by the qualified managed Native tool path.",
      visibility: "private", privacyOwnerUserId: result.aliceUserId, sourceProvenanceQualified: true,
      payloadSourceProtocolVersion: 1, payloadSourceSnapshotInvalidated: false });
    expect(await canActorReadProjectPrivacy(db, result.bobActor!, { id: project!.id, companyId: project!.companyId })).toBe(false);
    const workspaces = await db.select().from(projectWorkspaces).where(and(
      eq(projectWorkspaces.companyId, result.companyId), eq(projectWorkspaces.projectId, projectId)));
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ name: workspaceName, sourceType: "local_path", isPrimary: true,
      cwd: resolveManagedProjectWorkspaceDir({ companyId: result.companyId, projectId }), repoUrl: null,
      repoRef: null, defaultRef: null, setupCommand: null, cleanupCommand: null, remoteProvider: null,
      remoteWorkspaceRef: null, sharedWorkspaceKey: null });

    const snapshot = nativePayloadSourceSnapshotSchema.parse(project!.payloadSourceSnapshot);
    expect(snapshot.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "task", issueId: result.issueId })]));
    expect(snapshot.policy.issueIds).toContain(result.issueId);
  }, 240_000);
});
