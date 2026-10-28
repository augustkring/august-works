import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import {
  documentRevisions,
  documents,
  trustDocumentAcceptances,
  trustDocumentActionReceipts,
  trustDocumentRegistry,
  type Db,
} from "@paperclipai/db";
import {
  trustDocumentAcceptanceCommandSchema,
  trustDocumentAcceptanceReceiptSchema,
  trustDocumentActionCommandSchema,
  trustDocumentActionReceiptSchema,
  trustDocumentActionReceiptKindSchema,
  trustDocumentContentSchema,
  trustDocumentListQuerySchema,
  trustDocumentRegisterCommandSchema,
  trustDocumentRegistrationReceiptSchema,
  trustDocumentRegistrySchema,
  nativePayloadSourceSnapshotSchema,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";
import {
  assertCurrentCompanyHuman,
  isStandaloneHumanOwnedDocument,
  privateOwnerLinkedDocumentIds,
  resolveCurrentTrustAcceptanceRequirements,
  resolveCurrentTrustDocuments,
} from "../services/trust-documents.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

function actorUserId(req: Request, expectedUserId: string) {
  const userId = v5HumanActorId(req.actor);
  if (expectedUserId !== userId) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  return userId;
}

function receipt(row: typeof trustDocumentAcceptances.$inferSelect) {
  return trustDocumentAcceptanceReceiptSchema.parse({
    requestId: row.requestId,
    companyId: row.companyId,
    principal: row.principalUserId,
    registryEntryId: row.registryEntryId,
    documentRevisionId: row.documentRevisionId,
    documentVersion: row.documentVersion,
    acceptedAt: row.acceptedAt.toISOString(),
    surface: row.surface,
  });
}

function actionReceipt(row: typeof trustDocumentActionReceipts.$inferSelect) {
  return trustDocumentActionReceiptSchema.parse({
    requestId: row.requestId,
    companyId: row.companyId,
    principal: row.principalUserId,
    registryEntryId: row.registryEntryId,
    documentRevisionId: row.documentRevisionId,
    documentVersion: row.documentVersion,
    action: row.action,
    completedAt: row.completedAt.toISOString(),
    surface: row.surface,
  });
}

type TrustActionReceiptKind = z.infer<typeof trustDocumentActionReceiptKindSchema>;

async function completeTrustAction(
  db: Db,
  req: Request,
  companyId: string,
  input: z.infer<typeof trustDocumentActionCommandSchema>,
  action: TrustActionReceiptKind,
) {
  const userId = actorUserId(req, input.expectedUserId);
  const requiredMode = action === "notice_read" ? "notice" : "customer_admin_acknowledgment";
  const requireAdmin = action === "customer_admin_acknowledgment";
  const fingerprint = createHash("sha256").update(JSON.stringify({
    companyId, userId, requestId: input.requestId, registryEntryId: input.registryEntryId,
    version: input.version, action, surface: input.surface,
  })).digest("hex");
  return db.transaction(async tx => {
    const key = `trust-document-action:${companyId}:${userId}:${input.requestId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    await assertCurrentCompanyHuman(tx as unknown as Db, req.actor, companyId, input.expectedUserId, requireAdmin);
    const [prior] = await tx.select().from(trustDocumentActionReceipts).where(and(
      eq(trustDocumentActionReceipts.companyId, companyId),
      eq(trustDocumentActionReceipts.principalUserId, userId),
      eq(trustDocumentActionReceipts.requestId, input.requestId),
    )).limit(1);
    if (prior) {
      if (prior.action !== action || prior.requestHash !== fingerprint)
        throw conflict("This action request ID was already used for different terms");
      return { row: prior, created: false };
    }
    const documents = await resolveCurrentTrustDocuments(tx as unknown as Db, req.actor, companyId, input.expectedUserId);
    const document = documents.find(row => row.id === input.registryEntryId);
    if (!document || document.materialChangeAction !== requiredMode || document.version !== input.version)
      throw conflict("This document version has no current requirement for this action");
    if (requireAdmin)
      await assertCurrentCompanyHuman(tx as unknown as Db, req.actor, companyId, input.expectedUserId, true);
    const [row] = await tx.insert(trustDocumentActionReceipts).values({
      companyId, registryEntryId: document.id, documentRevisionId: document.documentRevisionId,
      principalUserId: userId, documentVersion: document.version, action,
      requestId: input.requestId, requestHash: fingerprint, surface: input.surface,
    }).returning();
    return { row, created: true };
  });
}

export function trustDocumentRoutes(db: Db) {
  const router = Router();
  router.use("/companies/:companyId/trust", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/companies/:companyId/trust/documents", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const query = trustDocumentListQuerySchema.parse(req.query);
    res.setHeader("Cache-Control", "private, no-store");
    const documents = await db.transaction(tx => resolveCurrentTrustDocuments(
      tx as unknown as Db, req.actor, companyId, query.expectedUserId,
    ));
    res.json(trustDocumentRegistrySchema.parse({ configured: documents.length > 0, documents }));
  });

  router.get("/companies/:companyId/trust/documents/:registryEntryId/content", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    const registryEntryId = z.uuid().parse(req.params.registryEntryId);
    assertCompanyAccess(req, companyId);
    const query = trustDocumentListQuerySchema.parse(req.query);
    res.setHeader("Cache-Control", "private, no-store");
    const content = await db.transaction(async tx => {
      const documents = await resolveCurrentTrustDocuments(
        tx as unknown as Db, req.actor, companyId, query.expectedUserId,
      );
      const document = documents.find(row => row.id === registryEntryId);
      if (!document) throw notFound("Current public trust document version not found");
      const [revision] = await tx.select({ format: documentRevisions.format, body: documentRevisions.body })
        .from(documentRevisions)
        .where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.id, document.documentRevisionId)))
        .limit(1);
      if (!revision) throw notFound("Current public trust document version not found");
      return trustDocumentContentSchema.parse({ document, format: revision.format, body: revision.body });
    });
    res.json(content);
  });

  router.post("/companies/:companyId/trust/documents", async (req, res) => {
    z.strictObject({}).parse(req.query);
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const input = trustDocumentRegisterCommandSchema.parse(req.body);
    const materialChangeAction = "materialChangeAction" in input
      ? input.materialChangeAction
      : input.acceptanceRequired ? "reacceptance" : "no_action";
    const acceptanceRequired = materialChangeAction === "reacceptance";
    const publications: ActivityPublication[] = [];
    const registered = await db.transaction(async tx => {
      const [source] = await tx.select({
        revision: documentRevisions,
        document: documents,
        revisionErased: sql<boolean>`aw_learning_asset_erased(${documentRevisions.companyId}, 'document_revision', ${documentRevisions.id})`,
      })
        .from(documentRevisions)
        .innerJoin(documents, and(eq(documents.id, documentRevisions.documentId), eq(documents.companyId, documentRevisions.companyId)))
        .where(and(eq(documentRevisions.companyId, companyId), eq(documentRevisions.documentId, input.documentId),
          eq(documentRevisions.id, input.documentRevisionId)))
        .limit(1).for("update");
      if (!source || source.document.latestRevisionId !== source.revision.id)
        throw notFound("Only the exact current document revision can be registered");
      const userId = await assertCurrentCompanyHuman(tx as unknown as Db, req.actor, companyId, input.expectedUserId, true);
      const privateOwnerLinks = await privateOwnerLinkedDocumentIds(tx as unknown as Db, companyId,
        [{ documentId: source.document.id, revisionId: source.revision.id }]);
      const privateOwnerLink = privateOwnerLinks.has(source.document.id);
      const snapshot = source.revision.payloadSourceSnapshot;
      const parsedSnapshot = snapshot === null ? null : nativePayloadSourceSnapshotSchema.safeParse(snapshot);
      const hasInheritedSources = source.revision.payloadSourceProtocolVersion !== 1 ||
        source.revision.payloadSourceSnapshotInvalidated || source.revisionErased || snapshot === null ||
        (parsedSnapshot !== null && (!parsedSnapshot.success ||
          (parsedSnapshot.data.inputs.length > 0 || Object.values(parsedSnapshot.data.policy).some(ids => ids.length > 0))));
      if (!isStandaloneHumanOwnedDocument({
        documentCreatedByUserId: source.document.createdByUserId,
        documentCreatedByAgentId: source.document.createdByAgentId,
        documentUpdatedByUserId: source.document.updatedByUserId,
        documentUpdatedByAgentId: source.document.updatedByAgentId,
        revisionCreatedByUserId: source.revision.createdByUserId,
        revisionCreatedByAgentId: source.revision.createdByAgentId,
        revisionCreatedByRunId: source.revision.createdByRunId,
        hasPrivateOwnerLink: privateOwnerLink,
        hasInheritedSources: hasInheritedSources || source.revision.conversationFoundationProposalIds.length > 0,
        hasMutableSourceTrust: source.document.sourceTrust !== null,
      }, userId))
        throw forbidden("Only a standalone company document authored and currently owned by this Human can be registered");
      const [row] = await tx.insert(trustDocumentRegistry).values({
        companyId,
        documentId: source.document.id,
        documentRevisionId: source.revision.id,
        owner: userId,
        version: String(source.revision.revisionNumber),
        effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null,
        evidenceRefs: input.evidenceRefs,
        customerVisibility: input.customerVisibility,
        ndaRequired: input.ndaRequired,
        lastReviewedAt: input.lastReviewedAt ? new Date(input.lastReviewedAt) : null,
        nextReviewOrTrigger: input.nextReviewOrTrigger,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        acceptanceRequired,
        materialChangeAction,
        createdByUserId: userId,
      }).returning();
      await tx.update(trustDocumentRegistry).set({ supersededBy: row.id })
        .where(and(eq(trustDocumentRegistry.companyId, companyId), eq(trustDocumentRegistry.documentId, source.document.id),
          isNull(trustDocumentRegistry.supersededBy), sql`${trustDocumentRegistry.id} <> ${row.id}`));
      await logActivity(tx as unknown as Db, {
        companyId, actorType: "user", actorId: userId, action: "trust_document.registered",
        entityType: "trust_document_registry", entityId: row.id,
        details: { documentId: source.document.id, documentRevisionId: source.revision.id,
          revisionNumber: source.revision.revisionNumber, visibility: input.customerVisibility,
          ndaRequired: input.ndaRequired, materialChangeAction },
      }, publications);
      return { row, version: String(source.revision.revisionNumber) };
    });
    for (const publication of publications) {
      try { publishActivity(publication); } catch (err) {
        logger.warn({ err, companyId, userId: registered.row.createdByUserId }, "Could not publish trust document registration activity");
      }
    }
    res.status(201).json(trustDocumentRegistrationReceiptSchema.parse({
      id: registered.row.id, documentId: registered.row.documentId,
      documentRevisionId: registered.row.documentRevisionId, version: registered.version, materialChangeAction,
    }));
  });

  router.post("/companies/:companyId/trust/notices/read", async (req, res) => {
    z.strictObject({}).parse(req.query);
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const input = trustDocumentActionCommandSchema.parse(req.body);
    const result = await completeTrustAction(db, req, companyId, input, "notice_read");
    res.status(result.created ? 201 : 200).json(actionReceipt(result.row));
  });

  router.post("/companies/:companyId/trust/admin-acknowledgments", async (req, res) => {
    z.strictObject({}).parse(req.query);
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const input = trustDocumentActionCommandSchema.parse(req.body);
    const result = await completeTrustAction(db, req, companyId, input, "customer_admin_acknowledgment");
    res.status(result.created ? 201 : 200).json(actionReceipt(result.row));
  });

  router.post("/companies/:companyId/trust/acceptances", async (req, res) => {
    z.strictObject({}).parse(req.query);
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const input = trustDocumentAcceptanceCommandSchema.parse(req.body);
    const userId = actorUserId(req, input.expectedUserId);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      companyId, userId, requestId: input.requestId, registryEntryId: input.registryEntryId,
      version: input.version, surface: input.surface,
    })).digest("hex");
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async tx => {
      const key = `trust-acceptance:${companyId}:${userId}:${input.requestId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      await assertCurrentCompanyHuman(tx as unknown as Db, req.actor, companyId, input.expectedUserId, false, true);
      const [prior] = await tx.select().from(trustDocumentAcceptances).where(and(
        eq(trustDocumentAcceptances.companyId, companyId),
        eq(trustDocumentAcceptances.principalUserId, userId),
        eq(trustDocumentAcceptances.requestId, input.requestId),
      )).limit(1);
      if (prior) {
        if (prior.requestHash !== fingerprint) throw conflict("This acceptance request ID was already used for different terms");
        return { row: prior, created: false };
      }
      const requirements = await resolveCurrentTrustAcceptanceRequirements(
        tx as unknown as Db, req.actor, companyId, input.expectedUserId,
      );
      const registered = requirements.find(row => row.id === input.registryEntryId);
      if (!registered || registered.version !== input.version)
        throw conflict("This document version has no current configured acceptance requirement");
      const [row] = await tx.insert(trustDocumentAcceptances).values({
        companyId, registryEntryId: registered.id,
        documentRevisionId: registered.documentRevisionId, principalUserId: userId,
        documentVersion: input.version, requestId: input.requestId,
        requestHash: fingerprint, surface: input.surface,
      }).returning();
      await logActivity(tx as unknown as Db, {
        companyId, actorType: "user", actorId: userId, action: "trust_document.accepted",
        entityType: "trust_document_acceptance", entityId: row.id,
        details: { registryEntryId: row.registryEntryId, documentRevisionId: row.documentRevisionId,
          version: row.documentVersion, surface: row.surface },
      }, publications);
      return { row, created: true };
    });
    for (const publication of publications) {
      try { publishActivity(publication); } catch (err) {
        logger.warn({ err, companyId, userId }, "Could not publish trust document acceptance activity");
      }
    }
    res.status(result.created ? 201 : 200).json(receipt(result.row));
  });

  return router;
}
