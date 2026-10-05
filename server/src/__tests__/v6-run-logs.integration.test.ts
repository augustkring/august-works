import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  companies,
  agentIdentities,
  agents,
  heartbeatRuns,
  saasRunLogChunks,
  saasRunLogs,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { saasRunLogStore } from "../services/saas/run-logs.js";
import type { StorageProvider } from "../storage/types.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 stateless encrypted run logs",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      companyId: string,
      agentId: string,
      runId: string;
    const objects = new Map<string, Buffer>();
    let unknownPut = false,
      corruptGet = false;
    const provider: StorageProvider = {
      id: "s3",
      putObject: vi.fn(async (input) => {
        if (!Buffer.isBuffer(input.body)) throw new Error("buffer required");
        objects.set(input.objectKey, Buffer.from(input.body));
        if (unknownPut) throw new Error("acknowledgement lost");
      }),
      async getObject(input) {
        const body = objects.get(input.objectKey);
        if (!body) throw new Error("missing object");
        return {
          stream: Readable.from(corruptGet ? Buffer.from("corrupt") : body),
        };
      },
      async headObject(input) {
        return { exists: objects.has(input.objectKey) };
      },
      async deleteObject(input) {
        objects.delete(input.objectKey);
      },
    };
    const keys = {
      encryptionKey: "ab".repeat(32),
      keyId: "first",
      previousKeys: {},
    };
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-log-");
      db = createDb(database.connectionString);
      const [company] = await db
        .insert(companies)
        .values({ name: "Log fixture", issuePrefix: "LOG" })
        .returning();
      companyId = company!.id;
      const [identity] = await db
        .insert(agentIdentities)
        .values({ name: "Log agent", homeCompanyId: companyId })
        .returning();
      const [agent] = await db
        .insert(agents)
        .values({
          companyId,
          agentIdentityId: identity!.id,
          name: "Log agent",
          adapterType: "openclaw_gateway",
        })
        .returning();
      agentId = agent!.id;
      const [run] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId,
          invocationSource: "on_demand",
          status: "running",
        })
        .returning();
      runId = run!.id;
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("retains acknowledged bytes through restart and S3 lost acknowledgement, detects corruption and permanently erases", async () => {
      const store = saasRunLogStore(db, provider, keys),
        handle = await store.begin({ companyId, agentId, runId });
      const event = {
        stream: "stdout" as const,
        chunk: "private fixture content",
        ts: "2026-10-04T00:00:00Z",
        seq: 1,
      };
      const outcomes = await Promise.all([
        store.append(handle, event),
        store.append(handle, event),
      ]);
      expect(outcomes.filter((v) => v > 0)).toHaveLength(1);
      await expect(
        store.append(handle, { ...event, chunk: "different" }),
      ).rejects.toMatchObject({ status: 409 });
      const [buffer] = await db.select().from(saasRunLogChunks);
      expect(buffer!.ciphertext).not.toContain(event.chunk);
      expect(buffer!.objectKey).not.toContain(event.chunk);
      const restarted = saasRunLogStore(db, provider, keys);
      expect((await restarted.read(handle)).content).toContain(event.chunk);
      unknownPut = true;
      await expect(restarted.flushOne()).rejects.toThrow(
        "acknowledgement lost",
      );
      expect(
        (await db.select().from(saasRunLogChunks))[0]!.ciphertext,
      ).toBeTruthy();
      expect((await restarted.read(handle)).content).toContain(event.chunk);
      unknownPut = false;
      await restarted.flushOne();
      expect(objects.size).toBe(1);
      expect(
        (await db.select().from(saasRunLogChunks))[0]!.ciphertext,
      ).toBeNull();
      expect((await db.select().from(saasRunLogs))[0]!.pendingBytes).toBe(0);
      expect(
        (await saasRunLogStore(db, provider, keys).read(handle)).content,
      ).toContain(event.chunk);
      expect([...objects.values()][0]!.toString()).not.toContain(event.chunk);
      corruptGet = true;
      await expect(restarted.read(handle)).rejects.toMatchObject({
        status: 409,
      });
      corruptGet = false;
      const summary = await restarted.finalize(handle);
      expect(summary.sha256).toMatch(/^[a-f0-9]{64}$/);
      await expect(
        restarted.append(handle, { ...event, seq: 2 }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await restarted.read(handle, { offset: summary.bytes }),
      ).toMatchObject({ content: "" });
      await restarted.erase!(handle);
      expect(objects.size).toBe(0);
      await expect(
        store.append(handle, { ...event, seq: 2 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        restarted.begin({ companyId, agentId, runId }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(restarted.read(handle)).rejects.toMatchObject({
        status: 404,
      });
    });
    it("checks real run ownership before constructing an archive reference", async () => {
      await expect(
        saasRunLogStore(db, provider, keys).begin({
          companyId: crypto.randomUUID(),
          agentId,
          runId,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
  },
);
