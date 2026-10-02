import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { desc, eq } from "drizzle-orm";
import { memoryJobs } from "@paperclipai/db";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { memoryMaintenanceInputSchema } from "../services/memory/memory-maintenance.js";
import {
  memoryBindingInputSchema,
  memoryBindingTargetInputSchema,
  memoryCandidateInputSchema,
  memoryCorrectionInputSchema,
  memoryRecordListQuerySchema,
  memoryReviewReasonSchema,
  memoryRevokeInputSchema,
  memoryRetentionPolicyInputSchema,
  memorySourceDeletionInputSchema,
  memoryDeletionLedgerInputSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden, notFound, unauthorized, unprocessable } from "../errors.js";
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
  const jobs = memoryJobService(db);

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

  function assertSharedCandidateInput(input: {
    scope: { type: string };
    ownerAgentId: string | null;
  }) {
    if (input.scope.type === "agent" || input.ownerAgentId !== null) {
      throw unprocessable(
        "Private agent memory is not available on the board Memory surface",
        { code: "private_memory_board_write_denied" },
      );
    }
  }

  async function assertSharedRecord(
    companyId: string,
    recordId: string,
    actor: MemoryMutationActor,
  ) {
    const detail = await svc.getShared(companyId, recordId, actor);
    if (!detail) {
      throw notFound("Memory record not found", {
        code: "shared_memory_record_not_found",
      });
    }
  }

  router.get("/companies/:companyId/memory/jobs", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    if (!(await svc.getRetentionPolicy(companyId, boardActor(req))).canManage) throw forbidden("Memory jobs require an owner or administrator");
    const rows = await db.select().from(memoryJobs).where(eq(memoryJobs.companyId, companyId)).orderBy(desc(memoryJobs.createdAt)).limit(50);
    res.json(rows.map((row) => ({ id: row.id, operationType: row.operationType, status: row.status, attemptNumber: row.attemptNumber,
      submittedAt: row.submittedAt, finishedAt: row.finishedAt, errorCode: row.errorCode,
      result: row.operationType === "dedupe" || row.operationType === "compaction" || row.operationType === "reflection" || row.operationType === "index_refresh" ? row.resultJson : null })));
  });
  router.post("/companies/:companyId/memory/jobs", validate(memoryMaintenanceInputSchema), async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    const actor = boardActor(req);
    if (!(await svc.getRetentionPolicy(companyId, actor)).canManage) throw forbidden("Memory jobs require an owner or administrator");
    const job = await jobs.enqueueMaintenance(companyId, req.body, actor, req.header("Idempotency-Key") ?? "");
    res.status(202).json({ id: job.id, operationType: job.operationType, status: job.status });
  });

  router.get("/companies/:companyId/memory/export", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'attachment; filename="memory-export.json"');
    res.json(await svc.export(companyId, boardActor(req)));
  });
  router.get("/companies/:companyId/memory/deletion-ledger", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await svc.exportDeletionLedger(companyId, boardActor(req)));
  });
  router.post("/companies/:companyId/memory/deletion-ledger/restore", validate(memoryDeletionLedgerInputSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.json(await svc.restoreDeletionLedger(companyId, req.body, boardActor(req)));
  });
  router.delete("/companies/:companyId/memory/records/:recordId", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    const actor = boardActor(req);
    await assertSharedRecord(companyId, req.params.recordId as string, actor);
    res.json(await svc.forget(companyId, req.params.recordId as string, actor));
  });
  router.get("/companies/:companyId/memory/retention-policy", async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.json(await svc.getRetentionPolicy(companyId, boardActor(req)));
  });
  router.put("/companies/:companyId/memory/retention-policy", validate(memoryRetentionPolicyInputSchema), async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.json(await svc.setRetentionPolicy(companyId, req.body, boardActor(req)));
  });
  router.post("/companies/:companyId/memory/source-deletions", validate(memorySourceDeletionInputSchema), async (req, res) => {
    await assertMemoryEnabled();
    const companyId = req.params.companyId as string;
    assertBoardCompany(req, companyId);
    res.json(await svc.forgetSource(companyId, req.body, boardActor(req)));
  });

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
      assertSharedCandidateInput(req.body);
      const created = await svc.createCandidate(
        companyId,
        req.body,
        boardActor(req),
      );
      const reusedExistingRecord =
        created.resolution.kind === "duplicate" ||
        created.resolution.kind === "corroboration" ||
        (created.resolution.kind === "contradiction" &&
          created.resolution.targetRecordId === created.record.id);
      const status = reusedExistingRecord ? 200 : 201;
      res.status(status).json(created);
    },
  );

  router.post(
    "/companies/:companyId/memory/records/:recordId/accept",
    validate(memoryReviewReasonSchema),
    async (req, res) => {
      await assertMemoryEnabled();
      const companyId = req.params.companyId as string;
      assertBoardCompany(req, companyId);
      const actor = boardActor(req);
      const recordId = req.params.recordId as string;
      await assertSharedRecord(companyId, recordId, actor);
      res.json(
        await svc.reviewCandidate(
          companyId,
          recordId,
          { decision: "accept", reason: req.body.reason ?? null },
          actor,
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
      const actor = boardActor(req);
      const recordId = req.params.recordId as string;
      await assertSharedRecord(companyId, recordId, actor);
      res.json(
        await svc.reviewCandidate(
          companyId,
          recordId,
          { decision: "reject", reason: req.body.reason },
          actor,
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
      const actor = boardActor(req);
      const recordId = req.params.recordId as string;
      await assertSharedRecord(companyId, recordId, actor);
      const created = await svc.createCorrectionCandidate(
        companyId,
        recordId,
        req.body,
        actor,
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
      const actor = boardActor(req);
      const recordId = req.params.recordId as string;
      await assertSharedRecord(companyId, recordId, actor);
      res.json(
        await svc.revoke(
          companyId,
          recordId,
          req.body,
          actor,
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
      if (req.body.targetType === "agent") {
        throw unprocessable(
          "Private agent memory targets are not available on the board Memory surface",
          { code: "private_memory_board_target_denied" },
        );
      }
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
