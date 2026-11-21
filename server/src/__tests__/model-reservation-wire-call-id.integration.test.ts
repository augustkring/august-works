import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type orchestrationModelReservations } from "@paperclipai/db";
import { modelProviderWireReceiptSchema } from "@paperclipai/shared";
import {
  MODEL_RESERVATION_CALL_ID_PURPOSES,
  assertModelReservationWireCallId,
} from "../services/orchestration/model-reservations.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// MS1h11. recordWireDispatch and aw_v10_provider_wire_receipt_guard must give
// the same answer for every reservation purpose: a string provider call ID is
// required for some purposes and a null call ID for all others. The probe
// table copies the real table's columns and CHECK constraints and runs the
// same trigger function, so each purpose can be checked without its FK graph.
type Purpose = (typeof orchestrationModelReservations.$inferSelect)["purpose"];
type Verdict = "accepted" | "refused";
const PROBE = "wire_call_id_probe";
const CALL_IDS = ["toolu_wire_call_id_probe", null] as const;

function tsVerdict(purpose: Purpose, callId: string | null): Verdict {
  try {
    assertModelReservationWireCallId(purpose, callId);
    return "accepted";
  } catch (error) {
    expect(error).toMatchObject({ status: 403 });
    return "refused";
  }
}

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return messages;
}

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("model reservation wire receipt call ID contract", () => {
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("model-reservation-wire-call-id-");
    db = createDb(temp.connectionString, { maxConnections: 1 });
    await db.execute(sql.raw(`CREATE SCHEMA ${PROBE}`));
    await db.execute(sql.raw(`CREATE TABLE ${PROBE}.orchestration_model_reservations
      (LIKE public.orchestration_model_reservations INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`));
    await db.execute(sql.raw(`CREATE TRIGGER probe_wire_receipt_guard
      BEFORE UPDATE ON ${PROBE}.orchestration_model_reservations
      FOR EACH ROW EXECUTE FUNCTION public.aw_v10_provider_wire_receipt_guard()`));
  }, 60000);
  afterAll(async () => {
    try { await db?.$client.end({ timeout: 0 }); }
    finally { await temp?.cleanup(); }
  });

  async function purposesFromCheck(): Promise<string[]> {
    const rows = await db.execute<{ definition: string }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.orchestration_model_reservations'::regclass
        AND conname = 'orchestration_model_reservation_purpose_ck'`);
    expect(rows).toHaveLength(1);
    return [...rows[0]!.definition.matchAll(/'([a-z_]+)'::text/g)].map(match => match[1]!);
  }

  async function dbVerdict(purpose: string, callId: string | null): Promise<Verdict> {
    const id = randomUUID();
    const conversation = purpose === "conversation_model";
    const review = purpose === "review_model";
    const decision = purpose === "decision_shadow";
    const provider = decision ? "openrouter" : "anthropic";
    const optionalId = (present: boolean) => (present ? randomUUID() : null);
    await db.execute(sql`
      INSERT INTO ${sql.raw(PROBE)}.orchestration_model_reservations (
        id, company_id, plan_id,
        conversation_agent_id, conversation_run_id, conversation_issue_id, conversation_session_generation,
        execution_manifest_id, execution_manifest_hash, conversation_tariff_snapshot,
        review_issue_id, review_interaction_id, review_decision_id, review_source_run_id, review_source_result_id,
        review_source_worker_id, review_source_agent_id, review_source_attempt_id, review_source_receipt_digest,
        review_source_result_canonical_sha256, review_agent_id, review_run_id, review_execution_manifest_id, review_plan_version,
        purpose, principal_user_id, idempotency_key, request_hash, input_hash, authority_hash,
        quote, maximum_minor, status, expires_at
      ) VALUES (
        ${id}, ${randomUUID()}, ${optionalId(!conversation)},
        ${optionalId(conversation)}, ${optionalId(conversation)}, ${optionalId(conversation)}, ${conversation ? 0 : null},
        ${optionalId(conversation)}, ${conversation ? "b".repeat(64) : null}, ${conversation ? "{}" : null}::jsonb,
        ${optionalId(review)}, ${optionalId(review)}, ${optionalId(review)}, ${optionalId(review)}, ${optionalId(review)},
        ${optionalId(review)}, ${optionalId(review)}, ${optionalId(review)}, ${review ? "c".repeat(64) : null},
        ${review ? `sha256:${"d".repeat(64)}` : null}, ${optionalId(review)}, ${optionalId(review)}, ${optionalId(review)}, ${review ? 1 : null},
        ${purpose}, 'wire-call-id-probe', ${id}, ${"a".repeat(64)}, ${"a".repeat(64)}, ${"a".repeat(64)},
        ${JSON.stringify({ provider, maximumMinor: 1 })}::jsonb, 1, 'dispatched', now() + interval '1 hour'
      )`);
    const receipt = modelProviderWireReceiptSchema.parse({
      version: 1, reservationId: id, requestHash: "a".repeat(64), method: "POST",
      endpoint: decision ? "https://openrouter.ai/api/alpha/decisions" : "https://api.anthropic.com/v1/messages",
      bodySha256: "e".repeat(64), callId,
    });
    try {
      await db.execute(sql`
        UPDATE ${sql.raw(PROBE)}.orchestration_model_reservations
        SET provider_wire_receipt = ${JSON.stringify(receipt)}::jsonb WHERE id = ${id}`);
    } catch (error) {
      if (errorChainMessages(error).some(message => message.includes("model_provider_wire_receipt_invalid"))) return "refused";
      throw error;
    }
    const stored = await db.execute<{ receipt: unknown }>(sql`
      SELECT provider_wire_receipt AS receipt FROM ${sql.raw(PROBE)}.orchestration_model_reservations WHERE id = ${id}`);
    expect(stored[0]?.receipt).toEqual(receipt);
    return "accepted";
  }

  it("runs the probe on the same guard function as both real ledger tables", async () => {
    const rows = await db.execute<{ table: string; fn: string; enabled: string }>(sql`
      SELECT c.relname AS table, t.tgfoid::regproc::text AS fn, t.tgenabled::text AS enabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND t.tgname IN (
        'orchestration_model_reservation_wire_receipt_guard',
        'orchestration_company_purpose_reservation_wire_receipt_guard')
      ORDER BY c.relname`);
    expect(rows.map(row => ({ ...row }))).toEqual([
      { table: "orchestration_company_purpose_reservations", fn: "aw_v10_provider_wire_receipt_guard", enabled: "O" },
      { table: "orchestration_model_reservations", fn: "aw_v10_provider_wire_receipt_guard", enabled: "O" },
    ]);
  });

  it("gives the same call ID verdict in TypeScript and SQL for every purpose in the purpose CHECK", async () => {
    const purposes = await purposesFromCheck();
    expect([...purposes].sort()).toEqual([
      "agent_safe_test", "conversation_model", "decision_shadow", "provider_conformance",
      "read_only_trajectory", "read_only_verification", "review_model", "worker_model",
    ]);
    for (const purpose of MODEL_RESERVATION_CALL_ID_PURPOSES) expect(purposes).toContain(purpose);
    const verdicts: Record<string, Record<string, { ts: Verdict; db: Verdict }>> = {};
    for (const purpose of purposes) {
      for (const callId of CALL_IDS) {
        (verdicts[purpose] ??= {})[callId === null ? "null" : "string"] = {
          ts: tsVerdict(purpose as Purpose, callId),
          db: await dbVerdict(purpose, callId),
        };
      }
    }
    for (const purpose of purposes) {
      const requiresCallId = MODEL_RESERVATION_CALL_ID_PURPOSES.has(purpose as Purpose);
      expect({ purpose, ...verdicts[purpose] }).toEqual({
        purpose,
        string: requiresCallId ? { ts: "accepted", db: "accepted" } : { ts: "refused", db: "refused" },
        null: requiresCallId ? { ts: "refused", db: "refused" } : { ts: "accepted", db: "accepted" },
      });
    }
    expect(verdicts.review_model).toEqual({
      string: { ts: "accepted", db: "accepted" },
      null: { ts: "refused", db: "refused" },
    });
  });
});
