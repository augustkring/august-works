import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createGovernedSkillSchema, skillCandidateInputSchema, skillLifecycleTransitionSchema, skillPromotionInputSchema, updateSkillGovernanceSchema } from "@paperclipai/shared";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { assertCompanyAccess } from "./authz.js";

export function skillLifecycleRoutes(db: Db) {
  const router = Router(), svc = skillLifecycleService(db), base = "/companies/:companyId/skills/:skillId/lifecycle";
  router.post("/companies/:companyId/skills/governed-drafts", validate(createGovernedSkillSchema), async (req, res) => { assertCompanyAccess(req, req.params.companyId as string); res.status(201).json(await svc.createDraft(req.actor, req.params.companyId as string, req.body)); });
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await svc.get(req.actor, req.params.companyId as string, req.params.skillId as string)); });
  router.patch(`${base}/governance`, validate(updateSkillGovernanceSchema), async (req, res) => { res.json(await svc.governance(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  router.post(`${base}/candidates`, validate(skillCandidateInputSchema), async (req, res) => { res.status(201).json(await svc.propose(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  router.post(`${base}/candidates/:versionId/submit`, async (req, res) => { res.json(await svc.submitCandidate(req.actor, req.params.companyId as string, req.params.skillId as string, req.params.versionId as string)); });
  router.post(`${base}/candidates/:versionId/overlap-review`, validate(z.object({ rationale: z.string().trim().min(20).max(4000) }).strict()), async (req, res) => { res.json(await svc.reviewOverlap(req.actor, req.params.companyId as string, req.params.skillId as string, req.params.versionId as string, req.body.rationale)); });
  router.post(`${base}/transition`, validate(skillLifecycleTransitionSchema), async (req, res) => { res.json(await svc.transition(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  router.post(`${base}/promote`, validate(skillPromotionInputSchema), async (req, res) => { res.json(await svc.promote(req.actor, req.params.companyId as string, req.params.skillId as string, req.body)); });
  return router;
}
