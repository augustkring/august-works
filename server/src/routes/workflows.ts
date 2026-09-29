import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  cancelWorkflowRunSchema,
  createWorkflowSchema,
  publishWorkflowSchema,
  startWorkflowRunSchema,
  updateWorkflowDraftSchema,
  workflowCapabilitySearchQuerySchema,
  workflowRunListQuerySchema,
  workflowDataSelectorRequestSchema,
  type PermissionKey,
  type WorkflowCapabilities,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden, notFound, unauthorized, unprocessable } from "../errors.js";
import {
  accessService,
  instanceSettingsService,
  issueService,
  logActivity,
  workflowCapabilityResolverService,
  workflowDataSelectorService,
  workflowExecutorService,
  workflowNodeRegistryService,
  workflowService,
  type WorkflowMutationActor,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

type WorkflowPermission = Extract<
  PermissionKey,
  "workflows:read" | "workflows:edit" | "workflows:publish" | "workflows:run"
>;

export function workflowRoutes(db: Db) {
  const router = Router();
  const svc = workflowService(db);
  const nodeRegistry = workflowNodeRegistryService(db);
  const capabilityResolver = workflowCapabilityResolverService(db);
  const dataSelector = workflowDataSelectorService(db);
  const executor = workflowExecutorService(db);
  const issuesSvc = issueService(db);
  const access = accessService(db);
  const settings = instanceSettingsService(db);

  async function assertWorkflowsEnabled() {
    const experimental = await settings.getExperimental();
    if (experimental.enableWorkflowsV1 !== true) {
      throw notFound("Workflows are not enabled", { code: "workflows_disabled" });
    }
  }

  function mutationActor(req: Request): WorkflowMutationActor {
    if (req.actor.type !== "board") throw forbidden("Board access required");
    if (req.actor.source === "local_implicit") {
      return {
        principal: { type: "system", service: "local-board" },
        runId: req.actor.runId ?? null,
      };
    }
    if (!req.actor.userId) throw unauthorized("Authenticated user identity required");
    return {
      principal: { type: "user", userId: req.actor.userId },
      runId: req.actor.runId ?? null,
    };
  }

  function runActor(req: Request) {
    if (req.actor.type === "agent" && req.actor.agentId) {
      return {
        principal: {
          type: "agent" as const,
          agentId: req.actor.agentId,
          responsibleUserId: req.actor.onBehalfOfUserId ?? null,
        },
        runId: req.actor.runId ?? null,
        responsibleUserId: req.actor.onBehalfOfUserId ?? null,
      };
    }
    if (req.actor.type === "board" && req.actor.source === "local_implicit") {
      return {
        principal: { type: "system" as const, service: "local-board" },
        runId: req.actor.runId ?? null,
        responsibleUserId: req.actor.userId ?? null,
      };
    }
    const info = getActorInfo(req);
    return {
      principal: { type: "user" as const, userId: info.actorId },
      runId: info.runId,
      responsibleUserId: info.actorId,
    };
  }

  function idempotencyKey(req: Request) {
    const value = req.header("Idempotency-Key")?.trim() ?? "";
    if (!value) return null;
    if (value.length > 200) {
      throw unprocessable("Idempotency-Key must be 200 characters or fewer", {
        code: "idempotency_key_invalid",
      });
    }
    return value;
  }

  async function decidePermission(
    req: Request,
    companyId: string,
    permission: WorkflowPermission,
  ) {
    assertCompanyAccess(req, companyId);
    if (
      req.actor.type === "board" &&
      (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)
    ) {
      return {
        allowed: true as const,
        action: permission,
        reason: "allow_local_board" as const,
        explanation: "Allowed by local trusted board access.",
      };
    }
    return access.decide({
      actor: req.actor,
      action: permission,
      resource: { type: "company", companyId },
    });
  }

  async function assertPermission(
    req: Request,
    companyId: string,
    permission: WorkflowPermission,
  ) {
    const decision = await decidePermission(req, companyId, permission);
    if (!decision.allowed) {
      throw forbidden(decision.explanation, {
        code: "permission_denied",
        reason: decision.reason,
        permission,
      });
    }
  }

  async function assertTaskWorkflowInvocationAllowed(
    req: Request,
    companyId: string,
    rawIssueId: string,
  ) {
    assertCompanyAccess(req, companyId);
    const issue = await issuesSvc.getById(rawIssueId);
    if (!issue || issue.companyId !== companyId) {
      throw notFound("Task not found");
    }
    const decision = await access.decide({
      actor: req.actor,
      action: "issue:mutate",
      resource: {
        type: "issue",
        companyId,
        issueId: issue.id,
        projectId: issue.projectId,
        parentIssueId: issue.parentId,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeUserId: issue.assigneeUserId,
        originKind: issue.originKind ?? null,
        originId: issue.originId ?? null,
        status: issue.status,
      },
    });
    if (!decision.allowed) {
      throw forbidden(decision.explanation, {
        code: "permission_denied",
        reason: decision.reason,
        permission: "issue:mutate",
      });
    }
    if (issue.status === "done" || issue.status === "cancelled") {
      throw unprocessable("Task is already terminal", {
        code: "workflow_task_not_active",
        issueId: issue.id,
        status: issue.status,
      });
    }
    return issue;
  }

  async function capabilities(
    req: Request,
    companyId: string,
  ): Promise<WorkflowCapabilities> {
    const [read, edit, publish, run] = await Promise.all([
      decidePermission(req, companyId, "workflows:read"),
      decidePermission(req, companyId, "workflows:edit"),
      decidePermission(req, companyId, "workflows:publish"),
      decidePermission(req, companyId, "workflows:run"),
    ]);
    const humanMutationSurface = req.actor.type === "board";
    return {
      read: read.allowed,
      edit: humanMutationSurface && edit.allowed,
      publish: humanMutationSurface && publish.allowed,
      run: run.allowed,
    };
  }

  async function audit(req: Request, input: {
    companyId: string;
    action: string;
    workflowId: string;
    details?: Record<string, unknown>;
  }) {
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: input.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: input.action,
      entityType: "workflow",
      entityId: input.workflowId,
      details: input.details ?? null,
    });
  }

  router.get("/companies/:companyId/workflows/capabilities", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    res.json(await capabilities(req, companyId));
  });

  router.get("/companies/:companyId/workflows/capability-search", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const query = workflowCapabilitySearchQuerySchema.parse(req.query);
    res.json(await capabilityResolver.search(companyId, query));
  });

  router.post(
    "/companies/:companyId/workflows/data-selector",
    validate(workflowDataSelectorRequestSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:read");
      res.json(await dataSelector.build(companyId, req.body));
    },
  );

  router.get("/companies/:companyId/workflows/node-registry", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    res.json(nodeRegistry.list());
  });

  router.get("/companies/:companyId/workflows", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    res.json(await svc.list(companyId));
  });

  router.post(
    "/companies/:companyId/workflows",
    validate(createWorkflowSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertPermission(req, companyId, "workflows:edit");
      const created = await svc.create(companyId, req.body, mutationActor(req));
      await audit(req, {
        companyId,
        action: "workflow.created",
        workflowId: created.id,
        details: {
          draftRevisionId: created.draftRevisionId,
          projectId: created.projectId,
        },
      });
      res.status(201).json(created);
    },
  );

  router.get("/companies/:companyId/workflows/:workflowId/runs", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const query = workflowRunListQuerySchema.parse(req.query);
    res.json(
      await executor.listRuns(
        companyId,
        req.params.workflowId as string,
        query.limit,
      ),
    );
  });

  router.post(
    "/companies/:companyId/issues/:issueId/workflows/:workflowId/run",
    validate(startWorkflowRunSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:run");
      const issue = await assertTaskWorkflowInvocationAllowed(
        req,
        companyId,
        req.params.issueId as string,
      );
      const result = await executor.startTaskRun(
        companyId,
        issue.id,
        req.params.workflowId as string,
        req.body,
        runActor(req),
        idempotencyKey(req),
      );
      await audit(req, {
        companyId,
        action: "workflow.task_invoked",
        workflowId: req.params.workflowId as string,
        details: {
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          workflowRunId: result.run.id,
          workflowRevisionId: result.run.workflowRevisionId,
        },
      });
      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/workflows/:workflowId/run",
    validate(startWorkflowRunSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:run");
      const result = await executor.startManualRun(
        companyId,
        req.params.workflowId as string,
        req.body,
        runActor(req),
        idempotencyKey(req),
      );
      res.status(201).json(result);
    },
  );

  router.get("/companies/:companyId/workflow-runs/:runId", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const result = await executor.getRun(companyId, req.params.runId as string);
    if (!result) {
      res.status(404).json({ error: "Workflow run not found" });
      return;
    }
    res.json(result);
  });

  router.post(
    "/companies/:companyId/workflow-runs/:runId/cancel",
    validate(cancelWorkflowRunSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:run");
      const result = await executor.cancelRun(
        companyId,
        req.params.runId as string,
        req.body,
        runActor(req),
      );
      res.json(result);
    },
  );

  router.get("/companies/:companyId/workflows/:workflowId", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const detail = await svc.getDetail(companyId, req.params.workflowId as string);
    if (!detail) {
      res.status(404).json({ error: "Workflow not found" });
      return;
    }
    res.json(detail);
  });

  router.get(
    "/companies/:companyId/workflows/:workflowId/revisions",
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:read");
      const revisions = await svc.listRevisions(
        companyId,
        req.params.workflowId as string,
      );
      if (!revisions) {
        res.status(404).json({ error: "Workflow not found" });
        return;
      }
      res.json(revisions);
    },
  );

  router.patch(
    "/companies/:companyId/workflows/:workflowId/draft",
    validate(updateWorkflowDraftSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertPermission(req, companyId, "workflows:edit");
      const updated = await svc.updateDraft(
        companyId,
        req.params.workflowId as string,
        req.body,
        mutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "workflow.draft_updated",
        workflowId: updated.id,
        details: {
          draftRevisionId: updated.draftRevisionId,
          revisionNumber: updated.draftRevision?.revisionNumber ?? null,
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/workflows/:workflowId/publish",
    validate(publishWorkflowSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertPermission(req, companyId, "workflows:publish");
      const published = await svc.publish(
        companyId,
        req.params.workflowId as string,
        req.body,
        mutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "workflow.revision_published",
        workflowId: published.id,
        details: {
          publishedRevisionId: published.publishedRevisionId,
          nextDraftRevisionId: published.draftRevisionId,
        },
      });
      res.json(published);
    },
  );

  return router;
}
