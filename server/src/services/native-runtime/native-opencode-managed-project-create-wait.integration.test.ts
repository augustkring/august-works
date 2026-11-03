import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { activityLog, authSessions, companyMemberships, createDb, heartbeatRuns, issues, projectWorkspaces, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { issueService } from "../issues.js";
import { instanceSettingsService } from "../instance-settings.js";
import type { AuthorizationActor } from "../authorization.js";
import type { NativeModelOutputCapture } from "./native-execution-input.js";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode Project source wait", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-opencode-project-wait-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `managed-opencode-project-wait-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-project-wait-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-project-wait-e2e-");
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

  it("rejects a retained Task body withdrawn while the actual managed Project constructor waits", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const projectName = `Must roll back after source withdrawal ${suffix}`;
    const projectWorkspaceName = `Must not persist ${suffix}`;
    let companyId: string | null = null;
    let runId: string | null = null;
    const taskLocked = deferred<{ pid: number; taskId: string; userId: string; actor: AuthorizationActor }>();
    const mutateTask = deferred<void>();
    let blocker: Promise<void> | null = null;
    const runPromise = runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, steps: [
        { tool: "create_project", id: `managed-project-wait-${suffix}`, input: {
          name: projectName, workspace: { name: projectWorkspaceName }, idempotencyKey: randomUUID(),
        } },
        { tool: "paperclip_finish", id: `managed-project-wait-finish-${suffix}` },
      ],
      beforeManagedProjectCreate: async (capture: NativeModelOutputCapture) => {
        runId = capture.runId;
        const [run] = await db.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId,
          nativeIssueId: heartbeatRuns.nativeIssueId, responsibleUserId: heartbeatRuns.responsibleUserId })
          .from(heartbeatRuns).where(eq(heartbeatRuns.id, capture.runId));
        const taskId = capture.sourceSet.inputs.find((source): source is Extract<typeof source, { kind: "task" }> =>
          source.kind === "task" && source.issueId === run?.nativeIssueId)?.issueId;
        if (!run?.nativeIssueId || !run.responsibleUserId || !taskId)
          throw new Error("managed_project_wait_source_task_missing");
        companyId = run.companyId;
        const now = new Date();
        const [session] = await db.select({ id: authSessions.id }).from(authSessions).where(and(
          eq(authSessions.userId, run.responsibleUserId), gt(authSessions.expiresAt, now),
        )).orderBy(desc(authSessions.createdAt)).limit(1);
        if (!session) throw new Error("managed_project_wait_human_session_missing");
        const [membership] = await db.select().from(companyMemberships).where(and(
          eq(companyMemberships.companyId, run.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, run.responsibleUserId),
          eq(companyMemberships.status, "active"),
        ));
        if (!membership) throw new Error("managed_project_wait_human_membership_missing");
        const actor: AuthorizationActor = { type: "board", source: "session", userId: run.responsibleUserId,
          sessionId: session.id, companyIds: [run.companyId], memberships: [{ companyId: run.companyId,
            membershipRole: membership.membershipRole, status: "active" }] };

        blocker = db.transaction(async tx => {
          await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, run.companyId),
            eq(issues.id, taskId))).for("update");
          const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          taskLocked.resolve({ pid: Number(backend!.pid), taskId, userId: run.responsibleUserId!, actor });
          await mutateTask.promise;
          await issueService(db).update(taskId, { title: `Changed while managed Project waits ${suffix}`,
            actorUserId: run.responsibleUserId, privacyActor: actor }, tx as unknown as typeof db);
        });
        await taskLocked.promise;
      },
    });
    const runOutcome = runPromise.then(value => ({ value, error: null as unknown }), error => ({ value: null, error }));
    let waitObserved = false;
    let taskId: string | null = null;
    try {
      const locked = await Promise.race([
        taskLocked.promise,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("managed_project_wait_hook_not_reached")), 180_000)),
      ]);
      taskId = locked.taskId;
      for (let attempt = 0; attempt < 300; attempt++) {
        const [row] = await db.execute<{ waiting: number }>(sql`select count(*)::int as waiting
          from pg_stat_activity a where a.datname=current_database() and a.wait_event_type='Lock'
            and ${locked.pid}::int = any(pg_blocking_pids(a.pid))`);
        if ((row?.waiting ?? 0) > 0) { waitObserved = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waitObserved, "the real Project constructor must wait on the retained Task owner row").toBe(true);
    } finally {
      mutateTask.resolve();
      if (blocker) await blocker;
    }

    const outcome = await runOutcome;
    expect(outcome.error).toBeTruthy();
    // The runner rejects the next request after the failed Project tool has
    // paused the plan. The decisive evidence is the blocked original source
    // read, committed owner edit, and absence of every Project effect below.
    expect(String((outcome.error as Error | null)?.message ?? outcome.error)).toContain("managed_opencode_runner_exit_1");
    expect(taskId).toBeTruthy();
    const [changedTask] = await db.select({ title: issues.title }).from(issues).where(eq(issues.id, taskId!));
    expect(changedTask?.title).toContain(`Changed while managed Project waits ${suffix}`);
    expect(companyId).toBeTruthy();
    expect(await db.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId,
      companyId!), eq(projects.name, projectName)))).toEqual([]);
    expect(await db.select({ id: projectWorkspaces.id }).from(projectWorkspaces).where(eq(projectWorkspaces.name, projectWorkspaceName))).toEqual([]);
    expect(runId).toBeTruthy();
    expect(await db.select({ id: activityLog.id }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId!), eq(activityLog.runId, runId!), eq(activityLog.action, "project.created"),
    ))).toEqual([]);
    if (runId) {
      const [run] = await db.select({ resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      const result = run?.resultJson && typeof run.resultJson === "object" ? run.resultJson as Record<string, unknown> : {};
      expect(result.nativeProjectCreateReceipts).toBeUndefined();
    }
  }, 240_000);
});
