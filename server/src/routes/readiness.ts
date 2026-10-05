import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { READINESS_ACTIONS, assessReadinessSchema, createReadinessRequirementSchema, resolveReadinessFindingSchema, v7FeatureEnabled } from "@paperclipai/shared";
import { forbidden, notFound, unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/access.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { readinessService } from "../services/readiness/readiness-service.js";
import { mandatoryReadinessPolicy } from "../services/readiness/readiness-policy.js";
import { assertCompanyAccess } from "./authz.js";

export function readinessOwner(req: Request) {
  if (req.actor.type === "agent" && req.actor.agentId) return { actor: req.actor, principalId: `agent:${req.actor.agentId}`, userId: req.actor.onBehalfOfUserId ?? null };
  if (req.actor.type === "board" && req.actor.source === "local_implicit") return { actor: req.actor, principalId: "local-board", userId: null };
  if (req.actor.type === "board" && req.actor.userId) return { actor: req.actor, principalId: `user:${req.actor.userId}`, userId: req.actor.userId };
  throw unauthorized("Authenticated identity required");
}
export function readinessRoutes(db: Db) {
  const router = Router();
  const service = readinessService(db);
  const settings = instanceSettingsService(db);
  const access = accessService(db);
  async function admit(req: Request, permission: "company_scope:read" | "foundation:approve" = "company_scope:read") {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const owner = readinessOwner(req);
    if (!v7FeatureEnabled(await settings.getExperimental(), "readiness_engine_v7")) throw notFound("Readiness is not enabled");
    if (permission === "foundation:approve" && req.actor.type !== "board") throw forbidden("Board review required");
    if (req.actor.source !== "local_implicit") {
      const decision = await access.decide({ actor: req.actor, action: permission, resource: { type: "company", companyId } });
      if (!decision.allowed) throw forbidden("Readiness access denied", { code: "permission_denied" });
    }
    return { companyId, owner };
  }
  router.get("/companies/:companyId/readiness/requirements", async (req, res) => {
    const { companyId } = await admit(req);
    res.json({ system: READINESS_ACTIONS.flatMap(mandatoryReadinessPolicy), company: await service.requirements(companyId) });
  });
  router.get("/companies/:companyId/readiness/overview", async (req, res) => {
    const { companyId, owner } = await admit(req);
    const assessments = await service.list(companyId, owner.principalId);
    res.json({ assessments: assessments.map((row) => ({ ...row, expired: row.expiresAt.getTime() <= Date.now() })), systemRequirements: READINESS_ACTIONS.flatMap(mandatoryReadinessPolicy) });
  });
  router.get("/companies/:companyId/readiness/findings", async (req, res) => {
    const { companyId, owner } = await admit(req);
    res.json(await service.findings(companyId, owner.principalId));
  });
  router.post("/companies/:companyId/readiness/findings/:id/resolve", validate(resolveReadinessFindingSchema), async (req, res) => {
    const { companyId, owner } = await admit(req, "foundation:approve");
    res.json(await service.resolveFinding(companyId, req.params.id as string, req.body, owner));
  });
  router.post("/companies/:companyId/readiness/requirements", validate(createReadinessRequirementSchema), async (req, res) => {
    const { companyId, owner } = await admit(req, "foundation:approve");
    res.status(201).json(await service.publishRequirement(companyId, req.body, owner));
  });
  router.post("/companies/:companyId/readiness/assess", validate(assessReadinessSchema), async (req, res) => {
    const { companyId, owner } = await admit(req);
    res.status(201).json(await service.assess(companyId, req.body, owner));
  });
  router.get("/companies/:companyId/readiness/assessments", async (req, res) => {
    const { companyId, owner } = await admit(req);
    res.json(await service.list(companyId, owner.principalId));
  });
  router.get("/companies/:companyId/readiness/assessments/:id", async (req, res) => {
    const { companyId, owner } = await admit(req);
    res.json(await service.get(companyId, req.params.id as string, owner.principalId));
  });
  return router;
}
