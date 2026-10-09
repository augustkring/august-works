import { proposeOptimizerCandidate } from "../services/optimizer/optimizer-candidate-proposal.js";
import { submitWorkflowDirectResult } from "../services/workflows/workflow-direct-agent.js";
import { Router, type Request, type Response } from "express";
import { toolActionRequests, toolInvocations, workflowWaits, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import {
  cancelWorkflowRunSchema,
  createWorkflowSchema,
  publishWorkflowSchema,
  retryWorkflowRunSchema,
  startWorkflowRunSchema,
  updateWorkflowDraftSchema,
  workflowCapabilitySearchQuerySchema,
  workflowRunListQuerySchema,
  workflowDataSelectorRequestSchema,
  type PermissionKey,
  type WorkflowCapabilities,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { conflict, forbidden, notFound, unauthorized, unprocessable } from "../errors.js";
import { workflowReview } from "../services/experience/workflow-review.js";
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
  optimizerSuggestionService,
  type WorkflowMutationActor,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { getAssignedMcpGateway } from "../services/native-runtime/assigned-mcp-tools.js";
import { ToolGatewayHttpError } from "../services/tool-gateway.js";
import { submitWorkflowTaskResult } from "../services/workflows/workflow-task-result.js";
import { z } from "zod";
import { getWorkflowRunReview, reviewWorkflowRun, workflowRunReviewSchema } from "../services/optimizer/optimizer-run-review.js";
import { optimizerCandidateRequestSchema, optimizerEvaluationService } from "../services/optimizer/optimizer-evaluation.js";
import { workflowOptimizerEvaluations } from "@paperclipai/db";

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
  const optimizerSuggestions = optimizerSuggestionService(db);
  const issuesSvc = issueService(db);
  const access = accessService(db);
  const settings = instanceSettingsService(db);
  const optimizerEvaluations = optimizerEvaluationService(db);

  router.get("/companies/:companyId/workflows/:workflowId/optimizer-evaluations", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    if (!await svc.getDetail(companyId, req.params.workflowId as string,req.actor)) throw notFound("Workflow not found");
    res.json(await optimizerEvaluations.list(companyId, req.params.workflowId as string,req.actor));
  });
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-suggestions/:suggestionId/propose",
    validate(z.object({}).strict()), async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertWorkflowsEnabled();
      await assertPermission(req, companyId, "workflows:publish");
      if (req.actor.type !== "board") throw forbidden("Candidate generation requires board review");
      res.json(await proposeOptimizerCandidate(db, companyId, req.params.workflowId as string, req.params.suggestionId as string,req.actor));
    });
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-suggestions/:suggestionId/compile",
    validate(optimizerCandidateRequestSchema), async (req, res) => {
      const companyId = req.params.companyId as string;
      await assertWorkflowsEnabled();
      await assertPermission(req, companyId, "workflows:publish");
      res.status(201).json(await optimizerEvaluations.compile(companyId, req.params.workflowId as string,
        req.params.suggestionId as string, req.body, mutationActor(req)));
    });
  const optimizerAction = (action: "evaluate" | "shadow" | "request-approval" | "canary" | "activate" | "retire") => [
    validate(z.object({}).strict()), async (req: Request, res: Response) => {
      const companyId = req.params.companyId as string;
      const evaluationId = req.params.evaluationId as string;
      await assertWorkflowsEnabled();
      await assertPermission(req, companyId, "workflows:publish");
      const [bound] = await db.select({ id: workflowOptimizerEvaluations.id }).from(workflowOptimizerEvaluations)
        .where(and(eq(workflowOptimizerEvaluations.companyId, companyId), eq(workflowOptimizerEvaluations.workflowId, req.params.workflowId as string), eq(workflowOptimizerEvaluations.id, evaluationId)));
      if (!bound) throw notFound("Optimizer evaluation not found");
      const actor = mutationActor(req);
      const result = action === "evaluate" ? await optimizerEvaluations.evaluate(companyId, evaluationId,actor)
        : action === "shadow" ? await optimizerEvaluations.startShadow(companyId, evaluationId, actor)
        : action === "request-approval" ? await optimizerEvaluations.requestPromotionApproval(companyId, evaluationId, actor)
          : action === "canary" ? await optimizerEvaluations.prepareCanary(companyId, evaluationId,actor)
            : action === "activate" ? await optimizerEvaluations.activate(companyId, evaluationId,actor)
              : await optimizerEvaluations.retire(companyId, evaluationId, actor);
      res.json(result);
    },
  ] as const;
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/evaluate", ...optimizerAction("evaluate"));
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/shadow", ...optimizerAction("shadow"));
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/request-approval", ...optimizerAction("request-approval"));
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/canary", ...optimizerAction("canary"));
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/activate", ...optimizerAction("activate"));
  router.post("/companies/:companyId/workflows/:workflowId/optimizer-evaluations/:evaluationId/retire", ...optimizerAction("retire"));

  router.get("/companies/:companyId/workflow-runs/:runId/review", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    if (!await executor.getRun(companyId, req.params.runId as string,req.actor)) throw notFound("Workflow run not found");
    res.json(await getWorkflowRunReview(db, companyId, req.params.runId as string));
  });
  router.post("/companies/:companyId/workflow-runs/:runId/review", validate(workflowRunReviewSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:publish");
    res.status(201).json(await reviewWorkflowRun(db, companyId, req.params.runId as string, req.body, mutationActor(req)));
  });

  router.post("/companies/:companyId/workflow-runs/:runId/nodes/:nodeId/task-result",
    validate(z.object({ result: z.unknown() }).strict()), async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertWorkflowsEnabled();
      if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.runId) {
        throw forbidden("An active assigned agent execution is required");
      }
      res.status(201).json(await submitWorkflowTaskResult(db, { companyId,
        workflowRunId: req.params.runId as string, nodeId: req.params.nodeId as string,
        agentId: req.actor.agentId, heartbeatRunId: req.actor.runId, result: req.body.result }));
    });

  router.post("/companies/:companyId/workflow-runs/:runId/nodes/:nodeId/direct-result",
    validate(z.object({ result: z.unknown() }).strict()), async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await assertWorkflowsEnabled();
      if (req.actor.type !== "agent" || !req.actor.agentId || !req.actor.runId) {
        throw forbidden("An active assigned agent execution is required");
      }
      res.status(201).json(await submitWorkflowDirectResult(db, { companyId,
        workflowRunId: req.params.runId as string, nodeId: req.params.nodeId as string,
        agentId: req.actor.agentId, heartbeatRunId: req.actor.runId, result: req.body.result }));
    });

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
        req.actor,
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

  async function toolReviewForRun(companyId: string, runId: string, requestId?: string) {
    return db.select({ id: toolActionRequests.id, status: toolActionRequests.status,
      preview: toolActionRequests.previewMarkdown, argumentsSummary: toolActionRequests.canonicalArgumentsSummary,
      approvalId: toolActionRequests.approvalId, expiresAt: toolActionRequests.expiresAt,
      toolName: toolInvocations.toolName, risk: toolInvocations.riskLevel, nodeId: workflowWaits.nodeId,
    }).from(toolActionRequests).innerJoin(toolInvocations, and(
      eq(toolInvocations.id, toolActionRequests.invocationId), eq(toolInvocations.companyId, companyId),
      eq(toolInvocations.workflowRunId, runId))).innerJoin(workflowWaits, and(
      eq(workflowWaits.companyId, companyId), eq(workflowWaits.workflowRunId, runId),
      eq(workflowWaits.kind, "tool_action"), eq(workflowWaits.status, "active"),
      eq(workflowWaits.referenceId, toolInvocations.id))).where(and(
        eq(toolActionRequests.companyId, companyId), requestId ? eq(toolActionRequests.id, requestId) : undefined));
  }

  router.get("/companies/:companyId/workflow-runs/:runId/tool-reviews", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const permission = await decidePermission(req, companyId, "workflows:publish");
    res.setHeader("Cache-Control", "no-store");
    res.json({ canReview: req.actor.type === "board" && permission.allowed,
      reviews: await toolReviewForRun(companyId, req.params.runId as string) });
  });

  const reviewToolAction = (decision: "approve" | "reject") => async (req: Request, res: Response) => {
    await assertWorkflowsEnabled();
    assertBoard(req);
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:publish");
    const runId = req.params.runId as string;
    const [review] = await toolReviewForRun(companyId, runId, req.params.requestId as string);
    if (!review) throw notFound("Active workflow tool review not found");
    const input = { companyId, actionRequestId: review.id, actor: { userId: getActorInfo(req).actorId } };
    const gateway = getAssignedMcpGateway(db);
    try {
      if (decision === "approve") await gateway.approveActionRequest(input);
      else await gateway.declineActionRequest(input);
    } catch (error) {
      if (!(error instanceof ToolGatewayHttpError)) throw error;
      res.status(error.status).json({ error: error.message, reasonCode: error.reasonCode, ...error.details });
      return;
    }
    res.json(await executor.getRun(companyId, runId,req.actor));
  };
  router.post("/companies/:companyId/workflow-runs/:runId/tool-reviews/:requestId/approve", reviewToolAction("approve"));
  router.post("/companies/:companyId/workflow-runs/:runId/tool-reviews/:requestId/reject", reviewToolAction("reject"));

  router.get("/companies/:companyId/workflow-runs/:runId", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const result = await executor.getRun(companyId, req.params.runId as string,req.actor);
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
  router.post(
    "/companies/:companyId/workflow-runs/:runId/retry",
    validate(retryWorkflowRunSchema),
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      await assertPermission(req, companyId, "workflows:run");
      const key = idempotencyKey(req);
      if (!key) {
        throw unprocessable("Idempotency-Key is required for workflow retry", {
          code: "idempotency_key_required",
        });
      }
      const result = await executor.retryRun(
        companyId,
        req.params.runId as string,
        req.body,
        runActor(req),
        key,
      );
      res.status(201).json(result);
    },
  );


  router.get(
    "/companies/:companyId/workflows/:workflowId/optimizer-suggestions",
    async (req, res) => {
      await assertWorkflowsEnabled();
      const companyId = req.params.companyId as string;
      const workflowId = req.params.workflowId as string;
      await assertPermission(req, companyId, "workflows:read");
      const workflow = await svc.getDetail(companyId, workflowId,req.actor);
      if (!workflow) {
        throw notFound("Workflow not found");
      }

      const experimental = await settings.getExperimental();
      if (experimental.enableWorkflowOptimizerSuggestions !== true) {
        res.json({
          state: "disabled",
          workflowId,
          workflowRevisionId: null,
          terminalRunCount: 0,
          correctionEvidenceCount: 0,
          minimumObservationCount: 3,
          suggestions: [],
        });
        return;
      }

      const result = await optimizerSuggestions.forWorkflow(companyId, workflowId);
      if (!result) {
        throw notFound("Workflow not found");
      }
      res.json(result);
    },
  );

  router.get("/companies/:companyId/workflows/:workflowId/experience", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    const workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal)
      throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    const detail = await svc.getDetail(companyId, workflowId, req.actor);
    if (!detail) throw notFound("Workflow not found");
    const edit = await decidePermission(req, companyId, "workflows:edit");
    const result = workflowReview(detail, nodeRegistry.list(), edit.allowed);
    // Current native admission remains necessary after the asynchronous private read.
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    res.json(result);
  });

  router.get("/companies/:companyId/workflows/:workflowId", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const detail = await svc.getDetail(companyId, req.params.workflowId as string,req.actor);
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
        req.actor,
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
