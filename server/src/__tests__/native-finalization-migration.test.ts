import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  applyPendingMigrations,
  closeRegisteredClients,
  createDb,
  ensurePostgresDatabase,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("P6-18 / MIG-01..04 native finalization migration", () => {
  it("repairs only later duplicates and preserves legacy event bytes and cursors", async () => {
    const temporary = await startEmbeddedPostgresTestDatabase("paperclip-native-migration-");
    const directory = await mkdtemp(join(tmpdir(), "paperclip-finalization-prior-migrations-"));
    const legacyUrl = new URL(temporary.connectionString);
    legacyUrl.pathname = "/native_finalization_legacy";
    const connectionString = legacyUrl.href;
    try {
      await ensurePostgresDatabase(temporary.connectionString, "native_finalization_legacy");
      const rawDb = createDb(connectionString);
      // Execute the real pre-0227 migrations in an empty database. Removing
      // columns from today's schema leaves later privacy triggers/functions
      // behind and does not reconstruct a historical migration boundary.
      const migrationsRoot = new URL("../../../packages/db/src/migrations/", import.meta.url);
      const journal = JSON.parse(await readFile(new URL("meta/_journal.json", migrationsRoot), "utf8"));
      const priorEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < 227);
      await mkdir(join(directory, "meta"));
      for (const entry of priorEntries) {
        await copyFile(new URL(`${entry.tag}.sql`, migrationsRoot), join(directory, `${entry.tag}.sql`));
      }
      await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries: priorEntries }));
      await migrate(rawDb, { migrationsFolder: directory });
      expect(await rawDb.execute(sql`SELECT to_regclass('public.native_run_finalizations') AS native_finalizations`))
        .toEqual([{ native_finalizations: null }]);
      const companyId = "10000000-0000-4000-8000-000000000001";
      const agentId = "10000000-0000-4000-8000-000000000002";
      const runId = "10000000-0000-4000-8000-000000000003";
      await rawDb.execute(sql`
        INSERT INTO companies (id, name, issue_prefix)
        VALUES (${companyId}, 'Migration fixture', 'MIG')
      `);
      await rawDb.execute(sql`
        INSERT INTO agents (id, company_id, name)
        VALUES (${agentId}, ${companyId}, 'Migration agent')
      `);
      await rawDb.execute(sql`
        INSERT INTO heartbeat_runs (id, company_id, agent_id, status)
        VALUES (${runId}, ${companyId}, ${agentId}, 'succeeded')
      `);
      await rawDb.execute(sql`
        INSERT INTO heartbeat_run_events
          (company_id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at)
        VALUES
          (${companyId}, ${runId}, ${agentId}, 1, 'legacy.start', 'system', 'info', 'one', ${JSON.stringify({ bytes: "α-1" })}::jsonb, '2026-08-01T00:00:01.000Z'),
          (${companyId}, ${runId}, ${agentId}, 5, 'legacy.log', 'stdout', 'info', 'first-five', ${JSON.stringify({ bytes: "β-5a" })}::jsonb, '2026-08-01T00:00:02.000Z'),
          (${companyId}, ${runId}, ${agentId}, 5, 'legacy.log', 'stderr', 'warn', 'duplicate-five', ${JSON.stringify({ bytes: "γ-5b" })}::jsonb, '2026-08-01T00:00:03.000Z'),
          (${companyId}, ${runId}, ${agentId}, 9, 'legacy.end', 'system', 'info', 'nine', ${JSON.stringify({ bytes: "δ-9" })}::jsonb, '2026-08-01T00:00:04.000Z')
      `);
      const beforeResult = await rawDb.execute(sql`
        SELECT * FROM heartbeat_run_events WHERE run_id = ${runId} ORDER BY id
      `);
      const before = [...beforeResult] as unknown as Record<string, unknown>[];

      await applyPendingMigrations(connectionString);
      const db = createDb(connectionString);

      const after = await db.select().from(heartbeatRunEvents)
        .where(eq(heartbeatRunEvents.runId, runId)).orderBy(heartbeatRunEvents.id);
      expect(after.map((row) => row.seq)).toEqual([1, 5, 10, 9]);
      expect((await db.select({ nextEventSeq: heartbeatRuns.nextEventSeq }).from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId)))[0]?.nextEventSeq).toBe(11);

      // The repaired duplicate's cursor is the only changed byte-equivalent read field.
      const legacyColumns = (row: Record<string, unknown>) => ({
        id: String(row.id),
        companyId: row.companyId ?? row.company_id,
        runId: row.runId ?? row.run_id,
        agentId: row.agentId ?? row.agent_id,
        eventType: row.eventType ?? row.event_type,
        stream: row.stream,
        level: row.level,
        message: row.message,
        payload: row.payload,
        createdAt: new Date(String(row.createdAt ?? row.created_at)).toISOString(),
      });
      expect(after.map((row) => legacyColumns(row))).toEqual(before.map(legacyColumns));
      expect(after[0]?.seq).toBe(Number(before[0]?.seq));
      expect(after[1]?.seq).toBe(Number(before[1]?.seq));
      expect(after[3]?.seq).toBe(Number(before[3]?.seq));
      await expect(db.insert(heartbeatRunEvents).values({
        companyId, runId, agentId, seq: 5, eventType: "must-conflict",
      })).rejects.toThrow();
    } finally {
      await closeRegisteredClients(connectionString);
      await temporary.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
