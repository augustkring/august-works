import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { addAgentPresenceSchema, createAgentIdentitySchema, rehomeAgentIdentitySchema, updateAgentIdentitySchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { unprocessable } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";
import { agentIdentityService } from "../services/agent-identities.js";

export function agentIdentityRoutes(db: Db) {
  const router = Router();
  const svc = agentIdentityService(db);
  const base = "/companies/:companyId/agent-identities";
  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(req.actor, companyId));
  });
  router.post(base, validate(createAgentIdentitySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.body.homeCompanyId !== companyId) throw unprocessable("Home company must match the request company");
    res.status(201).json(await svc.create(req.actor, req.body));
  });
  router.get(`${base}/:identityId`, async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.get(req.actor, companyId, req.params.identityId as string));
  });
  router.patch(`${base}/:identityId`, validate(updateAgentIdentitySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.update(req.actor, companyId, req.params.identityId as string, req.body));
  });
  router.post(`${base}/:identityId/presences`, validate(addAgentPresenceSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAccess(req, req.body.companyId);
    res.status(201).json(await svc.addPresence(req.actor, companyId, req.params.identityId as string, req.body));
  });
  router.post(`${base}/:identityId/rehome`, validate(rehomeAgentIdentitySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertCompanyAccess(req, req.body.homeCompanyId);
    res.json(await svc.rehome(req.actor, companyId, req.params.identityId as string, req.body.homeCompanyId));
  });
  return router;
}
