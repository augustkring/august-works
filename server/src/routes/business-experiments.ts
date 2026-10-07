import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createBusinessExperimentSchema, amendBusinessExperimentSchema, transitionBusinessExperimentSchema, startBusinessExperimentSchema, assignBusinessExperimentUnitSchema, recordBusinessExperimentExposureSchema, controlBusinessExperimentExecutionSchema, analyzeBusinessExperimentSchema, interpretBusinessExperimentSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
import { businessExperimentService } from "../services/business-experiments/service.js";
import { businessExperimentRecordingService } from "../services/business-experiments/recording.js";
import { businessExperimentAnalysisService } from "../services/business-experiments/analysis.js";
function id(value: unknown) { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw badRequest("Invalid experiment identity"); return parsed.data; }
function companyAccess(req: Request, companyId: string, allowed: string[] = []) {
  if (Object.keys(req.query).some(key => key !== "expectedUserId" && !allowed.includes(key))) throw badRequest("Unknown experiment query field");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId);
}
export function businessExperimentRoutes(db: Db) {
  const router = Router(), service = businessExperimentService(db), recording = businessExperimentRecordingService(db), analysis = businessExperimentAnalysisService(db);
  router.use("/companies/:companyId/experiments", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/experiments", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId, ["cursor"]); res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get("/companies/:companyId/experiments/:experimentId", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.detail(companyId, req.actor, id(req.params.experimentId))); });
  router.post("/companies/:companyId/experiments", validate(createBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.create(companyId, req.actor, req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/versions", validate(amendBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.amend(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/transition", validate(transitionBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.transition(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/start", validate(startBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await recording.start(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/assignments", validate(assignBusinessExperimentUnitSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await recording.assign(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/exposures", validate(recordBusinessExperimentExposureSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await recording.recordExposure(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/stop", validate(controlBusinessExperimentExecutionSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await recording.control(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.get("/companies/:companyId/experiments/:experimentId/versions/:versionId/receipts", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await recording.receipts(companyId, req.actor, id(req.params.experimentId), id(req.params.versionId))); });
  router.post("/companies/:companyId/experiments/:experimentId/analyze", validate(analyzeBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await analysis.analyze(companyId, req.actor, id(req.params.experimentId), req.body)); });
  router.post("/companies/:companyId/experiments/:experimentId/interpret", validate(interpretBusinessExperimentSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await analysis.interpret(companyId, req.actor, id(req.params.experimentId), req.body)); });
  return router;
}
