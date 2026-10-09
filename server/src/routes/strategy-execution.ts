import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createStrategyExecutionLinkSchema, reviseStrategyExecutionLinkSchema, approveStrategyExecutionLinkSchema, retireStrategyExecutionLinkSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { strategyExecutionService } from "../services/strategy-execution/service.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
function id(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest("Invalid strategy link identity"); return parsed.data;
}
function companyAccess(req: Request) {
  const companyId = id(req.params.companyId);
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId); return companyId;
}
export function strategyExecutionRoutes(db: Db) {
  const router = Router(); const service = strategyExecutionService(db);
  const base = "/companies/:companyId/strategy-execution-links";
  router.use(base, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/strategy-execution-links", async (req, res) => {
    const companyId = companyAccess(req);
    if (Object.keys(req.query).some(key => key !== "cursor" && key !== "expectedUserId")) throw badRequest("Unknown strategy list filter");
    res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor)));
  });
  router.get("/companies/:companyId/strategy-execution-links/:linkId", async (req, res) => { res.json(await service.detail(companyAccess(req), req.actor, id(req.params.linkId))); });
  router.post("/companies/:companyId/strategy-execution-links", validate(createStrategyExecutionLinkSchema), async (req, res) => { res.status(201).json(await service.create(companyAccess(req), req.actor, req.body)); });
  router.post("/companies/:companyId/strategy-execution-links/:linkId/versions", validate(reviseStrategyExecutionLinkSchema), async (req, res) => { res.status(201).json(await service.revise(companyAccess(req), req.actor, id(req.params.linkId), req.body)); });
  router.post("/companies/:companyId/strategy-execution-links/:linkId/approve", validate(approveStrategyExecutionLinkSchema), async (req, res) => { res.json(await service.approve(companyAccess(req), req.actor, id(req.params.linkId), req.body)); });
  router.post("/companies/:companyId/strategy-execution-links/:linkId/retire", validate(retireStrategyExecutionLinkSchema), async (req, res) => { res.json(await service.retire(companyAccess(req), req.actor, id(req.params.linkId), req.body)); });
  return router;
}
