import { Router } from "express";
import { z } from "zod";
import { memoryMaintenanceHistoryQuerySchema } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readMaintenanceHistory } from "../services/experience/maintenance-history.js";
import { readMemoryMaintenanceHistory } from "../services/experience/memory-maintenance-history.js";
export function maintenanceHistoryRoutes(db: Db) {
  const router = Router();
  router.get("/companies/:companyId/memory/experience/maintenance", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const query = memoryMaintenanceHistoryQuerySchema.parse(req.query);
    if (query.expectedUserId !== v5HumanActorId(req.actor))
      throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
    res.json(await readMemoryMaintenanceHistory(db, req.actor, companyId, query.jobId));
  });
  router.get(
    "/companies/:companyId/agent-package-installations/:installationId/experience/maintenance",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      assertBoard(req);
      const companyId = z.uuid().parse(req.params.companyId),
        installationId = z.uuid().parse(req.params.installationId);
      assertCompanyAccess(req, companyId);
      const query = z
        .strictObject({ expectedUserId: z.string().min(1).max(300) })
        .parse(req.query);
      if (query.expectedUserId !== v5HumanActorId(req.actor))
        throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
      res.json(
        await readMaintenanceHistory(db, req.actor, companyId, installationId),
      );
    },
  );
  return router;
}
