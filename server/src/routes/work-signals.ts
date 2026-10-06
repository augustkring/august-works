import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { workSignalExtractSchema, workSignalDecisionSchema } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { workSignalService } from "../services/work-signals/work-signal-service.js";
export function workSignalRoutes(db: Db) {
  const router = Router(), service = workSignalService(db);
  router.get("/companies/:companyId/work-signals", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.list(req.actor, companyId)); });
  router.post("/companies/:companyId/work-signals/extract", validate(workSignalExtractSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.extract(req.actor, companyId, req.body.issueId)); });
  for (const action of ["apply", "ignore", "review"] as const) router.post(`/companies/:companyId/work-signals/:id/${action}`, validate(workSignalDecisionSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.decide(req.actor, companyId, req.params.id as string, action, req.body)); });
  return router;
}
