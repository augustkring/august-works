import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, assets, companies, contextManifestItems, contextManifests, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issueAttachments, issues, memoryBindings, memoryEvidence, memoryRecords } from "@paperclipai/db";
import type { NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const hash = "a".repeat(64);
describe("Native payload bindings survive child/source mutations without trusting old closures", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("v10-payload-source-mutations-");
    db = createDb(database.connectionString, { maxConnections: 3 }); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function seed() {
    const companyId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Actual payload mutation fixture", issuePrefix: randomUUID() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Actual Context presence", role: "engineer", adapterType: "process" });
    const issue = await db.transaction(async tx => {
      const [row] = await tx.insert(issues).values({ companyId, title: "Actual source Task", description: "Original captured source bytes", payloadSourceProtocolVersion: 1 }).returning();
      const [bound] = await tx.update(issues).set({ payloadSourceSnapshot: await snapshot("issue", "issues", row!.id, tx) }).where(eq(issues.id, row!.id)).returning();
      return bound!;
    });
    return { companyId, agentId, issue: issue! };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  type QueryDb = Pick<ReturnType<typeof createDb>, "execute">;
  async function seal(content: Omit<NativePayloadSourceSnapshot, "digest">, connection: QueryDb = db) {
    const [row] = await connection.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select ${JSON.stringify(content)}::jsonb || jsonb_build_object(
      'digest',encode(sha256(convert_to((${JSON.stringify(content)}::jsonb)::text,'UTF8')),'hex')) as snapshot`);
    return row!.snapshot;
  }
  async function snapshot(kind: "issue" | "memory_record" | "attachment", table: "issues" | "memory_records" | "issue_attachments", id: string, connection: QueryDb = db) {
    const [row] = await connection.execute<{ companyId: string; contentHash: string }>(sql`select r.company_id as "companyId",
      public.aw_native_payload_body_hash(${kind},to_jsonb(r)) as "contentHash" from ${sql.identifier(table)} r where r.id=${id}::uuid`);
    return seal({ version: 1, owner: { kind, companyId: row!.companyId, id, contentHash: row!.contentHash },
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] }, connection);
  }
  // These are deliberately source-free structural DB fixtures. Canonical hashes
  // prove owner/body binding, not actual producer completeness or permission.
  async function memory(s: Seed) {
    const [binding] = await db.insert(memoryBindings).values({ companyId: s.companyId, key: randomUUID(), name: "Actual binding", providerKey: "local" }).returning();
    return db.transaction(async tx => {
      const [record] = await tx.insert(memoryRecords).values({ companyId: s.companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson",
        scopeType: "company", content: "Original Memory body", observedAt: new Date(), createdByActorType: "system", createdByActorId: "binding-fixture", payloadSourceProtocolVersion: 1 }).returning();
      const captured = await snapshot("memory_record", "memory_records", record!.id, tx);
      await tx.update(memoryRecords).set({ payloadSourceSnapshot: captured }).where(eq(memoryRecords.id, record!.id));
      return { record: record!, captured };
    });
  }

  it("invalidates a bound Memory envelope when actual persisted evidence is inserted", async () => {
    const s = await seed(), m = await memory(s);
    const [evidence] = await db.insert(memoryEvidence).values({ companyId: s.companyId, memoryRecordId: m.record.id,
      sourceClass: "task", sourceProvider: "native-binding-fixture", sourceType: "issue", sourceRef: `issue://${s.issue.id}`,
      sourceVersion: s.issue.updatedAt.toISOString(), observedAt: new Date(), excerptHash: hash,
      citationJson: { label: "Newly attached source evidence" }, trustLevel: "low", supportsOrContradicts: "supports" }).returning();
    expect(evidence!.memoryRecordId).toBe(m.record.id);
    const [current] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, m.record.id));
    expect(current!.payloadSourceSnapshot).toBeNull();
  });

  it("rejects a retained-source-array change that leaves a stale bound Memory snapshot", async () => {
    const s = await seed(), m = await memory(s);
    await expect(db.update(memoryRecords).set({ sourceIssueIds: [s.issue.id], updatedAt: new Date() }).where(eq(memoryRecords.id, m.record.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it.each(["size", "hash", "metadata"] as const)("invalidates the referencing attachment after actual asset %s mutation", async mutation => {
    const s = await seed();
    const [asset] = await db.insert(assets).values({ companyId: s.companyId, provider: "local_disk", objectKey: randomUUID(), contentType: "text/plain",
      byteSize: 4, sha256: hash, originalFilename: "original.txt" }).returning();
    const { attachment, captured } = await db.transaction(async tx => {
      const [attachment] = await tx.insert(issueAttachments).values({ companyId: s.companyId, issueId: s.issue.id, assetId: asset!.id,
        payloadSourceProtocolVersion: 1 }).returning();
      const captured = await snapshot("attachment", "issue_attachments", attachment!.id, tx);
      await tx.update(issueAttachments).set({ payloadSourceSnapshot: captured }).where(eq(issueAttachments.id, attachment!.id));
      return { attachment: attachment!, captured };
    });
    const [before] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, attachment!.id));
    expect(before!.payloadSourceSnapshot).toEqual(captured);
    const change = mutation === "size" ? { byteSize: 8 } : mutation === "hash" ? { sha256: "b".repeat(64) }
      : { contentType: "application/json", originalFilename: "different.json" };
    await db.update(assets).set(change).where(eq(assets.id, asset!.id));
    const [current] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, attachment!.id));
    expect(current!.payloadSourceSnapshot).toBeNull();
  });

  async function manifest(s: Seed) {
    const [row] = await db.insert(contextManifests).values({ companyId: s.companyId, agentId: s.agentId, issueId: s.issue.id,
      queryHash: hash, policySnapshotHash: hash }).returning(); return row!;
  }
  async function item(s: Seed, captured: NativePayloadSourceSnapshot | null) {
    const parent = await manifest(s);
    const [row] = await db.insert(contextManifestItems).values({ companyId: s.companyId, manifestId: parent.id,
      sourceClass: "task", sourceProvider: "august_works_tasks", sourceRef: `issue://${s.issue.id}`, sourceVersion: s.issue.updatedAt.toISOString(),
      payloadSourceSnapshot: captured, contentHash: hash, trustLevel: "high", sensitivity: "internal", rank: 0, selectionReason: "preferred_authority" }).returning();
    return row!;
  }
  it("refuses rewriting immutable selected Context source bindings or its frozen snapshot", async () => {
    const s = await seed(), captured = await snapshot("issue", "issues", s.issue.id), otherManifest = await manifest(s);
    const { digest: _digest, ...content } = captured;
    const different = await seal({ ...content, policy: { ...content.policy, issueIds: [s.issue.id] } });
    const [otherSource] = await db.insert(issues).values({ companyId: s.companyId, title: "Another actual Task" }).returning();
    const changes = [ { sourceRef: `issue://${otherSource!.id}` }, { sourceVersion: new Date(s.issue.updatedAt.getTime() + 1000).toISOString() },
      { contentHash: "b".repeat(64) }, { sourceProvider: "external_untrusted" }, { manifestId: otherManifest.id },
      { payloadSourceSnapshot: different } ];
    for (const change of changes) {
      const selected = await item(s, captured);
      expect(selected.payloadSourceSnapshot).toEqual(captured);
      await expect.soft(db.update(contextManifestItems).set(change).where(eq(contextManifestItems.id, selected.id)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });
  it("does not upgrade an unknown historical Context item from today's body", async () => {
    const s = await seed(), selected = await item(s, null);
    expect(selected.payloadSourceSnapshot).toBeNull();
    await expect(db.update(contextManifestItems).set({ payloadSourceSnapshot: await snapshot("issue", "issues", s.issue.id) })
      .where(eq(contextManifestItems.id, selected.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
