import { publicNativePayloadRow } from "../services/native-payload-public.js";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { activityLog, agents, authUsers, companyMemberships, projectAccessMembers, projects } from "@paperclipai/db";
import { projectToolContext } from "../services/project-tool-context.js";
import { persistActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";
import { z } from "zod";
import { normalizeProjectRepositoryUrl, resolveProjectRepositorySelection } from "../services/project-repositories.js";
import { toolAccessService } from "../services/tool-access.js";
import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  createProjectSchema,
  nativePayloadSourceSnapshotSchema,
  addProjectAccessMemberSchema,
  experienceProjectReceiptSchema,
  v9FeatureEnabled,
  createProjectWorkspaceSchema,
  findWorkspaceCommandDefinition,
  isUuidLike,
  matchWorkspaceRuntimeServiceToCommand,
  updateProjectSchema,
  updateProjectWorkspaceSchema,
  workspaceRuntimeControlTargetSchema,
} from "@paperclipai/shared";
import type { WorkspaceRuntimeDesiredState, WorkspaceRuntimeServiceStateMap } from "@paperclipai/shared";
import { trackProjectCreated } from "@paperclipai/shared/telemetry";
import { validate } from "../middleware/validate.js";
import { accessService, projectService, logActivity, workspaceOperationService } from "../services/index.js";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { externalObjectService } from "../services/external-objects.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { assertBoard, assertCompanyAccess, getAccessibleResource, getActorInfo } from "./authz.js";
import {
  buildWorkspaceRuntimeDesiredStatePatch,
  listConfiguredRuntimeServiceEntries,
  runWorkspaceJobForControl,
  startRuntimeServicesForWorkspaceControl,
  stopRuntimeServicesForProjectWorkspace,
} from "../services/workspace-runtime.js";
import {
  assertNoAgentHostWorkspaceCommandMutation,
  collectProjectExecutionWorkspaceCommandPaths,
  collectProjectWorkspaceCommandPaths,
} from "./workspace-command-authz.js";
import { assertCanManageProjectWorkspaceRuntimeServices } from "./workspace-runtime-service-authz.js";
import { getTelemetryClient } from "../telemetry.js";
import { appendWithCap } from "../adapters/utils.js";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";
import { environmentService } from "../services/environments.js";
import { secretService } from "../services/secrets.js";
import { authorizationService, canActorReadIssuePrivacy, canActorReadProjectPrivacy, issueReadSqlCondition, projectReadSqlCondition, pinCurrentBoardActor } from "../services/authorization.js";
import { ensureProjectAccessMember, pinProjectMutationHuman } from "../services/projects.js";
import { lockIssuePrivacyTree } from "../services/issues.js";
import { assertHumanAuthentication } from "../auth/authenticator-assurance.js";
import { assertDirectInputSessionCurrent, directHumanPayloadSnapshotSql } from "../services/native-direct-input.js";
import { logger } from "../middleware/logger.js";

const WORKSPACE_CONTROL_OUTPUT_MAX_CHARS = 256 * 1024;
const SHARED_WORKSPACE_STOP_AND_RESTART_ACTIONS = new Set(["stop", "restart"]);

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);
  // Private work stays unavailable until the complete source/delivery graph
  // has qualified. There is no operator or request-body override.
  router.use("/projects/:id", async (req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const project = await svc.getById(req.params.id as string);
    if (project) {
      if (!(await canActorReadProjectPrivacy(db, req.actor, project))) throw notFound("Project not found");
      if (!(await canActorReadProjectPrivacy(db, { type: "none" }, project))) throw unprocessable("Private projects are not available");
    }
    if (req.body?.visibility === "private") throw unprocessable("Private projects are not available");
    next();
  });
  router.use("/companies/:companyId/projects", async (req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (req.body?.visibility === "private") throw unprocessable("Private projects are not available");
    if (req.actor.type === "agent") {
      const context = await projectToolContext(db, req.actor);
      if (!context.issue || !(await canActorReadIssuePrivacy(db, { type: "none" }, context.issue))) {
        throw unprocessable("Private projects are not available");
      }
    }
    next();
  });

  async function repositoryViewer(req: Request) {
    if (req.actor.type === "board") return { userId: req.actor.userId ?? null, localTrusted: req.actor.source === "local_implicit" };
    const context = await projectToolContext(db, req.actor);
    if (!context.userId) throw forbidden("Repository access requires a responsible user");
    return context;
  }

  async function selectedRepositories(req: Request, companyId: string, ids: string[], existing: import("@paperclipai/shared").ProjectWorkspace[] = []) {
    const viewer = await repositoryViewer(req);
    if (!ids.length) return [];
    const available = await toolAccessService(db).listProjectRepositories(companyId, viewer.userId, viewer.localTrusted);
    return resolveProjectRepositorySelection(ids, available.repositories, existing);
  }
  const access = accessService(db);
  const secretsSvc = secretService(db);
  const workspaceOperations = workspaceOperationService(db);
  const instanceSettings = instanceSettingsService(db);
  const externalObjectsSvc = externalObjectService(db, {
    enabled: async () => (await instanceSettings.getExperimental()).enableExternalObjects === true,
  });
  const strictSecretsMode = process.env.PAPERCLIP_SECRETS_STRICT_MODE === "true";
  const environmentsSvc = environmentService(db);

  /**
   * Managed-sandbox-only policy (`enableManagedSandboxOnly`): a project
   * workspace `cwd` is an absolute path on the execution host. When the policy
   * is on every agent runs in the platform-managed environment, so there is no
   * host for a user to point at and a write that carries a path is refused
   * rather than stored and silently ignored. This is the floor behind the
   * hidden UI field, and it applies to every actor, mirroring how
   * `assertNoAgentHostWorkspaceCommandMutation` floors host-executed commands
   * on these same routes.
   *
   * `cwd: null` still passes: clearing a stale path is exactly what an instance
   * that just turned the policy on needs to do. The settings read only happens
   * when the payload actually carries a path.
   */
  async function assertNoManagedSandboxWorkspacePath(workspacePatch: unknown) {
    if (typeof workspacePatch !== "object" || workspacePatch === null || Array.isArray(workspacePatch)) return;
    const patch = workspacePatch as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(patch, "cwd")) return;
    if (patch.cwd === null || patch.cwd === undefined) return;
    if ((await instanceSettings.getExperimental()).enableManagedSandboxOnly !== true) return;
    throw unprocessable(
      "This instance runs agents only in the platform-managed environment; local folders are not configurable.",
    );
  }

  async function assertProjectEnvironmentSelection(companyId: string, environmentId: string | null | undefined) {
    if (environmentId === undefined || environmentId === null) return;
    await assertEnvironmentSelectionForCompany(environmentsSvc, companyId, environmentId, {
      allowedDrivers: ["local", "ssh", "sandbox"],
    });
  }

  function readProjectPolicyEnvironmentId(policy: unknown): string | null | undefined {
    if (!policy || typeof policy !== "object" || !("environmentId" in policy)) {
      return undefined;
    }
    const environmentId = (policy as { environmentId?: unknown }).environmentId;
    return typeof environmentId === "string" || environmentId === null ? environmentId : undefined;
  }

  async function resolveCompanyIdForProjectReference(req: Request) {
    const companyIdQuery = req.query.companyId;
    const requestedCompanyId =
      typeof companyIdQuery === "string" && companyIdQuery.trim().length > 0
        ? companyIdQuery.trim()
        : null;
    if (requestedCompanyId) {
      assertCompanyAccess(req, requestedCompanyId);
      return requestedCompanyId;
    }
    if (req.actor.type === "agent" && req.actor.companyId) {
      return req.actor.companyId;
    }
    return null;
  }

  async function normalizeProjectReference(req: Request, rawId: string) {
    if (isUuidLike(rawId)) return rawId;
    const companyId = await resolveCompanyIdForProjectReference(req);
    if (!companyId) return rawId;
    const resolved = await svc.resolveByReference(companyId, rawId, {
      readCondition: await projectReadSqlCondition(db, req.actor),
    });
    if (resolved.ambiguous) {
      throw conflict("Project shortname is ambiguous in this company. Use the project ID.");
    }
    return resolved.project?.id ?? rawId;
  }

  async function assertProjectReadAllowed(req: Request, res: Response, project: { id: string; companyId: string }) {
    const decision = await access.decide({
      actor: req.actor,
      action: "project:read",
      resource: { type: "project", companyId: project.companyId, projectId: project.id },
    });
    if (decision.allowed) return true;
    res.status(404).json({ error: "Project not found" });
    return false;
  }

  async function getReadableProject(req: Request, res: Response, id: string) {
    const project = await getAccessibleResource(req, res, svc.getById(id), "Project not found");
    if (!project || !(await assertProjectReadAllowed(req, res, project))) return null;
    return project;
  }

  async function requireProjectPrivacyOwner(executor: Db, req: Request, project: {
    id: string; companyId: string; privacyOwnerUserId: string | null; personalOwnerUserId: string | null;
  }) {
    if (!(await canActorReadProjectPrivacy(executor, req.actor, project))) throw notFound("Project not found");
    if (req.actor.type !== "board" || req.actor.source === "local_implicit" || !req.actor.userId
      || ![project.privacyOwnerUserId, project.personalOwnerUserId].includes(req.actor.userId)) {
      throw forbidden("Only the current project privacy owner can change its audience");
    }
    const [user] = await executor.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, req.actor.userId)).for("share");
    if (!user) throw forbidden("Current organization access is required");
    const [member] = await executor.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
      eq(companyMemberships.companyId, project.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, req.actor.userId), eq(companyMemberships.status, "active"),
      sql`${companyMemberships.membershipRole} <> 'viewer'`,
    )).for("share");
    if (!member) throw forbidden("Current organization access is required");
    if (!(await canActorReadProjectPrivacy(executor, req.actor, project))) throw notFound("Project not found");
  }

  async function assertRuntimeManageAllowed(req: Request, res: Response, companyId: string) {
    const decision = await access.decide({
      actor: req.actor,
      action: "runtime:manage",
      resource: { type: "company", companyId },
    });
    if (decision.allowed) return true;
    res.status(403).json({ error: "Runtime service control is outside this actor's authorization boundary" });
    return false;
  }

  async function filterProjectsForActor<T extends { id: string; companyId: string }>(req: Request, rows: T[]) {
    const decisions = await Promise.all(rows.map((project) =>
      access.decide({
        actor: req.actor,
        action: "project:read",
        resource: { type: "project", companyId: project.companyId, projectId: project.id },
      })
    ));
    return rows.filter((_, index) => decisions[index]?.allowed);
  }

  router.param("id", async (req, _res, next, rawId) => {
    try {
      req.params.id = await normalizeProjectReference(req, rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/companies/:companyId/project-repositories", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const viewer = await repositoryViewer(req);
    res.json(await toolAccessService(db).listProjectRepositories(companyId, viewer.userId, viewer.localTrusted));
  });

  router.put("/projects/:id/repositories", validate(z.object({ repositoryIds: z.array(z.string().regex(/^\d+$/)) })), async (req, res) => {
    assertBoard(req);
    const project = await getReadableProject(req, res, req.params.id as string);
    if (!project) return;
    const repositories = await selectedRepositories(req, project.companyId, req.body.repositoryIds, project.workspaces);
    const updated = await svc.replaceRepositories(project.id, repositories);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId, actorType: actor.actorType, actorId: actor.actorId,
      action: "project.repositories_updated", entityType: "project", entityId: project.id,
      details: { repositoryIds: repositories.map((repo) => repo.id) },
    });
    res.json(updated ? publicNativePayloadRow(updated) : updated);
  });

  router.get("/companies/:companyId/projects", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const includeArchived = req.query.includeArchived === "true";
    const result = await svc.list(companyId, {
      includeArchived,
      readCondition: await projectReadSqlCondition(db, req.actor),
      issueReadCondition: await issueReadSqlCondition(db, req.actor),
    });
    res.json((await filterProjectsForActor(req, result)).map(publicNativePayloadRow));
  });

  router.get("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const project = await getReadableProject(req, res, id);
    if (!project) return;
    res.json(publicNativePayloadRow(project));
  });

  router.get("/projects/:id/external-object-summary", async (req, res) => {
    const id = req.params.id as string;
    const project = await getReadableProject(req, res, id);
    if (!project) return;
    const summary = await externalObjectsSvc.getProjectSummary(project.id);
    res.json(summary);
  });

  router.get("/companies/:companyId/projects/create-receipts/:idempotencyKey", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const companyId = req.params.companyId as string;
    if (!z.uuid().safeParse(companyId).success) throw badRequest("Invalid company ID");
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    if (!v9FeatureEnabled(await instanceSettings.getExperimental(), "ambient_commands_v9"))
      throw notFound("Project receipt is not available");
    const parsed = z.uuid().safeParse(req.params.idempotencyKey);
    if (!parsed.success) throw badRequest("Invalid project receipt key");
    const actor = getActorInfo(req);
    const receiptKey = `project:${companyId}:${actor.actorId}:board:${parsed.data}`;
    // Read the original creator-bound receipt. No new key, audit row, replay or
    // workspace can be created while reconciling an unknown outcome.
    const [prior] = await db.select({ entityId: activityLog.entityId }).from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.action, "project.created"),
      eq(activityLog.entityType, "project"), eq(activityLog.actorType, actor.actorType),
      eq(activityLog.actorId, actor.actorId),
      sql`${activityLog.details}->>'idempotencyKey' = ${receiptKey}`,
    )).limit(1);
    const project = prior ? await svc.getById(prior.entityId) : null;
    if (!project || project.companyId !== companyId) throw notFound("Project receipt is not available");
    if (!(await assertProjectReadAllowed(req, res, project))) return;
    res.json(experienceProjectReceiptSchema.parse(project));
  });

  router.post("/companies/:companyId/projects", validate(createProjectSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    type CreateProjectPayload = Parameters<typeof svc.create>[1] & {
      workspace?: Parameters<typeof svc.createWorkspace>[1];
      repositoryIds?: string[];
    };

    const { workspace, repositoryIds, repositoryUrls, idempotencyKey, ...projectData } = req.body as CreateProjectPayload & { idempotencyKey?: string; repositoryUrls?: string[] };
    const runContext = req.actor.type === "agent" && req.actor.source === "agent_jwt" && req.actor.runId
      ? await projectToolContext(db, req.actor, true) : null;
    if (req.actor.type === "agent" && !runContext) throw forbidden("Project tools require a current task-bound run");
    projectData.privacyOwnerUserId = req.actor.type === "board" ? req.actor.userId ?? null : runContext?.userId ?? null;
    projectData.sourceIssueIds = runContext ? [runContext.issue.id] : [];
    projectData.sourceProvenanceQualified = req.actor.type === "board" || runContext !== null;
    if (projectData.visibility === "private" && req.actor.source === "local_implicit") throw forbidden("Private projects require an authenticated human owner");
    await assertProjectEnvironmentSelection(
      companyId,
      readProjectPolicyEnvironmentId(projectData.executionWorkspacePolicy),
    );
    assertNoAgentHostWorkspaceCommandMutation(
      req,
      [
        ...collectProjectExecutionWorkspaceCommandPaths(projectData.executionWorkspacePolicy),
        ...collectProjectWorkspaceCommandPaths(workspace, "workspace"),
      ],
    );
    await assertNoManagedSandboxWorkspacePath(workspace);
    if (projectData.env !== undefined) {
      projectData.env = await secretsSvc.normalizeEnvBindingsForPersistence(
        companyId,
        projectData.env,
        { strictMode: strictSecretsMode, fieldPath: "env" },
      );
    }
    if (workspace && (repositoryIds || repositoryUrls)) throw unprocessable("Use either workspace or repositoryIds/repositoryUrls when creating a project");
    const urlRepositories = (repositoryUrls ?? []).map(normalizeProjectRepositoryUrl);
    const repositories = repositoryIds ? await selectedRepositories(req, companyId, repositoryIds) : null;
    const actor = getActorInfo(req);
    const fingerprint = createHash("sha256").update(JSON.stringify({ projectData, workspace, repositoryIds, repositoryUrls })).digest("hex");
    const receiptKey = idempotencyKey ? `project:${companyId}:${actor.actorId}:${runContext?.issue.id ?? "board"}:${idempotencyKey}` : null;
    const directActor = req.actor.type === "board" && req.actor.source === "session" &&
      req.actor.userId && req.actor.sessionId && !req.actor.runId ? { ...req.actor } : null;
    const captureDirectInput = !!directActor && (!projectData.visibility || projectData.visibility === "open") &&
      !workspace && !repositoryIds?.length && !repositoryUrls?.length && !projectData.goalIds?.length &&
      !projectData.sourceIssueIds?.length && !projectData.sourceProjectIds?.length &&
      [projectData.goalId, projectData.personalOwnerUserId, projectData.env, projectData.roadmapPolicy,
        projectData.executionWorkspacePolicy, projectData.pauseReason].every(value => value == null);
    const result = await db.transaction(async (tx) => {
      let sourceExpiresAt: number | null = null, sourceOperator = false;
      if (captureDirectInput && directActor) {
        const pinned = await pinCurrentBoardActor(tx, directActor);
        if (!pinned || pinned.credentialExpiresAt === null || !Number.isFinite(pinned.credentialExpiresAt))
          throw forbidden("The current manual input session is unavailable");
        sourceExpiresAt = pinned.credentialExpiresAt;
        sourceOperator = await pinProjectMutationHuman(tx, directActor, companyId, true) === "instance_admin";
        if (sourceOperator) await assertHumanAuthentication(tx, directActor, { requireRecent: true, phishingResistant: true });
        await assertDirectInputSessionCurrent(tx, directActor, sourceExpiresAt);
      }
      await lockIssuePrivacyTree(tx, companyId);
      if (receiptKey) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${receiptKey}, 0))`);
        const [prior] = await tx.select().from(activityLog).where(and(
          eq(activityLog.companyId, companyId), eq(activityLog.action, "project.created"),
          sql`${activityLog.details}->>'idempotencyKey' = ${receiptKey}`,
        ));
        if (prior) {
          if (prior.details?.fingerprint !== fingerprint) throw conflict("Project idempotency key was used with different inputs");
          const project = await projectService(tx as unknown as Db).getById(prior.entityId);
          if (!project) throw conflict("Previously created project is no longer available");
          if (!(await canActorReadProjectPrivacy(tx, req.actor, project))) throw notFound("Project not found");
          if (captureDirectInput && directActor && sourceExpiresAt !== null) {
            if (sourceOperator) await assertHumanAuthentication(tx, directActor, { requireRecent: true, phishingResistant: true });
            await assertDirectInputSessionCurrent(tx, directActor, sourceExpiresAt);
          }
          return { project, publication: null, sourcePublication: null, duplicate: true };
        }
      }
      const currentContext = runContext ? await projectToolContext(tx as unknown as Db, req.actor, true) : null;
      const durableProjectData = { ...projectData };
      if (captureDirectInput) Object.assign(durableProjectData, {
        payloadSourceProtocolVersion: 1, payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: false,
      });
      if (currentContext) {
        if (currentContext.issue.id !== runContext!.issue.id || !(await canActorReadIssuePrivacy(tx, req.actor, currentContext.issue))) {
          throw notFound("Project source is unavailable");
        }
        if (!(await canActorReadIssuePrivacy(tx, { type: "none" }, currentContext.issue))) throw unprocessable("Private projects are not available");
      }
      const service = projectService(tx as unknown as Db);
      const project = repositories ? await service.createWithRepositories(companyId, durableProjectData, repositories, req.actor) : await service.create(companyId, durableProjectData, tx, req.actor);
      if (project.sourceProvenanceQualified !== true || !Array.isArray(project.sourceIssueIds)
        || (currentContext && !project.sourceIssueIds.includes(currentContext.issue.id))) {
        throw conflict("Project source binding is unavailable");
      }
      if (project.visibility === "private" && req.actor.type === "agent" && req.actor.agentId) {
        await ensureProjectAccessMember(tx, { companyId, projectId: project.id, subjectType: "agent", subjectId: req.actor.agentId });
      }
      const attachedUrls = new Set((repositories ?? []).map(repo => repo.url.toLowerCase()));
      const registeredUrls: typeof urlRepositories = [];
      for (const repo of urlRepositories) {
        if (attachedUrls.has(repo.url.toLowerCase())) continue;
        attachedUrls.add(repo.url.toLowerCase());
        await service.createWorkspace(project.id, { name: repo.fullName, repoUrl: repo.url });
        registeredUrls.push(repo);
      }
      const createdWorkspace = workspace ? await service.createWorkspace(project.id, workspace) : null;
      if (workspace && !createdWorkspace) throw unprocessable("Invalid project workspace payload");
      let hydrated = await service.getById(project.id);
      if (!(await canActorReadProjectPrivacy(tx, req.actor, project))) throw notFound("Project not found");
      const activity = await persistActivity(tx as unknown as Db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId,
        runId: actor.runId, issueId: runContext?.issue.id,
        action: "project.created", entityType: "project", entityId: project.id,
        details: {
          name: project.name, description: project.description, icon: project.icon, status: project.status,
          sourceIssueId: runContext?.issue.id ?? null,
          repositories: [...(repositories ?? []).map(repo => ({ id: repo.id, name: repo.fullName, url: repo.url })), ...registeredUrls.map(repo => ({ id: repo.url, name: repo.fullName, url: repo.url })),
            ...(createdWorkspace?.repoUrl ? [{ id: createdWorkspace.id, name: createdWorkspace.name, url: createdWorkspace.repoUrl }] : []),
          ],
          workspaceId: createdWorkspace?.id ?? null,
          envKeys: project.env ? Object.keys(project.env).sort() : [],
          ...(receiptKey ? { idempotencyKey: receiptKey, fingerprint } : {}),
        },
      });
      let sourcePublication: ActivityPublication | null = null;
      if (captureDirectInput && directActor && sourceExpiresAt !== null) {
        const decision = await authorizationService(tx).decide({
          actor: { ...directActor, isInstanceAdmin: false, ignoreInstanceAdmin: !sourceOperator },
          action: "project:read", resource: { type: "project", companyId, projectId: project.id },
          enforceResponsibleUserIntersection: true,
        });
        if (!decision.allowed) throw forbidden("Current project authority is required");
        const [captured] = await tx.update(projects).set({ payloadSourceSnapshot: directHumanPayloadSnapshotSql("project") })
          .where(and(eq(projects.id, project.id), eq(projects.companyId, companyId),
            eq(projects.privacyOwnerUserId, directActor.userId!), eq(projects.payloadSourceProtocolVersion, 1),
            isNull(projects.payloadSourceSnapshot), eq(projects.payloadSourceSnapshotInvalidated, false))).returning();
        if (!captured?.payloadSourceSnapshot) throw conflict("Manual input source capture was not stored");
        const snapshot = nativePayloadSourceSnapshotSchema.parse(captured.payloadSourceSnapshot);
        const source = await persistActivity(tx as unknown as Db, {
          companyId, actorType: "user", actorId: directActor.userId!, action: "project.payload_source_captured",
          entityType: "project", entityId: project.id,
          details: { producer: "direct_manual_input", contentHash: snapshot.owner.contentHash, digest: snapshot.digest },
        });
        sourcePublication = source.publication;
        hydrated = { ...(hydrated ?? project), payloadSourceProtocolVersion: captured.payloadSourceProtocolVersion,
          payloadSourceSnapshot: captured.payloadSourceSnapshot,
          payloadSourceSnapshotInvalidated: captured.payloadSourceSnapshotInvalidated, updatedAt: captured.updatedAt };
        if (sourceOperator) await assertHumanAuthentication(tx, directActor, { requireRecent: true, phishingResistant: true });
        await assertDirectInputSessionCurrent(tx, directActor, sourceExpiresAt);
      }
      return { project: hydrated ?? project, publication: activity.publication, sourcePublication, duplicate: false };
    });
    if (result.publication) publishActivity(result.publication);
    if (result.sourcePublication) {
      try { publishActivity(result.sourcePublication); }
      catch (err) { logger.warn({ err }, "Failed to publish committed project source activity"); }
    }
    if (result.project.env) await secretsSvc.syncEnvBindingsForTarget?.(companyId, { targetType: "project", targetId: result.project.id }, result.project.env);
    if (!(await assertProjectReadAllowed(req, res, result.project))) return;
    if (result.duplicate) { res.status(200).json(publicNativePayloadRow(result.project)); return; }
    const telemetryClient = getTelemetryClient();
    if (telemetryClient) {
      trackProjectCreated(telemetryClient);
    }
    res.status(result.duplicate ? 200 : 201).json(publicNativePayloadRow(result.project));
  });

  router.patch("/projects/:id", validate(updateProjectSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await getReadableProject(req, res, id);
    if (!existing) return;
    const body = { ...req.body };
    assertNoAgentHostWorkspaceCommandMutation(
      req,
      collectProjectExecutionWorkspaceCommandPaths(body.executionWorkspacePolicy),
    );
    await assertProjectEnvironmentSelection(
      existing.companyId,
      readProjectPolicyEnvironmentId(body.executionWorkspacePolicy),
    );
    if (typeof body.archivedAt === "string") {
      body.archivedAt = new Date(body.archivedAt);
    }
    if (body.env !== undefined) {
      body.env = await secretsSvc.normalizeEnvBindingsForPersistence(existing.companyId, body.env, {
        strictMode: strictSecretsMode,
        fieldPath: "env",
      });
    }
    const project = await svc.update(id, body, req.actor);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (body.env !== undefined) {
      await secretsSvc.syncEnvBindingsForTarget?.(
        project.companyId,
        { targetType: "project", targetId: project.id },
        project.env,
      );
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.updated",
      entityType: "project",
      entityId: project.id,
      details: {
        changedKeys: Object.keys(req.body).sort(),
        // Record the mutation's returned state, not a later current-state read.
        ...(body.status !== undefined ? { status: project.status } : {}),
        envKeys:
          body.env && typeof body.env === "object" && !Array.isArray(body.env)
            ? Object.keys(body.env as Record<string, unknown>).sort()
            : undefined,
      },
    });

    res.json(publicNativePayloadRow(project));
  });

  router.get("/projects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const existing = await getReadableProject(req, res, id);
    if (!existing) return;
    const workspaces = await svc.listWorkspaces(id);
    res.json(workspaces);
  });

  router.get("/projects/:id/access-members", async (req, res) => {
    const project = await getReadableProject(req, res, req.params.id as string);
    if (!project) return;
    const rows = await db.select().from(projectAccessMembers).where(and(
      eq(projectAccessMembers.companyId, project.companyId), eq(projectAccessMembers.projectId, project.id),
    ));
    if (!(await assertProjectReadAllowed(req, res, project))) return;
    res.json(rows.map(row => ({ ...row, subjectDisplayName: null, subjectAvatarUrl: null })));
  });

  router.post("/projects/:id/access-members", validate(addProjectAccessMemberSchema), async (req, res) => {
    assertBoard(req);
    const existing = await getReadableProject(req, res, req.params.id as string);
    if (!existing) return;
    const result = await db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, existing.companyId);
      const [project] = await tx.select().from(projects).where(eq(projects.id, existing.id)).for("update");
      if (!project) throw notFound("Project not found");
      await requireProjectPrivacyOwner(tx as unknown as Db, req, project);
      const { subjectType, subjectId } = req.body as { subjectType: "user" | "agent"; subjectId: string };
      const [subject] = subjectType === "agent"
        ? await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.id, subjectId), eq(agents.companyId, project.companyId)))
        : await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
          eq(companyMemberships.companyId, project.companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, subjectId), eq(companyMemberships.status, "active"),
        ));
      if (!subject) throw unprocessable("Project access member must belong to this organization");
      // A project membership never publishes any retained task source.
      for (const sourceId of project.sourceIssueIds) {
        if (subjectType !== "user" || !(await canActorReadIssuePrivacy(tx, { type: "board", userId: subjectId, source: "session" },
          { id: sourceId, companyId: project.companyId }))) throw unprocessable("Sharing inherited source content requires an authorized publication operation");
      }
      for (const sourceId of project.sourceProjectIds) {
        if (subjectType !== "user" || !(await canActorReadProjectPrivacy(tx, { type: "board", userId: subjectId, source: "session" },
          { id: sourceId, companyId: project.companyId }))) throw unprocessable("Sharing inherited source content requires an authorized publication operation");
      }
      const member = await ensureProjectAccessMember(tx, { companyId: project.companyId, projectId: project.id, subjectType, subjectId });
      if (!member) {
        const [prior] = await tx.select().from(projectAccessMembers).where(and(eq(projectAccessMembers.projectId, project.id),
          eq(projectAccessMembers.companyId, project.companyId), eq(projectAccessMembers.subjectType, subjectType), eq(projectAccessMembers.subjectId, subjectId)));
        return { member: prior, publication: null, created: false };
      }
      const actor = getActorInfo(req);
      const activity = await persistActivity(tx as unknown as Db, { companyId: project.companyId, actorType: actor.actorType,
        actorId: actor.actorId, agentId: actor.agentId, action: "project.access_member_added", entityType: "project", entityId: project.id,
        details: { subjectType, subjectId } });
      return { member, publication: activity.publication, created: true };
    });
    if (result.publication) publishActivity(result.publication);
    res.status(result.created ? 201 : 200).json({ ...result.member, subjectDisplayName: null, subjectAvatarUrl: null });
  });

  router.delete("/projects/:id/access-members/:memberId", async (req, res) => {
    assertBoard(req);
    if (!isUuidLike(req.params.memberId as string)) throw notFound("Project access member not found");
    const existing = await getReadableProject(req, res, req.params.id as string);
    if (!existing) return;
    const result = await db.transaction(async tx => {
      await lockIssuePrivacyTree(tx, existing.companyId);
      const [project] = await tx.select().from(projects).where(eq(projects.id, existing.id)).for("update");
      if (!project) throw notFound("Project not found");
      await requireProjectPrivacyOwner(tx as unknown as Db, req, project);
      const [member] = await tx.select().from(projectAccessMembers).where(and(eq(projectAccessMembers.id, req.params.memberId as string),
        eq(projectAccessMembers.companyId, project.companyId), eq(projectAccessMembers.projectId, project.id))).for("update");
      if (!member) throw notFound("Project access member not found");
      if (member.subjectType === "user" && [project.privacyOwnerUserId, project.personalOwnerUserId].includes(member.subjectId)) {
        throw unprocessable("The project privacy owner cannot be removed");
      }
      await tx.delete(projectAccessMembers).where(eq(projectAccessMembers.id, member.id));
      const actor = getActorInfo(req);
      const activity = await persistActivity(tx as unknown as Db, { companyId: project.companyId, actorType: actor.actorType,
        actorId: actor.actorId, agentId: actor.agentId, action: "project.access_member_removed", entityType: "project", entityId: project.id,
        details: { subjectType: member.subjectType, subjectId: member.subjectId } });
      return { member, publication: activity.publication };
    });
    publishActivity(result.publication);
    res.json(result.member);
  });

  router.post("/projects/:id/workspaces", validate(createProjectWorkspaceSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await getReadableProject(req, res, id);
    if (!existing) return;
    assertNoAgentHostWorkspaceCommandMutation(
      req,
      collectProjectWorkspaceCommandPaths(req.body),
    );
    await assertNoManagedSandboxWorkspacePath(req.body);
    const workspace = await svc.createWorkspace(id, req.body);
    if (!workspace) {
      res.status(422).json({ error: "Invalid project workspace payload" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_created",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
        cwd: workspace.cwd,
        isPrimary: workspace.isPrimary,
      },
    });

    res.status(201).json(workspace);
  });

  router.patch(
    "/projects/:id/workspaces/:workspaceId",
    validate(updateProjectWorkspaceSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const workspaceId = req.params.workspaceId as string;
      const existing = await getReadableProject(req, res, id);
      if (!existing) return;
      assertNoAgentHostWorkspaceCommandMutation(
        req,
        collectProjectWorkspaceCommandPaths(req.body),
      );
      await assertNoManagedSandboxWorkspacePath(req.body);
      const workspaceExists = (await svc.listWorkspaces(id)).some((workspace) => workspace.id === workspaceId);
      if (!workspaceExists) {
        res.status(404).json({ error: "Project workspace not found" });
        return;
      }
      const workspace = await svc.updateWorkspace(id, workspaceId, req.body);
      if (!workspace) {
        res.status(422).json({ error: "Invalid project workspace payload" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: existing.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "project.workspace_updated",
        entityType: "project",
        entityId: id,
        details: {
          workspaceId: workspace.id,
          changedKeys: Object.keys(req.body).sort(),
        },
      });

      res.json(workspace);
    },
  );

  async function handleProjectWorkspaceRuntimeCommand(req: Request, res: Response) {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const action = String(req.params.action ?? "").trim().toLowerCase();
    if (action !== "start" && action !== "stop" && action !== "restart" && action !== "run") {
      res.status(404).json({ error: "Workspace command action not found" });
      return;
    }

    const project = await getReadableProject(req, res, id);
    if (!project) return;

    const workspace = project.workspaces.find((entry) => entry.id === workspaceId) ?? null;
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }
    if (!(await assertRuntimeManageAllowed(req, res, project.companyId))) return;

    const isSharedWorkspace = Boolean(workspace.sharedWorkspaceKey);
    if (
      req.actor.type === "agent"
      && isSharedWorkspace
      && SHARED_WORKSPACE_STOP_AND_RESTART_ACTIONS.has(action)
    ) {
      throw forbidden("Missing permission to manage workspace runtime services");
    }

    await assertCanManageProjectWorkspaceRuntimeServices(db, req, {
      companyId: project.companyId,
      projectWorkspaceId: workspace.id,
    });

    const workspaceCwd = workspace.cwd;
    if (!workspaceCwd) {
      res.status(422).json({ error: "Project workspace needs a local path before Paperclip can run workspace commands" });
      return;
    }

    const runtimeConfig = workspace.runtimeConfig?.workspaceRuntime ?? null;
    const target = req.body as { workspaceCommandId?: string | null; runtimeServiceId?: string | null; serviceIndex?: number | null };
    const configuredServices = runtimeConfig ? listConfiguredRuntimeServiceEntries({ workspaceRuntime: runtimeConfig }) : [];
    const workspaceCommand = runtimeConfig
      ? findWorkspaceCommandDefinition(runtimeConfig, target.workspaceCommandId ?? null)
      : null;
    if (target.workspaceCommandId && !workspaceCommand) {
      res.status(404).json({ error: "Workspace command not found for this project workspace" });
      return;
    }
    if (target.runtimeServiceId && !(workspace.runtimeServices ?? []).some((service) => service.id === target.runtimeServiceId)) {
      res.status(404).json({ error: "Runtime service not found for this project workspace" });
      return;
    }
    const matchedRuntimeService =
      workspaceCommand?.kind === "service" && !target.runtimeServiceId
        ? matchWorkspaceRuntimeServiceToCommand(workspaceCommand, workspace.runtimeServices ?? [])
        : null;
    const selectedRuntimeServiceId = target.runtimeServiceId ?? matchedRuntimeService?.id ?? null;
    const selectedServiceIndex =
      workspaceCommand?.kind === "service"
        ? workspaceCommand.serviceIndex
        : target.serviceIndex ?? null;
    if (
      selectedServiceIndex !== undefined
      && selectedServiceIndex !== null
      && (selectedServiceIndex < 0 || selectedServiceIndex >= configuredServices.length)
    ) {
      res.status(422).json({ error: "Selected runtime service is not defined in this project workspace runtime config" });
      return;
    }
    if (workspaceCommand?.kind === "job" && action !== "run") {
      res.status(422).json({ error: `Workspace job "${workspaceCommand.name}" can only be run` });
      return;
    }
    if (workspaceCommand?.kind === "service" && action === "run") {
      res.status(422).json({ error: `Workspace service "${workspaceCommand.name}" should be started or restarted, not run` });
      return;
    }
    if (action === "run" && !workspaceCommand) {
      res.status(422).json({ error: "Select a workspace job to run" });
      return;
    }
    if ((action === "start" || action === "restart") && !runtimeConfig) {
      res.status(422).json({ error: "Project workspace has no workspace command configuration" });
      return;
    }

    const actor = getActorInfo(req);
    const recorder = workspaceOperations.createRecorder({ companyId: project.companyId });
    let runtimeServiceCount = workspace.runtimeServices?.length ?? 0;
    let stdout = "";
    let stderr = "";

    const operation = await recorder.recordOperation({
      phase: action === "stop" ? "workspace_teardown" : "workspace_provision",
      command: workspaceCommand?.command ?? `workspace command ${action}`,
      cwd: workspace.cwd,
      metadata: {
        action,
        projectId: project.id,
        projectWorkspaceId: workspace.id,
        workspaceCommandId: workspaceCommand?.id ?? target.workspaceCommandId ?? null,
        workspaceCommandKind: workspaceCommand?.kind ?? null,
        workspaceCommandName: workspaceCommand?.name ?? null,
        runtimeServiceId: selectedRuntimeServiceId,
        serviceIndex: selectedServiceIndex,
      },
      run: async () => {
        if (action === "run") {
          if (!workspaceCommand || workspaceCommand.kind !== "job") {
            throw new Error("Workspace job selection is required");
          }
          return await runWorkspaceJobForControl({
            actor: {
              id: actor.agentId ?? null,
              name: actor.actorType === "user" ? "Board" : "Agent",
              companyId: project.companyId,
            },
            issue: null,
            workspace: {
              baseCwd: workspaceCwd,
              source: "project_primary",
              projectId: project.id,
              workspaceId: workspace.id,
              repoUrl: workspace.repoUrl,
              repoRef: workspace.repoRef,
              strategy: "project_primary",
              cwd: workspaceCwd,
              branchName: workspace.defaultRef ?? workspace.repoRef ?? null,
              worktreePath: null,
              warnings: [],
              created: false,
              branchCreatedByRuntime: false,
            },
            command: workspaceCommand.rawConfig,
            adapterEnv: {},
            recorder,
            metadata: {
              action,
              projectId: project.id,
              projectWorkspaceId: workspace.id,
              workspaceCommandId: workspaceCommand.id,
            },
          }).then((nestedOperation) => ({
            status: "succeeded" as const,
            exitCode: 0,
            metadata: {
              nestedOperationId: nestedOperation?.id ?? null,
              runtimeServiceCount,
            },
          }));
        }

        const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
          if (stream === "stdout") stdout = appendWithCap(stdout, chunk, WORKSPACE_CONTROL_OUTPUT_MAX_CHARS);
          else stderr = appendWithCap(stderr, chunk, WORKSPACE_CONTROL_OUTPUT_MAX_CHARS);
        };

        if (action === "stop" || action === "restart") {
          await stopRuntimeServicesForProjectWorkspace({
            db,
            projectWorkspaceId: workspace.id,
            runtimeServiceId: selectedRuntimeServiceId,
          });
        }

        if (action === "start" || action === "restart") {
          const startedServices = await startRuntimeServicesForWorkspaceControl({
            db,
            actor: {
              id: actor.agentId ?? null,
              name: actor.actorType === "user" ? "Board" : "Agent",
              companyId: project.companyId,
            },
            issue: null,
            workspace: {
              baseCwd: workspaceCwd,
              source: "project_primary",
              projectId: project.id,
              workspaceId: workspace.id,
              repoUrl: workspace.repoUrl,
              repoRef: workspace.repoRef,
              strategy: "project_primary",
              cwd: workspaceCwd,
              branchName: workspace.defaultRef ?? workspace.repoRef ?? null,
              worktreePath: null,
              warnings: [],
              created: false,
              branchCreatedByRuntime: false,
            },
            config: { workspaceRuntime: runtimeConfig },
            adapterEnv: {},
            onLog,
            serviceIndex: selectedServiceIndex,
            runtimeServiceId: selectedRuntimeServiceId,
          });
          runtimeServiceCount = startedServices.length;
        } else {
          runtimeServiceCount = selectedRuntimeServiceId ? Math.max(0, (workspace.runtimeServices?.length ?? 1) - 1) : 0;
        }

        const currentDesiredState: WorkspaceRuntimeDesiredState =
          workspace.runtimeConfig?.desiredState
          ?? ((workspace.runtimeServices ?? []).some((service) =>
            service.status === "provisioning" || service.status === "starting" || service.status === "running"
          )
            ? "running"
            : "stopped");
        const nextRuntimeState: {
          desiredState: WorkspaceRuntimeDesiredState;
          serviceStates: WorkspaceRuntimeServiceStateMap | null | undefined;
        } = selectedRuntimeServiceId && (selectedServiceIndex === undefined || selectedServiceIndex === null)
          ? {
              desiredState: currentDesiredState,
              serviceStates: workspace.runtimeConfig?.serviceStates ?? null,
            }
          : buildWorkspaceRuntimeDesiredStatePatch({
              config: { workspaceRuntime: runtimeConfig },
              currentDesiredState,
              currentServiceStates: workspace.runtimeConfig?.serviceStates ?? null,
              action,
              serviceIndex: selectedServiceIndex,
            });
        await svc.updateWorkspace(project.id, workspace.id, {
          runtimeConfig: {
            desiredState: nextRuntimeState.desiredState,
            serviceStates: nextRuntimeState.serviceStates,
          },
        });

        return {
          status: "succeeded",
          stdout,
          stderr,
          system:
            action === "stop"
              ? "Stopped project workspace runtime services.\nThis does not pause issue work or held wake scheduling."
              : action === "restart"
                ? "Restarted project workspace runtime services.\nThis does not pause issue work or held wake scheduling."
                : "Started project workspace runtime services.\n",
          metadata: {
            runtimeServiceCount,
            workspaceCommandId: workspaceCommand?.id ?? target.workspaceCommandId ?? null,
            runtimeServiceId: selectedRuntimeServiceId,
            serviceIndex: selectedServiceIndex,
          },
        };
      },
    });

    const updatedWorkspace = (await svc.listWorkspaces(project.id)).find((entry) => entry.id === workspace.id) ?? workspace;

    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: `project.workspace_runtime_${action}`,
      entityType: "project",
      entityId: project.id,
      details: {
        projectWorkspaceId: workspace.id,
        runtimeServiceCount,
        workspaceCommandId: workspaceCommand?.id ?? target.workspaceCommandId ?? null,
        workspaceCommandKind: workspaceCommand?.kind ?? null,
        workspaceCommandName: workspaceCommand?.name ?? null,
        runtimeServiceId: selectedRuntimeServiceId,
        serviceIndex: selectedServiceIndex,
      },
    });

    res.json({
      workspace: updatedWorkspace,
      operation,
    });
  }

  router.post("/projects/:id/workspaces/:workspaceId/runtime-services/:action", validate(workspaceRuntimeControlTargetSchema), handleProjectWorkspaceRuntimeCommand);
  router.post("/projects/:id/workspaces/:workspaceId/runtime-commands/:action", validate(workspaceRuntimeControlTargetSchema), handleProjectWorkspaceRuntimeCommand);

  router.delete("/projects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const existing = await getReadableProject(req, res, id);
    if (!existing) return;
    const workspace = await svc.removeWorkspace(id, workspaceId);
    if (!workspace) {
      res.status(404).json({ error: "Project workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: existing.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.workspace_deleted",
      entityType: "project",
      entityId: id,
      details: {
        workspaceId: workspace.id,
        name: workspace.name,
      },
    });

    res.json(workspace);
  });

  router.delete("/projects/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await getReadableProject(req, res, id);
    if (!existing) return;
    const project = await svc.remove(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "project.deleted",
      entityType: "project",
      entityId: project.id,
    });

    res.json(publicNativePayloadRow(project));
  });

  return router;
}
