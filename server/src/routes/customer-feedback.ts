import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  FEEDBACK_CONTACTS,
  customerFeedbackPolicySchema,
} from "@paperclipai/shared";
import { assertBoard, hasCompanyAccess } from "./authz.js";
import { badRequest, conflict, forbidden, tooManyRequests, unprocessable } from "../errors.js";
import { customerFeedbackService } from "../services/customer-feedback.js";
import { loadFeedbackDataProcessingAdmission } from "../services/feedback-data-processing.js";
import { configuredFeedbackImageScanner, FEEDBACK_IMAGE_MAX_BYTES } from "../services/feedback-image-intake.js";
import { customerFeedbackImageService } from "../services/customer-feedback-images.js";
import type { StorageService } from "../storage/types.js";
import { customerFeedbackRetentionService } from "../services/customer-feedback-retention.js";
import { customerFeedbackRetentionErasureService } from "../services/customer-feedback-retention-erasure.js";

export function customerFeedbackRoutes(
  db: Db,
  options: {
    operatorUserIds?: readonly string[];
    runtimeEnv?: Readonly<Record<string, string | undefined>>;
    storage?: StorageService;
  } = {},
) {
  const router = Router(),
    service = customerFeedbackService(db, options),
    dataProcessing = loadFeedbackDataProcessingAdmission(options.runtimeEnv);
  const scanner = configuredFeedbackImageScanner(options.runtimeEnv);
  const imageService = options.storage
    ? customerFeedbackImageService(db, options.storage, { scanner, operatorUserIds: options.operatorUserIds }) : null;
  const retention = customerFeedbackRetentionService(db, options);
  const retentionErasure = options.storage ? customerFeedbackRetentionErasureService(db, options.storage, options) : null;
  const upload = multer({ storage: multer.memoryStorage(),
    limits: { fileSize: FEEDBACK_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 100 } });
  // HOUSE per-process bound includes scanner, multipart buffers and decoder
  // work. Native per-principal budgets remain shared across server processes.
  let activeImageUploads = 0;
  // Preview intake still requires current native authority, the original
  // abuse budget and actual local scanner admission before parsing any bytes.
  function images() {
    if (!imageService) throw unprocessable("Protected feedback image storage is unavailable");
    return imageService;
  }
  function identity(req: Request) {
    assertBoard(req);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
  }
  function context(req: Request) {
    identity(req);
    const id = z.uuid().safeParse(req.params.companyId);
    if (!id.success) throw badRequest("Invalid company ID");
    // Actor-owned feedback is not a company-work mutation. Viewers may submit
    // their own feedback; native current-read membership is checked in service.
    if (!hasCompanyAccess(req, id.data))
      throw forbidden("Company access required");
    return id.data.toLowerCase();
  }
  const feedbackId = (req: Request) => z.uuid().toLowerCase().parse(req.params.feedbackId);
  router.get("/internal/customer-feedback/:companyId/:feedbackId/retention", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await retention.get(req.actor, z.uuid().parse(req.params.companyId), feedbackId(req)));
  });
  router.post("/internal/customer-feedback/:companyId/:feedbackId/retention", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await retention.change(req.actor, z.uuid().parse(req.params.companyId), feedbackId(req), req.body));
  });
  router.get("/internal/customer-feedback/:companyId/:feedbackId/retention-plan", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await retention.plan(req.actor, z.uuid().parse(req.params.companyId), feedbackId(req)));
  });
  const erasurePath = "/internal/customer-feedback/:companyId/:feedbackId/retention-erasures";
  function erasures() {
    if (!retentionErasure) throw unprocessable("Protected feedback image storage is unavailable");
    return retentionErasure;
  }
  router.get("/internal/customer-feedback/:companyId/retention-erasures", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await erasures().history(req.actor, z.uuid().toLowerCase().parse(req.params.companyId)));
  });
  router.get(`${erasurePath}/review`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await erasures().review(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req)));
  });
  router.get(`${erasurePath}/:operationId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await erasures().get(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req),
      z.uuid().toLowerCase().parse(req.params.operationId)));
  });
  router.get(`${erasurePath}/requests/:requestKey`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await erasures().getRequest(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req),
      z.uuid().toLowerCase().parse(req.params.requestKey)));
  });
  router.post(erasurePath, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await erasures().execute(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req), req.body));
  });
  const imageId = (req: Request) => z.uuid().toLowerCase().parse(req.params.imageId);
  const imagePath = "/companies/:companyId/customer-feedback/:feedbackId/images";
  const internalImagePath = "/internal/customer-feedback/:companyId/:feedbackId/images";
  router.get(internalImagePath, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.json(await images().internalList(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req)));
  });
  router.get(`${internalImagePath}/:imageId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); identity(req);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    const result = await images().internalRead(req.actor, z.uuid().toLowerCase().parse(req.params.companyId), feedbackId(req), imageId(req));
    res.setHeader("Content-Disposition", "inline; filename=\"image\"");
    res.type(result.mediaType).send(result.body);
  });
  router.get(imagePath, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await images().list(req.actor, context(req), feedbackId(req)));
  });
  router.get(`${imagePath}/requests/:requestKey`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await images().request(req.actor, context(req), feedbackId(req), z.uuid().parse(req.params.requestKey)));
  });
  router.post(imagePath, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const companyId = context(req), id = feedbackId(req);
    if (!scanner) {
      await images().preflight(req.actor, companyId, id);
      throw unprocessable("Feedback image scanning is unavailable", { code: "FEEDBACK_IMAGES_UNAVAILABLE" });
    }
    if (!req.is("multipart/form-data")) throw badRequest("Choose one image file");
    const requestKey = z.uuid().toLowerCase().parse(req.header("X-AW-Feedback-Request-Key"));
    if (activeImageUploads >= 4) throw tooManyRequests("Image processing is busy. Try again later.");
    activeImageUploads++;
    try {
      const admission = await images().admitUpload(req.actor, companyId, id, requestKey);
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown) => {
          if (done) return; done = true;
          clearTimeout(timer); req.removeListener("aborted", aborted);
          if (error) reject(error); else resolve();
        };
        const aborted = () => finish(badRequest("Image input was interrupted"));
        const timer = setTimeout(() => {
          finish(badRequest("Image input timed out")); req.destroy();
        }, 30_000);
        req.once("aborted", aborted);
        upload.single("file")(req, res, error => finish(error
          ? unprocessable("Choose one PNG, JPEG or WebP image of at most 10 MiB") : undefined));
      });
      if (!req.file) throw badRequest("Choose one image file");
      res.status(201).json(await images().upload(req.actor, companyId, id, requestKey,
        req.file.buffer, req.file.mimetype, admission));
    } finally { activeImageUploads--; }
  });
  router.get(`${imagePath}/:imageId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    const result = await images().read(req.actor, context(req), feedbackId(req), imageId(req));
    res.setHeader("Content-Disposition", "inline; filename=\"image\"");
    res.type(result.mediaType).send(result.body);
  });
  router.delete(`${imagePath}/:imageId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await images().remove(req.actor, context(req), feedbackId(req), imageId(req)));
  });
  router.get("/customer-feedback/policy", (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(
      customerFeedbackPolicySchema.parse({
        contacts: FEEDBACK_CONTACTS,
        attachments: {
          enabled: !!imageService && !!scanner,
          reason: imageService && scanner ? "validation_required" : "scanner_qualification_required",
          types: ["image/png", "image/jpeg", "image/webp"],
          maxFiles: 3,
          maxBytes: 10485760,
        },
        retention: { status: dataProcessing.retentionStatus },
        ga: {
          allowed: dataProcessing.gaAllowed,
          reason: "data_processing_qualification_required",
        },
      }),
    );
  });
  router.get("/companies/:companyId/customer-feedback", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(
      await service.list(
        req.actor,
        context(req),
        z.uuid().optional().parse(req.query.before),
      ),
    );
  });
  router.get(
    "/companies/:companyId/customer-feedback/:feedbackId",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(await service.get(req.actor, context(req), feedbackId(req)));
    },
  );
  router.post("/companies/:companyId/customer-feedback", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res
      .status(201)
      .json(await service.create(req.actor, context(req), req.body));
  });
  router.post(
    "/companies/:companyId/customer-feedback/:feedbackId/follow-up",
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.followUp(
          req.actor,
          context(req),
          feedbackId(req),
          req.body,
        ),
      );
    },
  );
  // Explicit platform operator admission lives in service; no company-admin bypass.
  router.get("/internal/customer-feedback/:companyId", async (req, res) => {
    identity(req);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(
      await service.internalList(
        req.actor,
        z.uuid().parse(req.params.companyId),
        z.uuid().optional().parse(req.query.before),
      ),
    );
  });
  router.get(
    "/internal/customer-feedback/:companyId/:feedbackId",
    async (req, res) => {
      identity(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.internalGet(
          req.actor,
          z.uuid().parse(req.params.companyId),
          feedbackId(req),
          z.uuid().optional().parse(req.query.beforeEvent),
        ),
      );
    },
  );
  router.post(
    "/internal/customer-feedback/:companyId/:feedbackId/triage",
    async (req, res) => {
      identity(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(
        await service.triage(
          req.actor,
          z.uuid().parse(req.params.companyId),
          feedbackId(req),
          req.body,
        ),
      );
    },
  );
  return router;
}
