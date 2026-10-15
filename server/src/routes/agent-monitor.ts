import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readAgentMonitor } from "../services/experience/agent-monitor.js";
import { agentPauseService } from "../services/experience/agent-pause.js";
import { agentPauseCommandSchema } from "@paperclipai/shared";
export function agentMonitorRoutes(db: Db) {
  const router = Router(), pause = agentPauseService(db);
  const root = "/companies/:companyId/agents/:agentId/experience";
  function pauseScope(req: import("express").Request, res: import("express").Response) {
    res.setHeader("Cache-Control", "private, no-store"); assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), agentId = z.uuid().parse(req.params.agentId);
    assertCompanyAccess(req, companyId);
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (query.expectedUserId !== v5HumanActorId(req.actor)) throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    return { companyId, agentId };
  }
  router.get(`${root}/pause-review`, async (req, res) => {
    const { companyId, agentId } = pauseScope(req, res);
    res.json(await pause.review(req.actor, companyId, agentId));
  });
  router.get(`${root}/pause-requests/:requestId`, async (req, res) => {
    const { companyId, agentId } = pauseScope(req, res);
    res.json(await pause.receipt(req.actor, companyId, agentId, z.uuid().parse(req.params.requestId)));
  });
  router.post(`${root}/pause`, async (req, res) => {
    const { companyId, agentId } = pauseScope(req, res);
    res.json(await pause.pause(req.actor, companyId, agentId, agentPauseCommandSchema.parse(req.body)));
  });
  router.get(
    "/companies/:companyId/agents/:agentId/experience",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      assertBoard(req);
      const companyId = z.uuid().parse(req.params.companyId),
        agentId = z.uuid().parse(req.params.agentId);
      assertCompanyAccess(req, companyId);
      const query = z
        .strictObject({ expectedUserId: z.string().min(1).max(300) })
        .parse(req.query);
      if (query.expectedUserId !== v5HumanActorId(req.actor))
        throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
      res.json(await readAgentMonitor(db, req.actor, companyId, agentId));
    },
  );
  return router;
}
