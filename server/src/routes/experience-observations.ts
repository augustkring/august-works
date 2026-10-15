import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { experienceObservationService } from "../services/experience/observations.js";

export function experienceObservationRoutes(db: Db) {
  const router = Router(), service = experienceObservationService(db);
  const path = "/companies/:companyId/experience/observations";
  function scope(req: Request) {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (query.expectedUserId !== v5HumanActorId(req.actor))
      throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    return companyId;
  }
  // Set privacy headers before authentication, validation and service failures.
  router.use(path, (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  router.get(`${path}/preference`, async (req, res) => {
    res.json(await service.get(req.actor, scope(req)));
  });
  router.post(`${path}/preference`, async (req, res) => {
    res.json(await service.update(req.actor, scope(req), req.body));
  });
  router.post(path, async (req, res) => {
    res.json(await service.record(req.actor, scope(req), req.body));
  });
  router.get(`${path}/summary`, async (req, res) => {
    res.json(await service.summary(req.actor, scope(req)));
  });
  return router;
}
