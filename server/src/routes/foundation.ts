import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createFoundationChangeProposalSchema,
  createFoundationDocumentSchema,
  transitionFoundationDocumentSchema,
  updateFoundationDraftSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden, notFound, unauthorized } from "../errors.js";
import {
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

  async function audit(req: Request, input: {
    companyId: string;
    action: string;
    entityId: string;
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
      entityType: "foundation_document",
      entityId: input.entityId,
      details: input.details ?? null,
    });
  }

  router.get("/companies/:companyId/foundation", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    res.json(await svc.list(companyId));
  });

  router.post(
    "/companies/:companyId/foundation",
    validate(createFoundationDocumentSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
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

  router.get("/companies/:companyId/foundation/:foundationDocumentId", async (req, res) => {
    await assertFoundationEnabled();
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const result = await svc.get(companyId, req.params.foundationDocumentId as string);
    if (!result) {
      res.status(404).json({ error: "Foundation document not found" });
      return;
    }
    res.json(result);
  });

  router.patch(
    "/companies/:companyId/foundation/:foundationDocumentId/draft",
    validate(updateFoundationDraftSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
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
      assertCompanyAccess(req, companyId);
      assertBoard(req);
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
      assertCompanyAccess(req, companyId);
      assertBoard(req);
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
      assertCompanyAccess(req, companyId);
      assertBoard(req);
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
    assertCompanyAccess(req, companyId);
    assertBoard(req);
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
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const foundation = await svc.get(companyId, req.params.foundationDocumentId as string);
      if (!foundation) {
        res.status(404).json({ error: "Foundation document not found" });
        return;
      }
      res.json(await svc.listProposals(companyId, foundation.id));
    },
  );

  router.post(
    "/companies/:companyId/foundation/:foundationDocumentId/proposals",
    validate(createFoundationChangeProposalSchema),
    async (req, res) => {
      await assertFoundationEnabled();
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
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
        entityId: proposal.foundationDocumentId,
        details: {
          proposalId: proposal.id,
          sourceType: proposal.sourceType,
          baseRevisionId: proposal.baseRevisionId,
        },
      });
      res.status(201).json(proposal);
    },
  );

  return router;
}
