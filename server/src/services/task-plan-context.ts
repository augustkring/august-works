import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  documentRevisions,
  documents,
  issueDocuments,
  issues,
  type Db,
} from "@paperclipai/db";
import { redactQuarantinedBodyForHigherTrust } from "./source-trust.js";
import type { DocumentRevisionSourceCapture } from "./documents.js";

/** Read the task's durable plan before constructing any provider's assignment. */
export async function getTaskPlanContext(input: {
  db: Db;
  companyId: string;
  issueId: string;
  approvedRevisionId?: string | null;
  exposeLowTrustRaw?: boolean;
  // Server-only collection, separate from the returned plan/prompt DTO.
  onSourceCapture?: (capture: DocumentRevisionSourceCapture | null) => void;
}) {
  const { db, companyId, issueId } = input;
  const plan = await db
    .select({
      documentId: documents.id,
      revisionId: documentRevisions.id,
      revisionNumber: documentRevisions.revisionNumber,
      body: documentRevisions.body,
      sourceTrust: documents.sourceTrust,
      payloadSourceSnapshot: documentRevisions.payloadSourceSnapshot,
    })
    .from(issueDocuments)
    .innerJoin(issues, eq(issues.id, issueDocuments.issueId))
    .innerJoin(documents, eq(documents.id, issueDocuments.documentId))
    .innerJoin(
      documentRevisions,
      and(
        eq(documentRevisions.documentId, documents.id),
        input.approvedRevisionId
          ? eq(documentRevisions.id, input.approvedRevisionId)
          : eq(documentRevisions.id, documents.latestRevisionId),
      ),
    )
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.companyId, companyId),
        eq(issueDocuments.companyId, companyId),
        eq(documents.companyId, companyId),
        eq(documentRevisions.companyId, companyId),
        eq(issueDocuments.key, "plan"),
        isNull(issues.conversationAgentId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!plan) {
    input.onSourceCapture?.(null);
    return null;
  }
  const { payloadSourceSnapshot, ...selectedPlan } = plan;
  const result = !input.exposeLowTrustRaw
    ? redactQuarantinedBodyForHigherTrust(selectedPlan)
    : selectedPlan;
  input.onSourceCapture?.({
    input: { kind: "document_revision", documentId: result.documentId, revisionId: result.revisionId, issueId,
      // Exact returned body after trust redaction, not the full owner-envelope
      // hash or final native dispatch. NULL history never becomes qualified.
      contentHash: createHash("sha256").update(result.body, "utf8").digest("hex") },
    payloadSourceSnapshot,
  });
  return result;
}
