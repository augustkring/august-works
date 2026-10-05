import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport(),
  image = process.env.AW_TEST_DATABASE_DUMP_IMAGE;
(support.supported && image ? describe : describe.skip)(
  "V6 real operator database role bootstrap",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      client: ReturnType<typeof postgres>,
      directory: string;
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-roles-");
      client = postgres(database.connectionString, { max: 1 });
      directory = await mkdtemp(join(tmpdir(), "aw-v6-db-roles-"));
      const url = new URL(database.connectionString);
      await writeFile(
        join(directory, "pg.env"),
        `PGHOST=${url.hostname}\nPGPORT=${url.port}\nPGUSER=paperclip\nPGPASSWORD=paperclip\nPGDATABASE=paperclip\nPGSSLMODE=disable\n`,
        { mode: 0o600 },
      );
      await client`create role aw_test_app noinherit`;
      await client`create role aw_test_migrator`;
      await client`create role aw_test_backup`;
      const env = { ...process.env };
      for (const key of [
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
        "DOCKER_TLS",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
      ])
        delete env[key];
      execFileSync(
        "docker",
        [
          "--host=unix:///var/run/docker.sock",
          "run",
          "--rm",
          "--interactive",
          "--network=host",
          "--env-file",
          join(directory, "pg.env"),
          "--entrypoint",
          "psql",
          image!,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "app_role=aw_test_app",
          "-v",
          "migrator_role=aw_test_migrator",
          "-v",
          "backup_role=aw_test_backup",
        ],
        {
          env,
          input: await readFile(
            new URL("../../../deploy/v6/db-roles.sql", import.meta.url),
          ),
          timeout: 120000,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    }, 60000);
    afterAll(async () => {
      await client?.end();
      await database?.cleanup();
      if (directory) await rm(directory, { recursive: true, force: true });
    }, 30000);
    it("gives the application DML, the backup identity reads and the migrator independent schema creation", async () => {
      const { assertApplicationDatabaseRole } = await import(
        "../../../deploy/v6/database-role-policy.mjs"
      );
      await client`set role aw_test_migrator`;
      await client`create schema aw_role_fixture`;
      await client`create table public.aw_role_fixture(id integer primary key,value text)`;
      await client`reset role`;
      await client`set role aw_test_app`;
      await assertApplicationDatabaseRole(client);
      await client`insert into public.aw_role_fixture values(1,'fixture')`;
      await client`update public.aw_role_fixture set value='updated' where id=1`;
      await expect(
        client`create table public.aw_should_be_denied(id integer)`,
      ).rejects.toMatchObject({ code: "42501" });
      await client`reset role`;
      await client`set role aw_test_backup`;
      expect(
        (await client`select value from public.aw_role_fixture`)[0]!.value,
      ).toBe("updated");
      await expect(
        client`delete from public.aw_role_fixture`,
      ).rejects.toMatchObject({ code: "42501" });
      await client`reset role`;
    });
    it("rejects a no-inherit membership that could switch to an elevated role", async () => {
      const { assertApplicationDatabaseRole } = await import(
        "../../../deploy/v6/database-role-policy.mjs"
      );
      await client`create role aw_test_elevated createrole`;
      await client`grant aw_test_elevated to aw_test_app`;
      await client`set role aw_test_app`;
      await expect(assertApplicationDatabaseRole(client)).rejects.toThrow(
        "reachable role",
      );
      await client`reset role`;
    });
  },
);
