import { exportCompanyStateV7 } from "../services/enterprise/portability.js";
import { securityEventExportService } from "../services/enterprise/security-events.js";
import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  enterpriseIdentityPolicySchema,
  enterpriseSubjectBindingSchema,
  enterpriseQualificationSchema,
  enterprisePolicyDecisionSchema,
  enterpriseCredentialRotationSchema,
  securityEventExportConfigurationSchema,
} from "@paperclipai/shared";
import {
  enterpriseIdentityPolicyService,
  type EnterprisePublisherOptions,
} from "../services/enterprise/identity-policy.js";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { conflict, notFound } from "../errors.js";
export function enterpriseRoutes(db: Db, options?: EnterprisePublisherOptions) {
  const router = Router();
  function company(req: Request, requirePlatform = true) {
    if (requirePlatform && !options)
      throw notFound("Enterprise platform configuration is unavailable");
    if (
      typeof req.query.expectedUserId === "string" &&
      (req.actor.type !== "board" ||
        req.actor.userId !== req.query.expectedUserId)
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    return companyId;
  }
  const service = () => {
    if (!options)
      throw notFound("Enterprise platform configuration is unavailable");
    return enterpriseIdentityPolicyService(db, options);
  };
  router.get("/companies/:companyId/portability/v7", async (req, res) => {
    const c = company(req, false);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="august-works-company-state-v7.json"',
    );
    res.json(await exportCompanyStateV7(db, req.actor, c));
  });
  router.get(
    "/companies/:companyId/enterprise/security-events",
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await securityEventExportService(db).get(req.actor, c));
    },
  );
  router.put(
    "/companies/:companyId/enterprise/security-events",
    validate(securityEventExportConfigurationSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await securityEventExportService(db).configure(req.actor, c, req.body),
      );
    },
  );
  router.get("/companies/:companyId/enterprise/identity", async (req, res) => {
    const c = company(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service().get(req.actor, c));
  });
  router.put(
    "/companies/:companyId/enterprise/identity",
    validate(enterpriseIdentityPolicySchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await service().configure(req.actor, c, req.body));
    },
  );
  router.post(
    "/companies/:companyId/enterprise/identity/qualify",
    validate(enterpriseQualificationSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await service().qualify(req.actor, c, req.body));
    },
  );
  router.post(
    "/companies/:companyId/enterprise/identity/subjects",
    validate(enterpriseSubjectBindingSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(await service().bind(req.actor, c, req.body));
    },
  );
  router.get(
    "/companies/:companyId/enterprise/identity/subjects",
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await service().listBindings(req.actor, c));
    },
  );
  router.delete(
    "/companies/:companyId/enterprise/identity/subjects/:bindingId",
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await service().revokeBinding(
          req.actor,
          c,
          req.params.bindingId as string,
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/enterprise/identity/scim-credential",
    validate(enterpriseCredentialRotationSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await service().rotateScim(
          req.actor,
          c,
          req.body.expectedVersion,
          req.body.expectedCredentialId,
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/enterprise/identity/scim-decommission",
    validate(enterprisePolicyDecisionSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await service().decommissionScim(
          req.actor,
          c,
          req.body.expectedVersion,
        ),
      );
    },
  );
  router.post(
    "/companies/:companyId/enterprise/identity/suspend",
    validate(enterprisePolicyDecisionSchema),
    async (req, res) => {
      const c = company(req);
      res.setHeader("Cache-Control", "no-store");
      res.json(await service().suspend(req.actor, c, req.body.expectedVersion));
    },
  );
  return router;
}
