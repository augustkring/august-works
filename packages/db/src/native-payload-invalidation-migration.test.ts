import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

describe("Native payload source invalidation preserves unknown history across migration", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof postgres>;
  let folder: string;
  let retainedSnapshot: unknown;
  const companyId = randomUUID();
  const legacy = randomUUID(), initialUnknown = randomUUID(), invalidated = randomUUID(), retained = randomUUID();

  // Structural fixture only: an owner/hash/protocol does not prove source
  // completeness or authorize the retained input. Use the real SQL digest.
  async function bind(client: ReturnType<typeof postgres>, id: string) {
    await client`update issues target set payload_source_snapshot=(
      select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','issue','companyId',target.company_id,'id',target.id,
          'contentHash',public.aw_native_payload_body_hash('issue',to_jsonb(target))),
          'policy',jsonb_build_object('issueIds',jsonb_build_array(${legacy}::uuid),'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
      ) actual_body
    ) where target.company_id=${companyId} and target.id=${id}`;
  }

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "native-payload-invalidation-history-"));
    const journal = JSON.parse(await readFile(new URL("./migrations/meta/_journal.json", import.meta.url), "utf8"));
    const target = journal.entries.findIndex((entry: { tag: string }) => entry.tag.startsWith("0513_"));
    expect(target).toBeGreaterThan(0);
    const entries: Array<{ tag: string }> = journal.entries.slice(0, target);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(new URL(`./migrations/${entry.tag}.sql`, import.meta.url), join(folder, `${entry.tag}.sql`));
    database = await startEmbeddedPostgresTestDatabase("native-payload-invalidation-", {
      beforeMigrations: async connectionString => {
        const historical = postgres(connectionString, { max: 1, onnotice: () => {} });
        try {
          await migrate(drizzle(historical), { migrationsFolder: folder });
          await historical`insert into companies(id,name,issue_prefix) values(${companyId},'Historical payload fixture',${randomUUID()})`;
          for (const [id, protocol] of [[legacy, 0], [initialUnknown, 1], [invalidated, 1], [retained, 1]] as const) {
            await historical`insert into issues(id,company_id,title,payload_source_protocol_version)
              values(${id},${companyId},'Historical actual body',${protocol})`;
          }
          await bind(historical, invalidated);
          await historical`update issues set payload_source_snapshot=null where id=${invalidated}`;
          await bind(historical, retained);
          const [bound] = await historical`select payload_source_snapshot from issues where id=${retained}`;
          retainedSnapshot = bound!.payload_source_snapshot;
        } finally { await historical.end(); }
      },
    });
    db = postgres(database.connectionString, { max: 1, onnotice: () => {} });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await db?.end();
    await database?.cleanup();
    if (folder) await rm(folder, { recursive: true, force: true });
  }, 30000);

  it("withholds both kinds of historical protocol1 NULL rather than inventing their lost history", async () => {
    for (const id of [initialUnknown, invalidated]) {
      const [row] = await db`select * from issues where id=${id}`;
      expect(row!.payload_source_protocol_version).toBe(1);
      expect(row!.payload_source_snapshot).toBeNull();
      expect(row!.payload_source_snapshot_invalidated).toBe(true);
      await expect(bind(db, id)).rejects.toMatchObject({ code: "23514" });
      await expect(db`update issues set payload_source_snapshot_invalidated=false where id=${id}`)
        .rejects.toMatchObject({ code: "23514" });
    }
  });

  it("preserves a known binding byte-for-byte through the upgrade and an operational update", async () => {
    const [before] = await db`select payload_source_snapshot, payload_source_snapshot_invalidated from issues where id=${retained}`;
    expect(before!.payload_source_snapshot).toEqual(retainedSnapshot);
    expect(before!.payload_source_snapshot.policy.issueIds).toEqual([legacy]);
    expect(before!.payload_source_snapshot_invalidated).toBe(false);
    const [after] = await db`update issues set priority='high' where id=${retained} returning payload_source_snapshot`;
    expect(after!.payload_source_snapshot).toEqual(before!.payload_source_snapshot);
  });

  it("keeps legacy protocol0 unknown without promoting it during upgrade", async () => {
    const [row] = await db`select * from issues where id=${legacy}`;
    expect(row!.payload_source_protocol_version).toBe(0);
    expect(row!.payload_source_snapshot).toBeNull();
    expect(row!.payload_source_snapshot_invalidated).toBe(false);
    await expect(db`update issues set payload_source_protocol_version=1 where id=${legacy}`).rejects.toMatchObject({ code: "23514" });
  });

  it("allows a fresh protocol1 structural binding before any invalidation", async () => {
    const id = randomUUID();
    await db`insert into issues(id,company_id,title,payload_source_protocol_version)
      values(${id},${companyId},'Fresh structural binding',1)`;
    await bind(db, id);
    const [row] = await db`select payload_source_snapshot, payload_source_snapshot_invalidated from issues where id=${id}`;
    expect(row!.payload_source_snapshot).not.toBeNull();
    expect(row!.payload_source_snapshot_invalidated).toBe(false);
  });
});
