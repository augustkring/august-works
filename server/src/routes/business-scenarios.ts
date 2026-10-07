import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createBusinessScenarioSchema, reviseBusinessScenarioSchema, publishBusinessScenarioSchema, runBusinessScenarioSchema, retireBusinessScenarioSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, conflict } from "../errors.js";
import { businessScenarioService } from "../services/business-scenarios/service.js";
function id(value: unknown) { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw badRequest("Invalid scenario identity"); return parsed.data; }
function companyAccess(req: Request, companyId: string, allowed: string[] = []) {
  if (Object.keys(req.query).some(key => key !== "expectedUserId" && !allowed.includes(key))) throw badRequest("Unknown scenario query field");
  if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  assertCompanyAccess(req, companyId);
}
export function businessScenarioRoutes(db: Db) {
  const router = Router(), service = businessScenarioService(db);
  router.use("/companies/:companyId/business-scenarios", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/business-scenarios", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId, ["cursor"]); res.json(await service.list(companyId, req.actor, req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get("/companies/:companyId/business-scenarios/:scenarioId", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.detail(companyId, req.actor, id(req.params.scenarioId))); });
  router.post("/companies/:companyId/business-scenarios", validate(createBusinessScenarioSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.create(companyId, req.actor, req.body)); });
  router.post("/companies/:companyId/business-scenarios/:scenarioId/versions", validate(reviseBusinessScenarioSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.revise(companyId, req.actor, id(req.params.scenarioId), req.body)); });
  router.post("/companies/:companyId/business-scenarios/:scenarioId/publish", validate(publishBusinessScenarioSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.publish(companyId, req.actor, id(req.params.scenarioId), req.body)); });
  router.post("/companies/:companyId/business-scenarios/:scenarioId/runs", validate(runBusinessScenarioSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.status(201).json(await service.run(companyId, req.actor, id(req.params.scenarioId), req.body)); });
  router.get("/companies/:companyId/business-scenarios/:scenarioId/runs", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId, ["cursor"]); res.json(await service.listRuns(companyId, req.actor, id(req.params.scenarioId), req.query.cursor === undefined ? undefined : id(req.query.cursor))); });
  router.get("/companies/:companyId/business-scenarios/:scenarioId/runs/:runId", async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.result(companyId, req.actor, id(req.params.scenarioId), id(req.params.runId))); });
  router.post("/companies/:companyId/business-scenarios/:scenarioId/retire", validate(retireBusinessScenarioSchema), async (req, res) => { const companyId = id(req.params.companyId); companyAccess(req, companyId); res.json(await service.retire(companyId, req.actor, id(req.params.scenarioId), req.body)); });
  return router;
}
