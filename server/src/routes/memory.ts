import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  memoryBindingInputSchema,
  memoryBindingTargetInputSchema,
  memoryCandidateInputSchema,
  memoryCorrectionInputSchema,
  memoryRecordListQuerySchema,
  memoryReviewReasonSchema,
  memoryRevokeInputSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { notFound, unauthorized, unprocessable } from "../errors.js";
import {
  instanceSettingsService,
  memoryService,
  type MemoryMutationActor,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function memoryRoutes(db: Db) {
  const router = Router();
  const svc = memoryService(db);
  const settings = instanceSettingsService(db);

  async function assertMemoryEnabled() {
    const experimental = await settings.getExperimental();
    if (experimental.enableCollectiveMemoryV1 !== true) {
      throw notFound("Memory is not enabled", { code: "memory_disabled" });
    }
  }

  function boardActor(req: Request): MemoryMutationActor {
    assertBoard(req);
    if (req.actor.source === "local_implicit") {
      return {
        principal: { type: "system", service: "local-board" },
        runId: req.actor.runId ?? null,
      };
    }
    if (!req.actor.userId) {
      throw unauthorized("Authenticated user identity required");
    }
    return {
      principal: { type: "user", userId: req.actor.userId },
      runId: req.actor.runId ?? null,
    };
  }

  function assertBoardCompany(req: Request, companyId: string) {
    assertBoard(req);
    assertCompanyAccess(req, companyId);
  }

  router.get("/companies/:companyId/memory/records", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    const query = memoryRecordListQuerySchema.parse(req.query);
    res.json(await svc.listReviewable(companyId, query, boardActor(req)));
  });

  router.get("/companies/:companyId/memory/records/:recordId", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    const detail = await svc.getShared(
      companyId,
      req.params.recordId as string,
      boardActor(req),
    );
    if (!detail) {
      res.status(404).json({ error: "Memory record not found" });
      return;
    }
    res.json(detail);
  });

  router.post(
    "/companies/:companyId/memory/candidates",
    validate(memoryCandidateInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const created = await svc.createCandidate(companyId, req.body, boardActor(req));
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/memory/records/:recordId/accept",
    validate(memoryReviewReasonSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      res.json(
        await svc.reviewCandidate(
          companyId,
          req.params.recordId as string,
          { decision: "accept", reason: req.body.reason ?? null },
          boardActor(req),
        ),
      );
    },
  );

  router.post(
    "/companies/:companyId/memory/records/:recordId/reject",
    validate(memoryReviewReasonSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      if (!req.body.reason) {
        throw unprocessable("Rejected memory requires a reason", {
          code: "memory_rejection_reason_required",
        });
      }
      res.json(
        await svc.reviewCandidate(
          companyId,
          req.params.recordId as string,
          { decision: "reject", reason: req.body.reason },
          boardActor(req),
        ),
      );
    },
  );

  router.post(
    "/companies/:companyId/memory/records/:recordId/correct",
    validate(memoryCorrectionInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const created = await svc.createCorrectionCandidate(
        companyId,
        req.params.recordId as string,
        req.body,
        boardActor(req),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/memory/records/:recordId/revoke",
    validate(memoryRevokeInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      res.json(
        await svc.revoke(
          companyId,
          req.params.recordId as string,
          req.body,
          boardActor(req),
        ),
      );
    },
  );

  router.get("/companies/:companyId/memory/bindings", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.json(await svc.listBindings(companyId, boardActor(req)));
  });

  router.post(
    "/companies/:companyId/memory/bindings/company",
    validate(memoryBindingInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const created = await svc.createCompanyBinding(
        companyId,
        req.body,
        boardActor(req),
      );
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/memory/bindings",
    validate(memoryBindingInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const created = await svc.createBinding(companyId, req.body, boardActor(req));
      res.status(201).json(created);
    },
  );

  router.post(
    "/companies/:companyId/memory/bindings/:bindingId/targets",
    validate(memoryBindingTargetInputSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const created = await svc.addBindingTarget(
        companyId,
        req.params.bindingId as string,
        req.body,
        boardActor(req),
      );
      res.status(201).json(created);
    },
  );

  return router;
}
