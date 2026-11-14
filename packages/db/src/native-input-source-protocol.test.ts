import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

describe("Native run input source writer protocol is insert-only, not readiness", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof postgres>;
  let folder: string;
  const companyId = randomUUID(), agentId = randomUUID(), historicalId = randomUUID();

  beforeAll(async () => {
    // Install the actual pre-0510 migration chain and seed a real historical
    // run. The canonical helper then applies the current migration normally.
    folder = await mkdtemp(join(tmpdir(), "native-input-protocol-history-"));
    const journal = JSON.parse(await readFile(new URL("./migrations/meta/_journal.json", import.meta.url), "utf8"));
    const target = journal.entries.findIndex((entry: { tag: string }) => entry.tag.startsWith("0510_"));
    expect(target).toBeGreaterThan(0);
    const entries: Array<{ tag: string }> = journal.entries.slice(0, target);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(new URL(`./migrations/${entry.tag}.sql`, import.meta.url), join(folder, `${entry.tag}.sql`));
    database = await startEmbeddedPostgresTestDatabase("native-input-protocol-", {
      beforeMigrations: async connectionString => {
        const historical = postgres(connectionString, { max: 1, onnotice: () => {} });
        try {
          await migrate(drizzle(historical), { migrationsFolder: folder });
          await historical`insert into companies(id,name,issue_prefix) values(${companyId},'Protocol fixture',${randomUUID()})`;
          const identityId = randomUUID();
          await historical`insert into agent_identities(id,name,home_company_id) values(${identityId},'Protocol persona',${companyId})`;
          await historical`insert into agents(id,company_id,agent_identity_id,name) values(${agentId},${companyId},${identityId},'Protocol worker')`;
          await historical`insert into heartbeat_runs(id,company_id,agent_id,status) values(${historicalId},${companyId},${agentId},'succeeded')`;
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

  async function insert(version: number, triggerDetail: string | null = null) {
    const [row] = await db`insert into heartbeat_runs(company_id,agent_id,native_input_source_protocol_version,trigger_detail)
      values(${companyId},${agentId},${version},${triggerDetail}) returning *`;
    return row!;
  }

  it("defaults historical and new unspecified writers to 0 without upgrading either", async () => {
    const [historical] = await db`select * from heartbeat_runs where id=${historicalId}`;
    const [unspecified] = await db`insert into heartbeat_runs(company_id,agent_id) values(${companyId},${agentId}) returning *`;
    for (const row of [historical!, unspecified!]) {
      expect(row.native_input_source_protocol_version).toBe(0);
      await expect(db`update heartbeat_runs set native_input_source_protocol_version=1 where id=${row.id}`).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("accepts explicit 0/1 only at insertion and preserves normal operational updates", async () => {
    for (const version of [0, 1]) {
      const row = await insert(version);
      const [updated] = await db`update heartbeat_runs set status='succeeded',native_input_source_protocol_version=${version}
        where id=${row.id} returning *`;
      expect(updated!.native_input_source_protocol_version).toBe(version);
      await expect(db`update heartbeat_runs set native_input_source_protocol_version=${1-version} where id=${row.id}`).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("rejects unknown and NULL protocol values", async () => {
    for (const version of [-1, 2]) await expect(insert(version)).rejects.toMatchObject({ code: "23514" });
    await expect(db`insert into heartbeat_runs(company_id,agent_id,native_input_source_protocol_version)
      values(${companyId},${agentId},null)`).rejects.toMatchObject({ code: "23502" });
  });

  it("keeps original synthetic provider/draft/authoring probe markers at 0", async () => {
    const probe = await insert(0, "provider_conformance");
    await db`update heartbeat_runs set trigger_detail=null where id=${probe.id}`;
    await expect(db`update heartbeat_runs set native_input_source_protocol_version=1 where id=${probe.id}`).rejects.toMatchObject({ code: "23514" });
    for (const marker of ["provider_conformance", "agent_safe_test"]) {
      // Match this new BEFORE barrier specifically. An unbound protocol0
      // authoring probe also fails its existing deferred production owner;
      // this fixture does not fabricate or bypass that separate admission.
      const rejected = { code: "23514", message: "Synthetic probes cannot claim native input source protocol" };
      await expect(insert(1, marker)).rejects.toMatchObject(rejected);
      const capable = await insert(1);
      await expect(db`update heartbeat_runs set trigger_detail=${marker} where id=${capable.id}`).rejects.toMatchObject(rejected);
    }
  });

  it("does not set source qualification, select native mode or create an input receipt", async () => {
    const row = await insert(1);
    expect(row.source_context_provenance_qualified).toBe(false);
    expect(row.source_context_manifest_ids).toEqual([]);
    expect(row.runtime_mode).toBe("legacy");
    expect(row.runner_profile_json).toBeNull();
  });
});
