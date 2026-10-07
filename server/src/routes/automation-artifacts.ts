import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  appendAutomationArtifactVersionSchema, archiveAutomationArtifactSchema,
  createAutomationArtifactSchema, transitionAutomationArtifactStatusSchema,
} from "@paperclipai/shared";
import { automationArtifactService } from "../services/automation-artifacts/automation-artifact-service.js";
import { automationArtifactSecurityService } from "../services/automation-artifacts/automation-artifact-security.js";
import { accessService } from "../services/access.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { validate } from "../middleware/validate.js";
import { conflict, forbidden, notFound, unauthorized } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function automationArtifactRoutes(db: Db) {
  const router = Router();
  router.use("/companies/:companyId/automation-artifacts", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const artifacts = automationArtifactService(db);
  const security = automationArtifactSecurityService(db);
  const access = accessService(db);
  const settings = instanceSettingsService(db);
  async function authorize(req: Request, permission: "workflows:read" | "workflows:edit" | "workflows:publish") {
    const companyId = req.params.companyId as string;
    if (req.query.expectedUserId !== undefined && (typeof req.query.expectedUserId !== "string" || req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) {
      throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    }
    if ((await settings.getExperimental()).enableAutomationArtifactsV1 !== true) {
      throw notFound("Automation Artifacts are not enabled", { code: "automation_artifacts_disabled" });
    }
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
      const decision = await access.decide({ actor: req.actor, action: permission,
        resource: { type: "company", companyId } });
      if (!decision.allowed) throw forbidden(decision.explanation, { code: "permission_denied", permission });
    }
    if (req.actor.source === "local_implicit") {
      return { principal: { type: "system" as const, service: "local-board" } };
    }
    if (!req.actor.userId) throw unauthorized("Authenticated user identity required");
    return { principal: { type: "user" as const, userId: req.actor.userId } };
  }
  router.get("/companies/:companyId/automation-artifacts", async (req, res) => {
    const actor = await authorize(req, "workflows:read");
    res.json(await artifacts.list(req.params.companyId as string, actor));
  });
  router.get("/companies/:companyId/automation-artifacts/:artifactId", async (req, res) => {
    const actor = await authorize(req, "workflows:read");
    const detail = await artifacts.getDetail(req.params.companyId as string, req.params.artifactId as string, actor);
    if (!detail) throw notFound("Automation Artifact not found");
    res.json(detail);
  });
  router.post("/companies/:companyId/automation-artifacts", validate(createAutomationArtifactSchema), async (req, res) => {
    const actor = await authorize(req, "workflows:edit");
    res.status(201).json(await artifacts.create(req.params.companyId as string, req.body, actor));
  });
  router.post("/companies/:companyId/automation-artifacts/:artifactId/versions", validate(appendAutomationArtifactVersionSchema), async (req, res) => {
    const actor = await authorize(req, "workflows:edit");
    res.status(201).json(await artifacts.appendVersion(req.params.companyId as string, req.params.artifactId as string, req.body, actor));
  });
  router.post("/companies/:companyId/automation-artifacts/:artifactId/evaluate", async (req, res) => {
    const actor = await authorize(req, "workflows:edit");
    const companyId = req.params.companyId as string;
    const artifactId = req.params.artifactId as string;
    // The caller requests evaluation; it cannot supply or mark gate reports passed.
    if (!(await artifacts.getDetail(companyId, artifactId, actor))) throw notFound("Automation Artifact not found");
    res.json(await security.evaluateLatestVersion(companyId, artifactId,
      { principal: { type: "system", service: "artifact-security-evaluator" },sourceActor:req.actor }));
  });
  router.post("/companies/:companyId/automation-artifacts/:artifactId/status", validate(transitionAutomationArtifactStatusSchema), async (req, res) => {
    const actor = await authorize(req, "workflows:publish");
    res.json(await artifacts.transitionStatus(req.params.companyId as string, req.params.artifactId as string, req.body, actor));
  });
  router.post("/companies/:companyId/automation-artifacts/:artifactId/archive", validate(archiveAutomationArtifactSchema), async (req, res) => {
    const actor = await authorize(req, "workflows:publish");
    res.json(await artifacts.archive(req.params.companyId as string, req.params.artifactId as string, req.body, actor));
  });
  return router;
}
