import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { attachSkillEvalObservationSchema, createSkillEvalRunSchema, createSkillEvalSuiteSchema, replaceSkillEvalSuiteSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { skillEvaluationService } from "../services/skill-evaluations.js";
import { assertCompanyAccess } from "./authz.js";

export function skillEvaluationRoutes(db: Db) {
  const router = Router(), svc = skillEvaluationService(db), base = "/companies/:companyId/skills/:skillId/evaluations";
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await svc.list(req.actor, req.params.companyId as string, req.params.skillId as string)); });
  router.post(`${base}/suites`, validate(createSkillEvalSuiteSchema), async (req, res) => { res.status(201).json(await svc.createSuite(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  router.get(`${base}/suites/:suiteId`, async (req, res) => { res.json(await svc.getSuite(req.actor, req.params.companyId as string, req.params.skillId as string, req.params.suiteId as string)); });
  router.post(`${base}/suites/:suiteId/replace`, validate(replaceSkillEvalSuiteSchema), async (req, res) => { res.status(201).json(await svc.replaceSuite(req.actor, req.params.companyId as string, req.params.skillId as string, req.params.suiteId as string, req.body)); });
  router.post(`${base}/runs`, validate(createSkillEvalRunSchema), async (req, res) => { res.status(201).json(await svc.start(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  router.post(`${base}/runs/:evalRunId/observations`, validate(attachSkillEvalObservationSchema), async (req, res) => { res.json(await svc.observe(req.actor, req.params.companyId as string, req.params.skillId as string, req.params.evalRunId as string, req.body)); });
  return router;
}
