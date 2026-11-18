import { and, eq } from "drizzle-orm";
import { documentRevisions, documents, issueDocuments, type Db } from "@paperclipai/db";
import type { VerificationEvidenceRef } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { validateWorkflowOutput } from "../workflows/workflow-output-schema.js";

export type TaskDocumentOutputRow = { key: string; doc: typeof documents.$inferSelect };

/** The documents linked to a Task, with their keys, as plan verification reads
 * them. `lock` takes the share lock on the documents that verification holds
 * while it builds its packet; `documentId` narrows the read to one document. */
export async function readTaskDocumentOutputs(
  db: Db,
  input: { companyId: string; issueId: string; documentId?: string; lock: boolean },
): Promise<TaskDocumentOutputRow[]> {
  const query = db.select({ key: issueDocuments.key, doc: documents }).from(issueDocuments)
    .innerJoin(documents, and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
    .where(and(
      eq(issueDocuments.companyId, input.companyId),
      eq(issueDocuments.issueId, input.issueId),
      input.documentId === undefined ? undefined : eq(issueDocuments.documentId, input.documentId),
    ));
  return input.lock ? query.for("share", { of: documents }) : query;
}

export type TaskDocumentOutputCheck =
  | { status: "missing" }
  | {
      status: "present";
      /** The document's latest revision row, or null when it does not exist. */
      revision: typeof documentRevisions.$inferSelect | null;
      /** The latest revision exists and its body and number match the document's latest body and number. */
      revisionCurrent: boolean;
      /** null when the output declares no JSON schema. */
      schemaValid: boolean | null;
      evidence: VerificationEvidenceRef;
    };

/**
 * MS1f decision 2. The one check of a declared Task document output, shared by
 * plan verification (`output_missing`, `output_revision_mismatch`,
 * `output_schema_mismatch` and the `task_document` evidence) and the Native
 * evidence classifier's `document:<docId>:<revisionId>` evidence. It reads the
 * document's current state only; who wrote it is the caller's question.
 */
export async function checkTaskDocumentOutput(
  db: Db,
  input: {
    companyId: string;
    output: TaskDocumentOutputRow | undefined;
    jsonSchema: Record<string, unknown> | null | undefined;
    lock: boolean;
  },
): Promise<TaskDocumentOutputCheck> {
  const output = input.output;
  if (!output?.doc.latestBody.trim() || !output.doc.latestRevisionId) return { status: "missing" };
  const query = db.select().from(documentRevisions).where(and(
    eq(documentRevisions.companyId, input.companyId),
    eq(documentRevisions.documentId, output.doc.id),
    eq(documentRevisions.id, output.doc.latestRevisionId),
  ));
  const [revision] = input.lock ? await query.for("share") : await query;
  const revisionCurrent = !!revision && revision.body === output.doc.latestBody &&
    revision.revisionNumber === output.doc.latestRevisionNumber;
  let schemaValid: boolean | null = null;
  if (input.jsonSchema) {
    try {
      if (Buffer.byteLength(output.doc.latestBody, "utf8") > 256000) throw new Error("bounded_output_limit");
      validateWorkflowOutput(input.jsonSchema, JSON.parse(output.doc.latestBody));
      schemaValid = true;
    } catch {
      schemaValid = false;
    }
  }
  return {
    status: "present",
    revision: revision ?? null,
    revisionCurrent,
    schemaValid,
    evidence: {
      ref: `document:${output.doc.id}:${output.doc.latestRevisionId}`,
      type: "task_document",
      sourceId: output.doc.id,
      sourceVersion: output.doc.latestRevisionId,
      hash: nativeSha256(output.doc.latestBody),
    },
  };
}
