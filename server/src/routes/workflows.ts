import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createWorkflowSchema,
  publishWorkflowSchema,
  updateWorkflowDraftSchema,
  workflowCapabilitySearchQuerySchema,
  type PermissionKey,
  type WorkflowCapabilities,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden, notFound, unauthorized } from "../errors.js";
import {
  accessService,
  instanceSettingsService,
  logActivity,
  workflowCapabilityResolverService,
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
