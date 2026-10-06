import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { businessEventBackfillSchema, businessEventListSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { businessEventService } from "../services/business-events.js";
import { badRequest } from "../errors.js";
import { assertCompanyAccess, assertInstanceAdmin } from "./authz.js";

export function businessEventRoutes(db: Db) {
  const router = Router();
  const service = businessEventService(db);
  router.get("/companies/:companyId/business-events", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const { cursorAt, cursorId, ...filters } = req.query;
    const parsed = businessEventListSchema.safeParse({ ...filters, cursor: cursorAt || cursorId ? { at: cursorAt, id: cursorId } : undefined });
    if (!parsed.success) throw badRequest("Invalid business event query", parsed.error.issues);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.list(companyId, req.actor, parsed.data));
  });
  router.post("/companies/:companyId/business-events/backfill", validate(businessEventBackfillSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await service.backfill(companyId, req.actor, req.body));
  });
  router.delete("/companies/:companyId/business-events/sources/:sourceRef", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertInstanceAdmin(req);
    const source = z.string().uuid().safeParse(req.params.sourceRef);
    if (!source.success) throw badRequest("Invalid business event source");
    res.json(await service.suppressSource(companyId, req.actor, source.data));
  });
  return router;
}
