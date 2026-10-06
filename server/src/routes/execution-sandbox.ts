import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { sandboxBindingCreateSchema, sandboxCompileSchema } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { executionSandboxService } from "../services/execution-sandbox/sandbox-service.js";

export function executionSandboxRoutes(db: Db, options: {
  operatorUserIds?: string[];
  backendFor?: NonNullable<Parameters<typeof executionSandboxService>[1]>["backendFor"];
  nativeOperation?: NonNullable<Parameters<typeof executionSandboxService>[1]>["nativeOperation"];
} = {}) {
  const router = Router(), service = executionSandboxService(db, options);
  router.get("/companies/:companyId/runtime-cells/:id/execution-posture", async (req, res) => {
    if (typeof req.query.expectedUserId === "string" && (req.actor.type !== "board" || req.actor.userId !== req.query.expectedUserId)) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
    const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId);
    res.json(await service.posture(req.actor, companyId, req.params.id as string));
  });
  const operator = (req: { actor: { type: string; userId?: string | null } }) => {
    if (req.actor.type !== "board" || !req.actor.userId || !options.operatorUserIds?.includes(req.actor.userId)) throw forbidden("Sandbox control requires a configured platform operator");
  };
  router.get("/companies/:companyId/runtime-sandboxes", async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.list(req.actor, companyId)); });
  router.post("/companies/:companyId/runtime-sandboxes", validate(sandboxBindingCreateSchema), async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.create(req.actor, companyId, req.body)); });
  router.get("/companies/:companyId/runtime-sandboxes/:id", async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.get(req.actor, companyId, req.params.id as string)); });
  router.post("/companies/:companyId/runtime-sandboxes/:id/qualify", validate(z.object({ expectedVersion: z.number().int().positive() }).strict()), async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.qualify(req.actor, companyId, req.params.id as string, req.body.expectedVersion)); });
  router.post("/companies/:companyId/runtime-sandboxes/:id/reconcile", validate(z.object({ expectedVersion: z.number().int().positive() }).strict()), async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.json(await service.reconcile(req.actor, companyId, req.params.id as string, req.body.expectedVersion)); });
  router.post("/companies/:companyId/runtime-sandboxes/:id/policy", validate(sandboxCompileSchema), async (req, res) => { operator(req); const companyId = req.params.companyId as string; assertCompanyAccess(req, companyId); res.status(201).json(await service.compile(req.actor, companyId, req.params.id as string, req.body)); });
  return router;
}
