import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createCompanyRelationshipSchema, createOrgUnitSchema, setOrgUnitMembershipSchema, transitionCompanyRelationshipSchema, updateOrgUnitSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { organizationService } from "../services/organization.js";

export function organizationRoutes(db: Db) {
  const router = Router(), svc = organizationService(db);
  const base = "/companies/:companyId";
  router.get(`${base}/relationships`, async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.listRelationships(req.actor, id));
  });
  router.post(`${base}/relationships`, validate(createCompanyRelationshipSchema), async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.status(201).json(await svc.proposeRelationship(req.actor, id, req.body));
  });
  router.post(`${base}/relationships/:relationshipId/transition`, validate(transitionCompanyRelationshipSchema), async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.transitionRelationship(req.actor, id, req.params.relationshipId as string, req.body.action));
  });
  router.get(`${base}/org-units`, async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.listUnits(req.actor, id));
  });
  router.post(`${base}/org-units`, validate(createOrgUnitSchema), async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.status(201).json(await svc.createUnit(req.actor, id, req.body));
  });
  router.patch(`${base}/org-units/:unitId`, validate(updateOrgUnitSchema), async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.updateUnit(req.actor, id, req.params.unitId as string, req.body));
  });
  router.get(`${base}/org-units/:unitId/memberships`, async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.listMemberships(req.actor, id, req.params.unitId as string));
  });
  router.put(`${base}/org-units/:unitId/memberships`, validate(setOrgUnitMembershipSchema), async (req, res) => {
    const id = req.params.companyId as string; assertCompanyAccess(req, id);
    res.json(await svc.setMembership(req.actor, id, req.params.unitId as string, req.body));
  });
  return router;
}
