import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createObservationSchema, createMemoryModelSchema, derivedReviewSchema, rebuildMemoryModelSchema } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { derivedMemoryService } from "../services/memory/derived-memory.js";
export function derivedMemoryRoutes(db: Db) {
  const router = Router(), service = derivedMemoryService(db);
  router.get("/companies/:companyId/memory/observations", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.listObservations(req.actor, companyId)); });
  router.post("/companies/:companyId/memory/observations", validate(createObservationSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.createObservation(req.actor, companyId, req.body)); });
  router.get("/companies/:companyId/memory/observations/:id", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.getObservation(req.actor, companyId, req.params.id as string)); });
  for (const decision of ["accept", "reject", "revoke"] as const) router.post(`/companies/:companyId/memory/observations/:id/${decision}`, validate(derivedReviewSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.reviewObservation(req.actor, companyId, req.params.id as string, decision, req.body)); });
  router.get("/companies/:companyId/memory/models", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.listModels(req.actor, companyId)); });
  router.post("/companies/:companyId/memory/models", validate(createMemoryModelSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.createModel(req.actor, companyId, req.body)); });
  router.get("/companies/:companyId/memory/models/:id", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.getModel(req.actor, companyId, req.params.id as string)); });
  for (const decision of ["accept", "revoke"] as const) router.post(`/companies/:companyId/memory/models/:id/${decision}`, validate(derivedReviewSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.reviewModel(req.actor, companyId, req.params.id as string, decision, req.body)); });
  router.post("/companies/:companyId/memory/models/:id/rebuild", validate(rebuildMemoryModelSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(202).json(await service.rebuildModel(req.actor, companyId, req.params.id as string, req.body)); });
  return router;
}
