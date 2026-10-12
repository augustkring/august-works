import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
  agentDraftPrepareSchema,
  agentDraftTestCommandSchema,
  verificationReviewSchema,
  agentDraftPublicationCommandSchema,
} from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { agentAuthoringTestService } from "../services/agents/authoring-tests.js";
import { agentAuthoringPublicationService } from "../services/agents/authoring-publication.js";
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
  router.get(`${root}/admission`, async (req, res) =>
    res.json(
      await service.admission(
        req.actor,
        company(req),
        req.query.agentId === undefined
          ? null
          : z.uuid().parse(req.query.agentId),
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
  router.get(`${root}/:id/preparation-review`, async (req, res) => res.json(
    await service.preparationReview(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/runtime`, async (req, res) => res.json(
    await service.runtime(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.post(`${root}/:id/prepare`, validate(agentDraftPrepareSchema), async (req, res) => res.json(
    await service.prepare(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.get(`${root}/:id/test-review`, async (req, res) => res.json(
    await agentAuthoringTestService(db).review(req.actor, company(req), z.uuid().parse(req.params.id), z.coerce.number().int().min(0).max(9).parse(req.query.scenarioIndex)),
  ));
  router.get(`${root}/:id/tests`, async (req, res) => res.json(
    await agentAuthoringTestService(db).list(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/tests/:requestId`, async (req, res) => res.json(
    await agentAuthoringTestService(db).get(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${root}/:id/tests/:requestId/verification-packet`, async (req, res) => res.json(
    await agentAuthoringTestService(db).packet(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.post(`${root}/:id/tests/:requestId/verify`, validate(verificationReviewSchema), async (req, res) => res.json(
    await agentAuthoringTestService(db).verify(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId), req.body),
  ));
  router.post(`${root}/:id/tests`, validate(agentDraftTestCommandSchema), async (req, res) => res.json(
    await agentAuthoringTestService(db).start(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
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
  router.get(`${root}/:id/hire-capability`, async (req, res) =>
    res.json(
      await service.hireCapability(
        req.actor,
        company(req),
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.get(`${root}/:id/publication-review`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).review(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/publications/:requestId`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${root}/:id/publications`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.post(`${root}/:id/publish`, validate(agentDraftPublicationCommandSchema), async (req, res) => res.json(
    await agentAuthoringPublicationService(db).publish(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  return router;
}
