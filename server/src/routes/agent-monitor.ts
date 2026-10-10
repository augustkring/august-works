import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readAgentMonitor } from "../services/experience/agent-monitor.js";
export function agentMonitorRoutes(db: Db) {
  const router = Router();
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
