/**
 * The `account.issuer` backfill has to be total. The column lands NOT NULL, so
 * a row the UPDATE misses aborts the whole migration and leaves an upgraded
 * install with no working auth at all. This suite builds the pre-upgrade
 * schema, seeds existing deployment rows, and applies the current migrations;
 * a backfill narrowed to one provider fails here.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMigrations } from "./client.js";
import { authAccounts } from "./schema/auth.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const MIGRATION_FILE = "0230_better_auth_account_issuer.sql";
const UNIQUE_INDEX = "account_issuer_account_id_uq";

// Better Auth's own issuer helpers: `createLocalAccountIssuer("credential")`
// for email/password and `createOAuthAccountIssuer(providerId)` for a social
// provider that declares no issuer of its own. Sign-in looks the credential
// account up by this exact value.
const CREDENTIAL_ISSUER = "local:credential";
const OAUTH_ISSUER_PREFIX = "local:oauth:";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describe("account issuer schema", () => {
  it("declares the column Better Auth requires and the key it indexes on", () => {
    const config = getTableConfig(authAccounts);
    const issuer = config.columns.find((column) => column.name === "issuer");
    expect(issuer).toBeDefined();
    expect(issuer?.notNull).toBe(true);

    // Better Auth declares `(issuer, accountId)` unique on the account model
    // and resolves accounts by that pair.
    const unique = config.indexes.find((index) => index.config.name === UNIQUE_INDEX);
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "issuer",
      "account_id",
    ]);
  });
});

describeEmbeddedPostgres("account issuer migration", () => {
  // Reverse registration order, one at a time. The raw `postgres` client is not
  // registered with the module's client registry, so the cluster teardown does
  // not close it. Stopping the cluster while that client is still draining kills
  // the backend socket under a queued write and can crash the runner.
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("backfills every pre-upgrade row before the column goes NOT NULL", async () => {
    const credentialUserId = `user-${randomUUID()}`;
    const socialUserId = `user-${randomUUID()}`;
    const credentialAccountId = `account-${randomUUID()}`;
    const githubAccountId = `account-${randomUUID()}`;
    const googleAccountId = `account-${randomUUID()}`;
    // Seed the real pre-upgrade schema. Later immutable account guards depend
    // on issuer, so dropping it from the latest schema is not an old install.
    const folder = await fs.promises.mkdtemp(join(tmpdir(), "paperclip-issuer-history-"));
    cleanups.push(() => fs.promises.rm(folder, { recursive: true, force: true }));
    const journal = JSON.parse(await fs.promises.readFile(new URL("./migrations/meta/_journal.json", import.meta.url), "utf8"));
    const target = journal.entries.findIndex((entry: { tag: string }) => `${entry.tag}.sql` === MIGRATION_FILE);
    expect(target).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, target) as Array<{ tag: string }>;
    await fs.promises.mkdir(join(folder, "meta"));
    await fs.promises.writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await fs.promises.copyFile(
      new URL(`./migrations/${entry.tag}.sql`, import.meta.url), join(folder, `${entry.tag}.sql`));
    const database = await startEmbeddedPostgresTestDatabase("paperclip-account-issuer-", {
      beforeMigrations: async connectionString => {
        const historical = postgres(connectionString, { max: 1 });
        try { await migrate(drizzle(historical), { migrationsFolder: folder }); }
        finally { await historical.end(); }
        const sql = postgres(connectionString, { max: 1 });
        try {
          const [column] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM information_schema.columns
            WHERE table_schema='public' AND table_name='account' AND column_name='issuer'`;
          expect(column?.count).toBe(0);
          await sql`
      INSERT INTO "user" ("id", "name", "email", "created_at", "updated_at")
      VALUES
        (${credentialUserId}, 'Credential User', 'credential@example.com', now(), now()),
        (${socialUserId}, 'Social User', 'social@example.com', now(), now())
    `;
          await sql`
      INSERT INTO "account"
        ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at")
      VALUES
        (${credentialAccountId}, ${credentialUserId}, 'credential', ${credentialUserId}, 'hashed', now(), now()),
        (${githubAccountId}, 'github-subject-1', 'github', ${socialUserId}, NULL, now(), now()),
        (${googleAccountId}, 'google-subject-1', 'google', ${socialUserId}, NULL, now(), now())
    `;

        } finally { await sql.end(); }
      },
    });
    cleanups.push(database.cleanup);
    const sql = postgres(database.connectionString, { max: 1 });
    cleanups.push(async () => sql.end());
    expect((await inspectMigrations(database.connectionString)).status).toBe("upToDate");

    const rows = await sql<{ id: string; issuer: string }[]>`
      SELECT "id", "issuer" FROM "account" ORDER BY "id"
    `;
    const issuerById = new Map(rows.map((row) => [row.id, row.issuer]));
    expect(issuerById.get(credentialAccountId)).toBe(CREDENTIAL_ISSUER);
    // A backfill restricted to `provider_id = 'credential'` leaves these NULL,
    // and SET NOT NULL then aborts the upgrade.
    expect(issuerById.get(githubAccountId)).toBe(`${OAUTH_ISSUER_PREFIX}github`);
    expect(issuerById.get(googleAccountId)).toBe(`${OAUTH_ISSUER_PREFIX}google`);

    const [issuerColumn] = await sql<{ is_nullable: string }[]>`
      SELECT "is_nullable" FROM "information_schema"."columns"
      WHERE "table_name" = 'account' AND "column_name" = 'issuer'
    `;
    expect(issuerColumn?.is_nullable).toBe("NO");

    const indexes = await sql<{ indexname: string }[]>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "tablename" = 'account' AND "indexname" = ${UNIQUE_INDEX}
    `;
    expect(indexes).toHaveLength(1);

    // The restored index rejects a second account under the same key.
    await expect(
      sql`
        INSERT INTO "account"
          ("id", "issuer", "account_id", "provider_id", "user_id", "created_at", "updated_at")
        VALUES (${`account-${randomUUID()}`}, ${CREDENTIAL_ISSUER}, ${credentialUserId}, 'credential', ${credentialUserId}, now(), now())
      `,
    ).rejects.toMatchObject({ code: "23505", constraint_name: UNIQUE_INDEX });
  }, 30_000);
});
