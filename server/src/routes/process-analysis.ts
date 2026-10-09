import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createProcessAnalysisDefinitionSchema, publishProcessAnalysisDefinitionSchema, retireProcessAnalysisDefinitionSchema,
  reviseProcessAnalysisDefinitionSchema, runProcessAnalysisSchema, createProcessFindingSchema, transitionProcessFindingSchema } from "@paperclipai/shared";
import { badRequest, conflict } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { processAnalysisService } from "../services/process-analysis.js";
import { processFindingService } from "../services/process-findings.js";

function id(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest("Invalid native process identity");
  return parsed.data;
}
function company(req: Request, list = false) {
  if (Object.keys(req.query).some(key => key !== "expectedUserId" && !(list && key === "cursor"))) throw badRequest("Unknown process filter");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId); return companyId;
}
export function processAnalysisRoutes(db: Db) {
  const router = Router(), service = processAnalysisService(db);
  router.use("/companies/:companyId/process-definitions", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/process-definitions", async (req, res) => {
    res.json(await service.list(company(req, true), req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor)));
  });
  router.get("/companies/:companyId/process-definitions/:definitionId", async (req, res) => {
    res.json(await service.detail(company(req), req.actor, id(req.params.definitionId)));
  });
  router.post("/companies/:companyId/process-definitions", validate(createProcessAnalysisDefinitionSchema), async (req, res) => {
    res.status(201).json(await service.create(company(req), req.actor, req.body));
  });
  router.post("/companies/:companyId/process-definitions/:definitionId/versions", validate(reviseProcessAnalysisDefinitionSchema), async (req, res) => {
    res.status(201).json(await service.revise(company(req), req.actor, id(req.params.definitionId), req.body));
  });
  router.post("/companies/:companyId/process-definitions/:definitionId/publish", validate(publishProcessAnalysisDefinitionSchema), async (req, res) => {
    res.json(await service.publish(company(req), req.actor, id(req.params.definitionId), req.body));
  });
  router.post("/companies/:companyId/process-definitions/:definitionId/retire", validate(retireProcessAnalysisDefinitionSchema), async (req, res) => {
    res.json(await service.retire(company(req), req.actor, id(req.params.definitionId), req.body));
  });
  router.post("/companies/:companyId/process-definitions/:definitionId/runs", validate(runProcessAnalysisSchema), async (req, res) => {
    res.status(201).json(await service.run(company(req), req.actor, id(req.params.definitionId), req.body));
  });
  router.get("/companies/:companyId/process-definitions/:definitionId/runs", async (req,res)=>{
    res.json(await service.listRuns(company(req,true),req.actor,id(req.params.definitionId),req.query.cursor===undefined ? undefined : id(req.query.cursor)));
  });
  router.get("/companies/:companyId/process-definitions/:definitionId/runs/:runId", async (req, res) => {
    res.json(await service.getRun(company(req), req.actor, id(req.params.definitionId), id(req.params.runId)));
  });
  const findings = processFindingService(db);
  const findingPath = "/companies/:companyId/process-definitions/:definitionId/runs/:runId/findings";
  router.get(findingPath, async (req, res) => {
    res.json(await findings.list(company(req, true), req.actor, id(req.params.definitionId), id(req.params.runId), req.query.cursor === undefined ? undefined : id(req.query.cursor)));
  });
  router.post(findingPath, validate(createProcessFindingSchema), async (req, res) => {
    res.status(201).json(await findings.create(company(req), req.actor, id(req.params.definitionId), id(req.params.runId), req.body));
  });
  router.get(`${findingPath}/:findingId`, async (req, res) => {
    res.json(await findings.detail(company(req), req.actor, id(req.params.definitionId), id(req.params.runId), id(req.params.findingId)));
  });
  router.post(`${findingPath}/:findingId/transition`, validate(transitionProcessFindingSchema), async (req, res) => {
    res.json(await findings.transition(company(req), req.actor, id(req.params.definitionId), id(req.params.runId), id(req.params.findingId), req.body));
  });
  return router;
}
