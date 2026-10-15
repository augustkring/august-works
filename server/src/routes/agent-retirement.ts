import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { agentRetirementService } from "../services/agents/retirement.js";

export function agentRetirementRoutes(db: Db) {
  const router = Router(), owner = agentRetirementService(db);
  router.route("/companies/:companyId/agents/:agentId/retirement").all((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    assertBoard(req);
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (query.expectedUserId !== v5HumanActorId(req.actor)) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    assertCompanyAccess(req, z.uuid().parse(req.params.companyId).toLowerCase());
    z.uuid().parse(req.params.agentId);
    next();
  }).get(async (req, res) => {
    res.json(await owner.get(req.actor, (req.params.companyId as string).toLowerCase(), (req.params.agentId as string).toLowerCase()));
  }).post(async (req, res) => {
    res.json(await owner.retire(req.actor, (req.params.companyId as string).toLowerCase(), (req.params.agentId as string).toLowerCase(), req.body));
  });
  return router;
}
