import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createBusinessMetricTargetSchema, reviseBusinessMetricTargetSchema, approveBusinessMetricTargetSchema, retireBusinessMetricTargetSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { businessMetricTargetService } from "../services/business-metrics/targets.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
function id(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest("Invalid target identity"); return parsed.data;
}
function companyAccess(req: Request) {
  const companyId = id(req.params.companyId);
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId); return companyId;
}
export function businessMetricTargetRoutes(db: Db) {
  const router = Router(); const service = businessMetricTargetService(db);
  const base = "/companies/:companyId/business-metric-targets";
  router.use(base, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/business-metric-targets", async (req, res) => {
    const companyId = companyAccess(req);
    if (Object.keys(req.query).some(key => key !== "cursor" && key !== "expectedUserId")) throw badRequest("Unknown target list filter");
    res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor)));
  });
  router.get("/companies/:companyId/business-metric-targets/:targetId", async (req, res) => { res.json(await service.detail(companyAccess(req), req.actor, id(req.params.targetId))); });
  router.post("/companies/:companyId/business-metric-targets", validate(createBusinessMetricTargetSchema), async (req, res) => { res.status(201).json(await service.create(companyAccess(req), req.actor, req.body)); });
  router.post("/companies/:companyId/business-metric-targets/:targetId/versions", validate(reviseBusinessMetricTargetSchema), async (req, res) => { res.status(201).json(await service.revise(companyAccess(req), req.actor, id(req.params.targetId), req.body)); });
  router.post("/companies/:companyId/business-metric-targets/:targetId/approve", validate(approveBusinessMetricTargetSchema), async (req, res) => { res.json(await service.approve(companyAccess(req), req.actor, id(req.params.targetId), req.body)); });
  router.post("/companies/:companyId/business-metric-targets/:targetId/retire", validate(retireBusinessMetricTargetSchema), async (req, res) => { res.json(await service.retire(companyAccess(req), req.actor, id(req.params.targetId), req.body)); });
  router.post("/companies/:companyId/business-metric-targets/:targetId/compare", validate(z.object({}).strict()), async (req, res) => { res.json(await service.compare(companyAccess(req), req.actor, id(req.params.targetId))); });
  return router;
}
