import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { managementReviewDefinitionSchema, publishManagementReviewSchema, recordManagementReviewEventSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
import { managementReviewService } from "../services/management-reviews/service.js";
function id(raw: unknown) { const value = z.string().uuid().safeParse(raw); if (!value.success) throw badRequest("Invalid native management review reference"); return value.data; }
function access(req: Request, cursor = false) { const companyId = id(req.params.companyId); if (Object.keys(req.query).some(key => key !== "expectedUserId" && !(cursor && key === "cursor"))) throw badRequest("Unknown management review query field"); if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" }); assertCompanyAccess(req, companyId); return companyId; }
export function managementReviewRoutes(db: Db) {
  const router = Router(), service = managementReviewService(db), base = "/companies/:companyId/management-reviews";
  router.use(base, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/management-reviews/controls", async (req, res) => { const companyId = access(req, true); res.json(await service.controls(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get("/companies/:companyId/management-reviews/:reviewId", async (req, res) => { const companyId = access(req); res.json(await service.detail(companyId, req.actor, id(req.params.reviewId))); });
  router.post("/companies/:companyId/management-reviews", validate(managementReviewDefinitionSchema), async (req, res) => { const companyId = access(req); res.status(201).json(await service.create(companyId, req.actor, req.body)); });
  router.post("/companies/:companyId/management-reviews/:reviewId/publish", validate(publishManagementReviewSchema), async (req, res) => { const companyId = access(req); res.json(await service.publish(companyId, req.actor, id(req.params.reviewId), req.body)); });
  router.post("/companies/:companyId/management-reviews/:reviewId/events", validate(recordManagementReviewEventSchema), async (req, res) => { const companyId = access(req); res.status(201).json(await service.recordEvent(companyId, req.actor, id(req.params.reviewId), req.body)); });
  return router;
}
