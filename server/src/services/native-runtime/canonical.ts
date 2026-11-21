import { createHash } from "node:crypto";
import type { ExecutionContinuationEnvelope, IssueCommentAuthorType, SourceTrustMetadata } from "@paperclipai/shared";

export function canonicalNativeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalNativeJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalNativeJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function nativeSha256(value: unknown): string {
  return createHash("sha256").update(canonicalNativeJson(value), "utf8").digest("hex");
}

/** Runnerd's provider-visible wrapper for a successful call_api tool result. */
export function nativeCallApiResultEnvelope<T>(callId: string, result: T) {
  return { ok: true as const, operationId: "call_api" as const, callId, result };
}

/** Hash the exact public comment projection returned by Native history reads.
 * This is deliberately distinct from the database owner-snapshot body hash. */
export function nativeCommentProjectionHash(input: { body: unknown; presentation?: unknown; metadata?: unknown }): string {
  const json = JSON.parse(JSON.stringify({ body: input.body ?? null,
    presentation: input.presentation ?? null, metadata: input.metadata ?? null }));
  return nativeSha256(json);
}

/** Exact final-message rendition owned by Task continuation assembly. Redaction
 * runs after this projection, before any source hash is captured. */
export type NativeContinuationCommentProjection = Omit<ExecutionContinuationEnvelope["messages"][number],
  "authorType" | "sourceTrust" | "createdByRunId"> & { authorType: IssueCommentAuthorType;
    sourceTrust: SourceTrustMetadata | null; createdByRunId: string | null };
export function nativeContinuationCommentProjection(row: { id: string; authorType: IssueCommentAuthorType | null;
  authorUserId: string | null; authorAgentId: string | null; createdByRunId: string | null;
  body: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null; sourceTrust: SourceTrustMetadata | null }): NativeContinuationCommentProjection {
  return { id: row.id, authorType: row.authorType ?? (row.authorUserId ? "user" : row.authorAgentId ? "agent" : "system"),
    authorId: row.authorUserId ?? row.authorAgentId, createdByRunId: row.createdByRunId,
    body: row.deletedAt ? "" : row.body, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null, sourceTrust: row.sourceTrust };
}

/** Hash the closed DTO with the existing Native canonicalizer so nested trust
 * metadata and top-level JSONB key order preserve the selected rendition. */
export function nativeContinuationMessageHash(message: ExecutionContinuationEnvelope["messages"][number]): string {
  return nativeSha256({ id: message.id, authorType: message.authorType,
    authorId: message.authorId, createdByRunId: message.createdByRunId, body: message.body,
    createdAt: message.createdAt, updatedAt: message.updatedAt, deleted: message.deleted, sourceTrust: message.sourceTrust });
}

/** IDs carried by this persisted admitted wake, not inherited continuation
 * history. Unknown/missing IDs remain for the closed matcher to reject. */
export function nativeTaskWakeOriginCommentIds(payload: unknown): string[] {
  const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const root = object(payload), context = object(root._paperclipWakeContext);
  const ids: string[] = [];
  for (const value of [root, context]) {
    for (const key of ["commentId", "latestCommentId", "wakeCommentId"]) {
      if (value[key] === undefined || value[key] === null) continue;
      if (typeof value[key] !== "string" || !value[key]) return ["invalid-origin"];
      ids.push(value[key]);
    }
    for (const key of ["commentIds", "wakeCommentIds", "queuedCommentIds"]) {
      if (value[key] === undefined || value[key] === null) continue;
      const array = value[key];
      if (!Array.isArray(array) || array.length > 256 || array.some(id => typeof id !== "string" || !id)) return ["invalid-origin"];
      ids.push(...array);
    }
  }
  return [...new Set(ids)];
}

/** Exact causal fields from the actual admitted wake. Conflicting direct and
 * context projections do not acquire an authority by precedence. */
export function nativeTaskWakeInteraction(payload: unknown): {
  interactionId: string; interactionKind: string; interactionStatus: string; sourceRunId: string | null;
} | null {
  const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const root = record(payload), context = record(root._paperclipWakeContext);
  const values: Record<string, unknown> = {};
  for (const key of ["interactionId", "interactionKind", "interactionStatus", "sourceRunId"]) {
    if (root[key] !== undefined && context[key] !== undefined && root[key] !== context[key]) return null;
    values[key] = root[key] ?? context[key] ?? null;
  }
  return typeof values.interactionId === "string" && typeof values.interactionKind === "string" &&
    typeof values.interactionStatus === "string" && (values.sourceRunId === null || typeof values.sourceRunId === "string")
    ? { interactionId: values.interactionId, interactionKind: values.interactionKind,
        interactionStatus: values.interactionStatus, sourceRunId: values.sourceRunId } : null;
}
