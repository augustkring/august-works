import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { FEEDBACK_CONTACTS } from "@paperclipai/shared";
import { assertBoard, hasCompanyAccess } from "./authz.js";
import { badRequest, conflict, forbidden } from "../errors.js";
import { customerFeedbackService } from "../services/customer-feedback.js";

export function customerFeedbackRoutes(
  db: Db,
  options: { operatorUserIds?: readonly string[] } = {},
) {
  const router = Router(),
    service = customerFeedbackService(db, options);
  function identity(req: Request) {
    assertBoard(req);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
  }
  function context(req: Request) {
    identity(req);
    const id = z.uuid().safeParse(req.params.companyId);
    if (!id.success) throw badRequest("Invalid company ID");
    // Actor-owned feedback is not a company-work mutation. Viewers may submit
    // their own feedback; native current-read membership is checked in service.
    if (!hasCompanyAccess(req, id.data))
      throw forbidden("Company access required");
    return id.data;
  }
  const feedbackId = (req: Request) => z.uuid().parse(req.params.feedbackId);
  router.get("/customer-feedback/policy", (_req, res) =>
    res.json({
      contacts: FEEDBACK_CONTACTS,
      attachments: {
        enabled: false,
        reason: "scanner_qualification_required",
        types: ["image/png", "image/jpeg", "image/webp"],
        maxFiles: 3,
        maxBytes: 10485760,
      },
      retention: { status: "owner_decision_required" },
    }),
  );
  router.get("/companies/:companyId/customer-feedback", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(
      await service.list(
        req.actor,
        context(req),
        z.uuid().optional().parse(req.query.before),
      ),
    );
  });
  router.get(
    "/companies/:companyId/customer-feedback/:feedbackId",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(await service.get(req.actor, context(req), feedbackId(req)));
    },
  );
  router.post("/companies/:companyId/customer-feedback", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res
      .status(201)
      .json(await service.create(req.actor, context(req), req.body));
  });
  router.post(
    "/companies/:companyId/customer-feedback/:feedbackId/follow-up",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.followUp(
          req.actor,
          context(req),
          feedbackId(req),
          req.body,
        ),
      );
    },
  );
  // Explicit platform operator admission lives in service; no company-admin bypass.
  router.get("/internal/customer-feedback/:companyId", async (req, res) => {
    identity(req);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(
      await service.internalList(
        req.actor,
        z.uuid().parse(req.params.companyId),
        z.uuid().optional().parse(req.query.before),
      ),
    );
  });
  router.get(
    "/internal/customer-feedback/:companyId/:feedbackId",
    async (req, res) => {
      identity(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.internalGet(
          req.actor,
          z.uuid().parse(req.params.companyId),
          feedbackId(req),
          z.uuid().optional().parse(req.query.beforeEvent),
        ),
      );
    },
  );
  router.post(
    "/internal/customer-feedback/:companyId/:feedbackId/triage",
    async (req, res) => {
      identity(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.triage(
          req.actor,
          z.uuid().parse(req.params.companyId),
          feedbackId(req),
          req.body,
        ),
      );
    },
  );
  return router;
}
