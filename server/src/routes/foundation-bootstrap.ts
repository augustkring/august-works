import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { answerBootstrapSchema, bootstrapTransitionSchema, startFoundationBootstrapSchema, submitBootstrapCandidatesSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { foundationBootstrapService } from "../services/foundation/foundation-bootstrap.js";
import { heartbeatService } from "../services/heartbeat.js";
import { logger } from "../middleware/logger.js";
export function foundationBootstrapRoutes(db: Db) {
  const router = Router(), service = foundationBootstrapService(db);
  async function dispatch(run: Awaited<ReturnType<typeof service.start>>, actor: Express.Request["actor"]) {
    // The canonical Task survives a wakeup failure. Its normal runtime recovery
    // and manual Run operation remain available; no second job scheduler exists.
    let dispatchPending = false;
    if (run.status === "awaiting_candidates") {
      try {
        await heartbeatService(db).wakeup(run.agentId, { source: "assignment", triggerDetail: "system", reason: "foundation_bootstrap",
          payload: { issueId: run.taskId, foundationBootstrapRunId: run.id }, idempotencyKey: `foundation-bootstrap:${run.id}:${run.version}`,
          requestedByActorType: actor.type === "agent" ? "agent" : "user", requestedByActorId: actor.userId ?? "local-board" });
      } catch (error) { dispatchPending = true; logger.warn({ err: error, runId: run.id }, "Foundation discovery task awaits runtime dispatch"); }
    }
    return dispatchPending;
  }
  router.post("/companies/:companyId/foundation/bootstrap", validate(startFoundationBootstrapSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const run = await service.start(req.actor, companyId, req.body);
    const dispatchPending = await dispatch(run, req.actor);
    res.status(201).json({ ...run, dispatchPending });
  });
  router.get("/companies/:companyId/foundation/bootstrap/:runId", async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.get(req.actor, companyId, req.params.runId as string));
  });
  router.get("/companies/:companyId/foundation/bootstrap/:runId/sources", async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.sources(req.actor, companyId, req.params.runId as string));
  });
  router.post("/companies/:companyId/foundation/bootstrap/:runId/candidates", validate(submitBootstrapCandidatesSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.submit(req.actor, companyId, req.params.runId as string, req.body));
  });
  router.post("/companies/:companyId/foundation/bootstrap/:runId/answer", validate(answerBootstrapSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    const run = await service.answer(req.actor, companyId, req.params.runId as string, req.body);
    res.json({ ...run, dispatchPending: await dispatch(run, req.actor) });
  });
  router.post("/companies/:companyId/foundation/bootstrap/:runId/create-proposals", validate(bootstrapTransitionSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.createProposals(req.actor, companyId, req.params.runId as string, req.body.expectedVersion));
  });
  return router;
}
