import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { businessEventBackfillSchema, businessEventExportSchema, businessEventListSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { businessEventService } from "../services/business-events.js";
import { businessEventExportService } from "../services/business-event-export.js";
import { badRequest, conflict } from "../errors.js";
import { assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

export function businessEventRoutes(db: Db) {
  const router = Router();
  const service = businessEventService(db);
  function company(req: Request) {
    const parsed = z.string().uuid().safeParse(req.params.companyId);
    if (!parsed.success) throw badRequest("Invalid company identity");
    if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    assertCompanyAccess(req, parsed.data); return parsed.data;
  }
  router.use("/companies/:companyId/business-events", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/business-events", async (req, res) => {
    const companyId = company(req);
    const { cursorAt, cursorId, expectedUserId: _expectedUserId, ...filters } = req.query;
    const parsed = businessEventListSchema.safeParse({ ...filters, cursor: cursorAt || cursorId ? { at: cursorAt, id: cursorId } : undefined });
    if (!parsed.success) throw badRequest("Invalid business event query", parsed.error.issues);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.list(companyId, req.actor, parsed.data));
  });
  router.post("/companies/:companyId/business-events/backfill", validate(businessEventBackfillSchema), async (req, res) => {
    const companyId = company(req);
    res.json(await service.backfill(companyId, req.actor, req.body));
  });
  router.post("/companies/:companyId/business-events/export", validate(businessEventExportSchema), async (req, res) => {
    res.json(await businessEventExportService(db).exportPage(company(req),req.actor,req.body));
  });
  router.delete("/companies/:companyId/business-events/sources/:sourceRef", async (req, res) => {
    const companyId = company(req);
    assertInstanceAdmin(req);
    const source = z.string().uuid().safeParse(req.params.sourceRef);
    if (!source.success) throw badRequest("Invalid business event source");
    res.json(await service.suppressSource(companyId, req.actor, source.data));
  });
  return router;
}
