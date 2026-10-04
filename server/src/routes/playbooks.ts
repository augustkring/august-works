import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createPlaybookSchema, playbookDraftSchema, updatePlaybookMetadataSchema, proposePlaybookSchema, reviewPlaybookSchema, linkPlaybookSkillSchema, projectPlaybookSkillSchema } from "@paperclipai/shared";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { playbookService } from "../services/playbooks.js";

export function playbookRoutes(db: Db) {
  const router = Router(), svc = playbookService(db), base = "/companies/:companyId/playbooks";
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await svc.list(req.actor, req.params.companyId as string)); });
  router.post(base, validate(createPlaybookSchema), async (req, res) => { res.status(201).json(await svc.create(req.actor, req.params.companyId as string, req.body)); });
  router.get(`${base}/:id`, async (req, res) => { res.json(await svc.get(req.actor, req.params.companyId as string, req.params.id as string)); });
  router.get(`${base}/:id/revisions/:revisionId`, async (req, res) => { res.json(await svc.getRevision(req.actor, req.params.companyId as string, req.params.id as string, req.params.revisionId as string)); });
  router.get(`${base}/:id/export`, async (req, res) => {
    const row = await svc.get(req.actor, req.params.companyId as string, req.params.id as string);
    const revision = row.approvedRevisionId ? await svc.getRevision(req.actor, row.companyId, row.id, row.approvedRevisionId) : null;
    res.type("text/markdown").attachment(`${row.key}.md`).send(`# ${revision?.title ?? row.document.title}\n\nCompany: ${row.companyId}\nClassification: ${row.sensitivity}\nRevision: ${revision?.id ?? row.document.latestRevisionId}\nStatus: ${revision ? "approved" : "draft"}\n\n${revision?.body ?? row.document.latestBody}`);
  });
  router.patch(`${base}/:id/draft`, validate(playbookDraftSchema), async (req, res) => { res.json(await svc.draft(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.patch(`${base}/:id/metadata`, validate(updatePlaybookMetadataSchema), async (req, res) => { res.json(await svc.updateMetadata(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.post(`${base}/:id/review`, validate(reviewPlaybookSchema), async (req, res) => { res.json(await svc.review(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.post(`${base}/:id/proposals`, validate(proposePlaybookSchema), async (req, res) => { res.status(201).json(await svc.propose(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.post(`${base}/:id/proposals/:proposalId/review`, validate(z.object({ accept: z.boolean(), rationale: z.string().trim().min(10).max(4000) }).strict()), async (req, res) => { res.json(await svc.reviewProposal(req.actor, req.params.companyId as string, req.params.id as string, req.params.proposalId as string, req.body.accept, req.body.rationale)); });
  router.post(`${base}/:id/skill-links`, validate(linkPlaybookSkillSchema), async (req, res) => { res.status(201).json(await svc.linkSkill(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  router.post(`${base}/:id/compile-skill-candidate`, validate(projectPlaybookSkillSchema), async (req, res) => { res.status(201).json(await svc.projectSkill(req.actor, req.params.companyId as string, req.params.id as string, req.body)); });
  return router;
}
