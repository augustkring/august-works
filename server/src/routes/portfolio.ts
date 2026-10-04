import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { preparePortfolioCapabilityUpgradeSchema, installPortfolioCapabilitySchema, portfolioRequestSchema, publishPortfolioCapabilitySchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { portfolioService } from "../services/portfolio.js";
import { portfolioCapabilityService } from "../services/portfolio-capabilities.js";

export function portfolioRoutes(db: Db) {
  const router = Router(), capabilities = portfolioCapabilityService(db), base = "/companies/:companyId/portfolio-capabilities";
  router.post("/portfolio/summary", validate(portfolioRequestSchema), async (req, res) => { res.json(await portfolioService(db).summary(req.actor, req.body)); });
  router.use(base, (req, _res, next) => { assertCompanyAccess(req, req.params.companyId as string); next(); });
  router.get(base, async (req, res) => { res.json(await capabilities.discover(req.actor, req.params.companyId as string)); });
  router.get(`${base}/publications`, async (req, res) => { res.json(await capabilities.ownPublications(req.actor, req.params.companyId as string)); });
  router.post(`${base}/publications`, validate(publishPortfolioCapabilitySchema), async (req, res) => { res.status(201).json(await capabilities.publish(req.actor, req.params.companyId as string, req.body)); });
  router.post(`${base}/publications/:id/withdraw`, async (req, res) => { res.json(await capabilities.withdraw(req.actor, req.params.companyId as string, req.params.id as string)); });
  router.get(`${base}/subscriptions`, async (req, res) => { res.json(await capabilities.subscriptions(req.actor, req.params.companyId as string)); });
  router.post(`${base}/install`, validate(installPortfolioCapabilitySchema), async (req, res) => { res.status(201).json(await capabilities.install(req.actor, req.params.companyId as string, req.body)); });
  router.post(`${base}/subscriptions/:id/prepare-upgrade`, validate(preparePortfolioCapabilityUpgradeSchema), async (req, res) => { res.status(201).json(await capabilities.prepareUpgrade(req.actor, req.params.companyId as string, req.params.id as string, req.body.publicationId, req.body.expectedActiveVersionId, req.body.expectedRevisionId)); });
  router.get(`${base}/:id`, async (req, res) => { res.json(await capabilities.get(req.actor, req.params.companyId as string, req.params.id as string)); });
  return router;
}
