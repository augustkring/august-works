import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { agents, authSessions, authUsers, environmentLeases, executionWorkspaces,
  issues, projects, projectWorkspaces, type Db } from "@paperclipai/db";
import type { BetterAuthSessionResult } from "../../auth/better-auth.js";
import { actorMiddleware } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { projectRoutes } from "../../routes/projects.js";
import { authorizationService, type AuthorizationActor } from "../../services/authorization.js";
import { isRuntimeOwnedGitBranch } from "../../services/execution-workspace-branch-ownership.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { assertNativeProjectSourceCurrent } from "../../services/native-direct-input.js";
import type { NativeBootstrapSourceClosure } from "../../services/native-runtime/native-execution-input.js";
import type { runManagedNativeConversationFrame } from "./managed-native-conversation-frame.js";

export type ManagedNativeProjectWorkspaceScope = Readonly<{ projectId: string; projectWorkspaceId: string }>;
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type FrameInput = Parameters<typeof runManagedNativeConversationFrame>[0];
type PreparationContext = Parameters<NonNullable<FrameInput["prepareNativeRuntimeContext"]>>[0];
type HeartbeatContext = Parameters<NonNullable<FrameInput["configureHeartbeat"]>>[0];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Compose these two existing preparation hooks before profile qualification.
 * Project/Workspace source capture uses the actual authenticated Human route.
 * No Run, Plan, WorkerAttempt or ExecutionWorkspace is inserted here. */
export function managedNativeProjectWorkspaceFixture(input: { root: string }) {
  let prepared: (ManagedNativeProjectWorkspaceScope & {
    companyId: string; agentId: string; userId: string; sessionId: string; repositoryRoot: string;
  }) | null = null;
  return {
    prepareNativeRuntimeContext: async ({ db, actor, companyId, agentId }: PreparationContext) => {
      if (prepared || actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId)
        throw new Error("managed_project_fixture_preparation_owner_invalid");
      const repositoryRoot = await realpath(await mkdtemp(join(input.root, "managed-project-repository-")));
      git(repositoryRoot, ["init", "-b", "main"]);
      await writeFile(join(repositoryRoot, "README.md"), "Managed Project workspace fixture\n");
      git(repositoryRoot, ["add", "README.md"]);
      git(repositoryRoot, ["-c", "user.name=Managed fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "-m", "Initial Project repository"]);
      const [session] = await db.select({ token: authSessions.token }).from(authSessions)
        .where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId),
          sql`${authSessions.expiresAt} > now()`)).limit(1);
      if (!session) throw new Error("managed_project_fixture_current_session_missing");
      const app = express(); app.use(express.json());
      app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => {
        const cookie = (req.header("cookie") ?? "").split(";").map(value => value.trim())
          .find(value => value.startsWith("session_token="));
        const token = cookie ? decodeURIComponent(cookie.slice("session_token=".length)) : null;
        if (!token) return null;
        const [current] = await db.select({ id: authSessions.id, userId: authSessions.userId,
          expiresAt: authSessions.expiresAt }).from(authSessions)
          .where(and(eq(authSessions.token, token), sql`${authSessions.expiresAt} > now()`)).limit(1);
        if (!current) return null;
        const [user] = await db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
          .from(authUsers).where(eq(authUsers.id, current.userId)).limit(1);
        return user ? { session: current, user } satisfies BetterAuthSessionResult : null;
      } }));
      app.use("/api", projectRoutes(db)); app.use(errorHandler);
      const created = await request(app).post(`/api/companies/${companyId}/projects`)
        .set("cookie", `session_token=${encodeURIComponent(session.token)}`)
        .send({ name: "Managed real Git Project", description: "Human-owned local repository for a managed Worker.",
          workspace: { name: "Managed local repository", sourceType: "git_repo", cwd: repositoryRoot,
            repoUrl: pathToFileURL(repositoryRoot).href, repoRef: "main", defaultRef: "main", isPrimary: true } });
      if (created.status !== 201 || typeof created.body.id !== "string")
        throw new Error("managed_project_fixture_human_creation_failed");
      const [workspace] = await db.select().from(projectWorkspaces).where(and(
        eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, created.body.id),
        eq(projectWorkspaces.isPrimary, true))).limit(1);
      const [project] = await db.select().from(projects).where(and(eq(projects.companyId, companyId),
        eq(projects.id, created.body.id))).limit(1);
      if (!workspace || !project || project.payloadSourceProtocolVersion !== 1 || !project.payloadSourceSnapshot ||
          project.payloadSourceSnapshotInvalidated || workspace.cwd !== repositoryRoot ||
          workspace.repoUrl !== pathToFileURL(repositoryRoot).href)
        throw new Error("managed_project_fixture_source_capture_missing");
      const [agent] = await db.select({ adapterConfig: agents.adapterConfig }).from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
      if (!agent) throw new Error("managed_project_fixture_agent_missing");
      await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true,
        enableIsolatedWorkspacesByDefault: true });
      await db.update(agents).set({ adapterConfig: { ...agent.adapterConfig,
        workspaceStrategy: { type: "git_worktree", baseRef: "main" } } })
        .where(and(eq(agents.companyId, companyId), eq(agents.id, agentId)));
      prepared = { companyId, agentId, userId: actor.userId, sessionId: actor.sessionId,
        projectId: project.id, projectWorkspaceId: workspace.id, repositoryRoot };
    },
    configureHeartbeat: async (context: HeartbeatContext) => {
      if (!prepared || context.companyId !== prepared.companyId || context.agentId !== prepared.agentId ||
          context.actor.userId !== prepared.userId || context.actor.sessionId !== prepared.sessionId)
        throw new Error("managed_project_fixture_configuration_owner_changed");
      const { configureManagedConversationSandboxHost } = await import("./managed-native-conversation-sandbox-host.js");
      return configureManagedConversationSandboxHost({ ...context, root: context.runHome, ordinaryWorker: true,
        ordinaryWorkerProject: { projectId: prepared.projectId, projectWorkspaceId: prepared.projectWorkspaceId } });
    },
    project: () => {
      if (!prepared) throw new Error("managed_project_fixture_not_prepared");
      return { ...prepared };
    },
  };
}

/** A narrow opt-in for an actual scheduler-realized in-place Git worktree.
 * The caller still performs all ordinary Run/Task/Plan/bootstrap admission. */
export async function assertManagedNativeProjectWorkspace(input: {
  db: Db | DbTransaction; actor: AuthorizationActor; companyId: string; agentId: string;
  runId: string; issueId: string; leaseId: string; project: ManagedNativeProjectWorkspaceScope;
  execution: { binding?: { executionWorkspaceId?: string }; workspace?: {
    cwd?: string; repoUrl?: unknown; repoRef?: unknown; branchName?: unknown } };
  bootstrapSourceClosure: NativeBootstrapSourceClosure | null;
}): Promise<string> {
  const { db, companyId, project: selected, execution } = input;
  const executionWorkspace = execution.workspace;
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, input.issueId)));
  const [project] = await db.select().from(projects).where(and(eq(projects.companyId, companyId),
    eq(projects.id, selected.projectId)));
  const [repository] = await db.select().from(projectWorkspaces).where(and(eq(projectWorkspaces.companyId, companyId),
    eq(projectWorkspaces.projectId, selected.projectId), eq(projectWorkspaces.id, selected.projectWorkspaceId)));
  if (!task || task.projectId !== selected.projectId ||
      (task.projectWorkspaceId !== null && task.projectWorkspaceId !== selected.projectWorkspaceId) ||
      task.assigneeAgentId !== input.agentId || !project ||
      project.archivedAt || !repository || !repository.isPrimary || repository.sourceType !== "git_repo" ||
      !repository.cwd || !repository.repoUrl || new URL(repository.repoUrl).protocol !== "file:")
    throw new Error("worker_software_host_project_binding_invalid");
  const access = await authorizationService(db).decide({ actor: input.actor, action: "project:read",
    resource: { type: "project", companyId, projectId: project.id }, enforceResponsibleUserIntersection: true });
  if (!access.allowed) throw new Error("worker_software_host_project_source_denied");
  const sources = input.bootstrapSourceClosure?.sourceSet.inputs.filter(source =>
    source.kind === "project" && source.projectId === selected.projectId) ?? [];
  if (sources.length !== 1 || sources[0]?.kind !== "project")
    throw new Error("worker_software_host_project_source_missing");
  await assertNativeProjectSourceCurrent(db, { companyId, actor: input.actor, source: sources[0] });
  const workspaceId = execution.binding?.executionWorkspaceId;
  const [workspace] = workspaceId ? await db.select().from(executionWorkspaces).where(and(
    eq(executionWorkspaces.companyId, companyId), eq(executionWorkspaces.id, workspaceId))) : [];
  const [lease] = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
    eq(environmentLeases.id, input.leaseId), eq(environmentLeases.heartbeatRunId, input.runId),
    eq(environmentLeases.status, "active"))).limit(1);
  if (!executionWorkspace || !workspace || workspace.status !== "active" || workspace.projectId !== selected.projectId ||
      workspace.projectWorkspaceId !== selected.projectWorkspaceId || workspace.sourceIssueId !== input.issueId ||
      workspace.strategyType !== "git_worktree" || workspace.mode !== "isolated_workspace" ||
      !isRuntimeOwnedGitBranch(workspace.metadata) || !workspace.cwd || !workspace.branchName ||
      workspace.cwd !== executionWorkspace.cwd || workspace.repoUrl !== repository.repoUrl ||
      workspace.repoUrl !== executionWorkspace.repoUrl || workspace.baseRef !== executionWorkspace.repoRef ||
      workspace.branchName !== executionWorkspace.branchName || !lease || !lease.expiresAt || lease.expiresAt <= new Date() || lease.metadata?.remoteCwd !== workspace.cwd)
    throw new Error("worker_software_host_project_workspace_binding_invalid");
  const taskRoot = await realpath(workspace.cwd), repositoryRoot = await realpath(repository.cwd);
  const common = git(taskRoot, ["rev-parse", "--git-common-dir"]);
  if (taskRoot !== workspace.cwd || taskRoot === repositoryRoot ||
      await realpath(git(taskRoot, ["rev-parse", "--show-toplevel"])) !== taskRoot ||
      git(taskRoot, ["branch", "--show-current"]) !== workspace.branchName ||
      await realpath(isAbsolute(common) ? common : resolve(taskRoot, common)) !== await realpath(join(repositoryRoot, ".git")))
    throw new Error("worker_software_host_project_worktree_identity_invalid");
  // Called inside the same transaction as the existing workspace source check.
  // Pin the original current lease after filesystem reads; no expiry renewal.
  const [currentLease] = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, companyId), eq(environmentLeases.id, input.leaseId),
    eq(environmentLeases.heartbeatRunId, input.runId), eq(environmentLeases.status, "active"))).for("share");
  const [currentTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId),
    eq(issues.id, input.issueId))).for("share");
  if (!currentLease?.expiresAt || currentLease.expiresAt <= new Date() || currentLease.metadata?.remoteCwd !== taskRoot ||
      !currentTask || currentTask.projectId !== selected.projectId || currentTask.assigneeAgentId !== input.agentId ||
      (currentTask.projectWorkspaceId !== null && currentTask.projectWorkspaceId !== selected.projectWorkspaceId))
    throw new Error("worker_software_host_project_current_lease_or_task_changed");
  return taskRoot;
}
