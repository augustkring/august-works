import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, assets, companies, createDb, documentRevisions, documents, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issueDocuments, memoryDeletionMarkers,
  issueAttachments, issueComments, issues, memoryBindings, memoryEvidence, memoryRecords, pluginManagedResources, plugins, projects } from "@paperclipai/db";
import { roadmapPolicySchema, type NativePayloadSourceSnapshot } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { projectService } from "../services/projects.js";
import { projectControlService } from "../services/project-control.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory, purgeMemoryRecords } from "../services/memory/memory-privacy.js";

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

  async function memorySnapshotWithoutIssueSources(id: string, dbOrTx = db) {
    const [forged] = await dbOrTx.execute<{ snapshot: NativePayloadSourceSnapshot }>(sql`select
      content || jsonb_build_object('digest',encode(sha256(convert_to(content::text,'UTF8')),'hex')) as snapshot
      from (select (m.payload_source_snapshot - 'digest') || jsonb_build_object('owner',
        (m.payload_source_snapshot->'owner') || jsonb_build_object('contentHash',
          public.aw_native_payload_body_hash('memory_record',to_jsonb(m) || '{"source_issue_ids":[]}'::jsonb))) as content
        from memory_records m where m.company_id=${companyId}::uuid and m.id=${id}::uuid) candidate`);
    return forged!.snapshot;
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

  it("erases a captured Memory without depending on an evidence-row invalidation", async () => {
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Erasure binding", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson",
      scopeType: "company", title: "Captured private title", content: "Captured private memory", metadata: { private: "content" },
      observedAt: new Date(), createdByActorType: "system", createdByActorId: "test", payloadSourceProtocolVersion: 1 }).returning();
    await bindOwner("memory_records", "memory_record", memory!.id);
    await db.transaction(async tx => {
      await purgeMemoryRecords(tx as unknown as typeof db, companyId, [memory!.id]);
    });
    const [erased] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, memory!.id));
    expect(erased).toMatchObject({ content: "", title: null, summary: null, metadata: {}, retentionState: "expired",
      payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
    expect(erased!.deletedAt).toBeInstanceOf(Date);
    await expect(bindOwner("memory_records", "memory_record", memory!.id)).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("validates Memory captures after its retained source arrays have been restored", async () => {
    const source = await insert(0);
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Retained source binding", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson",
      scopeType: "company", content: "Retained source content", sourceIssueIds: [source.id], observedAt: new Date(),
      createdByActorType: "system", createdByActorId: "test", payloadSourceProtocolVersion: 1 }).returning();
    await bindOwner("memory_records", "memory_record", memory!.id);
    // This digest binds the attempted removal, before the retention trigger
    // restores the old source. It must never bind the final stored row.
    const forged = await memorySnapshotWithoutIssueSources(memory!.id);
    await expect(db.update(memoryRecords).set({ sourceIssueIds: [], payloadSourceSnapshot: forged })
      .where(eq(memoryRecords.id, memory!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const [retained] = await db.select().from(memoryRecords).where(eq(memoryRecords.id, memory!.id));
    expect(retained!.sourceIssueIds).toEqual([source.id]);
    expect(retained!.payloadSourceSnapshot!.owner.contentHash).not.toBe(forged.owner.contentHash);
  });

  it("invalidates an inconsistent Memory capture left by the old trigger order during migration", async () => {
    const source = await insert(0);
    const [binding] = await db.insert(memoryBindings).values({ companyId, key: randomUUID(), name: "Upgrade source binding", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId, bindingId: binding!.id, providerKey: "local", memoryType: "lesson",
      scopeType: "company", content: "Original retained content", sourceIssueIds: [source.id], observedAt: new Date(),
      createdByActorType: "system", createdByActorId: "test", payloadSourceProtocolVersion: 1 }).returning();
    await bindOwner("memory_records", "memory_record", memory!.id);
    const migration = await readFile(new URL("../../../packages/db/src/migrations/0516_memory_payload_binding_order.sql", import.meta.url), "utf8");
    // Reproduce the old write ordering and run the actual upgrade in one
    // transaction, so failure cannot leave the test database's triggers moved.
    await db.transaction(async tx => {
      await tx.execute(sql`alter trigger zz_memory_records_payload_source_binding on memory_records rename to memory_records_payload_source_binding`);
      const forged = await memorySnapshotWithoutIssueSources(memory!.id, tx as unknown as typeof db);
      await tx.update(memoryRecords).set({ sourceIssueIds: [], payloadSourceSnapshot: forged }).where(eq(memoryRecords.id, memory!.id));
      const [inconsistent] = await tx.execute<{ invalid: boolean }>(sql`select
        (m.payload_source_snapshot #>> '{owner,contentHash}') is distinct from
        public.aw_native_payload_body_hash('memory_record',to_jsonb(m)) as invalid
        from memory_records m where m.id=${memory!.id}::uuid`);
      expect(inconsistent!.invalid).toBe(true);
      for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
      const [repaired] = await tx.select().from(memoryRecords).where(eq(memoryRecords.id, memory!.id));
      expect(repaired).toMatchObject({ content: "Original retained content", sourceIssueIds: [source.id],
        payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
    });
    await expect(bindOwner("memory_records", "memory_record", memory!.id)).rejects.toMatchObject({ cause: { code: "23514" } });
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

  it.each(["issue", "comment", "document_revision"] as const)("erases a captured derived %s through the original transactional purge", async kind => {
    const [agent] = await db.insert(agents).values({ companyId, name: "Erasure fixture", role: "engineer", adapterType: "process" }).returning();
    const source = await insert(0);
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent!.id, runtimeMode: "native", nativeIssueId: source.id }).returning();
    // New structural fixtures, never an in-place protocol or source-proof upgrade.
    const [task] = await db.insert(issues).values({ companyId, title: "PRIVATE saved task", description: "PRIVATE saved body",
      createdByAgentId: agent!.id, originKind: "manual", originRunId: run!.id, originId: `paperclip-runner:create-task:${source.id}:erasure-fixture`,
      payloadSourceProtocolVersion: kind === "issue" ? 1 : 0 }).returning();
    const [comment] = await db.insert(issueComments).values({ companyId, issueId: task!.id, body: "PRIVATE comment",
      payloadSourceProtocolVersion: kind === "comment" ? 1 : 0 }).returning();
    const [document] = await db.insert(documents).values({ companyId, title: "PRIVATE document", latestBody: "PRIVATE document body" }).returning();
    const [revision] = await db.insert(documentRevisions).values({ companyId, documentId: document!.id, revisionNumber: 1,
      title: "PRIVATE revision", body: "PRIVATE revision body", changeSummary: "PRIVATE revision summary",
      payloadSourceProtocolVersion: kind === "document_revision" ? 1 : 0 }).returning();
    await db.insert(issueDocuments).values({ companyId, issueId: task!.id, documentId: document!.id, key: "plan" });
    await db.update(documents).set({ latestRevisionId: revision!.id }).where(eq(documents.id, document!.id));
    const table = kind === "issue" ? "issues" : kind === "comment" ? "issue_comments" : "document_revisions";
    const id = kind === "issue" ? task!.id : kind === "comment" ? comment!.id : revision!.id;
    const [original] = await db.execute<{ body: string }>(sql`select
      case when ${kind}='issue' then to_jsonb(r)->>'title' else to_jsonb(r)->>'body' end as body
      from ${sql.identifier(table)} r where r.company_id=${companyId}::uuid and r.id=${id}::uuid`);
    expect(original!.body).toContain("PRIVATE");
    await bindOwner(table, kind, id);
    const unrelated = await insert();
    const unrelatedSnapshot = await snapshot(unrelated);
    await db.update(issues).set({ payloadSourceSnapshot: unrelatedSnapshot }).where(eq(issues.id, unrelated.id));
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await lockMemoryPrivacy(tx, companyId);
      await tx.insert(memoryDeletionMarkers).values({ companyId, kind: "source", key: `memory-run-source-erasure:v1:${run!.id}` });
      await purgeDerivedWorkflowMemory(tx, companyId, [], new Date(), { workflowRevisionIds: [], artifactVersionIds: [], runIds: [run!.id] });
    });
    const [erased] = await db.execute<{ body: string; captured: unknown; invalidated: boolean }>(sql`select
      case when ${kind}='issue' then to_jsonb(r)->>'title' else to_jsonb(r)->>'body' end as body,
      payload_source_snapshot as captured,payload_source_snapshot_invalidated as invalidated
      from ${sql.identifier(table)} r where r.company_id=${companyId}::uuid and r.id=${id}::uuid`);
    expect(erased!.body).not.toContain("PRIVATE");
    expect(erased!.captured).toBeNull(); expect(erased!.invalidated).toBe(true);
    expect((await db.select().from(issues).where(eq(issues.id, unrelated.id)))[0]!.payloadSourceSnapshot).toEqual(unrelatedSnapshot);
    await expect(bindOwner(table, kind, id)).rejects.toMatchObject({ cause: { code: "23514" } });
  });


  it.each(["text", "json"] as const)("invalidates a changed Project %s body through the native updater and preserves unchanged bodies", async kind => {
    const [project] = await db.insert(projects).values({ companyId, name: "Captured project", description: "Original description",
      env: { FIRST: "one", SECOND: "two" }, payloadSourceProtocolVersion: 1 }).returning();
    await bindOwner("projects", "project", project!.id);
    const [captured] = await db.select().from(projects).where(eq(projects.id, project!.id));
    const service = projectService(db);
    await service.update(project!.id, { targetDate: "2026-11-01", description: "Original description", env: { SECOND: "two", FIRST: "one" } });
    const [unchanged] = await db.select().from(projects).where(eq(projects.id, project!.id));
    expect(unchanged!.targetDate).toBe("2026-11-01");
    expect(unchanged!.payloadSourceSnapshot).toEqual(captured!.payloadSourceSnapshot);
    expect(unchanged!.payloadSourceSnapshotInvalidated).toBe(false);
    const changed = kind === "text" ? { description: "Changed project body" } : { env: { FIRST: "changed", SECOND: "two" } };
    await service.update(project!.id, changed);
    const [stored] = await db.select().from(projects).where(eq(projects.id, project!.id));
    expect(kind === "text" ? stored!.description : stored!.env).toEqual(kind === "text" ? changed.description : changed.env);
    expect(stored!.payloadSourceSnapshot).toBeNull(); expect(stored!.payloadSourceSnapshotInvalidated).toBe(true);
    await expect(bindOwner("projects", "project", project!.id)).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("invalidates a Project capture when its selected environment is removed", async () => {
    const environmentId = randomUUID(), otherEnvironmentId = randomUUID();
    const rows = await db.insert(projects).values([environmentId, otherEnvironmentId].map((id, index) => ({ companyId,
      name: `Project environment ${index}`, executionWorkspacePolicy: { enabled: false, environmentId: id }, payloadSourceProtocolVersion: 1 }))).returning();
    for (const row of rows) await bindOwner("projects", "project", row.id);
    const [other] = await db.select().from(projects).where(eq(projects.id, rows[1]!.id));
    expect(await projectService(db).clearExecutionWorkspaceEnvironmentSelection(companyId, environmentId)).toBe(1);
    const [cleared] = await db.select().from(projects).where(eq(projects.id, rows[0]!.id));
    expect(cleared!.executionWorkspacePolicy).toMatchObject({ environmentId: null });
    expect(cleared!.payloadSourceSnapshot).toBeNull(); expect(cleared!.payloadSourceSnapshotInvalidated).toBe(true);
    expect((await db.select().from(projects).where(eq(projects.id, rows[1]!.id)))[0]).toEqual(other);
  });

  it("invalidates a captured Comment through the native tombstone owner", async () => {
    const task = await insert(0);
    const rows = await db.insert(issueComments).values(["PRIVATE deleted comment", "Retained comment", ""].map(body => ({ companyId,
      issueId: task.id, authorType: "user" as const, body, payloadSourceProtocolVersion: 1 }))).returning();
    for (const row of rows) await bindOwner("issue_comments", "comment", row.id);
    const [other] = await db.select().from(issueComments).where(eq(issueComments.id, rows[1]!.id));
    const [sameBody] = await db.select().from(issueComments).where(eq(issueComments.id, rows[2]!.id));
    await issueService(db).tombstoneComment(rows[0]!.id, { actorType: "user", userId: "structural-fixture" });
    const [deleted] = await db.select().from(issueComments).where(eq(issueComments.id, rows[0]!.id));
    expect(deleted!.body).not.toContain("PRIVATE"); expect(deleted!.deletedAt).toBeInstanceOf(Date);
    expect(deleted!.payloadSourceSnapshot).toBeNull(); expect(deleted!.payloadSourceSnapshotInvalidated).toBe(true);
    expect((await db.select().from(issueComments).where(eq(issueComments.id, rows[1]!.id)))[0]).toEqual(other);
    await expect(bindOwner("issue_comments", "comment", rows[0]!.id)).rejects.toMatchObject({ cause: { code: "23514" } });
    await issueService(db).tombstoneComment(rows[2]!.id, { actorType: "user", userId: "structural-fixture" });
    const [unchanged] = await db.select().from(issueComments).where(eq(issueComments.id, rows[2]!.id));
    expect(unchanged!.deletedAt).toBeInstanceOf(Date);
    expect(unchanged!.payloadSourceSnapshot).toEqual(sameBody!.payloadSourceSnapshot);
    expect(unchanged!.payloadSourceSnapshotInvalidated).toBe(false);
  });


  it.each(["issue", "project"] as const)("preserves a concurrently replaced %s environment selection", async kind => {
    const environmentId = randomUUID(), nextEnvironmentId = randomUUID();
    const table = kind === "issue" ? "issues" : "projects";
    const column = kind === "issue" ? "execution_workspace_settings" : "execution_workspace_policy";
    const settings = kind === "issue" ? { mode: "shared_workspace", environmentId } : { enabled: false, environmentId };
    const [row] = kind === "issue"
      ? await db.insert(issues).values({ companyId, title: "Concurrent environment Task", executionWorkspaceSettings: settings }).returning()
      : await db.insert(projects).values({ companyId, name: "Concurrent environment Project", executionWorkspacePolicy: settings }).returning();
    const replacement = { ...settings, environmentId: nextEnvironmentId };
    let release!: () => void, locked!: () => void;
    const releaseLock = new Promise<void>(resolve => { release = resolve; });
    const rowLocked = new Promise<void>(resolve => { locked = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=${JSON.stringify(replacement)}::jsonb where id=${row!.id}::uuid`);
      locked(); await releaseLock;
    });
    await rowLocked;
    const clearing = (kind === "issue" ? issueService(db) : projectService(db)).clearExecutionWorkspaceEnvironmentSelection(companyId, environmentId);
    try {
      // Wait for the real UPDATE lock, not an assumed timing delay.
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const [state] = await db.execute<{ waiting: boolean }>(sql`select exists(select 1 from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and query ilike ${`%update "${table}"%`}) as waiting`);
        waiting = state!.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); await blocker; }
    expect(await clearing).toBe(0);
    const [stored] = await db.execute<{ settings: unknown }>(sql`select ${sql.identifier(column)} as settings from ${sql.identifier(table)} where id=${row!.id}::uuid`);
    expect(stored!.settings).toEqual(replacement);
  });


  it("preserves unchanged Project roadmap policy captures and invalidates a changed policy", async () => {
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
    const f = await seedV5Companies(db), policy = roadmapPolicySchema.parse({});
    const [project] = await db.insert(projects).values({ companyId: f.home, name: "Captured roadmap policy",
      sourceProvenanceQualified: true, roadmapPolicy: policy, payloadSourceProtocolVersion: 1 }).returning();
    await bindOwner("projects", "project", project!.id);
    const [before] = await db.select().from(projects).where(eq(projects.id, project!.id));
    const service = projectControlService(db);
    await service.policy(f.actor, f.home, project!.id, policy);
    expect((await db.select().from(projects).where(eq(projects.id, project!.id)))[0]!.payloadSourceSnapshot).toEqual(before!.payloadSourceSnapshot);
    const changed = { ...policy, scheduleToleranceDays: policy.scheduleToleranceDays + 1 };
    await service.policy(f.actor, f.home, project!.id, changed);
    const [stored] = await db.select().from(projects).where(eq(projects.id, project!.id));
    expect(stored!.roadmapPolicy).toEqual(changed);
    expect(stored!.payloadSourceSnapshot).toBeNull(); expect(stored!.payloadSourceSnapshotInvalidated).toBe(true);
  });

  it("invalidates a changed plugin Project reset while preserving an unchanged reset", async () => {
    const pluginKey = `capture-fixture.${randomUUID()}`;
    const declaration = { projectKey: "operations", displayName: "Captured plugin project", description: "Declared project body", status: "in_progress" as const };
    const manifest = { id: pluginKey, apiVersion: 1 as const, version: "0.1.0", displayName: "Capture fixture", description: "Structural fixture",
      author: "Fixture", categories: ["automation" as const], capabilities: ["projects.managed" as const],
      entrypoints: { worker: "./worker.js" }, projects: [declaration] };
    const [plugin] = await db.insert(plugins).values({ pluginKey, packageName: pluginKey, version: "0.1.0", apiVersion: 1,
      categories: ["automation"], status: "ready", manifestJson: manifest }).returning();
    const [project] = await db.insert(projects).values({ companyId, name: declaration.displayName, description: declaration.description,
      status: declaration.status, payloadSourceProtocolVersion: 1 }).returning();
    await db.insert(pluginManagedResources).values({ companyId, pluginId: plugin!.id, pluginKey, resourceKind: "project", resourceKey: declaration.projectKey, resourceId: project!.id });
    await bindOwner("projects", "project", project!.id);
    const [before] = await db.select().from(projects).where(eq(projects.id, project!.id));
    const service = projectService(db), input = { companyId, pluginId: plugin!.id, pluginKey, projectKey: declaration.projectKey, reset: true };
    expect((await service.resolveManagedProject(input)).status).toBe("reset");
    expect((await db.select().from(projects).where(eq(projects.id, project!.id)))[0]!.payloadSourceSnapshot).toEqual(before!.payloadSourceSnapshot);
    await db.update(plugins).set({ manifestJson: { ...manifest, projects: [{ ...declaration, displayName: "Changed plugin project" }] } }).where(eq(plugins.id, plugin!.id));
    const reset = await service.resolveManagedProject(input);
    expect(reset.project!.name).toBe("Changed plugin project");
    const [stored] = await db.select().from(projects).where(eq(projects.id, project!.id));
    expect(stored!.payloadSourceSnapshot).toBeNull(); expect(stored!.payloadSourceSnapshotInvalidated).toBe(true);
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
