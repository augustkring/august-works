import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { inspectMigrations } from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0195_built_in_agent_unique_marker.sql";
const UNIQUE_INDEX = "agents_company_built_in_agent_key_unique_idx";
const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function markerObj(key: string) {
  // Return a plain object (not a JSON string) so `sql.json` stores it as a jsonb
  // object; a JSON string param + `::jsonb` would double-encode into a scalar.
  return { paperclipBuiltInAgent: { key, featureKeys: [key] } };
}

describeEmbeddedPostgres("built-in agent unique marker migration", () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("resolves pre-existing duplicates and enforces uniqueness going forward", async () => {
    const affectedCompanyId = randomUUID();
    const cleanCompanyId = randomUUID();
    const olderId = randomUUID();
    const newerId = randomUUID();
    const terminatedDupeId = randomUUID();
    const cleanSummarizerId = randomUUID();
    const approvalId = randomUUID();
    const apiKeyId = randomUUID();

    // This migration fixes the pre-index state. Rewinding its journal on a
    // fully migrated V9 schema introduces later deferred Agent triggers that
    // never existed at this upgrade boundary. Install the exact earlier SQL
    // and journal, seed duplicates, then use the current migration owner.
    const folder = await fs.promises.mkdtemp(join(tmpdir(), "paperclip-marker-history-"));
    cleanups.push(() => fs.promises.rm(folder, { recursive: true, force: true }));
    const journal = JSON.parse(await fs.promises.readFile(new URL("./migrations/meta/_journal.json", import.meta.url), "utf8"));
    const target = journal.entries.findIndex((entry: { tag: string }) => `${entry.tag}.sql` === MIGRATION_FILE);
    expect(target).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, target) as Array<{ tag: string }>;
    await fs.promises.mkdir(join(folder, "meta"));
    await fs.promises.writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await fs.promises.copyFile(
      new URL(`./migrations/${entry.tag}.sql`, import.meta.url), join(folder, `${entry.tag}.sql`));
    const database = await startEmbeddedPostgresTestDatabase("paperclip-built-in-unique-marker-", {
      beforeMigrations: async connectionString => {
        const sql = postgres(connectionString, { max: 1 });
        try {
          await migrate(drizzle(sql), { migrationsFolder: folder });
          const [missing] = await sql<{ name: string | null }[]>`SELECT to_regclass(${UNIQUE_INDEX})::text AS name`;
          expect(missing!.name).toBeNull();
          await sql`
            INSERT INTO "companies" ("id", "name", "issue_prefix")
            VALUES
              (${affectedCompanyId}, 'Affected', 'AFF'),
              (${cleanCompanyId}, 'Clean', 'CLN')
          `;
          await sql`
            INSERT INTO "agents" ("id", "company_id", "name", "status", "created_at", "metadata")
            VALUES
              (${olderId}, ${affectedCompanyId}, 'Summarizer One', 'idle', '2026-07-18T00:00:00.000Z', ${sql.json(markerObj("summarizer"))}),
              (${newerId}, ${affectedCompanyId}, 'Summarizer Two', 'pending_approval', '2026-07-18T00:00:00.025Z', ${sql.json(markerObj("summarizer"))}),
              (${terminatedDupeId}, ${affectedCompanyId}, 'Summarizer Old', 'terminated', '2026-07-17T00:00:00.000Z', ${sql.json(markerObj("summarizer"))}),
              (${cleanSummarizerId}, ${cleanCompanyId}, 'Summarizer', 'idle', '2026-07-18T00:00:00.000Z', ${sql.json(markerObj("summarizer"))})
          `;
          await sql`
            INSERT INTO "approvals" ("id", "company_id", "type", "status", "payload")
            VALUES (${approvalId}, ${affectedCompanyId}, 'hire_agent', 'pending', ${sql.json({ agentId: newerId, sourceBuiltInAgentKey: "summarizer" })})
          `;
          await sql`
            INSERT INTO "agent_api_keys" ("id", "agent_id", "company_id", "name", "key_hash")
            VALUES (${apiKeyId}, ${newerId}, ${affectedCompanyId}, 'dupe-key', 'hash')
          `;
        } finally { await sql.end(); }
      },
    });
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());
    expect((await inspectMigrations(database.connectionString)).status).toBe("upToDate");

    const agentRows = await sql<{ id: string; status: string }[]>`
      SELECT "id", "status" FROM "agents"
      WHERE "company_id" IN (${affectedCompanyId}, ${cleanCompanyId})
    `;
    const statusById = new Map(agentRows.map((row) => [row.id, row.status]));
    // Oldest active row kept; newer duplicate terminated; the clean company untouched.
    expect(statusById.get(olderId)).toBe("idle");
    expect(statusById.get(newerId)).toBe("terminated");
    expect(statusById.get(cleanSummarizerId)).toBe("idle");

    const activeMarked = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM "agents"
      WHERE "company_id" = ${affectedCompanyId}
        AND "status" <> 'terminated'
        AND ("metadata" -> 'paperclipBuiltInAgent' ->> 'key') = 'summarizer'
    `;
    expect(activeMarked[0]!.count).toBe("1");

    // The newer duplicate's orphan approval was cancelled and its API key revoked.
    const [approval] = await sql<{ status: string }[]>`
      SELECT "status" FROM "approvals" WHERE "id" = ${approvalId}
    `;
    expect(approval!.status).toBe("cancelled");
    const [apiKey] = await sql<{ revoked_at: Date | null }[]>`
      SELECT "revoked_at" FROM "agent_api_keys" WHERE "id" = ${apiKeyId}
    `;
    expect(apiKey!.revoked_at).not.toBeNull();

    // The partial unique index exists again and now rejects a second active row.
    const indexes = await sql<{ indexname: string }[]>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "tablename" = 'agents' AND "indexname" = ${UNIQUE_INDEX}
    `;
    expect(indexes).toHaveLength(1);
    await expect(
      sql`
        INSERT INTO "agents" ("id", "company_id", "name", "status", "metadata")
        VALUES (${randomUUID()}, ${affectedCompanyId}, 'Summarizer Dupe', 'idle', ${sql.json(markerObj("summarizer"))})
      `,
    ).rejects.toMatchObject({ code: "23505", constraint_name: UNIQUE_INDEX });
  }, 30_000);
});
