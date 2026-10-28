import { sql } from "drizzle-orm";

type PrivacyLockDb = { execute: (query: unknown) => Promise<unknown> };
let emitted = 0;
const MAX_EVENTS = 80;

function serviceFrames(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack.split("\n").flatMap((line) => {
    const match = line.match(/(?:server\/src\/)?(services\/[\w./-]+\.ts:\d+:\d+)/);
    if (!match || match[1].endsWith("privacy-lock-diagnostics.ts")) return [];
    return [match[1]];
  }).slice(0, 4);
}

/** Bounded, opt-in metadata for one focused PostgreSQL deadlock investigation. */
export async function tracePrivacyLock(
  db: PrivacyLockDb,
  lockKey: string,
  mode: "read" | "write",
  acquire: () => Promise<unknown>,
): Promise<void> {
  if (process.env.PAPERCLIP_NATIVE_PRIVACY_LOCK_DIAGNOSTICS !== "1" || emitted >= MAX_EVENTS) {
    await acquire();
    return;
  }
  const frames = serviceFrames(new Error().stack);
  let metadata: { backend_pid: number; transaction_id: string; key_hash: string } | undefined;
  try {
    const rows = await db.execute(sql`select pg_backend_pid() as backend_pid,
      pg_current_xact_id()::text as transaction_id,
      hashtextextended(${lockKey}, 0)::text as key_hash`);
    const result = rows as Array<Record<string, unknown>>;
    const row = Array.isArray(result) ? result[0] : undefined;
    if (row && typeof row.backend_pid === "number" && typeof row.transaction_id === "string" &&
      typeof row.key_hash === "string") {
      metadata = { backend_pid: row.backend_pid, transaction_id: row.transaction_id, key_hash: row.key_hash };
    }
  } catch {
    // Diagnostics must never change lock behavior.
  }
  const event = (phase: "requested" | "acquired") => {
    if (!metadata || emitted >= MAX_EVENTS) return;
    emitted += 1;
    console.error("native-privacy-lock-diagnostic", JSON.stringify({ ...metadata, mode, frames, phase }));
  };
  event("requested");
  await acquire();
  event("acquired");
}
