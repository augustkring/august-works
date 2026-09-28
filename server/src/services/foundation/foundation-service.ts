import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
} from "@paperclipai/db";
import {
  createFoundationChangeProposalSchema,
  createFoundationDocumentSchema,
  updateFoundationDraftSchema,
  type CreateFoundationChangeProposal,
  type CreateFoundationDocument,
  type ExecutionPrincipal,
  type FoundationDocument,
  type UpdateFoundationDraft,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { isUniqueViolation } from "../../db-errors.js";

type FoundationDb = Db;

export interface FoundationMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
}

const approvedRevision = alias(documentRevisions, "foundation_approved_revision");

function actorFields(actor: FoundationMutationActor) {
  return {
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
    userId: actor.principal.type === "user" ? actor.principal.userId : null,
    runId: actor.runId ?? null,
  };
}

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function nextReviewAt(now: Date, days: number | null) {
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

async function assertActorCompanyScope(
  db: FoundationDb,
  companyId: string,
  actor: FoundationMutationActor,
) {
  if (actor.principal.type === "system") return;

  if (actor.principal.type === "agent") {
    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, actor.principal.agentId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw forbidden("Agent does not belong to this company");
    return;
  }

  const membership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.principal.userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!membership) throw forbidden("User does not have an active company membership");
}

async function assertOwnerReferences(
  db: FoundationDb,
  companyId: string,
  input: { ownerUserId?: string | null; ownerAgentId?: string | null },
) {
  if (input.ownerAgentId) {
    const agent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, input.ownerAgentId)))
      .then((rows) => rows[0] ?? null);
    if (!agent) throw unprocessable("Foundation owner agent must belong to the company");
  }

  if (input.ownerUserId) {
    const membership = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, input.ownerUserId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!membership) throw unprocessable("Foundation owner user must have an active company membership");
  }
}

const foundationSelect = {
  foundation: foundationDocuments,
  document: documents,
  canonicalRevision: approvedRevision,
};

function mapFoundationRow(row: {
  foundation: typeof foundationDocuments.$inferSelect;
  document: typeof documents.$inferSelect;
  canonicalRevision: typeof documentRevisions.$inferSelect | null;
}): FoundationDocument {
  return {
    id: row.foundation.id,
    companyId: row.foundation.companyId,
    documentId: row.foundation.documentId,
    approvedRevisionId: row.foundation.approvedRevisionId,
    foundationKey: row.foundation.foundationKey,
    category: (row.foundation.draftMetadata?.category ?? row.foundation.category) as FoundationDocument["category"],
    documentType: row.foundation.draftMetadata?.documentType ?? row.foundation.documentType,
    authorityLevel: (row.foundation.draftMetadata?.authorityLevel ?? row.foundation.authorityLevel) as FoundationDocument["authorityLevel"],
    status: row.foundation.status as FoundationDocument["status"],
    sensitivity: (row.foundation.draftMetadata?.sensitivity ?? row.foundation.sensitivity) as FoundationDocument["sensitivity"],
    ownerUserId: row.foundation.draftMetadata?.ownerUserId ?? row.foundation.ownerUserId,
    ownerAgentId: row.foundation.draftMetadata?.ownerAgentId ?? row.foundation.ownerAgentId,
    reviewFrequencyDays: row.foundation.draftMetadata?.reviewFrequencyDays ?? row.foundation.reviewFrequencyDays,
    lastReviewedAt: row.foundation.lastReviewedAt,
    nextReviewAt: row.foundation.nextReviewAt,
    validFrom: row.foundation.draftMetadata?.validFrom ? new Date(row.foundation.draftMetadata.validFrom) : row.foundation.validFrom,
    validUntil: row.foundation.draftMetadata?.validUntil ? new Date(row.foundation.draftMetadata.validUntil) : row.foundation.validUntil,
    createdAt: row.foundation.createdAt,
    updatedAt: row.foundation.updatedAt,
    title: row.document.title,
    body: row.document.latestBody,
    latestRevisionId: row.document.latestRevisionId,
    latestRevisionNumber: row.document.latestRevisionNumber,
    canonicalRevision: row.canonicalRevision
      ? {
          id: row.canonicalRevision.id,
          revisionNumber: row.canonicalRevision.revisionNumber,
          title: row.canonicalRevision.title,
          body: row.canonicalRevision.body,
          changeSummary: row.canonicalRevision.changeSummary,
          createdAt: row.canonicalRevision.createdAt,
        }
      : null,
    canonicalGovernance: row.foundation.approvedRevisionId
      ? {
          category: row.foundation.category as FoundationDocument["category"],
          documentType: row.foundation.documentType,
          authorityLevel: row.foundation.authorityLevel as FoundationDocument["authorityLevel"],
          sensitivity: row.foundation.sensitivity as FoundationDocument["sensitivity"],
          ownerUserId: row.foundation.ownerUserId,
          ownerAgentId: row.foundation.ownerAgentId,
          reviewFrequencyDays: row.foundation.reviewFrequencyDays,
          validFrom: row.foundation.validFrom,
          validUntil: row.foundation.validUntil,
        }
      : null,
  };
}

async function selectFoundation(
  db: FoundationDb,
  companyId: string,
  predicate: ReturnType<typeof eq>,
) {
  return db
    .select(foundationSelect)
    .from(foundationDocuments)
    .innerJoin(documents, eq(foundationDocuments.documentId, documents.id))
    .leftJoin(
      approvedRevision,
      and(
        eq(foundationDocuments.approvedRevisionId, approvedRevision.id),
        eq(foundationDocuments.documentId, approvedRevision.documentId),
        eq(foundationDocuments.companyId, approvedRevision.companyId),
      ),
    )
    .where(and(eq(foundationDocuments.companyId, companyId), predicate))
    .then((rows) => rows[0] ?? null);
}

async function lockFoundation(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  companyId: string,
  foundationDocumentId: string,
) {
  await tx.execute(sql`
    select id
    from ${foundationDocuments}
    where ${foundationDocuments.companyId} = ${companyId}
      and ${foundationDocuments.id} = ${foundationDocumentId}
    for update
  `);
  const txDb = tx as unknown as Db;
  return selectFoundation(txDb, companyId, eq(foundationDocuments.id, foundationDocumentId));
}

function requireMutable(row: FoundationDocument) {
  if (row.status === "in_review") {
    throw conflict("Foundation document is in review and cannot be edited");
  }
  if (row.status === "superseded" || row.status === "archived") {
    throw conflict("Foundation document is not editable in its current state", {
      status: row.status,
    });
  }
}

export function foundationService(db: Db) {
  async function get(companyId: string, foundationDocumentId: string) {
    const row = await selectFoundation(
      db,
      companyId,
      eq(foundationDocuments.id, foundationDocumentId),
    );
    return row ? mapFoundationRow(row) : null;
  }

  async function getByKey(companyId: string, foundationKey: string) {
    const row = await selectFoundation(
      db,
      companyId,
      eq(foundationDocuments.foundationKey, foundationKey),
    );
    return row ? mapFoundationRow(row) : null;
  }

  return {
    get,
    getByKey,

    list: async (companyId: string) => {
      const rows = await db
        .select(foundationSelect)
        .from(foundationDocuments)
        .innerJoin(documents, eq(foundationDocuments.documentId, documents.id))
        .leftJoin(
          approvedRevision,
          and(
            eq(foundationDocuments.approvedRevisionId, approvedRevision.id),
            eq(foundationDocuments.documentId, approvedRevision.documentId),
            eq(foundationDocuments.companyId, approvedRevision.companyId),
          ),
        )
        .where(eq(foundationDocuments.companyId, companyId))
        .orderBy(asc(foundationDocuments.category), asc(foundationDocuments.foundationKey));
      return rows.map(mapFoundationRow);
    },

    createDraft: async (
      companyId: string,
      rawInput: CreateFoundationDocument,
      actor: FoundationMutationActor,
    ) => {
      const parsed = createFoundationDocumentSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid Foundation document", parsed.error.issues);
      const input = parsed.data;

      try {
        return await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          await assertActorCompanyScope(txDb, companyId, actor);
          await assertOwnerReferences(txDb, companyId, input);
          const now = new Date();
          const actorData = actorFields(actor);

          const [document] = await txDb
            .insert(documents)
            .values({
              companyId,
              title: input.title ?? null,
              format: "markdown",
              latestBody: input.body,
              latestRevisionNumber: 1,
              createdByAgentId: actorData.agentId,
              createdByUserId: actorData.userId,
              updatedByAgentId: actorData.agentId,
              updatedByUserId: actorData.userId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const [revision] = await txDb
            .insert(documentRevisions)
            .values({
              companyId,
              documentId: document!.id,
              revisionNumber: 1,
              title: input.title ?? null,
              format: "markdown",
              body: input.body,
              changeSummary: "Created Foundation draft",
              createdByAgentId: actorData.agentId,
              createdByUserId: actorData.userId,
              createdByRunId: actorData.runId,
              createdAt: now,
            })
            .returning();

          await txDb
            .update(documents)
            .set({ latestRevisionId: revision!.id })
            .where(eq(documents.id, document!.id));

          const [foundation] = await txDb
            .insert(foundationDocuments)
            .values({
              companyId,
              documentId: document!.id,
              approvedRevisionId: null,
              foundationKey: input.foundationKey,
              category: input.category,
              documentType: input.documentType,
              authorityLevel: input.authorityLevel,
              status: "draft",
              sensitivity: input.sensitivity,
              draftMetadata: null,
              ownerUserId: input.ownerUserId ?? null,
              ownerAgentId: input.ownerAgentId ?? null,
              reviewFrequencyDays: input.reviewFrequencyDays ?? null,
              validFrom: parseDate(input.validFrom),
              validUntil: parseDate(input.validUntil),
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          const row = await selectFoundation(
            txDb,
            companyId,
            eq(foundationDocuments.id, foundation!.id),
          );
          if (!row) throw new Error("Foundation document disappeared after creation");
          return mapFoundationRow(row);
        });
      } catch (error) {
        if (isUniqueViolation(error, "foundation_documents_company_key_uq")) {
          throw conflict("Foundation key already exists", {
            code: "foundation_key_conflict",
            foundationKey: input.foundationKey,
          });
        }
        throw error;
      }
    },

    updateDraft: async (
      companyId: string,
      foundationDocumentId: string,
      rawPatch: UpdateFoundationDraft,
      actor: FoundationMutationActor,
    ) => {
      const parsed = updateFoundationDraftSchema.safeParse(rawPatch);
      if (!parsed.success) throw unprocessable("Invalid Foundation update", parsed.error.issues);
      const patch = parsed.data;

      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const lockedRow = await lockFoundation(tx, companyId, foundationDocumentId);
        if (!lockedRow) throw notFound("Foundation document not found");
        const existing = mapFoundationRow(lockedRow);
        requireMutable(existing);

        if (existing.latestRevisionId !== patch.baseRevisionId) {
          throw conflict("Foundation document was updated by someone else", {
            code: "revision_conflict",
            currentRevisionId: existing.latestRevisionId,
          });
        }

        await assertOwnerReferences(txDb, companyId, patch);

        const nextValidFrom = patch.validFrom === undefined ? existing.validFrom : parseDate(patch.validFrom);
        const nextValidUntil = patch.validUntil === undefined ? existing.validUntil : parseDate(patch.validUntil);
        if (nextValidFrom && nextValidUntil && nextValidUntil <= nextValidFrom) {
          throw unprocessable("validUntil must be later than validFrom");
        }

        const nextTitle = patch.title === undefined ? existing.title : patch.title;
        const nextBody = patch.body === undefined ? existing.body : patch.body;
        const contentChanged = nextTitle !== existing.title || nextBody !== existing.body;
        const now = new Date();
        const actorData = actorFields(actor);
        let latestRevisionId = existing.latestRevisionId;
        let latestRevisionNumber = existing.latestRevisionNumber;

        if (contentChanged) {
          latestRevisionNumber += 1;
          const [revision] = await txDb
            .insert(documentRevisions)
            .values({
              companyId,
              documentId: existing.documentId,
              revisionNumber: latestRevisionNumber,
              title: nextTitle,
              format: "markdown",
              body: nextBody,
              changeSummary: patch.changeSummary ?? null,
              createdByAgentId: actorData.agentId,
              createdByUserId: actorData.userId,
              createdByRunId: actorData.runId,
              createdAt: now,
            })
            .returning();
          latestRevisionId = revision!.id;

          await txDb
            .update(documents)
            .set({
              title: nextTitle,
              latestBody: nextBody,
              latestRevisionId,
              latestRevisionNumber,
              updatedByAgentId: actorData.agentId,
              updatedByUserId: actorData.userId,
              updatedAt: now,
            })
            .where(eq(documents.id, existing.documentId));
        }

        const nextGovernance = {
          category: patch.category ?? existing.category,
          documentType: patch.documentType ?? existing.documentType,
          authorityLevel: patch.authorityLevel ?? existing.authorityLevel,
          sensitivity: patch.sensitivity ?? existing.sensitivity,
          ownerUserId: patch.ownerUserId === undefined ? existing.ownerUserId : patch.ownerUserId,
          ownerAgentId: patch.ownerAgentId === undefined ? existing.ownerAgentId : patch.ownerAgentId,
          reviewFrequencyDays:
            patch.reviewFrequencyDays === undefined
              ? existing.reviewFrequencyDays
              : patch.reviewFrequencyDays,
          validFrom: nextValidFrom,
          validUntil: nextValidUntil,
        };
        const draftGovernance = {
          ...nextGovernance,
          validFrom: nextGovernance.validFrom?.toISOString() ?? null,
          validUntil: nextGovernance.validUntil?.toISOString() ?? null,
        };

        const hasApprovedBaseline = existing.approvedRevisionId !== null;
        await txDb
          .update(foundationDocuments)
          .set({
            ...(hasApprovedBaseline
              ? { draftMetadata: draftGovernance }
              : {
                  category: nextGovernance.category,
                  documentType: nextGovernance.documentType,
                  authorityLevel: nextGovernance.authorityLevel,
                  sensitivity: nextGovernance.sensitivity,
                  ownerUserId: nextGovernance.ownerUserId,
                  ownerAgentId: nextGovernance.ownerAgentId,
                  reviewFrequencyDays: nextGovernance.reviewFrequencyDays,
                  validFrom: nextGovernance.validFrom,
                  validUntil: nextGovernance.validUntil,
                  draftMetadata: null,
                }),
            status: "draft",
            updatedAt: now,
          })
          .where(
            and(
              eq(foundationDocuments.companyId, companyId),
              eq(foundationDocuments.id, foundationDocumentId),
            ),
          );

        const row = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!row) throw new Error("Foundation document disappeared after update");
        const result = mapFoundationRow(row);
        if (result.latestRevisionId !== latestRevisionId || result.latestRevisionNumber !== latestRevisionNumber) {
          throw new Error("Foundation revision pointer did not persist");
        }
        return result;
      });
    },

    submitForReview: async (
      companyId: string,
      foundationDocumentId: string,
      expectedRevisionId: string,
      actor: FoundationMutationActor,
    ) =>
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const lockedRow = await lockFoundation(tx, companyId, foundationDocumentId);
        if (!lockedRow) throw notFound("Foundation document not found");
        const existing = mapFoundationRow(lockedRow);

        if (existing.status !== "draft") {
          throw conflict("Only a draft Foundation document can be submitted for review", {
            code: "foundation_invalid_transition",
            status: existing.status,
          });
        }
        if (existing.latestRevisionId !== expectedRevisionId) {
          throw conflict("Foundation document was updated by someone else", {
            code: "revision_conflict",
            currentRevisionId: existing.latestRevisionId,
          });
        }

        await txDb
          .update(foundationDocuments)
          .set({ status: "in_review", updatedAt: new Date() })
          .where(eq(foundationDocuments.id, foundationDocumentId));

        const row = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!row) throw new Error("Foundation document disappeared after submit");
        return mapFoundationRow(row);
      }),

    approve: async (
      companyId: string,
      foundationDocumentId: string,
      expectedRevisionId: string,
      actor: FoundationMutationActor,
    ) =>
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        if (actor.principal.type !== "user") {
          throw forbidden("Foundation approval requires a user principal");
        }

        const lockedRow = await lockFoundation(tx, companyId, foundationDocumentId);
        if (!lockedRow) throw notFound("Foundation document not found");
        const existing = mapFoundationRow(lockedRow);

        if (existing.status !== "in_review") {
          throw conflict("Only an in-review Foundation document can be approved", {
            code: "foundation_invalid_transition",
            status: existing.status,
          });
        }
        if (!existing.latestRevisionId || existing.latestRevisionId !== expectedRevisionId) {
          throw conflict("Foundation document was updated by someone else", {
            code: "revision_conflict",
            currentRevisionId: existing.latestRevisionId,
          });
        }

        const now = new Date();
        const stored = lockedRow.foundation;
        const pendingGovernance = stored.draftMetadata;
        const approvedReviewFrequency =
          pendingGovernance?.reviewFrequencyDays ?? stored.reviewFrequencyDays;
        await txDb
          .update(foundationDocuments)
          .set({
            ...(pendingGovernance
              ? {
                  category: pendingGovernance.category,
                  documentType: pendingGovernance.documentType,
                  authorityLevel: pendingGovernance.authorityLevel,
                  sensitivity: pendingGovernance.sensitivity,
                  ownerUserId: pendingGovernance.ownerUserId,
                  ownerAgentId: pendingGovernance.ownerAgentId,
                  reviewFrequencyDays: pendingGovernance.reviewFrequencyDays,
                  validFrom: parseDate(pendingGovernance.validFrom),
                  validUntil: parseDate(pendingGovernance.validUntil),
                }
              : {}),
            draftMetadata: null,
            status: "approved",
            approvedRevisionId: existing.latestRevisionId,
            lastReviewedAt: now,
            nextReviewAt: nextReviewAt(now, approvedReviewFrequency),
            updatedAt: now,
          })
          .where(eq(foundationDocuments.id, foundationDocumentId));

        const row = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!row) throw new Error("Foundation document disappeared after approval");
        return mapFoundationRow(row);
      }),

    rejectReview: async (
      companyId: string,
      foundationDocumentId: string,
      expectedRevisionId: string,
      actor: FoundationMutationActor,
    ) =>
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        if (actor.principal.type !== "user") {
          throw forbidden("Foundation review decisions require a user principal");
        }

        const lockedRow = await lockFoundation(tx, companyId, foundationDocumentId);
        if (!lockedRow) throw notFound("Foundation document not found");
        const existing = mapFoundationRow(lockedRow);
        if (existing.status !== "in_review") {
          throw conflict("Only an in-review Foundation document can be rejected", {
            code: "foundation_invalid_transition",
            status: existing.status,
          });
        }
        if (existing.latestRevisionId !== expectedRevisionId) {
          throw conflict("Foundation document was updated by someone else", {
            code: "revision_conflict",
            currentRevisionId: existing.latestRevisionId,
          });
        }

        await txDb
          .update(foundationDocuments)
          .set({ status: "draft", updatedAt: new Date() })
          .where(eq(foundationDocuments.id, foundationDocumentId));

        const row = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!row) throw new Error("Foundation document disappeared after review rejection");
        return mapFoundationRow(row);
      }),

    createProposal: async (
      companyId: string,
      foundationDocumentId: string,
      rawInput: CreateFoundationChangeProposal,
      actor: FoundationMutationActor,
    ) => {
      const parsed = createFoundationChangeProposalSchema.safeParse(rawInput);
      if (!parsed.success) throw unprocessable("Invalid Foundation proposal", parsed.error.issues);
      const input = parsed.data;

      return db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const foundation = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!foundation) throw notFound("Foundation document not found");

        const baseRevisionId = input.baseRevisionId ?? foundation.document.latestRevisionId;
        if (baseRevisionId) {
          const baseRevision = await txDb
            .select({ id: documentRevisions.id })
            .from(documentRevisions)
            .where(
              and(
                eq(documentRevisions.companyId, companyId),
                eq(documentRevisions.documentId, foundation.document.id),
                eq(documentRevisions.id, baseRevisionId),
              ),
            )
            .then((rows) => rows[0] ?? null);
          if (!baseRevision) {
            throw unprocessable("Proposal base revision must belong to the Foundation document");
          }
        }

        const actorData = actorFields(actor);
        const now = new Date();
        const [proposal] = await txDb
          .insert(foundationChangeProposals)
          .values({
            companyId,
            foundationDocumentId,
            sourceType: input.sourceType,
            sourceId: input.sourceId ?? null,
            proposedByAgentId: actorData.agentId,
            proposedByUserId: actorData.userId,
            baseRevisionId,
            proposedBody: input.proposedBody,
            changeSummary: input.changeSummary ?? null,
            reason: input.reason ?? null,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return proposal!;
      });
    },

    listProposals: async (companyId: string, foundationDocumentId: string) =>
      db
        .select()
        .from(foundationChangeProposals)
        .where(
          and(
            eq(foundationChangeProposals.companyId, companyId),
            eq(foundationChangeProposals.foundationDocumentId, foundationDocumentId),
          ),
        )
        .orderBy(asc(foundationChangeProposals.createdAt)),

    archive: async (
      companyId: string,
      foundationDocumentId: string,
      actor: FoundationMutationActor,
    ) =>
      db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const lockedRow = await lockFoundation(tx, companyId, foundationDocumentId);
        if (!lockedRow) throw notFound("Foundation document not found");
        const existing = mapFoundationRow(lockedRow);
        if (existing.status === "archived") return existing;

        await txDb
          .update(foundationDocuments)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(foundationDocuments.id, foundationDocumentId));

        const row = await selectFoundation(
          txDb,
          companyId,
          eq(foundationDocuments.id, foundationDocumentId),
        );
        if (!row) throw new Error("Foundation document disappeared after archive");
        return mapFoundationRow(row);
      }),
  };
}
