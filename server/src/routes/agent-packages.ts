import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  packageInstallSchema,
  packageDecisionSchema,
  packageUpdateSchema,
  packageReleaseSchema,
} from "@paperclipai/shared";
import {
  agentPackageService,
  type PackagePublisherOptions,
} from "../services/agent-packages/package-service.js";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import { conflict, notFound } from "../errors.js";
export function agentPackageRoutes(
  db: Db,
  options: PackagePublisherOptions = {},
) {
  const router = Router(),
    service = agentPackageService(db, options);
  function account(req: Request) {
    if (
      typeof req.query.expectedUserId === "string" &&
      (req.actor.type !== "board" ||
        req.actor.userId !== req.query.expectedUserId)
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
  }
  function company(req: Request) {
    account(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    return companyId;
  }
  router.get("/agent-packages", async (req, res) => {
    account(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.catalog(req.actor));
  });
  router.post(
    "/agent-packages/releases",
    validate(packageReleaseSchema),
    async (req, res) => {
      account(req);
      res.status(201).json(await service.publish(req.actor, req.body));
    },
  );
  router.post("/agent-packages/releases/:id/revoke", async (req, res) => {
    account(req);
    res.json(await service.revoke(req.actor, req.params.id as string));
  });
  router.get("/agent-packages/:packageKey", async (req, res) => {
    account(req);
    const rows = (await service.catalog(req.actor)).filter(
      (r) => r.key === req.params.packageKey,
    );
    if (!rows.length) throw notFound("Package not found");
    res.json(rows);
  });
  for (const action of ["preview", "install"] as const)
    router.post(
      `/companies/:companyId/agent-packages/:packageKey/${action}`,
      validate(packageInstallSchema),
      async (req, res) => {
        const companyId = company(req);
        const catalog = await service.catalog(req.actor);
        if (
          !catalog.some(
            (r) =>
              r.key === req.params.packageKey &&
              r.versionId === req.body.versionId,
          )
        )
          throw notFound("Package version not found");
        res
          .status(action === "install" ? 201 : 200)
          .json(await service[action](req.actor, companyId, req.body));
      },
    );
  router.get(
    "/companies/:companyId/agent-package-update-proposals",
    async (req, res) =>
      res.json(await service.proposals(req.actor, company(req))),
  );
  router.post(
    "/companies/:companyId/agent-package-update-proposals/:id/review",
    async (req, res) => {
      if (req.body?.decision !== "accept" && req.body?.decision !== "reject")
        throw conflict("Choose an explicit review decision");
      res.json(
        await service.reviewProposal(
          req.actor,
          company(req),
          req.params.id as string,
          req.body.decision,
        ),
      );
    },
  );
  router.get("/companies/:companyId/agent-package-options", async (req, res) =>
    res.json(await service.options(req.actor, company(req))),
  );
  router.get(
    "/companies/:companyId/agent-package-installations",
    async (req, res) => res.json(await service.list(req.actor, company(req))),
  );
  router.get(
    "/companies/:companyId/agent-package-installations/:id",
    async (req, res) =>
      res.json(
        await service.get(req.actor, company(req), req.params.id as string),
      ),
  );
  for (const action of ["activate", "suspend"] as const)
    router.post(
      `/companies/:companyId/agent-package-installations/:id/${action}`,
      validate(packageDecisionSchema),
      async (req, res) =>
        res.json(
          await service.decide(
            req.actor,
            company(req),
            req.params.id as string,
            action,
            req.body,
          ),
        ),
    );
  router.delete(
    "/companies/:companyId/agent-package-installations/:id",
    validate(packageDecisionSchema),
    async (req, res) =>
      res.json(
        await service.decide(
          req.actor,
          company(req),
          req.params.id as string,
          "uninstall",
          req.body,
        ),
      ),
  );
  router.post(
    "/companies/:companyId/agent-package-installations/:id/update",
    validate(packageUpdateSchema),
    async (req, res) =>
      res.json(
        await service.update(
          req.actor,
          company(req),
          req.params.id as string,
          req.body,
        ),
      ),
  );
  return router;
}
