import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
  agentDraftPrepareSchema,
  agentDraftTestCommandSchema,
  verificationReviewSchema,
  agentDraftPublicationCommandSchema,
  agentPackageSetupCommandSchema,
  agentRuntimeCandidateCreateSchema,
  agentRuntimeCandidateConformanceCommandSchema,
  providerConformanceInputSchema,
  agentManagedRuntimeSetupCommandSchema,
  agentManagedRuntimeSetupReviewInputSchema,
  agentModelMigrationMonitorCommandSchema,
} from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { conflict, forbidden } from "../errors.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { agentAuthoringTestService } from "../services/agents/authoring-tests.js";
import { agentAuthoringPublicationService } from "../services/agents/authoring-publication.js";
import { agentAuthoringModelMigrationMonitorService } from "../services/agents/authoring-model-migration-monitor.js";
import { agentAuthoringPackageSetupService } from "../services/agents/authoring-package-setup.js";
import { validate } from "../middleware/validate.js";
import { installedNativeDraftGateway } from "../services/orchestration/native-draft-runtime.js";
import { agentRuntimeCandidateService } from "../services/agents/authoring-runtime-candidates.js";
import { agentRuntimeCandidateConformanceService } from "../services/agents/authoring-runtime-candidate-conformance.js";
import { agentAuthoringManagedRuntimeSetupService } from "../services/agents/authoring-managed-runtime-setup.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";

export function agentAuthoringRoutes(db: Db, platformConfig?: SaasPlatformConfig) {
  const router = Router(),
    service = agentAuthoringService(db);
  // Original metadata receipts do not require an installed model transport.
  // These instances are used only by the read routes below.
  const metadataOptions = { profiles: [], sourceSha: "", protectedEvidenceOrigin: "" };
  const candidateMetadata = agentRuntimeCandidateService(db, metadataOptions);
  const conformanceMetadata = agentRuntimeCandidateConformanceService(db, metadataOptions);
  const managedSetup = agentAuthoringManagedRuntimeSetupService(db, platformConfig);
  function company(req: Request) {
    assertBoard(req);
    const id = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, id);
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== req.actor.userId
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    return id;
  }
  function requireModelMigrationMonitorSession(req: Request, _res: Response, next: NextFunction) {
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId || !req.actor.sessionId)
      return next(forbidden("A current Human session is required", { code: "human_session_required" }));
    next();
  }
  const root = "/companies/:companyId/agent-configuration-drafts";
  router.use(root, (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.get(root, async (req, res) =>
    res.json(
      await service.list(
        req.actor,
        company(req),
        req.query.before === undefined
          ? undefined
          : z.uuid().parse(req.query.before),
      ),
    ),
  );
  router.get(`${root}/admission`, async (req, res) =>
    res.json(
      await service.admission(
        req.actor,
        company(req),
        req.query.agentId === undefined
          ? null
          : z.uuid().parse(req.query.agentId),
      ),
    ),
  );
  router.get(`${root}/options`, async (req, res) =>
    res.json(
      await service.options(
        req.actor,
        company(req),
        req.query.agentId === undefined
          ? null
          : z.uuid().parse(req.query.agentId),
      ),
    ),
  );
  router.get(`${root}/hire-catalog`, async (req, res) =>
    res.json(await service.hireCatalog(req.actor, company(req))),
  );
  router.post(root, validate(agentDraftCreateSchema), async (req, res) =>
    res
      .status(201)
      .json(await service.create(req.actor, company(req), req.body)),
  );
  router.get(`${root}/:id`, async (req, res) =>
    res.json(
      await service.get(req.actor, company(req), z.uuid().parse(req.params.id)),
    ),
  );
  router.get(`${root}/:id/preparation-review`, async (req, res) => res.json(
    await service.preparationReview(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/runtime`, async (req, res) => res.json(
    await service.runtime(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  const runtimeCandidates = "/companies/:companyId/agent-configuration-drafts/:id/runtime-candidates";
  router.get(runtimeCandidates, async (req, res) => res.json(
    await installedNativeDraftGateway(db).runtimeCandidates.catalog(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.post(runtimeCandidates, validate(agentRuntimeCandidateCreateSchema), async (req, res) => res.status(201).json(
    await installedNativeDraftGateway(db).runtimeCandidates.create(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.get(`${runtimeCandidates}/requests/:requestId`, async (req, res) => res.json(
    await candidateMetadata.creationReceipt(req.actor, company(req),
      z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${runtimeCandidates}/:candidateId`, async (req, res) => res.json(
    await candidateMetadata.get(req.actor, company(req),
      z.uuid().parse(req.params.id), z.uuid().parse(req.params.candidateId)),
  ));
  router.get(`${runtimeCandidates}/:candidateId/conformance-review`, async (req, res) => {
    const companyId = company(req);
    const query = z.strictObject({ expectedUserId: z.string().optional(), maximumCostCents: z.coerce.number().int().min(1).max(10000),
      peerCompanyId: z.uuid().optional(), peerAgentId: z.uuid().optional() }).parse(req.query);
    const input = providerConformanceInputSchema.parse({ acknowledgeProviderRuns: true, maximumCostCents: query.maximumCostCents,
      isolationPeer: query.peerCompanyId !== undefined || query.peerAgentId !== undefined
        ? { companyId: query.peerCompanyId, agentId: query.peerAgentId } : null });
    res.json(await installedNativeDraftGateway(db).runtimeCandidateConformance.review(req.actor, companyId,
      z.uuid().parse(req.params.id), z.uuid().parse(req.params.candidateId), input));
  });
  router.post(`${runtimeCandidates}/:candidateId/conformance`, validate(agentRuntimeCandidateConformanceCommandSchema), async (req, res) => res.json(
    await installedNativeDraftGateway(db).runtimeCandidateConformance.start(req.actor, company(req),
      z.uuid().parse(req.params.id), z.uuid().parse(req.params.candidateId), req.body),
  ));
  router.get(`${runtimeCandidates}/:candidateId/conformance/requests/:requestId`, async (req, res) => res.json(
    await conformanceMetadata.receipt(req.actor, company(req),
      z.uuid().parse(req.params.id), z.uuid().parse(req.params.candidateId), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${root}/:id/package-setup-review`, async (req, res) => res.json(
    await agentAuthoringPackageSetupService(db).review(req.actor, company(req), z.uuid().parse(req.params.id),
      req.query.purposeId === undefined ? null : z.uuid().parse(req.query.purposeId)),
  ));
  router.get(`${root}/:id/package-setup-receipt`, async (req, res) => res.json(
    await agentAuthoringPackageSetupService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.query.requestId)),
  ));
  router.post(`${root}/:id/package-setup`, validate(agentPackageSetupCommandSchema), async (req, res) => res.json(
    await agentAuthoringPackageSetupService(db).confirm(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.post(`${root}/:id/prepare`, validate(agentDraftPrepareSchema), async (req, res) => res.json(
    await service.prepare(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.get(`${root}/:id/test-review`, async (req, res) => res.json(
    await agentAuthoringTestService(db).review(req.actor, company(req), z.uuid().parse(req.params.id), z.coerce.number().int().min(0).max(9).parse(req.query.scenarioIndex)),
  ));
  router.get(`${root}/:id/tests`, async (req, res) => res.json(
    await agentAuthoringTestService(db).list(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/tests/:requestId`, async (req, res) => res.json(
    await agentAuthoringTestService(db).get(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${root}/:id/tests/:requestId/verification-packet`, async (req, res) => res.json(
    await agentAuthoringTestService(db).packet(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.post(`${root}/:id/tests/:requestId/verify`, validate(verificationReviewSchema), async (req, res) => res.json(
    await agentAuthoringTestService(db).verify(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId), req.body),
  ));
  router.post(`${root}/:id/tests`, validate(agentDraftTestCommandSchema), async (req, res) => res.json(
    await agentAuthoringTestService(db).start(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.post(
    `${root}/:id/save`,
    validate(agentDraftSaveSchema),
    async (req, res) =>
      res.json(
        await service.save(
          req.actor,
          company(req),
          z.uuid().parse(req.params.id),
          req.body,
        ),
      ),
  );
  router.post(
    `${root}/:id/discard`,
    validate(agentDraftDiscardSchema),
    async (req, res) =>
      res.json(
        await service.discard(
          req.actor,
          company(req),
          z.uuid().parse(req.params.id),
          req.body,
        ),
      ),
  );
  router.get(`${root}/:id/review`, async (req, res) =>
    res.json(
      await service.review(
        req.actor,
        company(req),
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.get(`${root}/:id/hire-capability`, async (req, res) =>
    res.json(
      await service.hireCapability(
        req.actor,
        company(req),
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.get(`${root}/:id/publication-review`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).review(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/publications/:requestId`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get(`${root}/:id/publications`, async (req, res) => res.json(
    await agentAuthoringPublicationService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.post(`${root}/:id/publish`, validate(agentDraftPublicationCommandSchema), async (req, res) => res.json(
    await agentAuthoringPublicationService(db).publish(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  router.get(`${root}/:id/model-migrations/current/monitor-review`, requireModelMigrationMonitorSession, async (req, res) => res.json(
    await agentAuthoringModelMigrationMonitorService(db).current(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get(`${root}/:id/model-migrations/:revisionId/monitor-review`, requireModelMigrationMonitorSession, async (req, res) => res.json(
    await agentAuthoringModelMigrationMonitorService(db).review(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.revisionId)),
  ));
  router.get(`${root}/:id/model-migrations/:revisionId/monitor-receipt`, requireModelMigrationMonitorSession, async (req, res) => res.json(
    await agentAuthoringModelMigrationMonitorService(db).receipt(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.revisionId)),
  ));
  router.post(`${root}/:id/model-migrations/:revisionId/monitor`, requireModelMigrationMonitorSession, validate(agentModelMigrationMonitorCommandSchema), async (req, res) => res.json(
    await agentAuthoringModelMigrationMonitorService(db).record(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.revisionId), req.body),
  ));
  router.get("/companies/:companyId/agent-configuration-drafts/:id/managed-runtime", async (req, res) => res.json(
    await managedSetup.catalog(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.get("/companies/:companyId/agent-configuration-drafts/:id/managed-runtime/review", async (req, res) => res.json(
    await managedSetup.review(req.actor, company(req), z.uuid().parse(req.params.id), agentManagedRuntimeSetupReviewInputSchema.parse({
      capacityProfile: req.query.capacityProfile, imageDigest: req.query.imageDigest,
    })),
  ));
  router.get("/companies/:companyId/agent-configuration-drafts/:id/managed-runtime/requests/:requestId", async (req, res) => res.json(
    await managedSetup.receipt(req.actor, company(req), z.uuid().parse(req.params.id), z.uuid().parse(req.params.requestId)),
  ));
  router.get("/companies/:companyId/agent-configuration-drafts/:id/managed-runtime/requests", async (req, res) => res.json(
    await managedSetup.latestReceipt(req.actor, company(req), z.uuid().parse(req.params.id)),
  ));
  router.post("/companies/:companyId/agent-configuration-drafts/:id/managed-runtime", validate(agentManagedRuntimeSetupCommandSchema), async (req, res) => res.status(202).json(
    await managedSetup.confirm(req.actor, company(req), z.uuid().parse(req.params.id), req.body),
  ));
  return router;
}
