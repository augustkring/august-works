import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { MIGRATION_EXECUTION_BUDGETS, runMigrationTransaction } from "./client.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbedded = support.supported ? describe : describe.skip;
const migrationFile = "0554_company_import_fenced_effects.sql";
const migrationSql = await fs.readFile(new URL(`./migrations/${migrationFile}`, import.meta.url), "utf8");
const migrationStatements = migrationSql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);

async function prepareLegacyCompanyOperations(db: ReturnType<typeof postgres>): Promise<void> {
  // The shared embedded-Postgres helper runs the current migration set. Keep
  // its real table and journal intact; shadow the name with a minimal legacy
  // schema for this migration-runner transaction test.
  await db.unsafe("ALTER TABLE customer_operations RENAME TO customer_operations_budget_fixture");
  await db.unsafe(`CREATE TABLE customer_operations (
    id uuid PRIMARY KEY, attempt_id uuid NOT NULL, operation_type text NOT NULL, status text NOT NULL
  )`);
  await db.unsafe("CREATE TABLE migration_test_journal (migration_file text PRIMARY KEY)");
}

describe("migration execution budget policy", () => {
  it("applies the finite budget only to the historically unbounded CompanyImport migration", () => {
    expect(MIGRATION_EXECUTION_BUDGETS).toEqual({
      [migrationFile]: {
        lockTimeoutMs: 5_000,
        preflightStatementTimeoutMs: 5_000,
        statementTimeoutMs: 120_000,
        maximumOneShotRows: 10_000,
        rationale: expect.any(String),
      },
    });
  });
});

describeEmbedded("CompanyImport migration execution budget", () => {
  it("applies the original migration to a representative 10,000-row population and writes the journal after success", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-migration-0554-budget-");
    const db = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      await prepareLegacyCompanyOperations(db);
      await db.unsafe(`INSERT INTO customer_operations (id, attempt_id, operation_type, status)
        SELECT gen_random_uuid(), gen_random_uuid(), 'company_import', 'running'
        FROM generate_series(1, 10000)`);
      await db.unsafe(`INSERT INTO customer_operations (id, attempt_id, operation_type, status)
        SELECT gen_random_uuid(), gen_random_uuid(), 'other', 'running'
        FROM generate_series(1, 100)`);

      await runMigrationTransaction(db, migrationFile, async () => {
        for (const statement of migrationStatements) await db.unsafe(statement);
        await db.unsafe("INSERT INTO migration_test_journal VALUES ($1)", [migrationFile]);
      });

      const [counts] = await db.unsafe<{ company_import_running: number; unrelated_running: number }[]>(`
        SELECT count(*) FILTER (WHERE operation_type='company_import' AND status='running')::int AS company_import_running,
          count(*) FILTER (WHERE operation_type='other' AND status='running')::int AS unrelated_running
        FROM customer_operations`);
      expect(counts).toEqual({ company_import_running: 10000, unrelated_running: 100 });
      const owners = await db.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM customer_operations
        WHERE operation_type='company_import' AND status='running' AND lease_owner_id=attempt_id
          AND lease_expires_at < clock_timestamp()`);
      expect(owners[0]?.count).toBe(10000);
      expect(await db`SELECT migration_file FROM migration_test_journal`).toEqual([{ migration_file: migrationFile }]);

      await expect(runMigrationTransaction(db, migrationFile, async () => {
        await db.unsafe("SET LOCAL statement_timeout = '20ms'");
        await db.unsafe("SELECT pg_sleep(0.1)");
        await db.unsafe("INSERT INTO migration_test_journal VALUES ('timed-out-probe')");
      })).rejects.toThrow(/statement execution exceeded[\s\S]*journal entry was not written/);
      expect(await db`SELECT migration_file FROM migration_test_journal`).toEqual([{ migration_file: migrationFile }]);
    } finally {
      await db.end();
      await database.cleanup();
    }
  }, 30_000);

  it("stops above the one-shot preflight limit before schema or journal mutation", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-migration-0554-preflight-");
    const db = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      await prepareLegacyCompanyOperations(db);
      await db.unsafe(`INSERT INTO customer_operations (id, attempt_id, operation_type, status)
        SELECT gen_random_uuid(), gen_random_uuid(), 'company_import', 'running'
        FROM generate_series(1, 10001)`);

      await expect(runMigrationTransaction(db, migrationFile, async () => {
        for (const statement of migrationStatements) await db.unsafe(statement);
        await db.unsafe("INSERT INTO migration_test_journal VALUES ($1)", [migrationFile]);
      })).rejects.toThrow(/preflight found 10001 running CompanyImport rows; the one-shot limit is 10000/);

      const columns = await db.unsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns
        WHERE table_name='customer_operations' AND column_name IN ('lease_owner_id','lease_expires_at')`);
      expect(columns).toEqual([]);
      expect(await db`SELECT migration_file FROM migration_test_journal`).toEqual([]);
      const rows = await db.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM customer_operations
        WHERE operation_type='company_import' AND status='running'`);
      expect(rows[0]?.count).toBe(10001);
    } finally {
      await db.end();
      await database.cleanup();
    }
  }, 30_000);

  it("rolls back schema, row updates and journal after the migration-specific lock budget expires", async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-migration-0554-lock-");
    const db = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    const blocker = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      await prepareLegacyCompanyOperations(db);
      await db.unsafe(`INSERT INTO customer_operations (id, attempt_id, operation_type, status)
        VALUES (gen_random_uuid(), gen_random_uuid(), 'company_import', 'running')`);
      await blocker.unsafe("BEGIN");
      await blocker.unsafe("LOCK TABLE customer_operations IN ACCESS EXCLUSIVE MODE");

      await expect(runMigrationTransaction(db, migrationFile, async () => {
        for (const statement of migrationStatements) await db.unsafe(statement);
        await db.unsafe("INSERT INTO migration_test_journal VALUES ($1)", [migrationFile]);
      })).rejects.toThrow(/transaction was rolled back and its journal entry was not written[\s\S]*affected_rows/);

      // Release the simulated external blocker before checking the table, then
      // prove the same migration can be retried and journaled after resolution.
      await blocker.unsafe("ROLLBACK");

      const columns = await db.unsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns
        WHERE table_name='customer_operations' AND column_name IN ('lease_owner_id','lease_expires_at')`);
      expect(columns).toEqual([]);
      const rows = await db.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM customer_operations
        WHERE operation_type='company_import' AND status='running'`);
      expect(rows[0]?.count).toBe(1);
      expect(await db`SELECT migration_file FROM migration_test_journal`).toEqual([]);

      await runMigrationTransaction(db, migrationFile, async () => {
        for (const statement of migrationStatements) await db.unsafe(statement);
        await db.unsafe("INSERT INTO migration_test_journal VALUES ($1)", [migrationFile]);
      });
      expect(await db`SELECT migration_file FROM migration_test_journal`).toEqual([{ migration_file: migrationFile }]);
    } finally {
      await blocker.unsafe("ROLLBACK").catch(() => {});
      await blocker.end();
      await db.end();
      await database.cleanup();
    }
  }, 30_000);
});
