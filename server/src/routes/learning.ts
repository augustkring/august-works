import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { learningCycleSchema, learningHypothesisSchema, learningEvaluationSchema, learningChangeSchema, proposeLearningChangeSchema, reviewLearningPolicySchema } from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { learningService } from "../services/learning/learning-service.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { assertDerivedManager } from "../services/memory/derived-memory.js";
import { assertV7Enabled } from "../services/v7-authorization.js";
export function learningRoutes(db: Db) {
  const router = Router(), service = learningService(db);
  router.post("/companies/:companyId/learning/prepare-change", validate(learningChangeSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); await assertV7Enabled(db, "learning_engine_v7"); await assertDerivedManager(db, req.actor, companyId); res.json({ change: req.body, hash: nativeSha256(req.body) }); });
  router.get("/companies/:companyId/learning/cycles", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.list(req.actor, companyId)); });
  router.get("/companies/:companyId/learning/policy-proposals", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.policies(req.actor, companyId)); });
  router.post("/companies/:companyId/learning/cycles", validate(learningCycleSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.create(req.actor, companyId, req.body)); });
  router.get("/companies/:companyId/learning/cycles/:id", async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.get(req.actor, companyId, req.params.id as string)); });
  router.post("/companies/:companyId/learning/cycles/:id/hypotheses", validate(learningHypothesisSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.addHypothesis(req.actor, companyId, req.params.id as string, req.body)); });
  router.post("/companies/:companyId/learning/hypotheses/:id/evaluations", validate(learningEvaluationSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.evaluate(req.actor, companyId, req.params.id as string, req.body)); });
  router.post("/companies/:companyId/learning/hypotheses/:id/propose-change", validate(proposeLearningChangeSchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.proposeChange(req.actor, companyId, req.params.id as string, req.body)); });
  router.post("/companies/:companyId/learning/policy-proposals/:id/review", validate(reviewLearningPolicySchema), async (req, res) => { const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.reviewPolicy(req.actor, companyId, req.params.id as string, req.body)); });
  return router;
}
