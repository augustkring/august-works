import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentExecutionScopeSchema, crossCompanyContextRequestSchema, crossCompanyPolicySchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { unprocessable } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";
import { crossCompanyContextService } from "../services/cross-company-context.js";

export function crossCompanyContextRoutes(db: Db) {
  const router = Router(), svc = crossCompanyContextService(db);
  const base = "/companies/:companyId/cross-company";
  router.get(`${base}/policy`, async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.getPolicy(req.actor, companyId));
  });
  router.put(`${base}/policy`, validate(crossCompanyPolicySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.setPolicy(req.actor, companyId, req.body));
  });
  router.post(`${base}/preview`, validate(agentExecutionScopeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.body.primaryCompanyId !== companyId) throw unprocessable("Primary company must match request company");
    const resolved = await svc.resolve(req.actor, req.body);
    // No provider secrets, internal profiles, raw policy objects or other
    // company agents are disclosed by a delegation preview.
    res.json({ executionScope: resolved.scope, companies: resolved.scopes.map((s) => ({ companyId: s.companyId, name: s.companyName, agentPresenceId: s.presence.id, purpose: s.purpose, accessMode: s.accessMode, isolationMode: s.provider.provider.isolationMode })) });
  });
  router.post(`${base}/context`, validate(crossCompanyContextRequestSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.body.executionScope.primaryCompanyId !== companyId) throw unprocessable("Primary company must match request company");
    res.json(await svc.assemble(req.actor, req.body));
  });
  return router;
}
