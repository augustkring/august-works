import { readCustomerWorkflowPublication, admitCustomerWorkflowPublication } from "../services/workflows/workflow-customer-publication.js";
import { workflowPublicationCommandSchema } from "@paperclipai/shared";
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
  workflowLifecycleCommandSchema,
  workflowLaunchCommandSchema,
  workflowStopCommandSchema,
  workflowTestCommandSchema,
  workflowRequestKindSchema,
  workflowRunControlSchema, workflowStopReceiptSchema,
  workflowExperienceSchema,
  v9FeatureEnabled,
  type PermissionKey,
  type WorkflowCapabilities,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { conflict, forbidden, notFound, unauthorized, unprocessable, HttpError } from "../errors.js";
import { withExperienceAdmission } from "../services/experience/admission.js";
import { ExperienceOverloadError } from "../services/experience/projection.js";
import { workflowReview } from "../services/experience/workflow-review.js";
import { readWorkflowStepContext } from "../services/experience/workflow-step-actors.js";
import { workflowReviewBinding } from "../services/experience/workflow-review-binding.js";
import { workflowDraftIntentService } from "../services/experience/workflow-draft-intent.js";
import { applyWorkflowAuthoringApi } from "../services/workflows/workflow-authoring-api.js";
import { readWorkflowDraftAuthors } from "../services/workflows/workflow-draft-authors.js";
import { workflowCustomerDraftEdit } from "../services/workflows/workflow-customer-draft-edit.js";
import { workflowCustomerDraftFlow } from "../services/workflows/workflow-customer-draft-flow.js";
import { readWorkflowCapabilityCatalog } from "../services/workflows/workflow-capability-visibility.js";
import { workflowRunReview } from "../services/experience/workflow-run-review.js";
import { currentWorkflowStopRoleAllows, readCustomerWorkflowStopReceipt } from "../services/workflows/workflow-customer-stop.js";
import { assertV5Authorization } from "../services/v5-authorization.js";
import { admitCustomerWorkflowTest, readCustomerWorkflowTestReceipt } from "../services/workflows/workflow-customer-test.js";
import {
  accessService,
  instanceSettingsService,
  issueService,
  logActivity,
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
  const dataSelector = workflowDataSelectorService(db);
  const executor = workflowExecutorService(db);
  const optimizerSuggestions = optimizerSuggestionService(db);
  const issuesSvc = issueService(db);
  const access = accessService(db);
  const settings = instanceSettingsService(db);
  const optimizerEvaluations = optimizerEvaluationService(db);

  router.post("/companies/:companyId/workflow-authoring", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await applyWorkflowAuthoringApi(db, req.actor, z.uuid().parse(req.params.companyId), req.body));
  });

  function currentDraftAccount(req: Request) {
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (req.actor.type !== "board" || req.actor.source === "local_implicit" || !req.actor.userId)
      throw forbidden("A verified current account is required");
    if (query.expectedUserId !== req.actor.userId)
      throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  }
  router.get("/companies/:companyId/experience/workflows", async (req, res) => {
    currentDraftAccount(req);
    res.set("Cache-Control", "no-store");
    res.json(await workflowDraftIntentService(db).index(req.actor, z.uuid().parse(req.params.companyId)));
  });
  router.post("/companies/:companyId/experience/workflow-drafts", async (req, res) => {
    currentDraftAccount(req);
    res.set("Cache-Control", "no-store");
    res.status(201).json(await workflowDraftIntentService(db).create(req.actor, z.uuid().parse(req.params.companyId), req.body));
  });
  router.get("/companies/:companyId/experience/workflow-draft-requests/:requestId", async (req, res) => {
    currentDraftAccount(req);
    res.set("Cache-Control", "no-store");
    res.json(await workflowDraftIntentService(db).receipt(req.actor, z.uuid().parse(req.params.companyId), z.uuid().parse(req.params.requestId)));
  });
  router.get("/companies/:companyId/workflows/:workflowId/experience/authors", async (req, res) => {
    currentDraftAccount(req);
    res.set("Cache-Control", "no-store");
    res.json(await readWorkflowDraftAuthors(db, req.actor, z.uuid().parse(req.params.companyId), z.uuid().parse(req.params.workflowId)));
  });

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
    res.json(await getWorkflowRunReview(db, companyId, req.params.runId as string, req.actor));
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
        authorizationActor: { ...req.actor },
      };
    }
    if (req.actor.type === "board" && req.actor.source === "local_implicit") {
      return {
        principal: { type: "system" as const, service: "local-board" },
        runId: req.actor.runId ?? null,
        responsibleUserId: req.actor.userId ?? null,
        authorizationActor: { ...req.actor },
      };
    }
    const info = getActorInfo(req);
    return {
      principal: { type: "user" as const, userId: info.actorId },
      runId: info.runId,
      responsibleUserId: info.actorId,
      authorizationActor: { ...req.actor },
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

  function humanWorkflowCoverageId(req: Request) {
    const value = req.header("X-Human-Workflow-Coverage-Id")?.trim();
    if (!value) return null;
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw unprocessable("X-Human-Workflow-Coverage-Id must be a UUID", { code: "workflow_coverage_id_invalid" });
    return parsed.data;
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
    res.set("Cache-Control", "private, no-store");
    res.json(await readWorkflowCapabilityCatalog(db, companyId, req.actor, query));
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
    res.json(await svc.list(companyId, req.actor));
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
        humanWorkflowCoverageId(req),
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
      res.set("Cache-Control", "private, no-store");
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
        humanWorkflowCoverageId(req),
      );
      res.set("Cache-Control", "private, no-store");
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

  // Preserve Original callers while binding customer reviews to the account
  // that displayed the action. This middleware runs before any read or effect.
  router.use("/companies/:companyId/workflow-runs/:runId/tool-reviews", (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (req.query.expectedUserId !== undefined) {
      const expected = z.string().min(1).max(300).parse(req.query.expectedUserId);
      const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
      if (!principal || expected !== principal) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    }
    next();
  });

  router.get("/companies/:companyId/workflow-runs/:runId/tool-reviews", async (req, res) => {
    await assertWorkflowsEnabled();
    const companyId = req.params.companyId as string;
    await assertPermission(req, companyId, "workflows:read");
    const permission = await decidePermission(req, companyId, "workflows:publish");
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

  const retainedControlScope = (req: Request, res: Response) => {
    res.set("Cache-Control", "private, no-store"); assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), runId = z.uuid().parse(req.params.runId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    const account = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (!principal || account.expectedUserId !== principal) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    return { companyId, runId };
  };
  router.get("/companies/:companyId/workflow-runs/:runId/experience/control", async (req, res) => {
    const scope = retainedControlScope(req, res);
    res.json(workflowRunControlSchema.parse(await executor.retainedRunControl(scope.companyId, scope.runId, req.actor)));
  });
  router.post("/companies/:companyId/workflow-runs/:runId/experience/retained-stop", validate(workflowStopCommandSchema), async (req, res) => {
    const scope = retainedControlScope(req, res);
    const receipt = await executor.stopRetainedRun(scope.companyId, scope.runId, req.body, req.actor);
    // Repeat actual current retained control before disclosing the immutable
    // admission. A late lost reply is recovered by exact GET, not another Stop.
    await executor.retainedRunControl(scope.companyId, scope.runId, req.actor);
    res.json(workflowStopReceiptSchema.parse(receipt));
  });
  router.get("/companies/:companyId/workflow-runs/:runId/experience/retained-stop-requests/:requestId", async (req, res) => {
    const scope = retainedControlScope(req, res), requestId = z.uuid().parse(req.params.requestId);
    res.json(workflowStopReceiptSchema.parse(await executor.retainedStopReceipt(scope.companyId, scope.runId, requestId, req.actor)));
  });

  router.get("/companies/:companyId/workflow-runs/:runId/experience", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    const runId = z.uuid().parse(req.params.runId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    await assertV5Authorization(db, req.actor, companyId, "workflows:read");
    const detail = await executor.getRun(companyId, runId, req.actor);
    if (!detail) throw notFound("Workflow run not found");
    const revision = await svc.getRevision(companyId, detail.run.workflowId, detail.run.workflowRevisionId, req.actor);
    if (!revision) throw notFound("Workflow run revision not found");
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    await assertV5Authorization(db, req.actor, companyId, "workflows:read");
    const stopAllowed = await access.decide({ actor: req.actor, action: "workflows:run", resource: { type: "company", companyId } });
    const stopEnabled = v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9");
    const stopRoleAllowed = await currentWorkflowStopRoleAllows(db, companyId, req.actor);
    const canRequestStop = stopAllowed.allowed && stopEnabled && stopRoleAllowed;
    const stopReceipt = canRequestStop ? await readCustomerWorkflowStopReceipt(db, detail.run, req.actor) : null;
    // A receipt survives navigation, but never bypasses current private-source
    // admission or reveals another principal's original request.
    if (stopReceipt) {
      if (!await executor.getRun(companyId, runId, req.actor)) throw notFound("Workflow run not found");
      await assertWorkflowsEnabled();
      await assertV5Authorization(db, req.actor, companyId, "workflows:read");
      await assertV5Authorization(db, req.actor, companyId, "workflows:run");
      if (!v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9") ||
          !await currentWorkflowStopRoleAllows(db, companyId, req.actor)) throw notFound("Workflow stop receipt is unavailable");
    }
    res.json(workflowRunReview(detail, revision, nodeRegistry.list(), canRequestStop, stopReceipt));
  });

  router.post("/companies/:companyId/workflow-runs/:runId/experience/stop", validate(workflowStopCommandSchema), async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), runId = z.uuid().parse(req.params.runId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    await assertPermission(req, companyId, "workflows:run");
    const receipt = await executor.stopRun(companyId, runId, req.body, req.actor);
    // A later authority/retention loss can hide the reply. The native admission
    // is retained, so the client must reconcile the identical original request.
    if (!await executor.getRun(companyId, runId, req.actor)) throw notFound("Workflow run not found");
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    await assertPermission(req, companyId, "workflows:run");
    await assertV5Authorization(db, req.actor, companyId, "workflows:read");
    await assertV5Authorization(db, req.actor, companyId, "workflows:run");
    if (!await currentWorkflowStopRoleAllows(db, companyId, req.actor)) throw forbidden("Viewer access is read-only");
    res.json(receipt);
  });

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

      const result = await optimizerSuggestions.forWorkflow(companyId, workflowId, req.actor);
      if (!result) {
        throw notFound("Workflow not found");
      }
      res.json(result);
    },
  );

  router.get("/companies/:companyId/workflows/:workflowId/experience/requests/:kind/:requestId", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), workflowId = z.uuid().parse(req.params.workflowId),
      requestId = z.uuid().parse(req.params.requestId), kind = workflowRequestKindSchema.parse(req.params.kind);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    const account = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (!principal || account.expectedUserId !== principal) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    try {
      const receipt = await withExperienceAdmission(async signal => {
        signal.throwIfAborted();
        const value = await svc.requestReceipt(companyId, workflowId, kind, requestId, req.actor);
        signal.throwIfAborted(); return value;
      });
      res.json(receipt);
    } catch (error) {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The original request is unconfirmed; try the current read again");
      throw error;
    }
  });

  router.get("/companies/:companyId/workflows/:workflowId/experience/publication", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    const account = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (!principal || account.expectedUserId !== principal) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    for (const action of ["workflows:read", "workflows:edit", "workflows:run", "workflows:publish"] as const) await assertPermission(req, companyId, action);
    const review = await readCustomerWorkflowPublication(db, companyId, workflowId, req.actor);
    for (const action of ["workflows:read", "workflows:edit", "workflows:run", "workflows:publish"] as const) await assertV5Authorization(db, { ...req.actor, isInstanceAdmin: false }, companyId, action);
    if (!v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9") || !await currentWorkflowStopRoleAllows(db, companyId, req.actor)) throw notFound("Current publication authority is unavailable");
    await assertWorkflowsEnabled();
    res.json(review);
  });
  router.post("/companies/:companyId/workflows/:workflowId/experience/publication", validate(workflowPublicationCommandSchema), async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    const account = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (!principal || account.expectedUserId !== principal) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    for (const action of ["workflows:read", "workflows:edit", "workflows:run", "workflows:publish"] as const) await assertPermission(req, companyId, action);
    const receipt = await admitCustomerWorkflowPublication(db, companyId, workflowId, req.actor, req.body);
    for (const action of ["workflows:read", "workflows:edit", "workflows:run", "workflows:publish"] as const) await assertV5Authorization(db, { ...req.actor, isInstanceAdmin: false }, companyId, action);
    if (!v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9") || !await currentWorkflowStopRoleAllows(db, companyId, req.actor)) throw notFound("Current publication authority is unavailable");
    await assertWorkflowsEnabled();
    res.json(receipt);
  });

  router.post("/companies/:companyId/workflows/:workflowId/experience/test", validate(workflowTestCommandSchema), async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    await assertWorkflowsEnabled();
    for (const action of ["workflows:read", "workflows:edit", "workflows:run"] as const) await assertPermission(req, companyId, action);
    const receipt = await admitCustomerWorkflowTest(db, companyId, workflowId, req.body, req.actor);
    // The exact native run/source and its original initiating principal remain
    // authoritative. A queued test is neither publication nor verification.
    try { await executor.executeQueuedRun(companyId, receipt.runId, runActor(req)); } catch { /* Native recovery retains the admitted test. */ }
    if (!await executor.getRun(companyId, receipt.runId, req.actor)) throw notFound("Workflow test run not found");
    await assertWorkflowsEnabled();
    for (const action of ["workflows:read", "workflows:edit", "workflows:run"] as const) await assertV5Authorization(db, req.actor, companyId, action);
    if (!v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9") || !await currentWorkflowStopRoleAllows(db, companyId, req.actor))
      throw notFound("Workflow test receipt is unavailable");
    res.json(receipt);
  });

  router.post("/companies/:companyId/workflows/:workflowId/experience/launch", validate(workflowLaunchCommandSchema), async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    const receipt = await svc.launch(companyId, workflowId, req.body, req.actor);
    // Native durable reconciliation also owns this run. Inline execution is
    // best effort and cannot upgrade the admission receipt to completion.
    try { await executor.executeQueuedRun(companyId, receipt.runId, runActor(req)); } catch { /* Original admission remains durable. */ }
    res.json(receipt);
  });

  router.get("/companies/:companyId/workflows/:workflowId/experience/operations", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    const workflowId = z.uuid().parse(req.params.workflowId);
    const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (!principal) throw unauthorized("Authenticated user identity required");
    if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    res.set("Cache-Control", "private, no-store");
    res.json(await svc.operations(companyId, workflowId, req.actor));
  });

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
    const operate = await decidePermission(req, companyId, "workflows:publish");
    const run = await decidePermission(req, companyId, "workflows:run");
    const rollout = v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9");
    const testDecisions = await Promise.all(["workflows:read", "workflows:edit", "workflows:run"].map(action =>
      access.decide({actor: req.actor, action: action as WorkflowPermission, resource: {type: "company", companyId}})));
    const canTest = rollout && testDecisions.every(decision => decision.allowed) && await currentWorkflowStopRoleAllows(db, companyId, req.actor);
    const testReceipt = canTest ? await readCustomerWorkflowTestReceipt(db, companyId, workflowId, req.actor) : null;
    const result = workflowReview(detail, nodeRegistry.list(), edit.allowed,
      operate.allowed && rollout, run.allowed && rollout, canTest, testReceipt);
    try {
      const { assignments, toolAccess, toolInputs } = await readWorkflowStepContext(db, detail, req.actor);
      for (const revision of [result.draft, result.active]) if (revision) for (const step of revision.steps) {
        const assignment = assignments.get(`${revision.id}:${step.nodeId}`);
        if (assignment) step.assignment = assignment;
        const connection = toolAccess.get(`${revision.id}:${step.nodeId}`);
        if (connection) step.toolAccess = connection;
        const inputs = toolInputs.get(`${revision.id}:${step.nodeId}`);
        if (inputs) step.inputReview = inputs;
      }
    } catch (error) {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "Current workflow assignments are unavailable; try again");
      throw error;
    }
    // Current native admission remains necessary after the asynchronous private read.
    await assertWorkflowsEnabled();
    await assertPermission(req, companyId, "workflows:read");
    await assertV5Authorization(db, req.actor, companyId, "workflows:read");
    if (canTest) {
      for (const action of ["workflows:edit", "workflows:run"] as const) await assertV5Authorization(db, req.actor, companyId, action);
      if (!v9FeatureEnabled(await settings.getExperimental(), "progressive_shell_v9") || !await currentWorkflowStopRoleAllows(db, companyId, req.actor))
        throw notFound("Workflow test view is unavailable");
    }
    const currentDetail = await svc.getDetail(companyId, workflowId, req.actor);
    if (!currentDetail)
      throw conflict("Current workflow changed; refresh");
    try {
      if (workflowReviewBinding(currentDetail) !== workflowReviewBinding(detail)) throw conflict("Current workflow changed; refresh");
    } catch (error) {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "Current workflow review exceeds its read budget; try Advanced");
      throw error;
    }
    res.json(workflowExperienceSchema.parse(result));
  });

  router.get("/companies/:companyId/workflows/:workflowId/experience/draft-flow", async (req, res) => {
    res.set("Cache-Control", "private, no-store"); currentDraftAccount(req);
    try {
      res.json(await withExperienceAdmission(() => workflowCustomerDraftFlow(db).review(z.uuid().parse(req.params.companyId), z.uuid().parse(req.params.workflowId), req.actor)));
    } catch (error) {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The current draft flow is unavailable; try again"); throw error;
    }
  });
  router.post("/companies/:companyId/workflows/:workflowId/experience/draft-flow", async (req, res) => {
    res.set("Cache-Control", "private, no-store"); currentDraftAccount(req);
    res.json(await workflowCustomerDraftFlow(db).save(z.uuid().parse(req.params.companyId), z.uuid().parse(req.params.workflowId), req.body, req.actor));
  });
  router.get("/companies/:companyId/workflows/:workflowId/experience/draft-steps/:nodeId", async (req, res) => {
    res.set("Cache-Control", "private, no-store"); currentDraftAccount(req);
    try {
      res.json(await withExperienceAdmission((signal, remainingMs) => workflowCustomerDraftEdit(db).review(z.uuid().parse(req.params.companyId),
        z.uuid().parse(req.params.workflowId), req.params.nodeId as string, req.actor, { signal, remainingMs })));
    } catch (error) {
      if (error instanceof ExperienceOverloadError) throw new HttpError(503, "The current draft step is unavailable; try again"); throw error;
    }
  });
  router.post("/companies/:companyId/workflows/:workflowId/experience/draft-steps", async (req, res) => {
    res.set("Cache-Control", "private, no-store"); currentDraftAccount(req);
    res.json(await workflowCustomerDraftEdit(db).save(z.uuid().parse(req.params.companyId), z.uuid().parse(req.params.workflowId), req.body, req.actor));
  });

  router.post("/companies/:companyId/workflows/:workflowId/experience/lifecycle",
    validate(workflowLifecycleCommandSchema), async (req, res) => {
      assertBoard(req);
      const companyId = z.uuid().parse(req.params.companyId);
      const workflowId = z.uuid().parse(req.params.workflowId);
      const principal = req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
      if (!principal) throw unauthorized("Authenticated user identity required");
      if (req.query.expectedUserId !== principal) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
      res.set("Cache-Control", "private, no-store");
      res.json(await svc.lifecycle(companyId, workflowId, req.body, req.actor));
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
