import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { cognitiveBindingSchema, cognitiveReconcileSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { cognitiveMemoryService } from "../services/memory/cognitive-memory.js";
export function cognitiveMemoryRoutes(db: Db) {
  const router = Router(), service = cognitiveMemoryService(db);
  router.get("/companies/:companyId/memory/cognitive/status", async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.status(req.actor, companyId));
  });
  router.post("/companies/:companyId/memory/cognitive/bindings", validate(cognitiveBindingSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.status(201).json(await service.createBinding(req.actor, companyId, req.body));
  });
  router.post("/companies/:companyId/memory/cognitive/reconcile", validate(cognitiveReconcileSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.reconcile(req.actor, companyId, req.body.bindingId));
  });
  return router;
}
