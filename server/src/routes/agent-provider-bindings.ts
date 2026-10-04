import { providerDiscoveryService } from "../services/provider-discovery.js";
import { providerConformanceService } from "../services/provider-conformance.js";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { revalidateProviderBindingSchema, acknowledgeSharedRuntimeSchema, attachProviderBindingSchema, createProviderBindingSchema, providerConformanceInputSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";

export function agentProviderBindingRoutes(db: Db) {
  const router = Router(), svc = agentProviderBindingService(db);
  const base = "/companies/:companyId/agents/:agentId/provider-binding";
  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.getForPresence(req.actor, companyId, req.params.agentId as string));
  });
  router.post(base, validate(createProviderBindingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.status(201).json(await svc.create(req.actor, companyId, req.params.agentId as string, req.body));
  });
  router.put(base, validate(attachProviderBindingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.attach(req.actor, companyId, req.params.agentId as string, req.body));
  });
  router.post(`${base}/discover`, async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await providerDiscoveryService(db).discover(req.actor, companyId, req.params.agentId as string));
  });
  router.post(`${base}/conformance`, validate(providerConformanceInputSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await providerConformanceService(db).test(req.actor, companyId, req.params.agentId as string, req.body));
  });
  router.post(`${base}/revalidate`, validate(revalidateProviderBindingSchema), async (req, res) => {
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await svc.revalidate(req.actor, companyId, req.params.agentId as string, req.body.expectedSnapshotHash, req.body.rationale));
  });
  router.post(`${base}/:bindingId/acknowledge-shared`, validate(acknowledgeSharedRuntimeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.acknowledgeShared(req.actor, companyId, req.params.agentId as string, req.params.bindingId as string));
  });
  return router;
}
