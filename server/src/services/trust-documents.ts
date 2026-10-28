import { and, eq, gt, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import {
  accountDeletionOperations,
  authSessions,
  authUsers,
  caseDocuments,
  companyMemberships,
  documentAnnotationAnchorSnapshots,
  documentAnnotationComments,
  documentAnnotationThreads,
  documentRevisions,
  documents,
  foundationChangeProposals,
  foundationDocuments,
  foundationSections,
  issueDocuments,
  pipelineCaseDocuments,
  pipelineDocuments,
  routineDocuments,
  statusCards,
  summarySlots,
  trustDocumentRegistry,
  type Db,
} from "@paperclipai/db";
import { playbookDocuments } from "@paperclipai/db/schema/playbooks";
import { nativePayloadSourceSnapshotSchema, trustDocumentSchema, type TrustDocument } from "@paperclipai/shared";
import { conflict, forbidden } from "../errors.js";
import { v5HumanActorId } from "./v5-authorization.js";

export interface TrustDocumentLifecycleState {
  customerVisibility: string;
  ndaRequired: boolean;
  effectiveAt: Date | null;
  lastReviewedAt: Date | null;
  expiresAt: Date | null;
  supersededBy: string | null;
  acceptanceRequired: boolean;
}

export interface TrustDocumentAuthorState {
  documentCreatedByUserId: string | null;
  documentCreatedByAgentId: string | null;
  documentUpdatedByUserId: string | null;
  documentUpdatedByAgentId: string | null;
  revisionCreatedByUserId: string | null;
  revisionCreatedByAgentId: string | null;
  revisionCreatedByRunId: string | null;
  hasPrivateOwnerLink: boolean;
  hasInheritedSources: boolean;
  hasMutableSourceTrust: boolean;
}

export function isStandaloneHumanOwnedDocument(row: TrustDocumentAuthorState, userId: string) {
  return row.documentCreatedByUserId === userId && row.documentCreatedByAgentId === null &&
    row.documentUpdatedByUserId === userId && row.documentUpdatedByAgentId === null &&
    row.revisionCreatedByUserId === userId && row.revisionCreatedByAgentId === null && row.revisionCreatedByRunId === null &&
    !row.hasPrivateOwnerLink && !row.hasInheritedSources && !row.hasMutableSourceTrust;
}

export function isCurrentHumanSession(input: {
  source: string | undefined;
  actorUserId: string | null | undefined;
  actorSessionId: string | null | undefined;
  expectedUserId: string;
  databaseSession: { id: string; userId: string; expiresAt: Date } | null;
  now: Date;
}) {
  return input.source === "session" && input.actorUserId === input.expectedUserId &&
    input.actorSessionId !== null && input.actorSessionId !== undefined &&
    input.databaseSession !== null && input.databaseSession.id === input.actorSessionId &&
    input.databaseSession.userId === input.expectedUserId && input.databaseSession.expiresAt > input.now;
}

export function currentHumanMembershipAllows(
  membership: { principalType: string; principalId: string; status: string; membershipRole: string | null } | null,
  userId: string,
  requireAdmin: boolean,
) {
  return membership?.principalType === "user" && membership.principalId === userId &&
    membership.status === "active" && (!requireAdmin || membership.membershipRole === "owner" || membership.membershipRole === "admin");
}

export function isCurrentReviewedPublicTrustDocument(
  row: TrustDocumentLifecycleState,
  now = new Date(),
  requireAcceptance = false,
) {
  return row.customerVisibility === "public" && !row.ndaRequired &&
    row.effectiveAt !== null && row.effectiveAt <= now &&
    row.lastReviewedAt !== null && row.lastReviewedAt <= now && row.supersededBy === null &&
    (row.expiresAt === null || row.expiresAt > now) &&
    (!requireAcceptance || row.acceptanceRequired);
}
type TrustActor = Express.Request["actor"];

function actorUserId(actor: TrustActor, expectedUserId: string) {
  const userId = v5HumanActorId(actor);
  if (expectedUserId !== userId) throw conflict("Account changed; reload this page", { code: "ACCOUNT_CHANGED" });
  return userId;
}

/** Rechecks the session generation and company membership in the caller's transaction. */
export async function assertCurrentCompanyHuman(
  tx: Db,
  actor: TrustActor,
  companyId: string,
  expectedUserId: string,
  requireAdmin = false,
  requireSession = false,
) {
  const userId = actorUserId(actor, expectedUserId);
  if (actor.source === "local_implicit")
    throw forbidden(requireSession
      ? "Explicit acceptance requires an authenticated Human session"
      : "A current authenticated Human session is required");
  if (actor.source !== "session" || !actor.sessionId ||
    (actor.authenticatedCredentialExpiresAt !== undefined && actor.authenticatedCredentialExpiresAt <= Date.now()))
    throw forbidden("A current authenticated Human session is required");
  const now = new Date();
  const [session] = await tx.select({ id: authSessions.id, userId: authSessions.userId, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, userId), gt(authSessions.expiresAt, now),
      or(eq(authSessions.authenticatorVersion, authUsers.authenticatorVersion),
        and(isNull(authSessions.authenticatorVersion), eq(authUsers.authenticatorVersion, 0))),
      notExists(tx.select({ userId: accountDeletionOperations.userId }).from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, authUsers.id)))))
    .limit(1).for("share");
  if (!isCurrentHumanSession({ source: actor.source, actorUserId: actor.userId,
    actorSessionId: actor.sessionId, expectedUserId, databaseSession: session ?? null, now }))
    throw forbidden("The authenticated Human session is no longer current");
  const [membership] = await tx.select({ principalType: companyMemberships.principalType,
    principalId: companyMemberships.principalId, status: companyMemberships.status,
    membershipRole: companyMemberships.membershipRole })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active")))
    .limit(1).for("share");
  if (!currentHumanMembershipAllows(membership ?? null, userId, requireAdmin))
    throw forbidden(requireAdmin ? "Current company owner or administrator access is required" : "Current company membership is required");
  return userId;
}

export async function privateOwnerLinkedDocumentIds(
  tx: Db,
  companyId: string,
  sources: Array<{ documentId: string; revisionId: string }>,
) {
  if (sources.length === 0) return new Set<string>();
  const documentIds = sources.map(source => source.documentId);
  const revisionIds = sources.map(source => source.revisionId);
  const [issueLinks, caseLinks, pipelineLinks, pipelineCaseLinks, routineLinks, foundationLinks,
    foundationSectionLinks, foundationProposalLinks, playbookLinks, statusCardLinks, summaryLinks,
    annotationThreadLinks, annotationCommentLinks, annotationAnchorLinks] = await Promise.all([
    tx.select({ documentId: issueDocuments.documentId }).from(issueDocuments).where(and(eq(issueDocuments.companyId, companyId), inArray(issueDocuments.documentId, documentIds))),
    tx.select({ documentId: caseDocuments.documentId }).from(caseDocuments).where(and(eq(caseDocuments.companyId, companyId), inArray(caseDocuments.documentId, documentIds))),
    tx.select({ documentId: pipelineDocuments.documentId }).from(pipelineDocuments).where(and(eq(pipelineDocuments.companyId, companyId), inArray(pipelineDocuments.documentId, documentIds))),
    tx.select({ documentId: pipelineCaseDocuments.documentId }).from(pipelineCaseDocuments).where(and(eq(pipelineCaseDocuments.companyId, companyId), inArray(pipelineCaseDocuments.documentId, documentIds))),
    tx.select({ documentId: routineDocuments.documentId }).from(routineDocuments).where(and(eq(routineDocuments.companyId, companyId), inArray(routineDocuments.documentId, documentIds))),
    tx.select({ documentId: foundationDocuments.documentId }).from(foundationDocuments).where(and(eq(foundationDocuments.companyId, companyId), inArray(foundationDocuments.documentId, documentIds))),
    tx.select({ revisionId: foundationSections.documentRevisionId }).from(foundationSections).where(and(eq(foundationSections.companyId, companyId), inArray(foundationSections.documentRevisionId, revisionIds))),
    tx.select({ revisionId: foundationChangeProposals.baseRevisionId }).from(foundationChangeProposals).where(and(eq(foundationChangeProposals.companyId, companyId), inArray(foundationChangeProposals.baseRevisionId, revisionIds))),
    tx.select({ documentId: playbookDocuments.documentId }).from(playbookDocuments).where(and(eq(playbookDocuments.companyId, companyId), inArray(playbookDocuments.documentId, documentIds))),
    tx.select({ documentId: statusCards.documentId }).from(statusCards).where(and(eq(statusCards.companyId, companyId), inArray(statusCards.documentId, documentIds))),
    tx.select({ documentId: summarySlots.documentId }).from(summarySlots).where(and(eq(summarySlots.companyId, companyId), inArray(summarySlots.documentId, documentIds))),
    tx.select({ documentId: documentAnnotationThreads.documentId }).from(documentAnnotationThreads).where(and(eq(documentAnnotationThreads.companyId, companyId), inArray(documentAnnotationThreads.documentId, documentIds))),
    tx.select({ documentId: documentAnnotationComments.documentId }).from(documentAnnotationComments).where(and(eq(documentAnnotationComments.companyId, companyId), inArray(documentAnnotationComments.documentId, documentIds))),
    tx.select({ documentId: documentAnnotationAnchorSnapshots.documentId }).from(documentAnnotationAnchorSnapshots).where(and(eq(documentAnnotationAnchorSnapshots.companyId, companyId), inArray(documentAnnotationAnchorSnapshots.documentId, documentIds))),
  ]);
  const linked = new Set([...issueLinks, ...caseLinks, ...pipelineLinks, ...pipelineCaseLinks, ...routineLinks,
    ...foundationLinks, ...playbookLinks, ...statusCardLinks, ...summaryLinks, ...annotationThreadLinks,
    ...annotationCommentLinks, ...annotationAnchorLinks].flatMap(row =>
    "documentId" in row && row.documentId ? [row.documentId] : []));
  const sourceDocumentByRevision = new Map(sources.map(source => [source.revisionId, source.documentId]));
  for (const revisionLink of [...foundationSectionLinks, ...foundationProposalLinks]) {
    const revisionId = revisionLink.revisionId;
    const documentId = revisionId ? sourceDocumentByRevision.get(revisionId) : null;
    if (documentId) linked.add(documentId);
  }
  return linked;
}

/**
 * Resolve the exact current acceptance-required documents for an authenticated
 * Human. The caller must pass its transaction and actor context; this function
 * locks source rows, rechecks current account/company authorization after the
 * lock wait, and returns only the same metadata-safe DTO as the trust route.
 */
export async function resolveCurrentTrustDocuments(
  tx: Db,
  actor: TrustActor,
  companyId: string,
  expectedUserId: string,
  acceptanceRequiredOnly = false,
): Promise<TrustDocument[]> {
  const queryAt = new Date();
  const rows = await tx.select({
    id: trustDocumentRegistry.id,
    documentId: trustDocumentRegistry.documentId,
    documentRevisionId: trustDocumentRegistry.documentRevisionId,
    title: documentRevisions.title,
    version: documentRevisions.revisionNumber,
    registryVersion: trustDocumentRegistry.version,
    payloadSourceProtocolVersion: documentRevisions.payloadSourceProtocolVersion,
    payloadSourceSnapshotInvalidated: documentRevisions.payloadSourceSnapshotInvalidated,
    documentRevisionErased: sql<boolean>`aw_learning_asset_erased(${trustDocumentRegistry.companyId}, 'document_revision', ${documentRevisions.id})`,
    revisionCreatedByUserId: documentRevisions.createdByUserId,
    revisionCreatedByAgentId: documentRevisions.createdByAgentId,
    revisionCreatedByRunId: documentRevisions.createdByRunId,
    sourceSnapshot: documentRevisions.payloadSourceSnapshot,
    conversationFoundationProposalIds: documentRevisions.conversationFoundationProposalIds,
    owner: trustDocumentRegistry.owner,
    documentCreatedByUserId: documents.createdByUserId,
    documentCreatedByAgentId: documents.createdByAgentId,
    documentUpdatedByUserId: documents.updatedByUserId,
    documentUpdatedByAgentId: documents.updatedByAgentId,
    documentSourceTrust: documents.sourceTrust,
    effectiveAt: trustDocumentRegistry.effectiveAt,
    evidenceRefs: trustDocumentRegistry.evidenceRefs,
    customerVisibility: trustDocumentRegistry.customerVisibility,
    ndaRequired: trustDocumentRegistry.ndaRequired,
    lastReviewedAt: trustDocumentRegistry.lastReviewedAt,
    nextReviewOrTrigger: trustDocumentRegistry.nextReviewOrTrigger,
    expiresAt: trustDocumentRegistry.expiresAt,
    supersededBy: trustDocumentRegistry.supersededBy,
    materialChangeAction: trustDocumentRegistry.materialChangeAction,
    acceptanceRequired: trustDocumentRegistry.acceptanceRequired,
  }).from(trustDocumentRegistry)
    .innerJoin(documentRevisions, and(
      eq(documentRevisions.companyId, trustDocumentRegistry.companyId),
      eq(documentRevisions.documentId, trustDocumentRegistry.documentId),
      eq(documentRevisions.id, trustDocumentRegistry.documentRevisionId),
    ))
    .innerJoin(documents, and(
      eq(documents.companyId, trustDocumentRegistry.companyId),
      eq(documents.id, trustDocumentRegistry.documentId),
    ))
    .where(and(
      eq(trustDocumentRegistry.companyId, companyId),
      eq(documents.latestRevisionId, trustDocumentRegistry.documentRevisionId),
      eq(trustDocumentRegistry.customerVisibility, "public"),
      eq(trustDocumentRegistry.ndaRequired, false),
      acceptanceRequiredOnly ? eq(trustDocumentRegistry.acceptanceRequired, true) : undefined,
      isNull(trustDocumentRegistry.supersededBy),
      sql`${trustDocumentRegistry.lastReviewedAt} is not null`,
      lte(trustDocumentRegistry.lastReviewedAt, queryAt),
      sql`${trustDocumentRegistry.effectiveAt} is not null`,
      lte(trustDocumentRegistry.effectiveAt, queryAt),
      or(isNull(trustDocumentRegistry.expiresAt), gt(trustDocumentRegistry.expiresAt, queryAt)),
    )).for("update");
  await assertCurrentCompanyHuman(tx, actor, companyId, expectedUserId);
  const linkedDocuments = await privateOwnerLinkedDocumentIds(tx, companyId,
    rows.map(row => ({ documentId: row.documentId, revisionId: row.documentRevisionId })));
  const projectionAt = new Date();
  return rows.filter(row => {
    if (row.registryVersion !== String(row.version) || !isCurrentReviewedPublicTrustDocument(row, projectionAt, acceptanceRequiredOnly)) return false;
    const parsedSnapshot = row.sourceSnapshot === null ? null : nativePayloadSourceSnapshotSchema.safeParse(row.sourceSnapshot);
    const hasInheritedSources = row.payloadSourceProtocolVersion !== 1 || row.payloadSourceSnapshotInvalidated ||
      row.documentRevisionErased || row.sourceSnapshot === null ||
      (parsedSnapshot !== null && (!parsedSnapshot.success ||
        parsedSnapshot.data.inputs.length > 0 || Object.values(parsedSnapshot.data.policy).some(ids => ids.length > 0)));
    return isStandaloneHumanOwnedDocument({
      documentCreatedByUserId: row.documentCreatedByUserId,
      documentCreatedByAgentId: row.documentCreatedByAgentId,
      documentUpdatedByUserId: row.documentUpdatedByUserId,
      documentUpdatedByAgentId: row.documentUpdatedByAgentId,
      revisionCreatedByUserId: row.revisionCreatedByUserId,
      revisionCreatedByAgentId: row.revisionCreatedByAgentId,
      revisionCreatedByRunId: row.revisionCreatedByRunId,
      hasPrivateOwnerLink: linkedDocuments.has(row.documentId),
      hasInheritedSources: hasInheritedSources || row.conversationFoundationProposalIds.length > 0,
      hasMutableSourceTrust: row.documentSourceTrust !== null,
    }, row.owner);
  }).map(row => trustDocumentSchema.parse({
    id: row.id,
    documentId: row.documentId,
    documentRevisionId: row.documentRevisionId,
    title: row.title,
    version: String(row.version),
    owner: row.owner,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    evidenceRefs: row.evidenceRefs,
    customerVisibility: row.customerVisibility,
    ndaRequired: row.ndaRequired,
    lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
    nextReviewOrTrigger: row.nextReviewOrTrigger,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    supersededBy: row.supersededBy,
    materialChangeAction: row.materialChangeAction,
    acceptanceRequired: row.materialChangeAction === "reacceptance",
  }));
}

export function resolveCurrentTrustAcceptanceRequirements(
  tx: Db,
  actor: TrustActor,
  companyId: string,
  expectedUserId: string,
) {
  return resolveCurrentTrustDocuments(tx, actor, companyId, expectedUserId, true);
}

/** All current owner-declared material-change actions; no_action is omitted. */
export async function resolveCurrentTrustMaterialChangeRequirements(
  tx: Db,
  actor: TrustActor,
  companyId: string,
  expectedUserId: string,
) {
  const documents = await resolveCurrentTrustDocuments(tx, actor, companyId, expectedUserId);
  const [membership] = await tx.select({ membershipRole: companyMemberships.membershipRole })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, expectedUserId), eq(companyMemberships.status, "active")))
    .limit(1).for("share");
  return {
    documents: documents.filter(document => document.materialChangeAction !== "no_action"),
    membershipRole: membership?.membershipRole ?? null,
  };
}
