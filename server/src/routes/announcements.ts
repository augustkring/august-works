import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { companies, trustDocumentAcceptances, trustDocumentActionReceipts, type Db } from "@paperclipai/db";
import { ANNOUNCEMENT_ANIMATION_CSP, announcementIdSchema, dismissAnnouncementSchema, trustAcceptanceNoticeListSchema, trustDocumentListQuerySchema } from "@paperclipai/shared";
import { badRequest, forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertAuthenticated, assertBoard, assertCompanyAccess, hasCompanyAccess } from "./authz.js";
import { announcementService } from "../services/announcements.js";
import { announcementFeedService, type AnnouncementFeedOptions } from "../services/announcement-feed.js";
import { resolveCurrentTrustMaterialChangeRequirements } from "../services/trust-documents.js";
import { projectTrustAcceptanceNotices } from "../services/experience/product-notices.js";

export function announcementRoutes(db: Db, options: AnnouncementFeedOptions, feed = announcementFeedService(options)) {
  const router = Router();
  const service = announcementService(db);
  router.use("/announcements", (req, res, next) => {
    assertAuthenticated(req);
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("Board user context required");
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.get("/announcements/current", async (req, res) => {
    const announcement = await feed.current();
    if (announcement) await service.registerPublication(announcement.id);
    res.json(announcement && !await service.isDismissed(req.actor.userId!, announcement.id) ? announcement : null);
  });
  router.get("/companies/:companyId/notices/action-required", async (req, res) => {
    assertAuthenticated(req);
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("A current Human account is required");
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const query = trustDocumentListQuerySchema.parse(req.query);
    res.setHeader("Cache-Control", "private, no-store");
    const result = await db.transaction(async raw => {
      const tx = raw as unknown as Db;
      const resolved = await resolveCurrentTrustMaterialChangeRequirements(tx, req.actor, companyId, query.expectedUserId);
      const requirements = resolved.documents;
      if (!requirements.length) return { configured: false, notices: [] };
      const completed = new Set<string>();
      const registryIds = requirements.map(document => document.id);
      const acceptedRows = await tx.select({ registryEntryId: trustDocumentAcceptances.registryEntryId,
        documentRevisionId: trustDocumentAcceptances.documentRevisionId,
        documentVersion: trustDocumentAcceptances.documentVersion }).from(trustDocumentAcceptances).where(and(
        eq(trustDocumentAcceptances.companyId, companyId),
        eq(trustDocumentAcceptances.principalUserId, query.expectedUserId),
        inArray(trustDocumentAcceptances.registryEntryId, registryIds),
      ));
      for (const row of acceptedRows) completed.add(`acceptance\u0000${row.registryEntryId}\u0000${row.documentRevisionId}\u0000${row.documentVersion}`);
      const actionRows = await tx.select({ registryEntryId: trustDocumentActionReceipts.registryEntryId,
        documentRevisionId: trustDocumentActionReceipts.documentRevisionId,
        documentVersion: trustDocumentActionReceipts.documentVersion,
        principalUserId: trustDocumentActionReceipts.principalUserId,
        action: trustDocumentActionReceipts.action }).from(trustDocumentActionReceipts).where(and(
        eq(trustDocumentActionReceipts.companyId, companyId),
        inArray(trustDocumentActionReceipts.registryEntryId, registryIds),
      ));
      for (const row of actionRows) {
        if (row.action === "customer_admin_acknowledgment" || row.principalUserId === query.expectedUserId)
          completed.add(`${row.action}\u0000${row.registryEntryId}\u0000${row.documentRevisionId}\u0000${row.documentVersion}`);
      }
      const canAdminAcknowledge = resolved.membershipRole === "owner" || resolved.membershipRole === "admin";
      return { configured: true, notices: projectTrustAcceptanceNotices(companyId, requirements, completed, canAdminAcknowledge) };
    });
    res.json(trustAcceptanceNoticeListSchema.parse(result));
  });
  router.get("/announcements/:id/image", async (req, res) => {
    const id = announcementIdSchema.safeParse(req.params.id);
    if (!id.success) throw badRequest("Invalid announcement ID");
    const image = await feed.image(id.data);
    if (!image) throw notFound("Announcement image unavailable");
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(image.bytes);
  });
  router.get("/announcements/:id/animation", async (req, res) => {
    const id = announcementIdSchema.safeParse(req.params.id);
    if (!id.success) throw badRequest("Invalid announcement ID");
    const animation = await feed.animation(id.data);
    if (!animation) throw notFound("Announcement animation unavailable");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", `sandbox; ${ANNOUNCEMENT_ANIMATION_CSP}`);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(animation.bytes);
  });
  router.post("/announcements/:id/dismiss", validate(dismissAnnouncementSchema), async (req, res) => {
    const id = announcementIdSchema.safeParse(req.params.id);
    if (!id.success) throw badRequest("Invalid announcement ID");
    const { companyId } = req.body;
    // This writes the caller's personal preference. Viewers may dismiss it;
    // company read membership supplies audit context, not write authority.
    if (!hasCompanyAccess(req, companyId)) throw notFound("Company not found");
    if (!await db.query.companies.findFirst({ where: eq(companies.id, companyId), columns: { id: true } })) {
      throw notFound("Company not found");
    }
    if (!await service.dismiss(req.actor.userId!, id.data, companyId)) throw notFound("Announcement not found");
    res.status(204).end();
  });
  return router;
}
