import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { crossProjectPlanningProfileSchema, portfolioPlanningProfileSchema, proposeCrossProjectPlanningSchema, proposeInitiativePlanningSchema, reviewCrossProjectPlanningSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
import { crossProjectPlanningService } from "../services/adaptive-planning/cross-project.js";
import { portfolioPlanningService } from "../services/adaptive-planning/portfolio.js";
import { initiativePlanningService } from "../services/adaptive-planning/initiative-owner.js";
function id(raw: unknown) { const parsed = z.string().uuid().safeParse(raw); if (!parsed.success) throw badRequest("Invalid cross-project native reference"); return parsed.data; }
function access(req: Request, cursor = false, search = false) {
  if (Object.keys(req.query).some(key => key !== "expectedUserId" && !(cursor && key === "cursor") && !(search && key === "q"))) throw badRequest("Unknown cross-project planning query");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId); return companyId;
}
export function crossProjectPlanningRoutes(db: Db) {
  const router = Router(), service = crossProjectPlanningService(db), base = "/companies/:companyId/adaptive-planning";
  router.use(base, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get(`${base}/source-options`, async (req, res) => { const companyId = access(req, false, true), q = z.string().trim().max(120).optional().parse(req.query.q); res.json(await service.sourceOptions(companyId, req.actor, q)); });
  router.post(`${base}/preview`, validate(crossProjectPlanningProfileSchema), async (req, res) => { res.json(await service.preview(access(req), req.actor, req.body)); });
  router.post(`${base}/initiatives/preview`, validate(portfolioPlanningProfileSchema), async (req, res) => { res.json(await portfolioPlanningService(db).preview(access(req), req.actor, req.body)); });
  router.post(`${base}/initiatives/proposals`, validate(proposeInitiativePlanningSchema), async (req, res) => { res.status(201).json(await initiativePlanningService(db).propose(access(req), req.actor, req.body)); });
  router.get(`${base}/initiatives/controls`, async (req, res) => { res.json(await initiativePlanningService(db).controls(access(req, true), req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get(`${base}/initiatives/proposals/:proposalId`, async (req, res) => { res.json(await initiativePlanningService(db).detail(access(req), req.actor, id(req.params.proposalId))); });
  router.post(`${base}/initiatives/proposals/:proposalId/review`, validate(reviewCrossProjectPlanningSchema), async (req, res) => { res.json(await initiativePlanningService(db).review(access(req), req.actor, id(req.params.proposalId), req.body)); });
  router.post(`${base}/proposals`, validate(proposeCrossProjectPlanningSchema), async (req, res) => { res.status(201).json(await service.propose(access(req), req.actor, req.body)); });
  router.get(`${base}/controls`, async (req, res) => { res.json(await service.controls(access(req, true), req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get(`${base}/proposals/:proposalId`, async (req, res) => { res.json(await service.detail(access(req), req.actor, id(req.params.proposalId))); });
  router.post(`${base}/proposals/:proposalId/review`, validate(reviewCrossProjectPlanningSchema), async (req, res) => { res.json(await service.review(access(req), req.actor, id(req.params.proposalId), req.body)); });
  return router;
}
