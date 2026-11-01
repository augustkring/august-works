import { createHash } from "node:crypto";

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
