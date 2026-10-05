import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createUseCaseSchema,
  updateUseCaseSchema,
  useCaseAssessmentSchema,
  useCaseDecisionSchema,
  useCaseDeploymentSchema,
  oversightProfileSchema,
  governanceObligationSchema,
} from "@paperclipai/shared";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { aiGovernanceService } from "../services/ai-governance/governance-service.js";
import { conflict } from "../errors.js";
import { governanceEvidencePack } from "../services/ai-governance/evidence-pack.js";
export function aiGovernanceRoutes(db: Db) {
  const router = Router(),
    service = aiGovernanceService(db);
  function companyAccess(req: Request, companyId: string) {
    if (
      typeof req.query.expectedUserId === "string" &&
      (req.actor.type !== "board" ||
        req.actor.userId !== req.query.expectedUserId)
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    assertCompanyAccess(req, companyId);
  }
  router.get(
    "/companies/:companyId/ai-use-case-deployment-targets",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res.json(await service.targets(req.actor, companyId));
    },
  );
  router.get(
    "/companies/:companyId/ai-use-cases/:id/evidence-pack",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await governanceEvidencePack(
          db,
          req.actor,
          companyId,
          req.params.id as string,
        ),
      );
    },
  );
  router.get("/companies/:companyId/ai-use-cases", async (req, res) => {
    const companyId = req.params.companyId as string;
    companyAccess(req, companyId);
    res.json(await service.list(req.actor, companyId));
  });
  router.post(
    "/companies/:companyId/ai-use-cases",
    validate(createUseCaseSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res
        .status(201)
        .json(await service.create(req.actor, companyId, req.body));
    },
  );
  router.get("/companies/:companyId/ai-use-cases/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    companyAccess(req, companyId);
    res.json(await service.get(req.actor, companyId, req.params.id as string));
  });
  router.patch(
    "/companies/:companyId/ai-use-cases/:id",
    validate(updateUseCaseSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res.json(
        await service.update(
          req.actor,
          companyId,
          req.params.id as string,
          req.body,
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/ai-use-cases/:id/assessments",
    validate(useCaseAssessmentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res
        .status(201)
        .json(
          await service.assess(
            req.actor,
            companyId,
            req.params.id as string,
            req.body,
          ),
        );
    },
  );
  router.post(
    "/companies/:companyId/ai-use-cases/:id/deployments",
    validate(useCaseDeploymentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res
        .status(201)
        .json(
          await service.bind(
            req.actor,
            companyId,
            req.params.id as string,
            req.body,
          ),
        );
    },
  );
  for (const action of ["approve", "suspend", "retire"] as const)
    router.post(
      `/companies/:companyId/ai-use-cases/:id/${action}`,
      validate(useCaseDecisionSchema),
      async (req, res) => {
        const companyId = req.params.companyId as string;
        companyAccess(req, companyId);
        res.json(
          await service.decide(
            req.actor,
            companyId,
            req.params.id as string,
            action,
            req.body,
          ),
        );
      },
    );
  router.get(
    "/companies/:companyId/human-oversight-profiles",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res.json(await service.profiles(req.actor, companyId));
    },
  );
  router.post(
    "/companies/:companyId/human-oversight-profiles",
    validate(oversightProfileSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res
        .status(201)
        .json(await service.oversight(req.actor, companyId, req.body));
    },
  );
  router.get(
    "/companies/:companyId/governance-obligations",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res.json(await service.obligations(req.actor, companyId));
    },
  );
  router.post(
    "/companies/:companyId/governance-obligations",
    validate(governanceObligationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      companyAccess(req, companyId);
      res
        .status(201)
        .json(await service.obligation(req.actor, companyId, req.body));
    },
  );
  return router;
}
