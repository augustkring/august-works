import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createFoundationChangeProposalSchema,
  createFoundationDocumentSchema,
  foundationSearchQuerySchema,
  transitionFoundationDocumentSchema,
  updateFoundationDraftSchema,
  type PermissionKey,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden, notFound, unauthorized } from "../errors.js";
import {
  accessService,
  approvedFoundationView,
  foundationIndexService,
  foundationService,
  instanceSettingsService,
  logActivity,
  type FoundationMutationActor,
} from "../services/index.js";
import {
  assertBoard,
  assertCompanyAccess,
  getActorInfo,
} from "./authz.js";

export function foundationRoutes(db: Db) {
  const router = Router();
  const svc = foundationService(db);
  const access = accessService(db);
  const index = foundationIndexService(db);
  const settings = instanceSettingsService(db);

  async function assertFoundationEnabled() {
    const experimental = await settings.getExperimental();
    if (experimental.enableFoundationV1 !== true) {
      throw notFound("Foundation is not enabled", { code: "foundation_disabled" });
    }
  }

  function boardMutationActor(req: Request): FoundationMutationActor {
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

  function proposalActor(req: Request): FoundationMutationActor {
    if (req.actor.type === "agent" && req.actor.agentId) {
      return {
        principal: {
          type: "agent",
          agentId: req.actor.agentId,
          responsibleUserId: req.actor.onBehalfOfUserId ?? null,
        },
        runId: req.actor.runId ?? null,
      };
    }
    return boardMutationActor(req);
  }

  type FoundationPermission = Extract<
    PermissionKey,
    "foundation:read" | "foundation:propose" | "foundation:edit" | "foundation:approve"
  >;

  async function assertFoundationPermission(
    req: Request,
    companyId: string,
    permission: FoundationPermission,
  ) {
    assertCompanyAccess(req, companyId);
    if (
      req.actor.type === "board" &&
      (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)
    ) {
      return;
    }
    const decision = await access.decide({
      actor: req.actor,
      action: permission,
      resource: { type: "company", companyId },
    });
    if (!decision.allowed) {
      throw forbidden(decision.explanation, {
        code: "permission_denied",
        reason: decision.reason,
        permission,
      });
    }
  }

  async function resolveFoundationCapabilities(
    req: Request,
    companyId: string,
  ) {
    assertCompanyAccess(req, companyId);
    if (
      req.actor.type === "board" &&
      (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)
    ) {
      return { read: true, propose: true, edit: true, approve: true };
    }

    const permissions = [
      "foundation:read",
      "foundation:propose",
      "foundation:edit",
      "foundation:approve",
    ] as const satisfies readonly FoundationPermission[];
    const decisions = await Promise.all(
      permissions.map((permission) =>
        access.decide({
          actor: req.actor,
          action: permission,
          resource: { type: "company", companyId },
        }),
      ),
    );

    return {
      read: decisions[0]!.allowed,
      propose: decisions[1]!.allowed,
      edit: decisions[2]!.allowed,
      approve: decisions[3]!.allowed,
    };
  }

  async function audit(req: Request, input: {
    companyId: string;
    action: string;
    entityId: string;
    entityType?: string;
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
      entityType: input.entityType ?? "foundation_document",
      entityId: input.entityId,
      details: input.details ?? null,
    });
  }

  router.get("/companies/:companyId/foundation", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    await assertFoundationPermission(req, companyId, "foundation:read");
    const items = await svc.list(companyId,req.actor);
    if (req.actor.type === "agent") {
      res.json(items.flatMap((item) => {
        const approved = approvedFoundationView(item);
        return approved ? [approved] : [];
      }));
      return;
    }
    res.json(items);
  });

  router.get("/companies/:companyId/foundation/capabilities", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    res.json(await resolveFoundationCapabilities(req, companyId));
  });

  router.post(
    "/companies/:companyId/foundation",
    validate(createFoundationDocumentSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:edit");
      const created = await svc.createDraft(companyId, req.body, boardMutationActor(req));
      await audit(req, {
        companyId,
        action: "foundation.document_created",
        entityId: created.id,
        details: {
          foundationKey: created.foundationKey,
          category: created.category,
          revisionId: created.latestRevisionId,
        },
      });
      res.status(201).json(created);
    },
  );

  router.get("/companies/:companyId/foundation/search", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    await assertFoundationPermission(req, companyId, "foundation:read");
    const query = foundationSearchQuerySchema.parse(req.query);
    if (req.actor.type === "agent" && query.scope !== "approved") {
      throw forbidden("Agents can only search approved Foundation content", {
        code: "permission_denied",
        reason: "foundation_working_scope_denied",
      });
    }
    res.json(
      await index.search(companyId, {
        query: query.q,
        limit: query.limit,
        scope: query.scope,
      },req.actor),
    );
  });

  router.get("/companies/:companyId/foundation/:foundationDocumentId", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    await assertFoundationPermission(req, companyId, "foundation:read");
    const result = await svc.get(companyId, req.params.foundationDocumentId as string,req.actor);
    const visible =
      req.actor.type === "agent" && result ? approvedFoundationView(result) : result;
    if (!visible) {
      res.status(404).json({ error: "Foundation document not found" });
      return;
    }
    res.json(visible);
  });

  router.get(
    "/companies/:companyId/foundation/:foundationDocumentId/revisions",
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:read");
      const revisions = await svc.listRevisions(
        companyId,
        req.params.foundationDocumentId as string,req.actor,
      );
      if (!revisions) {
        res.status(404).json({ error: "Foundation document not found" });
        return;
      }
      res.json(revisions);
    },
  );

  router.patch(
    "/companies/:companyId/foundation/:foundationDocumentId/draft",
    validate(updateFoundationDraftSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:edit");
      const updated = await svc.updateDraft(
        companyId,
        req.params.foundationDocumentId as string,
        req.body,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.draft_updated",
        entityId: updated.id,
        details: {
          revisionId: updated.latestRevisionId,
          changedKeys: Object.keys(req.body).filter((key) => key !== "body").sort(),
          bodyChanged: Object.prototype.hasOwnProperty.call(req.body, "body"),
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/submit",
    validate(transitionFoundationDocumentSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:edit");
      const updated = await svc.submitForReview(
        companyId,
        req.params.foundationDocumentId as string,
        req.body.expectedRevisionId,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.revision_proposed",
        entityId: updated.id,
        details: { revisionId: updated.latestRevisionId },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/approve",
    validate(transitionFoundationDocumentSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:approve");
      const updated = await svc.approve(
        companyId,
        req.params.foundationDocumentId as string,
        req.body.expectedRevisionId,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.revision_approved",
        entityId: updated.id,
        details: {
          revisionId: updated.approvedRevisionId,
          foundationKey: updated.foundationKey,
        },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/reject",
    validate(transitionFoundationDocumentSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:approve");
      const updated = await svc.rejectReview(
        companyId,
        req.params.foundationDocumentId as string,
        req.body.expectedRevisionId,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.revision_rejected",
        entityId: updated.id,
        details: { revisionId: updated.latestRevisionId },
      });
      res.json(updated);
    },
  );

  router.post("/companies/:companyId/foundation/:foundationDocumentId/archive", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    assertBoard(req);
    await assertFoundationPermission(req, companyId, "foundation:approve");
    const updated = await svc.archive(
      companyId,
      req.params.foundationDocumentId as string,
      boardMutationActor(req),
    );
    await audit(req, {
      companyId,
      action: "foundation.document_archived",
      entityId: updated.id,
      details: { approvedRevisionId: updated.approvedRevisionId },
    });
    res.json(updated);
  });

  router.get(
    "/companies/:companyId/foundation/:foundationDocumentId/proposals",
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:read");
      const foundation = await svc.get(companyId, req.params.foundationDocumentId as string,req.actor);
      if (!foundation) {
        res.status(404).json({ error: "Foundation document not found" });
        return;
      }
      res.json(await svc.listProposals(companyId, foundation.id,req.actor));
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/proposals",
    validate(createFoundationChangeProposalSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      await assertFoundationPermission(req, companyId, "foundation:propose");
      if (req.actor.type !== "board" && req.actor.type !== "agent") {
        throw unauthorized("Authentication required");
      }
      const proposal = await svc.createProposal(
        companyId,
        req.params.foundationDocumentId as string,
        req.body,
        proposalActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.proposal_created",
        entityType: "foundation_change_proposal",
        entityId: proposal.id,
        details: {
          proposalId: proposal.id,
          sourceType: proposal.sourceType,
          baseRevisionId: proposal.baseRevisionId,
        },
      });
      res.status(201).json(proposal);
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/proposals/:proposalId/accept",
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:edit");
      const result = await svc.acceptProposal(
        companyId,
        req.params.foundationDocumentId as string,
        req.params.proposalId as string,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.proposal_accepted",
        entityType: "foundation_change_proposal",
        entityId: result.proposal.id,
        details: {
          foundationDocumentId: result.foundation.id,
          revisionId: result.foundation.latestRevisionId,
        },
      });
      res.json(result);
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/proposals/:proposalId/reject",
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertBoard(req);
      await assertFoundationPermission(req, companyId, "foundation:edit");
      const proposal = await svc.rejectProposal(
        companyId,
        req.params.foundationDocumentId as string,
        req.params.proposalId as string,
        boardMutationActor(req),
      );
      await audit(req, {
        companyId,
        action: "foundation.proposal_rejected",
        entityType: "foundation_change_proposal",
        entityId: proposal.id,
        details: { foundationDocumentId: proposal.foundationDocumentId },
      });
      res.json(proposal);
    },
  );

  return router;
}
