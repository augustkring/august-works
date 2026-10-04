import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { updateMilestoneSchema, createMilestoneSchema, roadmapPolicySchema, roadmapProposalSchema, taskForecastPatchSchema } from "@paperclipai/shared";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { projectControlService } from "../services/project-control.js";

export function projectControlRoutes(db: Db) {
  const router = Router(), svc = projectControlService(db), base = "/companies/:companyId/projects/:projectId/roadmap";
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await svc.get(req.actor, req.params.companyId as string, req.params.projectId as string)); });
  router.put(`${base}/policy`, validate(roadmapPolicySchema), async (req, res) => { res.json(await svc.policy(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.post(`${base}/milestones`, validate(createMilestoneSchema), async (req, res) => { res.status(201).json(await svc.createMilestone(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.patch(`${base}/milestones/:milestoneId`, validate(updateMilestoneSchema), async (req, res) => { res.json(await svc.updateMilestone(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.milestoneId as string, req.body)); });
  router.post(`${base}/baselines`, validate(z.object({ name: z.string().trim().min(1).max(200) }).strict()), async (req, res) => { res.status(201).json(await svc.baseline(req.actor, req.params.companyId as string, req.params.projectId as string, req.body.name)); });
  router.post(`${base}/proposals`, validate(roadmapProposalSchema), async (req, res) => { res.status(201).json(await svc.propose(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.post(`${base}/proposals/:proposalId/review`, validate(z.object({ accept: z.boolean(), rationale: z.string().trim().min(10).max(4000) }).strict()), async (req, res) => { res.json(await svc.review(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.proposalId as string, req.body.accept, req.body.rationale)); });
  router.patch(`${base}/tasks/:issueId/forecast`, validate(taskForecastPatchSchema), async (req, res) => { res.json(await svc.forecast(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.issueId as string, req.body)); });
  return router;
}
