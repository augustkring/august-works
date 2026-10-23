import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readCustomerSupportHistory } from "../services/experience/customer-support.js";
import { customerSupportCaseService } from "../services/experience/support-cases.js";
import { supportCaseDataPolicySchema } from "@paperclipai/shared";
export function customerSupportRoutes(db: Db, options: { runtimeEnv?: Readonly<Record<string, string | undefined>> } = {}) {
  const rawPolicy = (options.runtimeEnv ?? process.env).AW_SUPPORT_CASE_DATA_POLICY_JSON;
  let dataPolicy: z.infer<typeof supportCaseDataPolicySchema> | null = null;
  if (rawPolicy !== undefined) {
    try {
      if (Buffer.byteLength(rawPolicy, "utf8") > 16384) throw Error();
      dataPolicy = supportCaseDataPolicySchema.parse(JSON.parse(rawPolicy));
    } catch { throw Error("Invalid support case data policy configuration"); }
  }
  const router = Router(), cases = customerSupportCaseService(db, { dataPolicy });
  const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) });
  router.use("/companies/:companyId/support", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  router.get("/companies/:companyId/support/policy", async (req, res) => {
    assertBoard(req);
    res.json(await cases.intakePolicy(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), query.parse(req.query).expectedUserId));
  });
  router.get("/companies/:companyId/support/cases", async (req, res) => {
    assertBoard(req);
    res.json(await cases.list(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), req.query));
  });
  router.post("/companies/:companyId/support/cases", async (req, res) => {
    assertBoard(req);
    z.strictObject({}).parse(req.query);
    res.status(201).json(await cases.create(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), req.body));
  });
  router.get("/companies/:companyId/support/cases/requests/:requestKey", async (req, res) => {
    assertBoard(req);
    res.json(await cases.getRequest(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), z.uuid().toLowerCase().parse(req.params.requestKey), query.parse(req.query).expectedUserId));
  });
  router.get("/companies/:companyId/support/cases/:caseId", async (req, res) => {
    assertBoard(req);
    res.json(await cases.get(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), z.uuid().toLowerCase().parse(req.params.caseId), req.query));
  });
  router.post("/companies/:companyId/support/cases/:caseId/replies", async (req, res) => {
    assertBoard(req);
    z.strictObject({}).parse(req.query);
    res.status(201).json(await cases.reply(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), z.uuid().toLowerCase().parse(req.params.caseId), req.body));
  });
  router.get(
    "/companies/:companyId/experience/support-access",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      assertBoard(req);
      const companyId = z.uuid().toLowerCase().parse(req.params.companyId);
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
