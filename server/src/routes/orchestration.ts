import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createOrchestrationPlanSchema, orchestrationDecisionSchema, supervisionInterventionSchema, verificationReviewSchema, trajectoryReviewSchema } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { supervisionService } from "../services/supervision/supervision-service.js";
import { orchestrationRuntimeControl } from "../services/orchestration/orchestration-runtime-control.js";
import { readOrchestrationExperience } from "../services/experience/orchestration-experience.js";
import { ExperienceOverloadError } from "../services/experience/projection.js";
import { z } from "zod";
import { conflict, forbidden } from "../errors.js";
export function orchestrationRoutes(db: Db) {
  const router = Router(), service = orchestrationService(db);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/experience/orchestration", async (req, res) => {
    const companyId = z.uuid().parse(req.params.companyId);
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    assertCompanyAccess(req, companyId);
    if (req.actor.type !== "board" || req.actor.source === "local_implicit" || !req.actor.userId)
      throw forbidden("A verified account is required for current work status");
    if (query.expectedUserId !== req.actor.userId) throw conflict("Account changed; refresh");
    const controller = new AbortController(), close = () => controller.abort();
    req.once("aborted", close); res.once("close", close);
    try { res.json(await readOrchestrationExperience(db, req.actor, companyId, controller.signal)); }
    catch (error) { if (error instanceof ExperienceOverloadError) res.status(503).json({ error: "Current work status is unavailable; refresh" }); else throw error; }
    finally { req.removeListener("aborted", close); res.removeListener("close", close); }
  });
  router.get("/companies/:companyId/orchestration/plans", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.list(req.actor, companyId)); });
  router.get("/companies/:companyId/orchestration/plans/:id", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.get(req.actor, companyId, req.params.id as string, true)); });
  router.post("/companies/:companyId/orchestration/plans", validate(createOrchestrationPlanSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.create(req.actor, companyId, req.body)); });
  router.post("/companies/:companyId/orchestration/plans/:id/decisions", validate(orchestrationDecisionSchema), async (req, res) => {
    const companyId = req.params.companyId as string, id = req.params.id as string; assertCompanyAccess(req, companyId);
    const plan = await service.decide(req.actor, companyId, id, req.body), control = orchestrationRuntimeControl(db);
    const runtime = req.body.action === "start" ? await control.dispatch(req.actor, companyId, id) : await control.stop(req.actor, companyId, id, req.body.rationale);
    res.json({ plan, runtime });
  });
  router.get("/companies/:companyId/orchestration/plans/:id/supervision", async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); res.json(await supervisionService(db).get(req.actor,companyId,req.params.id as string)); });
  router.get("/companies/:companyId/orchestration/plans/:id/signals", async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); res.json((await supervisionService(db).get(req.actor,companyId,req.params.id as string)).signals); });
  router.post("/companies/:companyId/orchestration/plans/:id/intervene", validate(supervisionInterventionSchema), async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); const supervisor = supervisionService(db); const result = await supervisor.intervene(req.actor,companyId,req.params.id as string,req.body); res.json({ ...result, delivery: await supervisor.deliverStops(20,companyId) }); });
  router.get("/companies/:companyId/orchestration/plans/:id/verification-packet", async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); const workerId = typeof req.query.workerId === "string" ? req.query.workerId : null; res.json(await verificationService(db).packet(req.actor,companyId,req.params.id as string,workerId)); });
  router.get("/companies/:companyId/orchestration/plans/:id/verifications", async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); res.json(await verificationService(db).list(req.actor,companyId,req.params.id as string)); });
  router.post("/companies/:companyId/orchestration/plans/:id/verify",validate(verificationReviewSchema),async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); res.json(await verificationService(db).review(req.actor,companyId,req.params.id as string,req.body)); });
  router.post("/companies/:companyId/orchestration/plans/:id/trajectory-reviews",validate(trajectoryReviewSchema),async (req,res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req,companyId); res.json(await verificationService(db).trajectory(req.actor,companyId,req.params.id as string,req.body)); });
  return router;
}
