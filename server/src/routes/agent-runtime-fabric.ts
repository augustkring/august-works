import { scopedRuntimeActionSchema, scopedRuntimeActionService } from "../services/scoped-runtime-actions.js";
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { heartbeatRuns, companySkillUsageEvents, type Db } from "@paperclipai/db";
import { createExecutionScopeRequestSchema, skillUsageInputSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { capabilityResolverService } from "../services/capability-resolver.js";
import {assertRuntimeSkillSourceRetained} from "../services/learning/learning-assets.js";
import { heartbeatService } from "../services/heartbeat.js";
import { assertV5Enabled } from "../services/v5-authorization.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { forbidden, notFound } from "../errors.js";

export function agentRuntimeFabricRoutes(db: Db) {
  const router = Router(), svc = agentRuntimeFabricService(db);
  router.post("/companies/:companyId/agents/:agentId/runtime/execute", validate(createExecutionScopeRequestSchema), async (req, res) => {
    const companyId = req.params.companyId as string, agentId = req.params.agentId as string;
    assertCompanyAccess(req, companyId);
    const request = await svc.requestScope(req.actor, companyId, agentId, req.body);
    const run = await heartbeatService(db).wakeup(agentId, { source: "on_demand", triggerDetail: "manual", manualUserWake: true, reason: "v5_explicit_execution_scope", requestedByActorType: "user", requestedByActorId: request.requestedByUserId, payload: { v5ScopeRequestId: request.id, ...(request.issueId ? { issueId: request.issueId } : {}) }, contextSnapshot: { responsibleUserId: request.requestedByUserId, v5ScopeRequestId: request.id, ...(request.issueId ? { issueId: request.issueId } : {}) } });
    res.status(202).json({ scopeRequestId: request.id, run });
  });
  router.post("/companies/:companyId/runs/:runId/scoped-actions", validate(scopedRuntimeActionSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await scopedRuntimeActionService(db, req.app.locals.toolGateway).execute(req.actor, companyId, req.params.runId as string, req.body));
  });
  router.get("/companies/:companyId/runs/:runId/execution-manifest", async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await svc.getManifest(req.actor, companyId, req.params.runId as string));
  });
  router.get("/companies/:companyId/runs/:runId/playbooks/:playbookId/body",async(req,res)=>{
    const companyId=req.params.companyId as string;assertCompanyAccess(req,companyId);
    res.set("Cache-Control","no-store");
    res.json(await svc.loadPlaybook(req.actor,companyId,req.params.runId as string,req.params.playbookId as string));
  });
  router.get("/companies/:companyId/runtime/capabilities", async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    await assertV5Enabled(db, "agent_runtime_fabric_v5");
    res.json(await capabilityResolverService(db).search(req.actor, companyId, String(req.query.q ?? "").slice(0, 200)));
  });
  router.get("/companies/:companyId/runs/:runId/skills/:skillId/body", async (req, res) => {
    const companyId = req.params.companyId as string, runId = req.params.runId as string; assertCompanyAccess(req, companyId);
    res.set("Cache-Control","no-store");
    res.json(await svc.loadSkill(req.actor,companyId,runId,req.params.skillId as string));
  });
  router.post("/companies/:companyId/runs/:runId/skill-usage", validate(skillUsageInputSchema), async (req, res) => {
    const companyId = req.params.companyId as string, runId = req.params.runId as string; assertCompanyAccess(req, companyId);
    if (req.actor.type !== "agent" || req.actor.runId !== runId || req.body.runId !== runId || req.body.stage === "loaded") throw forbidden("Agents may report use/feedback only for their current loaded execution pins");
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId), eq(heartbeatRuns.agentId, req.actor.agentId!), eq(heartbeatRuns.status, "running"))).limit(1);
    if (!run) throw notFound("Current execution not found");
    const record = await svc.getManifest(req.actor, companyId, runId), pin = record.manifest.skills.find((item) => item.skillId === req.body.skillId && item.versionId === req.body.skillVersionId);
    if (!pin) throw forbidden("Skill is outside the execution pins");
    await agentProviderBindingService(db).assertRuntime(companyId, run.agentId);
    await assertRuntimeSkillSourceRetained(db,companyId,req.actor,pin.skillId,pin.versionId);
    const loaded = await db.select({ id: companySkillUsageEvents.id }).from(companySkillUsageEvents).where(and(eq(companySkillUsageEvents.companyId, companyId), eq(companySkillUsageEvents.runId, runId), eq(companySkillUsageEvents.skillVersionId, pin.versionId), eq(companySkillUsageEvents.stage, "loaded"))).limit(1);
    if (!loaded.length) throw forbidden("Load the pinned procedure before reporting use");
    await db.insert(companySkillUsageEvents).values({ ...req.body, companyId, agentId: run.agentId, selectionReason: `agent_report:${pin.selection}` }).onConflictDoNothing();
    res.status(201).json({ recorded: true, evidenceKind: "agent_report", promotionEvidence: false });
  });
  return router;
}
