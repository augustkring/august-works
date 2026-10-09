import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assessProcessDataSchema } from "@paperclipai/shared";
import { badRequest, conflict } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { processDataReadinessService } from "../services/process-data-readiness.js";

export function processDataReadinessRoutes(db: Db) {
  const router=Router();
  router.post("/companies/:companyId/process-data-readiness",validate(assessProcessDataSchema),async (req,res) => {
    const company=z.string().uuid().safeParse(req.params.companyId);
    if (!company.success) throw badRequest("Invalid process-data company identity");
    if (Object.keys(req.query).some(key => key!=="expectedUserId")) throw badRequest("Unknown process-data filter");
    if (req.query.expectedUserId!==undefined && (typeof req.query.expectedUserId!=="string" || req.actor.type!=="board" || req.actor.userId!==req.query.expectedUserId)) throw conflict("Account changed; reload this page",{ code: "ACCOUNT_CHANGED" });
    assertCompanyAccess(req,company.data); res.setHeader("Cache-Control","no-store");
    res.json(await processDataReadinessService(db).assess(company.data,req.actor,req.body));
  });
  return router;
}
