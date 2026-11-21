import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { createDb, companies, authUsers, customerFeedback, customerFeedbackImages, customerFeedbackDeletionMarkers,
  feedbackRetentionErasures } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { customerFeedbackRetentionErasureService } from "../services/customer-feedback-retention-erasure.js";
import { createStorageService } from "../storage/service.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";

it("upgrades actual pre-V9-restore erasure receipts and image states into immutable minimal identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aw-feedback-restore-prior-"));
  const companyId = randomUUID(), erasedId = randomUUID(), retainedId = randomUUID(), imageId = randomUUID(), operatorId = randomUUID();
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  try {
    database = await startEmbeddedPostgresTestDatabase("aw-feedback-restore-upgrade-", { beforeMigrations: async connection => {
      const root = new URL("../../../packages/db/src/migrations/", import.meta.url);
      const journal = JSON.parse(await readFile(new URL("meta/_journal.json", root), "utf8"));
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 485);
      const prior = join(directory, "migrations");
      await mkdir(join(prior, "meta"), { recursive: true });
      for (const entry of entries) await copyFile(new URL(`${entry.tag}.sql`, root), join(prior, `${entry.tag}.sql`));
      await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      const legacy = createDb(connection);
      await migrate(legacy, { migrationsFolder: prior });
      expect(await legacy.execute(sql`select to_regclass('public.customer_feedback_deletion_markers') as markers`))
        .toEqual([{ markers: null }]);
      await legacy.insert(companies).values({ id: companyId, name: "Owned prior erasure source", issuePrefix: `P${companyId.slice(0, 6)}` });
      await legacy.insert(authUsers).values({ id: operatorId, name: "Owned migration operator", email: `${operatorId}@example.test`,
        emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
      const original = { companyId, category: "BUG", body: "OWNED-PRE-UPGRADE-PRIVATE-FEEDBACK", omitName: true,
        status: "CLOSED", createdAt: new Date(Date.now() - 150 * 86400000), closedAt: new Date(Date.now() - 100 * 86400000),
        context: { surfaceKey: "home", locale: "en", timezone: "UTC", viewportClass: "wide" } };
      await legacy.insert(customerFeedback).values([{ ...original, id: erasedId }, { ...original, id: retainedId }]);
      const actor = { type: "board" as const, source: "session" as const, userId: operatorId, companyIds: [companyId] };
      const owner = customerFeedbackRetentionErasureService(legacy, createStorageService(createLocalDiskStorageProvider(join(directory, "objects"))),
        { operatorUserIds: [operatorId] });
      const review = await owner.review(actor, companyId, erasedId);
      const command = { requestKey: randomUUID(), confirmErasure: true, expectedReviewHash: review.reviewHash, target: { kind: "case" } };
      expect((await owner.execute(actor, companyId, erasedId, command)).status).toBe("completed");
      expect((await owner.execute(actor, companyId, erasedId, command)).status).toBe("completed");
      // Native prior-schema cancelled scan has no allocated bytes. Its accepted
      // privacy state must survive the upgrade without inventing an object.
      await legacy.insert(customerFeedbackImages).values({ id: imageId, companyId, feedbackId: retainedId, requestKey: randomUUID(),
        requestHash: "a".repeat(64), mediaType: "image/png", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120000) });
      await legacy.update(customerFeedbackImages).set({ status: "deleted", deletedAt: sql`clock_timestamp()` })
        .where(eq(customerFeedbackImages.id, imageId));
    } });
    const db = createDb(database.connectionString);
    const markers = await db.select().from(customerFeedbackDeletionMarkers).where(eq(customerFeedbackDeletionMarkers.companyId, companyId));
    expect(markers.map(row => ({ subject: row.subjectId, kind: row.targetKind })))
      .toEqual(expect.arrayContaining([{ subject: erasedId, kind: "case" }, { subject: imageId, kind: "image" }]));
    expect(markers).toHaveLength(2);
    expect(JSON.stringify(markers)).not.toContain("OWNED-PRE-UPGRADE-PRIVATE-FEEDBACK");
    expect(await db.select().from(feedbackRetentionErasures).where(eq(feedbackRetentionErasures.companyId, companyId))).toHaveLength(1);
    expect((await db.select().from(customerFeedback).where(eq(customerFeedback.companyId, companyId))).map(row => row.id)).toEqual([retainedId]);
    await expect(db.delete(customerFeedbackDeletionMarkers).where(eq(customerFeedbackDeletionMarkers.subjectId, imageId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  } finally {
    await database?.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
