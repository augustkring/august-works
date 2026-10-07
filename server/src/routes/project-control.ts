import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { projectPlanningProfileSchema, proposeProjectPlanningSchema, reviewRoadmapProposalSchema, createRoadmapBaselineSchema, updateMilestoneSchema, createMilestoneSchema, roadmapPolicySchema, roadmapProposalSchema, taskForecastPatchSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { projectControlService } from "../services/project-control.js";
import { projectPlanningService } from "../services/adaptive-planning/project-owner.js";
import { badRequest, conflict } from "../errors.js";

function planningId(value: unknown) { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw badRequest("Invalid native planning identity"); return parsed.data; }
function planningAccess(req: Request, cursor = false) {
  if (Object.keys(req.query).some((key) => key !== "expectedUserId" && !(cursor && key === "cursor"))) throw badRequest("Unknown planning query field");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  return { companyId: planningId(req.params.companyId), projectId: planningId(req.params.projectId) };
}

export function projectControlRoutes(db: Db) {
  const router = Router(), svc = projectControlService(db), base = "/companies/:companyId/projects/:projectId/roadmap";
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  const planning = projectPlanningService(db);
  router.use(`${base}/planning`, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/projects/:projectId/roadmap/planning/controls", async (req, res) => { const { companyId, projectId } = planningAccess(req, true); res.json(await planning.controls(companyId, projectId, req.actor, req.query.cursor === undefined ? undefined : planningId(req.query.cursor))); });
  router.post("/companies/:companyId/projects/:projectId/roadmap/planning/preview", validate(projectPlanningProfileSchema), async (req, res) => { const { companyId, projectId } = planningAccess(req); res.json(await planning.preview(companyId, projectId, req.actor, req.body)); });
  router.post("/companies/:companyId/projects/:projectId/roadmap/planning/proposals", validate(proposeProjectPlanningSchema), async (req, res) => { const { companyId, projectId } = planningAccess(req); res.status(201).json(await planning.propose(companyId, projectId, req.actor, req.body)); });
  router.get("/companies/:companyId/projects/:projectId/roadmap/planning/proposals/:proposalId", async (req, res) => { const { companyId, projectId } = planningAccess(req); res.json(await planning.detail(companyId, projectId, req.actor, planningId(req.params.proposalId))); });
  router.get(base, async (req, res) => { res.json(await svc.get(req.actor, req.params.companyId as string, req.params.projectId as string)); });
  router.put(`${base}/policy`, validate(roadmapPolicySchema), async (req, res) => { res.json(await svc.policy(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.post(`${base}/milestones`, validate(createMilestoneSchema), async (req, res) => { res.status(201).json(await svc.createMilestone(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.patch(`${base}/milestones/:milestoneId`, validate(updateMilestoneSchema), async (req, res) => { res.json(await svc.updateMilestone(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.milestoneId as string, req.body)); });
  router.post(`${base}/baselines`, validate(createRoadmapBaselineSchema), async (req, res) => { res.status(201).json(await svc.baseline(req.actor, req.params.companyId as string, req.params.projectId as string, req.body.name)); });
  router.post(`${base}/proposals`, validate(roadmapProposalSchema), async (req, res) => { res.status(201).json(await svc.propose(req.actor, req.params.companyId as string, req.params.projectId as string, req.body)); });
  router.post(`${base}/proposals/:proposalId/review`, validate(reviewRoadmapProposalSchema), async (req, res) => { res.json(await svc.review(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.proposalId as string, req.body.accept, req.body.rationale)); });
  router.patch(`${base}/tasks/:issueId/forecast`, validate(taskForecastPatchSchema), async (req, res) => { res.json(await svc.forecast(req.actor, req.params.companyId as string, req.params.projectId as string, req.params.issueId as string, req.body)); });
  return router;
}
