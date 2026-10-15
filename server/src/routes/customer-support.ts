import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readCustomerSupportHistory } from "../services/experience/customer-support.js";
export function customerSupportRoutes(db: Db) {
  const router = Router();
  router.get(
    "/companies/:companyId/experience/support-access",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      assertBoard(req);
      const companyId = z.uuid().parse(req.params.companyId);
      assertCompanyAccess(req, companyId);
      const query = z
        .strictObject({ expectedUserId: z.string().min(1).max(300) })
        .parse(req.query);
      if (query.expectedUserId !== v5HumanActorId(req.actor))
        throw conflict("Account changed; reload", { code: "ACCOUNT_CHANGED" });
      res.json(await readCustomerSupportHistory(db, req.actor, companyId));
    },
  );
  return router;
}
