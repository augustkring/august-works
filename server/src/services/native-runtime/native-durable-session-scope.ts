import { and, eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";

/**
 * PRIV-R8. Every controller durable session folder is recorded on its Run
 * before the folder can exist: the executor writes the folder's scope digest
 * into the Run profile, then creates the folder. Erasure therefore finds a
 * company's folders from the database alone, without trusting the runner's
 * identity files, which a crash can leave missing and a fault can corrupt.
 *
 * The record is content-free (a digest and the server-generated session id)
 * and Source erasure keeps it, so the erasure job that runs afterwards can
 * still find the folder.
 */
export const NATIVE_DURABLE_SESSION_SCOPE_KEY = "nativeDurableSessionScope";
export const NATIVE_DURABLE_SESSION_SCOPE_SCHEMA = "paperclip.native-durable-session-scope.v1";
const SCOPE_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
/** A Run's execution input fixes its scope; a few retries may add none. */
const RUN_SCOPE_BOUND = 16;

export type NativeDurableSessionScopeRecord = {
  schema: typeof NATIVE_DURABLE_SESSION_SCOPE_SCHEMA;
  normalizedSessionId: string;
  scopeSha256: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** `null` when the Run recorded nothing; throws when the record is malformed. */
export function readNativeDurableSessionScopeRecord(profile: unknown): NativeDurableSessionScopeRecord | null {
  const value = record(profile)[NATIVE_DURABLE_SESSION_SCOPE_KEY];
  if (value === undefined || value === null) return null;
  const entry = record(value);
  if (entry.schema !== NATIVE_DURABLE_SESSION_SCOPE_SCHEMA || typeof entry.normalizedSessionId !== "string" ||
    !entry.normalizedSessionId || !Array.isArray(entry.scopeSha256) || entry.scopeSha256.length === 0 ||
    entry.scopeSha256.length > RUN_SCOPE_BOUND ||
    !entry.scopeSha256.every(digest => typeof digest === "string" && SCOPE_DIGEST_PATTERN.test(digest)))
    throw new Error("native_durable_session_scope_record_invalid");
  return { schema: NATIVE_DURABLE_SESSION_SCOPE_SCHEMA, normalizedSessionId: entry.normalizedSessionId,
    scopeSha256: [...new Set(entry.scopeSha256 as string[])].sort() };
}

/** Record the folder's scope on its Run. Callers create the folder only after
 * this commits; a failure leaves no folder behind. Idempotent. */
export async function recordNativeDurableSessionScope(db: Db, input: {
  companyId: string; runId: string; normalizedSessionId: string; scopeSha256: string;
}) {
  if (!SCOPE_DIGEST_PATTERN.test(input.scopeSha256) || !input.normalizedSessionId)
    throw new Error("native_durable_session_scope_record_invalid");
  await db.transaction(async rawTx => {
    const tx = rawTx as unknown as Db;
    const [run] = await tx.select({ id: heartbeatRuns.id, runnerProfileJson: heartbeatRuns.runnerProfileJson })
      .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)))
      .for("update").limit(1);
    if (!run) throw new Error("native_durable_session_scope_owner_missing");
    const profile = record(run.runnerProfileJson);
    const current = readNativeDurableSessionScopeRecord(profile);
    if (current && current.normalizedSessionId !== input.normalizedSessionId)
      throw new Error("native_durable_session_scope_record_conflict");
    if (current?.scopeSha256.includes(input.scopeSha256)) return;
    const scopeSha256 = [...(current?.scopeSha256 ?? []), input.scopeSha256].sort();
    if (scopeSha256.length > RUN_SCOPE_BOUND) throw new Error("native_durable_session_scope_record_invalid");
    const next: NativeDurableSessionScopeRecord = { schema: NATIVE_DURABLE_SESSION_SCOPE_SCHEMA,
      normalizedSessionId: input.normalizedSessionId, scopeSha256 };
    await tx.update(heartbeatRuns).set({ runnerProfileJson: { ...profile, [NATIVE_DURABLE_SESSION_SCOPE_KEY]: next },
      updatedAt: new Date() }).where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)));
  });
}
