import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createBusinessMetricSchema, createBusinessMetricVersionSchema, publishBusinessMetricSchema, transitionBusinessMetricSchema, queryBusinessMetricSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { businessMetricService } from "../services/business-metrics/service.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
function id(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest("Invalid metric identity"); return parsed.data;
}
function companyAccess(req: Request, companyId: string) {
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string"
    || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId);
}
export function businessMetricRoutes(db: Db) {
  const router = Router(); const service = businessMetricService(db);
  router.use("/companies/:companyId/business-metrics", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/business-metrics", async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    if (Object.keys(req.query).some(key => key !== "cursor" && key !== "expectedUserId")) throw badRequest("Unknown metric list filter");
    res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor)));
  });
  router.get("/companies/:companyId/business-metrics/:metricId", async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.json(await service.detail(companyId, req.actor, id(req.params.metricId)));
  });
  router.post("/companies/:companyId/business-metrics", validate(createBusinessMetricSchema), async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.status(201).json(await service.create(companyId, req.actor, req.body));
  });
  router.post("/companies/:companyId/business-metrics/:metricId/versions", validate(createBusinessMetricVersionSchema), async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.status(201).json(await service.createVersion(companyId, req.actor, id(req.params.metricId), req.body));
  });
  router.post("/companies/:companyId/business-metrics/:metricId/publish", validate(publishBusinessMetricSchema), async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.json(await service.publish(companyId, req.actor, id(req.params.metricId), req.body));
  });
  router.post("/companies/:companyId/business-metrics/:metricId/lifecycle", validate(transitionBusinessMetricSchema), async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.json(await service.transition(companyId, req.actor, id(req.params.metricId), req.body));
  });
  router.post("/companies/:companyId/business-metrics/query", validate(queryBusinessMetricSchema), async (req, res) => {
    const companyId = req.params.companyId as string; companyAccess(req, companyId);
    res.json(await service.query(companyId, req.actor, req.body));
  });
  return router;
}
