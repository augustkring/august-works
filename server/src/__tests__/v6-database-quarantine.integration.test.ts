import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentIdentities,
  agentApiKeys,
  agents,
  authSessions,
  authUsers,
  companies,
  createDb,
  inspectMigrations,
  closeRegisteredClients,
  instanceSettings,
  memoryBindings,
  memoryRecords,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasOnboardingService } from "../services/saas/onboarding.js";
import {
  assertDatabaseRestoreAdmission,
  prepareRestoredQuarantine,
} from "../services/saas/quarantine.js";
import { memoryDeletionKey } from "../services/memory/memory-privacy.js";

const support = await getEmbeddedPostgresTestSupport();
const image = process.env.AW_TEST_DATABASE_DUMP_IMAGE;
(support.supported && image ? describe : describe.skip)(
  "V6 real PostgreSQL dump and quarantine restore",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      directory: string,
      target: string;
    const now = new Date(),
      key = "a".repeat(64),
      ledgerKey = "b".repeat(64);
    beforeAll(async () => {
      if (!/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image!))
        throw Error("Pinned PostgreSQL test client image required");
      database = await startEmbeddedPostgresTestDatabase("aw-v6-dump-");
      db = createDb(database.connectionString);
      directory = await mkdtemp(join(tmpdir(), "aw-v6-quarantine-"));
    }, 60000);
    afterAll(async () => {
      if (target) await closeRegisteredClients(target);
      await database?.cleanup();
      if (directory) await rm(directory, { recursive: true, force: true });
    }, 30000);
    function pgTool(command: string, args: string[], input?: Buffer) {
      const env = { ...process.env };
      for (const name of [
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
        "DOCKER_TLS",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
      ])
        delete env[name];
      return execFileSync(
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
          command,
          image!,
          ...args,
        ],
        {
          env,
          input,
          maxBuffer: 64 * 1024 ** 2,
          timeout: 120000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    }
    it("restores actual dumped tables, revokes credentials, preserves budget pauses and replays post-backup erasure and explicit identity rehomes", async () => {
      const { encryptDatabaseArchive, authenticateDatabaseArchive } =
        await import("../../../deploy/v6/database-archive.mjs");
      const { authenticateDeletionLedger } = await import(
        "../../../deploy/v6/deletion-ledger.mjs"
      );
      await db.insert(authUsers).values({
        id: "restore-owner",
        name: "Owner",
        email: "restore@example.test",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      const service = saasOnboardingService(db),
        erased = await service.create("restore-owner", {
          name: "Erase after backup",
          idempotencyKey: "restore-erased-company-001",
        }),
        retained = await service.create("restore-owner", {
          name: "Retained organization",
          idempotencyKey: "restore-retained-company-001",
        });
      const [identity] = await db
        .insert(agentIdentities)
        .values({ name: "Shared persona", homeCompanyId: erased.companyId })
        .returning();
      const [agent] = await db
        .insert(agents)
        .values([
          {
            name: "Erased presence",
            companyId: erased.companyId,
            agentIdentityId: identity!.id,
            adapterType: "openclaw_gateway",
          },
          {
            name: "Retained presence",
            companyId: retained.companyId,
            agentIdentityId: identity!.id,
            adapterType: "openclaw_gateway",
            status: "paused",
            pauseReason: "budget",
          },
        ])
        .returning();
      await db.insert(agentApiKeys).values({
        companyId: erased.companyId,
        agentId: agent!.id,
        name: "Must revoke",
        keyHash: "fixture-key",
      });
      await db.insert(authSessions).values({
        id: "restore-session",
        userId: "restore-owner",
        token: "fixture-session-token",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      });
      await db.update(instanceSettings).set({
        experimental: {
          saas_deployment_profile_v6: true,
          transactional_email_v6: true,
        },
      });
      const [binding] = await db
        .insert(memoryBindings)
        .values({
          companyId: retained.companyId,
          key: "restore",
          name: "Restore fixture",
          providerKey: "august_works_memory",
        })
        .returning();
      const [record] = await db
        .insert(memoryRecords)
        .values({
          companyId: retained.companyId,
          bindingId: binding!.id,
          providerKey: "august_works_memory",
          memoryType: "lesson",
          scopeType: "company",
          scopeId: null,
          content: "This was forgotten after the backup",
          createdByActorType: "user",
          createdByActorId: "restore-owner",
          observedAt: now,
        })
        .returning();
      const source = new URL(database.connectionString);
      await writeFile(
        join(directory, "pg.env"),
        `PGHOST=${source.hostname}\nPGPORT=${source.port}\nPGUSER=paperclip\nPGPASSWORD=paperclip\nPGDATABASE=paperclip\nPGSSLMODE=disable\n`,
        { mode: 0o600 },
      );
      const dump = pgTool("pg_dump", [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
      ]);
      const archive = join(directory, "database.awd6"),
        plaintext = join(directory, "quarantine.dump");
      await encryptDatabaseArchive(
        Readable.from(dump),
        archive,
        {
          format: "aw-database-archive-v1",
          id: randomUUID(),
          environment: "staging",
          sourceSha: "c".repeat(40),
          schemaVersion: (
            await inspectMigrations(database.connectionString)
          ).appliedMigrations.at(-1)!,
          keyId: "fixture",
          createdAt: now.toISOString(),
        },
        key,
      );
      const payload = JSON.stringify({
        environment: "staging",
        exportedAt: new Date().toISOString(),
        companies: [{ company_id: erased.companyId }],
        identityHomes: [
          { id: identity!.id, home_company_id: retained.companyId },
        ],
        memory: [
          {
            company_id: retained.companyId,
            key: memoryDeletionKey(retained.companyId, "record", record!.id),
            kind: "record",
            record_id: record!.id,
            deleted_at: now.toISOString(),
          },
        ],
      });
      const ledger = authenticateDeletionLedger(
        {
          payload,
          signature: createHmac("sha256", Buffer.from(ledgerKey, "hex"))
            .update(payload)
            .digest("hex"),
        },
        ledgerKey,
        "staging",
      );
      await authenticateDatabaseArchive(
        archive,
        plaintext,
        { fixture: key },
        { environment: "staging" },
      );
      await db.execute(sql`create database aw_restore_fixture`);
      source.pathname = "/aw_restore_fixture";
      target = source.toString();
      pgTool(
        "pg_restore",
        [
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          "--dbname=aw_restore_fixture",
        ],
        await readFile(plaintext),
      );
      const restored = createDb(target);
      await prepareRestoredQuarantine(restored, target, ledger);
      await expect(assertDatabaseRestoreAdmission(restored)).rejects.toThrow(
        "remains quarantined",
      );
      expect(await restored.select().from(authSessions)).toHaveLength(0);
      expect(
        await restored
          .select()
          .from(agents)
          .where(eq(agents.companyId, erased.companyId)),
      ).toHaveLength(0);
      const [tombstone] = await restored
        .select()
        .from(companies)
        .where(eq(companies.id, erased.companyId));
      expect(tombstone!.name).toBe("Deleted company");
      const [retainedAgent] = await restored
        .select()
        .from(agents)
        .where(eq(agents.companyId, retained.companyId));
      expect(retainedAgent).toMatchObject({
        name: "Retained presence",
        status: "paused",
        pauseReason: "budget",
      });
      const [shared] = await restored
        .select()
        .from(agentIdentities)
        .where(eq(agentIdentities.id, identity!.id));
      expect(shared!.homeCompanyId).toBe(retained.companyId);
      const [forgotten] = await restored
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, retained.companyId),
            eq(memoryRecords.id, record!.id),
          ),
        );
      expect(forgotten!.content).toBe("");
      expect(forgotten!.deletedAt).not.toBeNull();
      expect(
        (await restored.select().from(instanceSettings))[0]!.experimental,
      ).toEqual({});
    }, 180000);
  },
);
