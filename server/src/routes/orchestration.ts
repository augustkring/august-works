import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createOrchestrationPlanSchema, orchestrationDecisionSchema } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { orchestrationRuntimeControl } from "../services/orchestration/orchestration-runtime-control.js";
export function orchestrationRoutes(db: Db) {
  const router = Router(), service = orchestrationService(db);
  router.get("/companies/:companyId/orchestration/plans", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.list(req.actor, companyId)); });
  router.get("/companies/:companyId/orchestration/plans/:id", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.get(req.actor, companyId, req.params.id as string)); });
  router.post("/companies/:companyId/orchestration/plans", validate(createOrchestrationPlanSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.create(req.actor, companyId, req.body)); });
  router.post("/companies/:companyId/orchestration/plans/:id/decisions", validate(orchestrationDecisionSchema), async (req, res) => {
    const companyId = req.params.companyId as string, id = req.params.id as string; assertCompanyAccess(req, companyId);
    const plan = await service.decide(req.actor, companyId, id, req.body), control = orchestrationRuntimeControl(db);
    const runtime = req.body.action === "start" ? await control.dispatch(req.actor, companyId, id) : await control.stop(req.actor, companyId, id, req.body.rationale);
    res.json({ plan, runtime });
  });
  return router;
}
