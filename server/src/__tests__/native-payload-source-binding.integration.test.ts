import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets, companies, createDb, documentRevisions, documents, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issueAttachments, issueComments, issues, memoryBindings, memoryEvidence, memoryRecords, projects } from "@paperclipai/db";
import type { NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";

describe("Native payload source snapshot binds its original payload owner", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>, companyId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-payload-source-binding-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Native payload owner", issuePrefix: randomUUID() });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  async function insert(protocol = 1) {
    const [row] = await db.insert(issues).values({ companyId, title: "Original captured body", description: "Actual content", payloadSourceProtocolVersion: protocol }).returning();
    return row!;
  }
  async function snapshot(row: typeof issues.$inferSelect, owner: Record<string, unknown> = {},
    retained: Partial<Pick<NativePayloadSourceSnapshot, "policy" | "inputs">> = {}) {
    // PostgreSQL canonical JSON is also the persistence contract. This fixture
    // constructs a source-free structural snapshot; it proves no permissions.
    const [hash] = await db.execute<{ hash: string }>(sql`select public.aw_native_payload_body_hash('issue',to_jsonb(i)) as hash
      from issues i where i.company_id=${companyId}::uuid and i.id=${row.id}::uuid`);
    const content = { version: 1, owner: { kind: "issue", companyId, id: row.id, contentHash: hash!.hash, ...owner },
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [], ...retained };
    const [result] = await db.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select ${JSON.stringify(content)}::jsonb || jsonb_build_object(
      'digest',encode(sha256(convert_to((${JSON.stringify(content)}::jsonb)::text,'UTF8')),'hex')) as snapshot`);
    return result!.snapshot;
  }

  async function bindOwner(table: string, kind: string, id: string) {
    await db.execute(sql`update ${sql.identifier(table)} target set payload_source_snapshot=(
      select content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind',${kind}::text,'companyId',target.company_id,'id',target.id,
          'contentHash',public.aw_native_payload_body_hash(${kind},to_jsonb(target))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as content
      ) actual_body
    ) where target.id=${id}::uuid`);
  }

  it("keeps pre-protocol payloads unknown and refuses an in-place upgrade", async () => {
    const row = await insert(0);
    expect(row.payloadSourceSnapshot).toBeNull();
    await expect(db.update(issues).set({ payloadSourceProtocolVersion: 1 }).where(eq(issues.id, row.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("rejects a validly hashed snapshot copied across owners, companies or body bytes", async () => {
    const row = await insert();
    for (const owner of [{ id: randomUUID() }, { companyId: randomUUID() }, { kind: "project" }, { contentHash: "a".repeat(64) }]) {
      await expect(db.update(issues).set({ payloadSourceSnapshot: await snapshot(row, owner) }).where(eq(issues.id, row.id)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
    }
    const valid = await snapshot(row);
    await expect(db.update(issues).set({ payloadSourceSnapshot: { ...valid, digest: "b".repeat(64) } }).where(eq(issues.id, row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("retains a bound snapshot across operational updates but rejects silently replacing its body", async () => {
    const row = await insert();
    const captured = await snapshot(row);
    await db.update(issues).set({ payloadSourceSnapshot: captured }).where(eq(issues.id, row.id));
    const [operational] = await db.update(issues).set({ priority: "high" }).where(eq(issues.id, row.id)).returning();
    expect(operational!.payloadSourceSnapshot).toEqual(captured);
    for (const edit of [{ description: "Later unrelated private body" }, { monitorNotes: "Later private monitoring notes" },
      { forecastReason: "Later private planning explanation" }, { billingCode: "Private copied billing code" },
      { executionPolicy: { copied: "private policy content" } }]) {
      await expect(db.update(issues).set(edit).where(eq(issues.id, row.id)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
    }
    const [invalidated] = await db.update(issues).set({ description: "Explicitly unknown new body", payloadSourceSnapshot: null,
      payloadSourceSnapshotInvalidated: false }).where(eq(issues.id, row.id)).returning();
    expect(invalidated!.payloadSourceSnapshot).toBeNull();
  });
  it("rejects dropping previously retained policy roots or captured inputs", async () => {
    const row = await insert(), source = await insert(0);
    const sourceBody = await snapshot(source);
    const policy = { issueIds: [source.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
    const inputs: NativePayloadSourceSnapshot["inputs"] = [{ kind: "task", issueId: source.id,
      sourceVersion: source.updatedAt.toISOString(), contentHash: sourceBody.owner.contentHash }];
    const captured = await snapshot(row, {}, { policy, inputs });
    await db.update(issues).set({ payloadSourceSnapshot: captured }).where(eq(issues.id, row.id));
    for (const retained of [{ inputs }, { policy }]) {
      await expect(db.update(issues).set({ payloadSourceSnapshot: await snapshot(row, {}, retained) }).where(eq(issues.id, row.id)))
        .rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });

  it("invalidates a captured body through the native Task updater while preserving unchanged bodies", async () => {
    const row = await insert();
    const captured = await snapshot(row);
    await db.update(issues).set({ payloadSourceSnapshot: captured }).where(eq(issues.id, row.id));
    const service = issueService(db);
    const operational = await service.update(row.id, { priority: "high", description: row.description,
      statusVersion: sql`${issues.statusVersion} + 1` as unknown as number });
    expect(operational!.payloadSourceSnapshot).toEqual(captured);
    expect(operational!.payloadSourceSnapshotInvalidated).toBe(false);
    expect(operational!.statusVersion).toBe(row.statusVersion + 1);
    const changed = await service.update(row.id, { description: "New body without a captured input closure" });
    expect(changed!.description).toBe("New body without a captured input closure");
    expect(changed!.payloadSourceSnapshot).toBeNull();
    expect(changed!.payloadSourceSnapshotInvalidated).toBe(true);
    await expect(db.update(issues).set({ payloadSourceSnapshot: await snapshot(changed!) }).where(eq(issues.id, row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("compares native JSON payloads by PostgreSQL content rather than object key order", async () => {
    const row = await insert();
    await db.update(issues).set({ assigneeAdapterOverrides: { model: "original", config: { a: 1, b: 2 } } })
      .where(eq(issues.id, row.id));
    const captured = await snapshot(row);
    await db.update(issues).set({ payloadSourceSnapshot: captured }).where(eq(issues.id, row.id));
    const service = issueService(db);
    const unchanged = await service.update(row.id, { assigneeAdapterOverrides: { config: { b: 2, a: 1 }, model: "original" } });
    expect(unchanged!.payloadSourceSnapshot).toEqual(captured);
    const changed = await service.update(row.id, { assigneeAdapterOverrides: { model: "replacement", config: { a: 1, b: 2 } } });
    expect(changed!.assigneeAdapterOverrides).toEqual({ model: "replacement", config: { a: 1, b: 2 } });
    expect(changed!.payloadSourceSnapshot).toBeNull();
    expect(changed!.payloadSourceSnapshotInvalidated).toBe(true);
  });

  it("invalidates only the selected company's captured workspace settings when an environment is removed", async () => {
    const environmentId = randomUUID(), otherCompanyId = randomUUID();
    await db.insert(companies).values({ id: otherCompanyId, name: "Other environment owner", issuePrefix: randomUUID() });
    const rows = await db.insert(issues).values([
      { companyId, title: "Selected environment", executionWorkspaceSettings: { mode: "shared_workspace", environmentId } },
      { companyId, title: "Different environment", executionWorkspaceSettings: { mode: "shared_workspace", environmentId: randomUUID() } },
      { companyId: otherCompanyId, title: "Other company's environment", executionWorkspaceSettings: { mode: "shared_workspace", environmentId } },
    ].map(row => ({ ...row, payloadSourceProtocolVersion: 1 }))).returning();
    for (const row of rows) await bindOwner("issues", "issue", row.id);
    expect(await issueService(db).clearExecutionWorkspaceEnvironmentSelection(companyId, environmentId)).toBe(1);
    const [cleared] = await db.select().from(issues).where(eq(issues.id, rows[0]!.id));
    expect(cleared!.executionWorkspaceSettings).toEqual({ mode: "shared_workspace", environmentId: null });
    expect(cleared!.payloadSourceSnapshot).toBeNull();
    expect(cleared!.payloadSourceSnapshotInvalidated).toBe(true);
    for (const original of rows.slice(1)) {
      const [untouched] = await db.select().from(issues).where(eq(issues.id, original.id));
      expect(untouched!.executionWorkspaceSettings).toEqual(original.executionWorkspaceSettings);
      expect(untouched!.payloadSourceSnapshot).not.toBeNull();
      expect(untouched!.payloadSourceSnapshotInvalidated).toBe(false);
    }
  });

  it("rejects rebinding after an existing snapshot was explicitly invalidated to unknown", async () => {
    const row = await insert(), source = await insert(0);
    const sourceBody = await snapshot(source);
    const policy = { issueIds: [source.id], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] };
    const inputs: NativePayloadSourceSnapshot["inputs"] = [{ kind: "task", issueId: source.id,
      sourceVersion: source.updatedAt.toISOString(), contentHash: sourceBody.owner.contentHash }];
    const retained = await snapshot(row, {}, { policy, inputs });
    await db.update(issues).set({ payloadSourceSnapshot: retained }).where(eq(issues.id, row.id));
    const [unknown] = await db.update(issues).set({ payloadSourceSnapshot: null }).where(eq(issues.id, row.id)).returning();
    expect(unknown!.payloadSourceSnapshot).toBeNull();
    const rebound = await snapshot(row);
    await expect(db.update(issues).set({ payloadSourceSnapshot: rebound }).where(eq(issues.id, row.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("latches invalidation and rejects marker edits and rebinding for every payload owner", async () => {
    const issue = await insert();
    const [project] = await db.insert(projects).values({ companyId, name: "Marker project", payloadSourceProtocolVersion: 1 }).returning();
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Marker binding", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson",
      scopeType: "company", content: "Marker memory", observedAt: new Date(), createdByActorType: "system", createdByActorId: "test",
      payloadSourceProtocolVersion: 1 }).returning();
    const [comment] = await db.insert(issueComments).values({ companyId, issueId: issue.id, authorType: "user", body: "Marker comment",
      payloadSourceProtocolVersion: 1 }).returning();
    const [document] = await db.insert(documents).values({ companyId, latestBody: "Marker document" }).returning();
    const [revision] = await db.insert(documentRevisions).values({ companyId, documentId: document!.id, revisionNumber: 1, body: "Marker revision",
      payloadSourceProtocolVersion: 1 }).returning();
    const [asset] = await db.insert(assets).values({ companyId, provider: "local", objectKey: randomUUID(), contentType: "text/plain", byteSize: 1,
      sha256: "a".repeat(64) }).returning();
    const [attachment] = await db.insert(issueAttachments).values({ companyId, issueId: issue.id, assetId: asset!.id,
      payloadSourceProtocolVersion: 1 }).returning();
    const owners = [
      { table: "issues", kind: "issue", id: issue.id }, { table: "projects", kind: "project", id: project!.id },
      { table: "memory_records", kind: "memory_record", id: memory!.id }, { table: "issue_comments", kind: "comment", id: comment!.id },
      { table: "document_revisions", kind: "document_revision", id: revision!.id }, { table: "issue_attachments", kind: "attachment", id: attachment!.id },
    ];
    for (const owner of owners) {
      await bindOwner(owner.table, owner.kind, owner.id);
      await expect(db.execute(sql`update ${sql.identifier(owner.table)} set payload_source_snapshot_invalidated=true where id=${owner.id}::uuid`))
        .rejects.toMatchObject({ cause: { code: "23514" } });
      if (owner.table === "memory_records") {
        await db.insert(memoryEvidence).values({ companyId, memoryRecordId: owner.id, sourceClass: "task", sourceProvider: "test",
          sourceType: "issue", sourceRef: issue.id, observedAt: new Date(), excerptHash: "a".repeat(64), citationJson: {},
          trustLevel: "medium", supportsOrContradicts: "context" });
      } else if (owner.table === "issue_attachments") {
        await db.update(assets).set({ sha256: "b".repeat(64) }).where(eq(assets.id, asset!.id));
      } else {
        await db.execute(sql`update ${sql.identifier(owner.table)} set payload_source_snapshot=null where id=${owner.id}::uuid`);
      }
      const [state] = await db.execute<{ payload_source_snapshot: unknown; payload_source_snapshot_invalidated: boolean }>(
        sql`select payload_source_snapshot, payload_source_snapshot_invalidated from ${sql.identifier(owner.table)} where id=${owner.id}::uuid`);
      expect(state!.payload_source_snapshot_invalidated).toBe(true);
      expect(state!.payload_source_snapshot).toBeNull();
      const forgedId = randomUUID();
      await expect(db.execute(sql`insert into public.${sql.identifier(owner.table)}
        select (jsonb_populate_record(null::public.${sql.identifier(owner.table)},
          to_jsonb(source) || jsonb_build_object('id',${forgedId}::uuid,'payload_source_snapshot_invalidated',true))).*
        from public.${sql.identifier(owner.table)} source where source.id=${owner.id}::uuid`))
        .rejects.toMatchObject({ cause: { code: "23514", message: expect.stringContaining("server-owned") } });
      await expect(db.execute(sql`update ${sql.identifier(owner.table)} set payload_source_snapshot_invalidated=false where id=${owner.id}::uuid`))
        .rejects.toMatchObject({ cause: { code: "23514" } });
      await expect(bindOwner(owner.table, owner.kind, owner.id)).rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });

});
