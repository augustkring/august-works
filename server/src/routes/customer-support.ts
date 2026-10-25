import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict } from "../errors.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { readCustomerSupportHistory } from "../services/experience/customer-support.js";
import { customerSupportCaseService } from "../services/experience/support-cases.js";
import { readSupportCaseDataPolicy } from "../services/experience/support-case-configuration.js";
import { supportAssistantAvailabilityQuerySchema, supportAssistantRequestSchema, supportAssistantResponseSchema } from "@paperclipai/shared";
import type { firstPartySupportModelGateway } from "../services/orchestration/first-party-support-model-gateway.js";
export function customerSupportRoutes(db: Db, options: {
  runtimeEnv?: Readonly<Record<string, string | undefined>>;
  assistant?: ReturnType<typeof firstPartySupportModelGateway>;
} = {}) {
  const dataPolicy = readSupportCaseDataPolicy(options.runtimeEnv ?? process.env);
  const router = Router(), cases = customerSupportCaseService(db, { dataPolicy });
  const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) });
  router.use("/companies/:companyId/support", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  router.get("/companies/:companyId/support/assistant", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().toLowerCase().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const query = supportAssistantAvailabilityQuerySchema.parse(req.query);
    if (v5HumanActorId(req.actor) !== query.expectedUserId) throw conflict("The current support account changed");
    res.json(options.assistant
      ? await options.assistant.availability(req.actor, companyId, query)
      : { available: false });
  });
  router.post("/companies/:companyId/support/assistant/answers", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().toLowerCase().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    z.strictObject({}).parse(req.query);
    const input = supportAssistantRequestSchema.parse(req.body);
    if (v5HumanActorId(req.actor) !== input.expectedUserId) throw conflict("The current support account changed");
    if (!options.assistant) {
      res.json(supportAssistantResponseSchema.parse({ requestId: input.requestId, kind: "unavailable", citations: [] }));
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => { if (!res.writableEnded) abort(); };
    req.once("aborted", abort);
    res.once("close", close);
    try {
      const result = await options.assistant.answer(req.actor, companyId, input, controller.signal);
      if (!controller.signal.aborted) res.json(supportAssistantResponseSchema.parse(result));
    } finally {
      req.off("aborted", abort);
      res.off("close", close);
    }
  });
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
  router.post("/companies/:companyId/support/cases/:caseId/close", async (req, res) => {
    assertBoard(req);
    z.strictObject({}).parse(req.query);
    res.json(await cases.close(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), z.uuid().toLowerCase().parse(req.params.caseId), req.body));
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
