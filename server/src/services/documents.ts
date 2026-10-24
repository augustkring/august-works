import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documentRevisions, documents, issueDocuments, issues } from "@paperclipai/db";
import { isSystemIssueDocumentKey, issueDocumentKeySchema, nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput, type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { isUniqueViolation } from "../db-errors.js";
import { insertRowsInChunks } from "./batch-insert.js";
import type { ImportIssueDocumentRow } from "./import-write-types.js";

import { lockAnalyticalCompany, suppressAnalyticalSource } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { authorizationService, canActorReadIssuePrivacy, pinCurrentBoardActor, type AuthorizationActor } from "./authorization.js";
import { lockIssuePrivacyTree, pinIssueMutationHuman } from "./issues.js";
import { assertHumanAuthentication } from "../auth/authenticator-assurance.js";
import { assertDirectInputSessionCurrent, directHumanPayloadSnapshotSql } from "./native-direct-input.js";
import { persistActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

/** Selected native revision data, separate from every public document DTO.
 * A matching rendition and hash identify input bytes, never current access. */
export interface DocumentRevisionSourceCapture {
  readonly input: Extract<NativePayloadSourceInput, { kind: "document_revision" }>;
  readonly payloadSourceSnapshot: NativePayloadSourceSnapshot | null;
}

function normalizeDocumentKey(key: string) {
  const normalized = key.trim().toLowerCase();
  const parsed = issueDocumentKeySchema.safeParse(normalized);
  if (!parsed.success) {
    throw unprocessable("Invalid document key", parsed.error.issues);
  }
  return parsed.data;
}

function nextAvailableDocumentKey(sourceKey: string, existingKeys: string[]) {
  const usedKeys = new Set(existingKeys);
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const baseMaxLength = 64 - suffix.length;
    const base = sourceKey.slice(0, baseMaxLength).replace(/[-_]+$/g, "") || "document";
    const candidate = `${base}${suffix}`;
    if (!usedKeys.has(candidate) && issueDocumentKeySchema.safeParse(candidate).success) {
      return candidate;
    }
  }
  throw conflict("Unable to choose a new document key for locked document", { key: sourceKey });
}

type ImportDbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function extractLegacyPlanBody(description: string | null | undefined) {
  if (!description) return null;
  const match = /<plan>\s*([\s\S]*?)\s*<\/plan>/i.exec(description);
  if (!match) return null;
  const body = match[1]?.trim();
  return body ? body : null;
}

export function mapIssueDocumentRow(
  row: {
    id: string;
    companyId: string;
    issueId: string;
    key: string;
    title: string | null;
    format: string;
    latestBody: string;
    latestRevisionId: string | null;
    latestRevisionNumber: number;
    createdByAgentId: string | null;
    createdByUserId: string | null;
    updatedByAgentId: string | null;
    updatedByUserId: string | null;
    lockedAt: Date | null;
    lockedByAgentId: string | null;
    lockedByUserId: string | null;
    sourceTrust: typeof documents.$inferSelect.sourceTrust;
    createdAt: Date;
    updatedAt: Date;
  },
  includeBody: boolean,
) {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    key: row.key,
    title: row.title,
    format: row.format,
    ...(includeBody ? { body: row.latestBody } : {}),
    latestRevisionId: row.latestRevisionId ?? null,
    latestRevisionNumber: row.latestRevisionNumber,
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    updatedByAgentId: row.updatedByAgentId,
    updatedByUserId: row.updatedByUserId,
    lockedAt: row.lockedAt,
    lockedByAgentId: row.lockedByAgentId,
    lockedByUserId: row.lockedByUserId,
    sourceTrust: row.sourceTrust ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const issueDocumentSelect = {
  id: documents.id,
  companyId: documents.companyId,
  issueId: issueDocuments.issueId,
  key: issueDocuments.key,
  title: documents.title,
  format: documents.format,
  latestBody: documents.latestBody,
  latestRevisionId: documents.latestRevisionId,
  latestRevisionNumber: documents.latestRevisionNumber,
  createdByAgentId: documents.createdByAgentId,
  createdByUserId: documents.createdByUserId,
  updatedByAgentId: documents.updatedByAgentId,
  updatedByUserId: documents.updatedByUserId,
  lockedAt: documents.lockedAt,
  lockedByAgentId: documents.lockedByAgentId,
  lockedByUserId: documents.lockedByUserId,
  sourceTrust: documents.sourceTrust,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

export function documentService(db: Db) {
  const filterSystemDocuments = <T extends { key: string }>(rows: T[], includeSystem: boolean) =>
    includeSystem ? rows : rows.filter((row) => !isSystemIssueDocumentKey(row.key));

  return {
    getIssueDocumentPayload: async (
      issue: { id: string; description: string | null },
      options: { includeSystem?: boolean } = {},
    ) => {
      const [planDocument, documentSummaries] = await Promise.all([
        db
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, issue.id), eq(issueDocuments.key, "plan")))
          .then((rows) => rows[0] ?? null),
        db
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(eq(issueDocuments.issueId, issue.id))
          .orderBy(asc(issueDocuments.key), desc(documents.updatedAt)),
      ]);

      const legacyPlanBody = planDocument ? null : extractLegacyPlanBody(issue.description);

      return {
        planDocument: planDocument ? mapIssueDocumentRow(planDocument, true) : null,
        documentSummaries: filterSystemDocuments(documentSummaries, options.includeSystem ?? false)
          .map((row) => mapIssueDocumentRow(row, false)),
        legacyPlanDocument: legacyPlanBody
          ? {
              key: "plan" as const,
              body: legacyPlanBody,
              source: "issue_description" as const,
            }
          : null,
      };
    },

    listIssueDocuments: async (issueId: string, options: { includeSystem?: boolean } = {}) => {
      const rows = await db
        .select(issueDocumentSelect)
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .where(eq(issueDocuments.issueId, issueId))
        .orderBy(asc(issueDocuments.key), desc(documents.updatedAt));
      return filterSystemDocuments(rows, options.includeSystem ?? false).map((row) => mapIssueDocumentRow(row, true));
    },

    getIssueDocumentByKey: async (issueId: string, rawKey: string, options: {
      onSourceCapture?: (capture: DocumentRevisionSourceCapture | null) => void;
    } = {}) => {
      const key = normalizeDocumentKey(rawKey);
      const row = await db
        .select({ ...issueDocumentSelect, sourceRevision: { id: documentRevisions.id, body: documentRevisions.body,
          title: documentRevisions.title, format: documentRevisions.format, revisionNumber: documentRevisions.revisionNumber,
          payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot } })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .leftJoin(documentRevisions, and(eq(documentRevisions.id, documents.latestRevisionId),
          eq(documentRevisions.documentId, documents.id), eq(documentRevisions.companyId, documents.companyId)))
        .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
        .then((rows) => rows[0] ?? null);
      const revision = row?.sourceRevision;
      options.onSourceCapture?.(row && revision && revision.body === row.latestBody && revision.title === row.title &&
        revision.format === row.format && revision.revisionNumber === row.latestRevisionNumber
        ? { input: { kind: "document_revision", documentId: row.id, revisionId: revision.id, issueId: row.issueId,
            contentHash: createHash("sha256").update(row.latestBody, "utf8").digest("hex") },
            payloadSourceSnapshot: revision.payloadSourceSnapshot }
        : null);
      return row ? mapIssueDocumentRow(row, true) : null;
    },

    listIssueDocumentRevisions: async (issueId: string, rawKey: string) => {
      const key = normalizeDocumentKey(rawKey);
      return db
        .select({
          id: documentRevisions.id,
          companyId: documentRevisions.companyId,
          documentId: documentRevisions.documentId,
          issueId: issueDocuments.issueId,
          key: issueDocuments.key,
          revisionNumber: documentRevisions.revisionNumber,
          title: documentRevisions.title,
          format: documentRevisions.format,
          body: documentRevisions.body,
          changeSummary: documentRevisions.changeSummary,
          createdByAgentId: documentRevisions.createdByAgentId,
          createdByUserId: documentRevisions.createdByUserId,
          createdAt: documentRevisions.createdAt,
        })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
        .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
        .orderBy(desc(documentRevisions.revisionNumber));
    },

    upsertIssueDocument: async (input: {
      issueId: string;
      key: string;
      title?: string | null;
      format: string;
      body: string;
      changeSummary?: string | null;
      baseRevisionId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
      createdByRunId?: string | null;
      sourceTrust?: typeof documents.$inferInsert.sourceTrust;
      lockedDocumentStrategy?: "conflict" | "create_new_document";
      /** Actual request actor; author attribution alone is not input capture. */
      manualInputActor?: AuthorizationActor;
    }) => {
      const candidate = input.manualInputActor;
      const manualActor = candidate?.type === "board" && candidate.source === "session" && candidate.userId && candidate.sessionId &&
        candidate.userId === input.createdByUserId && !candidate.runId && !input.createdByAgentId && !input.createdByRunId &&
        !input.baseRevisionId && input.lockedDocumentStrategy !== "create_new_document" ? { ...candidate } : null;
      const key = normalizeDocumentKey(input.key);
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Issue not found");

      const maxAttempts = input.lockedDocumentStrategy === "create_new_document" ? 3 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          let sourcePublication: ActivityPublication | null = null;
          const result = await db.transaction(async (tx) => {
          let sourceExpiresAt: number | null = null, sourceOperator = false;
          const finishManualInput = async () => {
            if (manualActor && sourceExpiresAt !== null) {
              if (sourceOperator) await assertHumanAuthentication(tx, manualActor, { requireRecent: true, phishingResistant: true });
              await assertDirectInputSessionCurrent(tx, manualActor, sourceExpiresAt);
            }
          };
          if (manualActor) {
            const pinned = await pinCurrentBoardActor(tx, manualActor);
            if (!pinned || pinned.credentialExpiresAt === null || !Number.isFinite(pinned.credentialExpiresAt))
              throw forbidden("The current manual input session is unavailable");
            sourceExpiresAt = pinned.credentialExpiresAt;
            sourceOperator = await pinIssueMutationHuman(tx, manualActor, issue.companyId, true) === "instance_admin";
            await finishManualInput();
            await lockIssuePrivacyTree(tx, issue.companyId);
            const [current] = await tx.select({ id: issues.id, companyId: issues.companyId, status: issues.status,
              assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId }).from(issues)
              .where(and(eq(issues.id, issue.id), eq(issues.companyId, issue.companyId))).for("update");
            if (!current) throw notFound("Issue not found");
            await finishManualInput();
            const actor = { ...manualActor, isInstanceAdmin: false, ignoreInstanceAdmin: !sourceOperator };
            const decision = await authorizationService(tx).decide({ actor, action: "issue:mutate",
              resource: { type: "issue", companyId: issue.companyId, issueId: issue.id, status: current.status,
                assigneeAgentId: current.assigneeAgentId, assigneeUserId: current.assigneeUserId }, enforceResponsibleUserIntersection: true });
            if (!decision.allowed || !await canActorReadIssuePrivacy(tx, actor, current))
              throw forbidden("Current document write authority is required");
          }
          const now = new Date();
          const existing = await tx
            .select({
              id: documents.id,
              companyId: documents.companyId,
              issueId: issueDocuments.issueId,
              key: issueDocuments.key,
              title: documents.title,
              format: documents.format,
              latestBody: documents.latestBody,
              latestRevisionId: documents.latestRevisionId,
              latestRevisionNumber: documents.latestRevisionNumber,
              createdByAgentId: documents.createdByAgentId,
              createdByUserId: documents.createdByUserId,
              updatedByAgentId: documents.updatedByAgentId,
              updatedByUserId: documents.updatedByUserId,
              lockedAt: documents.lockedAt,
              lockedByAgentId: documents.lockedByAgentId,
              lockedByUserId: documents.lockedByUserId,
              sourceTrust: documents.sourceTrust,
              createdAt: documents.createdAt,
              updatedAt: documents.updatedAt,
            })
            .from(issueDocuments)
            .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
            .where(and(eq(issueDocuments.issueId, issue.id), eq(issueDocuments.key, key)))
            .then((rows) => rows[0] ?? null);

          if (existing) {
            if (existing.lockedAt) {
              if (input.lockedDocumentStrategy === "create_new_document") {
                const issueDocumentKeys = await tx
                  .select({ key: issueDocuments.key })
                  .from(issueDocuments)
                  .where(eq(issueDocuments.issueId, issue.id));
                const fallbackKey = nextAvailableDocumentKey(key, issueDocumentKeys.map((row) => row.key));

                const [document] = await tx
                  .insert(documents)
                  .values({
                    companyId: issue.companyId,
                    title: input.title ?? null,
                    format: input.format,
                    latestBody: input.body,
                    latestRevisionId: null,
                    latestRevisionNumber: 1,
                    createdByAgentId: input.createdByAgentId ?? null,
                    createdByUserId: input.createdByUserId ?? null,
                    updatedByAgentId: input.createdByAgentId ?? null,
                    updatedByUserId: input.createdByUserId ?? null,
                    lockedAt: null,
                    lockedByAgentId: null,
                    lockedByUserId: null,
                    sourceTrust: input.sourceTrust ?? null,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();

                const [revision] = await tx
                  .insert(documentRevisions)
                  .values({
                    companyId: issue.companyId,
                    documentId: document.id,
                    revisionNumber: 1,
                    title: input.title ?? null,
                    format: input.format,
                    body: input.body,
                    changeSummary: input.changeSummary ?? null,
                    createdByAgentId: input.createdByAgentId ?? null,
                    createdByUserId: input.createdByUserId ?? null,
                    createdByRunId: input.createdByRunId ?? null,
                    createdAt: now,
                  })
                  .returning();

                await tx
                  .update(documents)
                  .set({ latestRevisionId: revision.id })
                  .where(eq(documents.id, document.id));

                await tx.insert(issueDocuments).values({
                  companyId: issue.companyId,
                  issueId: issue.id,
                  documentId: document.id,
                  key: fallbackKey,
                  createdAt: now,
                  updatedAt: now,
                });

                return {
                  created: true as const,
                  redirectedFromLockedDocument: {
                    id: existing.id,
                    key: existing.key,
                  },
                  document: {
                    id: document.id,
                    companyId: issue.companyId,
                    issueId: issue.id,
                    key: fallbackKey,
                    title: document.title,
                    format: document.format,
                    body: document.latestBody,
                    latestRevisionId: revision.id,
                    latestRevisionNumber: 1,
                    createdByAgentId: document.createdByAgentId,
                    createdByUserId: document.createdByUserId,
                    updatedByAgentId: document.updatedByAgentId,
                    updatedByUserId: document.updatedByUserId,
                    lockedAt: null,
                    lockedByAgentId: null,
                    lockedByUserId: null,
                    sourceTrust: document.sourceTrust ?? null,
                    createdAt: document.createdAt,
                    updatedAt: document.updatedAt,
                  },
                };
              }

              throw conflict("Document is locked", {
                key: existing.key,
                documentId: existing.id,
                lockedAt: existing.lockedAt,
              });
            }

            if (!input.baseRevisionId) {
              throw conflict("Document update requires baseRevisionId. GET the current document, read its body and latestRevisionId, then set baseRevisionId to that latestRevisionId when updating.", {
                currentRevisionId: existing.latestRevisionId,
              });
            }
            if (input.baseRevisionId !== existing.latestRevisionId) {
              throw conflict("Document was updated by someone else", {
                currentRevisionId: existing.latestRevisionId,
              });
            }

            const nextRevisionNumber = existing.latestRevisionNumber + 1;
            const [revision] = await tx
              .insert(documentRevisions)
              .values({
                companyId: issue.companyId,
                documentId: existing.id,
                revisionNumber: nextRevisionNumber,
                title: input.title ?? null,
                format: input.format,
                body: input.body,
                changeSummary: input.changeSummary ?? null,
                createdByAgentId: input.createdByAgentId ?? null,
                createdByUserId: input.createdByUserId ?? null,
                createdByRunId: input.createdByRunId ?? null,
                createdAt: now,
              })
              .returning();

            await tx
              .update(documents)
              .set({
                title: input.title ?? null,
                format: input.format,
                latestBody: input.body,
                latestRevisionId: revision.id,
                latestRevisionNumber: nextRevisionNumber,
                updatedByAgentId: input.createdByAgentId ?? null,
                updatedByUserId: input.createdByUserId ?? null,
                sourceTrust: input.sourceTrust ?? null,
                updatedAt: now,
              })
              .where(eq(documents.id, existing.id));

            await tx
              .update(issueDocuments)
              .set({ updatedAt: now })
              .where(eq(issueDocuments.documentId, existing.id));

            return {
              created: false as const,
              document: {
                ...existing,
                title: input.title ?? null,
                format: input.format,
                body: input.body,
                latestRevisionId: revision.id,
                latestRevisionNumber: nextRevisionNumber,
                updatedByAgentId: input.createdByAgentId ?? null,
                updatedByUserId: input.createdByUserId ?? null,
                lockedAt: existing.lockedAt,
                lockedByAgentId: existing.lockedByAgentId,
                lockedByUserId: existing.lockedByUserId,
                sourceTrust: input.sourceTrust ?? null,
                updatedAt: now,
              },
            };
          }

          if (input.baseRevisionId) {
            throw conflict("Document does not exist yet", { key });
          }

          const [document] = await tx
            .insert(documents)
            .values({
              companyId: issue.companyId,
              title: input.title ?? null,
              format: input.format,
              latestBody: input.body,
              latestRevisionId: null,
              latestRevisionNumber: 1,
              createdByAgentId: input.createdByAgentId ?? null,
              createdByUserId: input.createdByUserId ?? null,
              updatedByAgentId: input.createdByAgentId ?? null,
              updatedByUserId: input.createdByUserId ?? null,
              lockedAt: null,
              lockedByAgentId: null,
              lockedByUserId: null,
              sourceTrust: input.sourceTrust ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const [revision] = await tx
            .insert(documentRevisions)
            .values({
              companyId: issue.companyId,
              documentId: document.id,
              revisionNumber: 1,
              ...(manualActor ? { payloadSourceProtocolVersion: 1 } : {}),
              title: input.title ?? null,
              format: input.format,
              body: input.body,
              changeSummary: input.changeSummary ?? null,
              createdByAgentId: input.createdByAgentId ?? null,
              createdByUserId: input.createdByUserId ?? null,
              createdByRunId: input.createdByRunId ?? null,
              createdAt: now,
            })
            .returning();

          await tx
            .update(documents)
            .set({ latestRevisionId: revision.id })
            .where(eq(documents.id, document.id));

          await tx.insert(issueDocuments).values({
            companyId: issue.companyId,
            issueId: issue.id,
            documentId: document.id,
            key,
            createdAt: now,
            updatedAt: now,
          });

          if (manualActor) {
            const [captured] = await tx.update(documentRevisions)
              .set({ payloadSourceSnapshot: directHumanPayloadSnapshotSql("document_revision") })
              .where(and(eq(documentRevisions.id, revision.id), eq(documentRevisions.companyId, issue.companyId),
                eq(documentRevisions.documentId, document.id), eq(documentRevisions.createdByUserId, manualActor.userId!),
                eq(documentRevisions.payloadSourceProtocolVersion, 1), isNull(documentRevisions.payloadSourceSnapshot),
                eq(documentRevisions.payloadSourceSnapshotInvalidated, false))).returning();
            if (!captured?.payloadSourceSnapshot) throw conflict("Manual document source capture was not stored");
            const snapshot = nativePayloadSourceSnapshotSchema.parse(captured.payloadSourceSnapshot);
            const source = await persistActivity(tx as unknown as Db, { companyId: issue.companyId, actorType: "user",
              actorId: manualActor.userId!, action: "document_revision.payload_source_captured", entityType: "issue", entityId: issue.id,
              details: { documentId: document.id, revisionId: revision.id, key, producer: "direct_manual_input",
                contentHash: snapshot.owner.contentHash, digest: snapshot.digest } });
            sourcePublication = source.publication;
            await finishManualInput();
          }

          return {
            created: true as const,
            document: {
              id: document.id,
              companyId: issue.companyId,
              issueId: issue.id,
              key,
              title: document.title,
              format: document.format,
              body: document.latestBody,
              latestRevisionId: revision.id,
              latestRevisionNumber: 1,
              createdByAgentId: document.createdByAgentId,
              createdByUserId: document.createdByUserId,
              updatedByAgentId: document.updatedByAgentId,
              updatedByUserId: document.updatedByUserId,
              lockedAt: document.lockedAt,
              lockedByAgentId: document.lockedByAgentId,
              lockedByUserId: document.lockedByUserId,
              sourceTrust: document.sourceTrust ?? null,
              createdAt: document.createdAt,
              updatedAt: document.updatedAt,
            },
          };
          });
          if (sourcePublication) {
            try { publishActivity(sourcePublication); }
            catch (err) { logger.warn({ err }, "Failed to publish committed document source activity"); }
          }
          return result;
        } catch (error) {
          if (isUniqueViolation(error, "issue_documents_company_issue_key_uq")) {
            if (input.lockedDocumentStrategy === "create_new_document" && attempt < maxAttempts - 1) {
              continue;
            }
            throw conflict("Document key already exists on this issue", { key });
          }
          throw error;
        }
      }

      throw conflict("Unable to choose a new document key for locked document", { key });
    },

    /**
     * Batched issue-document insert for company import.
     *
     * Every imported document is a fresh create (the issue is brand new), so we
     * skip {@link upsertIssueDocument}'s per-row existence/lock/base-revision
     * dance and the follow-up latest-revision update: ids are pre-generated so
     * `latest_revision_id` can be written inline. Documents, their initial
     * revisions, and the issue links are each inserted in chunked statements.
     */
    createIssueDocumentsForImport: async (rows: ImportIssueDocumentRow[], dbOrTx: Db | ImportDbTransaction = db): Promise<void> => {
      if (rows.length === 0) return;
      const now = new Date();
      const documentRows: Array<Record<string, unknown>> = [];
      const revisionRows: Array<Record<string, unknown>> = [];
      const linkRows: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        const key = normalizeDocumentKey(row.key);
        const documentId = randomUUID();
        const revisionId = randomUUID();
        documentRows.push({
          id: documentId,
          companyId: row.companyId,
          title: row.title ?? null,
          format: row.format,
          latestBody: row.body,
          latestRevisionId: revisionId,
          latestRevisionNumber: 1,
          createdByAgentId: row.createdByAgentId ?? null,
          createdByUserId: row.createdByUserId ?? null,
          updatedByAgentId: row.createdByAgentId ?? null,
          updatedByUserId: row.createdByUserId ?? null,
          lockedAt: null,
          lockedByAgentId: null,
          lockedByUserId: null,
          sourceTrust: row.sourceTrust ?? null,
          createdAt: now,
          updatedAt: now,
        });
        revisionRows.push({
          id: revisionId,
          companyId: row.companyId,
          documentId,
          revisionNumber: 1,
          title: row.title ?? null,
          format: row.format,
          body: row.body,
          changeSummary: null,
          createdByAgentId: row.createdByAgentId ?? null,
          createdByUserId: row.createdByUserId ?? null,
          createdByRunId: row.createdByRunId ?? null,
          createdAt: now,
        });
        linkRows.push({
          companyId: row.companyId,
          issueId: row.issueId,
          documentId,
          key,
          createdAt: now,
          updatedAt: now,
        });
      }
      await dbOrTx.transaction(async (tx) => {
        await insertRowsInChunks(tx, documents, documentRows);
        await insertRowsInChunks(tx, documentRevisions, revisionRows);
        await insertRowsInChunks(tx, issueDocuments, linkRows);
      });
    },

    restoreIssueDocumentRevision: async (input: {
      issueId: string;
      key: string;
      revisionId: string;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const key = normalizeDocumentKey(input.key);
      return db.transaction(async (tx) => {
        const existing = await tx
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, input.issueId), eq(issueDocuments.key, key)))
          .then((rows) => rows[0] ?? null);

        if (!existing) throw notFound("Document not found");
        if (existing.lockedAt) {
          throw conflict("Document is locked", {
            key: existing.key,
            documentId: existing.id,
            lockedAt: existing.lockedAt,
          });
        }

        const revision = await tx
          .select({
            id: documentRevisions.id,
            companyId: documentRevisions.companyId,
            documentId: documentRevisions.documentId,
            revisionNumber: documentRevisions.revisionNumber,
            title: documentRevisions.title,
            format: documentRevisions.format,
            body: documentRevisions.body,
          })
          .from(documentRevisions)
          .where(and(eq(documentRevisions.id, input.revisionId), eq(documentRevisions.documentId, existing.id)))
          .then((rows) => rows[0] ?? null);

        if (!revision) throw notFound("Document revision not found");
        if (existing.latestRevisionId === revision.id) {
          throw conflict("Selected revision is already the latest revision", {
            currentRevisionId: existing.latestRevisionId,
          });
        }

        const now = new Date();
        const nextRevisionNumber = existing.latestRevisionNumber + 1;
        const [restoredRevision] = await tx
          .insert(documentRevisions)
          .values({
            companyId: existing.companyId,
            documentId: existing.id,
            revisionNumber: nextRevisionNumber,
            title: revision.title ?? null,
            format: revision.format,
            body: revision.body,
            changeSummary: `Restored from revision ${revision.revisionNumber}`,
            createdByAgentId: input.createdByAgentId ?? null,
            createdByUserId: input.createdByUserId ?? null,
            createdAt: now,
          })
          .returning();

        await tx
          .update(documents)
          .set({
            title: revision.title ?? null,
            format: revision.format,
            latestBody: revision.body,
            latestRevisionId: restoredRevision.id,
            latestRevisionNumber: nextRevisionNumber,
            updatedByAgentId: input.createdByAgentId ?? null,
            updatedByUserId: input.createdByUserId ?? null,
            updatedAt: now,
          })
          .where(eq(documents.id, existing.id));

        await tx
          .update(issueDocuments)
          .set({ updatedAt: now })
          .where(eq(issueDocuments.documentId, existing.id));

        return {
          restoredFromRevisionId: revision.id,
          restoredFromRevisionNumber: revision.revisionNumber,
          document: {
            ...existing,
            title: revision.title ?? null,
            format: revision.format,
            body: revision.body,
            latestRevisionId: restoredRevision.id,
            latestRevisionNumber: nextRevisionNumber,
            updatedByAgentId: input.createdByAgentId ?? null,
            updatedByUserId: input.createdByUserId ?? null,
            updatedAt: now,
          },
        };
      });
    },

    lockIssueDocument: async (input: {
      issueId: string;
      key: string;
      lockedByAgentId?: string | null;
      lockedByUserId?: string | null;
    }) => {
      const key = normalizeDocumentKey(input.key);
      return db.transaction(async (tx) => {
        const existing = await tx
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, input.issueId), eq(issueDocuments.key, key)))
          .then((rows) => rows[0] ?? null);

        if (!existing) throw notFound("Document not found");
        if (existing.lockedAt) {
          return {
            changed: false as const,
            document: mapIssueDocumentRow(existing, true),
          };
        }

        const now = new Date();
        await tx
          .update(documents)
          .set({
            lockedAt: now,
            lockedByAgentId: input.lockedByAgentId ?? null,
            lockedByUserId: input.lockedByUserId ?? null,
            updatedAt: now,
          })
          .where(eq(documents.id, existing.id));

        await tx
          .update(issueDocuments)
          .set({ updatedAt: now })
          .where(eq(issueDocuments.documentId, existing.id));

        return {
          changed: true as const,
          document: {
            ...mapIssueDocumentRow(existing, true),
            lockedAt: now,
            lockedByAgentId: input.lockedByAgentId ?? null,
            lockedByUserId: input.lockedByUserId ?? null,
            updatedAt: now,
          },
        };
      });
    },

    unlockIssueDocument: async (issueId: string, rawKey: string) => {
      const key = normalizeDocumentKey(rawKey);
      return db.transaction(async (tx) => {
        const existing = await tx
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
          .then((rows) => rows[0] ?? null);

        if (!existing) throw notFound("Document not found");
        if (!existing.lockedAt) {
          return {
            changed: false as const,
            document: mapIssueDocumentRow(existing, true),
          };
        }

        const now = new Date();
        await tx
          .update(documents)
          .set({
            lockedAt: null,
            lockedByAgentId: null,
            lockedByUserId: null,
            updatedAt: now,
          })
          .where(eq(documents.id, existing.id));

        await tx
          .update(issueDocuments)
          .set({ updatedAt: now })
          .where(eq(issueDocuments.documentId, existing.id));

        return {
          changed: true as const,
          document: {
            ...mapIssueDocumentRow(existing, true),
            lockedAt: null,
            lockedByAgentId: null,
            lockedByUserId: null,
            updatedAt: now,
          },
        };
      });
    },

    deleteIssueDocument: async (issueId: string, rawKey: string) => {
      const key = normalizeDocumentKey(rawKey);
      return db.transaction(async (tx) => {
        let existing = await tx
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
          .then((rows) => rows[0] ?? null);

        if (!existing) return null;
        await lockAnalyticalCompany(tx, existing.companyId);
        await lockMemoryPrivacy(tx as unknown as Db, existing.companyId);
        existing = await tx.select(issueDocumentSelect).from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, key)))
          .for("update").then(rows => rows[0] ?? null);
        if (!existing) return null;
        if (existing.lockedAt) {
          throw conflict("Document is locked", {
            key: existing.key,
            documentId: existing.id,
            lockedAt: existing.lockedAt,
          });
        }

        await suppressAnalyticalSource(tx, existing.companyId, "document", existing.id);
        await tx.delete(issueDocuments).where(eq(issueDocuments.documentId, existing.id));
        await tx.delete(documents).where(eq(documents.id, existing.id));

        return {
          ...existing,
          body: existing.latestBody,
          latestRevisionId: existing.latestRevisionId ?? null,
        };
      });
    },
  };
}
