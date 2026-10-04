import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assignRolePackSchema, createRolePackSchema, publishRolePackSchema, rolePackVersionInputSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { rolePackService } from "../services/role-packs.js";
import { assertCompanyAccess } from "./authz.js";

export function rolePackRoutes(db: Db) {
  const router = Router(), svc = rolePackService(db), base = "/companies/:companyId/role-packs";
  router.use("/companies/:companyId/role-packs", (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await svc.list(req.actor, req.params.companyId as string)); });
  router.get(`${base}/catalog`, async (req, res) => { res.json(await svc.catalog(req.actor, req.params.companyId as string)); });
  router.post(base, validate(createRolePackSchema), async (req, res) => { res.status(201).json(await svc.create(req.actor, req.params.companyId as string, req.body)); });
  router.put(`${base}/assignments`, validate(assignRolePackSchema), async (req, res) => { res.json(await svc.assign(req.actor, req.params.companyId as string, req.body)); });
  router.get(`${base}/resolve/:agentId`, async (req, res) => { res.json(await svc.resolve(req.actor, req.params.companyId as string, req.params.agentId as string)); });
  router.get(`${base}/:id`, async (req, res) => { res.json(await svc.get(req.actor, req.params.companyId as string, req.params.id as string)); });
  router.post(`${base}/:id/versions`, validate(rolePackVersionInputSchema), async (req, res) => { res.status(201).json(await svc.createVersion(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.get(`${base}/:id/versions/:versionId`, async (req, res) => { res.json(await svc.getVersion(req.actor, req.params.companyId as string, req.params.id as string, req.params.versionId as string)); });
  router.post(`${base}/:id/versions/:versionId/publish`, validate(publishRolePackSchema), async (req, res) => { res.json(await svc.publish(req.actor, req.params.companyId as string, req.params.id as string, req.params.versionId as string, req.body.expectedPublishedVersionId)); });
  return router;
}
