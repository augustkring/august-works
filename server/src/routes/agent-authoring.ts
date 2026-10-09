import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
} from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict, unprocessable } from "../errors.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { validate } from "../middleware/validate.js";

export function agentAuthoringRoutes(db: Db) {
  const router = Router(),
    service = agentAuthoringService(db);
  function company(req: Request) {
    assertBoard(req);
    const id = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, id);
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== req.actor.userId
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    return id;
  }
  const root = "/companies/:companyId/agent-configuration-drafts";
  router.use(root, (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.get(root, async (req, res) =>
    res.json(
      await service.list(
        req.actor,
        company(req),
        req.query.before === undefined
          ? undefined
          : z.uuid().parse(req.query.before),
      ),
    ),
  );
  router.get(`${root}/options`, async (req, res) =>
    res.json(
      await service.options(
        req.actor,
        company(req),
        req.query.agentId === undefined
          ? null
          : z.uuid().parse(req.query.agentId),
      ),
    ),
  );
  router.get(`${root}/hire-catalog`, async (req, res) =>
    res.json(await service.hireCatalog(req.actor, company(req))),
  );
  router.post(root, validate(agentDraftCreateSchema), async (req, res) =>
    res
      .status(201)
      .json(await service.create(req.actor, company(req), req.body)),
  );
  router.get(`${root}/:id`, async (req, res) =>
    res.json(
      await service.get(req.actor, company(req), z.uuid().parse(req.params.id)),
    ),
  );
  router.post(
    `${root}/:id/save`,
    validate(agentDraftSaveSchema),
    async (req, res) =>
      res.json(
        await service.save(
          req.actor,
          company(req),
          z.uuid().parse(req.params.id),
          req.body,
        ),
      ),
  );
  router.post(
    `${root}/:id/discard`,
    validate(agentDraftDiscardSchema),
    async (req, res) =>
      res.json(
        await service.discard(
          req.actor,
          company(req),
          z.uuid().parse(req.params.id),
          req.body,
        ),
      ),
  );
  router.get(`${root}/:id/review`, async (req, res) =>
    res.json(
      await service.review(
        req.actor,
        company(req),
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.post(`${root}/:id/publish`, async (req) => {
    const review = await service.review(
      req.actor,
      company(req),
      z.uuid().parse(req.params.id),
    );
    throw unprocessable(
      "Agent publishing is blocked by current qualification",
      {
        code: "draft_publish_unqualified",
        version: review.version,
        blockers: review.blockers,
      },
    );
  });
  return router;
}
