import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createCausalClaimSchema, reviseCausalClaimSchema, reviewCausalClaimSchema, analyzeCausalClaimSchema, revokeCausalClaimSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
import { causalClaimService } from "../services/causal-claims/service.js";
function id(value: unknown) { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw badRequest("Invalid causal claim identity"); return parsed.data; }
function companyAccess(req: Request, companyId: string, allowed: string[] = []) {
  if (Object.keys(req.query).some(key => key !== "expectedUserId" && !allowed.includes(key))) throw badRequest("Unknown causal claim query field");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId);
}
export function causalClaimRoutes(db: Db) {
  const router = Router(), service = causalClaimService(db);
  router.use("/companies/:companyId/causal-claims", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/causal-claims", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId, ["cursor"]); res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get("/companies/:companyId/causal-claims/:claimId", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.detail(companyId, req.actor, id(req.params.claimId))); });
  router.post("/companies/:companyId/causal-claims", validate(createCausalClaimSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.create(companyId, req.actor, req.body)); });
  router.post("/companies/:companyId/causal-claims/:claimId/versions", validate(reviseCausalClaimSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.revise(companyId, req.actor, id(req.params.claimId), req.body)); });
  router.post("/companies/:companyId/causal-claims/:claimId/review", validate(reviewCausalClaimSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.review(companyId, req.actor, id(req.params.claimId), req.body)); });
  router.post("/companies/:companyId/causal-claims/:claimId/analyze", validate(analyzeCausalClaimSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.analyze(companyId, req.actor, id(req.params.claimId), req.body)); });
  router.post("/companies/:companyId/causal-claims/:claimId/revoke", validate(revokeCausalClaimSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.revoke(companyId, req.actor, id(req.params.claimId), req.body)); });
  return router;
}
