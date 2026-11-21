import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agents,
  heartbeatRuns,
  issueAccessGrants,
  memoryBindings,
  memoryRecords,
  contextManifests,
  contextManifestMemoryRoots,
  authUsers,
  companyMemberships,
  assets,
  companies,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  documentRevisions,
  documents,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueInboxArchives,
  issueLabels,
  issueRelations,
  issuePrivacySources,
  issueWorkProducts,
  issues,
} from "@paperclipai/db";
import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyPortabilityService } from "../services/company-portability.js";
import { canActorReadMemorySources } from "../services/memory/memory-privacy.js";
import { canActorReadHeartbeatRunPrivacy, canActorReadIssuePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { workProductService } from "../services/work-products.js";
import type { ImportIssueWorkProductRow } from "../services/import-write-types.js";
import type { CompanyPortabilityFileEntry } from "@paperclipai/shared";
import { randomUUID } from "node:crypto";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";

// This suite proves the company-import writers batch their inserts: it runs a
// real import against embedded Postgres and counts the SQL insert statements
// issued per table. The non-benchmark test guards against a regression to the
// old one-insert-per-row pattern in normal CI; the benchmark (opt-in via
// PORTABILITY_IMPORT_BENCH=1) reports wall-clock and statement counts at scale.

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

// Tables whose insert statements we count, keyed by a readable label.
const COUNTED_TABLES: Array<[string, unknown]> = [
  ["issues", issues],
  ["issue_labels", issueLabels],
  ["issue_comments", issueComments],
  ["documents", documents],
  ["document_revisions", documentRevisions],
  ["issue_documents", issueDocuments],
  ["issue_work_products", issueWorkProducts],
  ["assets", assets],
  ["issue_attachments", issueAttachments],
  ["issue_relations", issueRelations],
];

interface InsertCounts {
  total: number;
  byTable: Map<string, number>;
  reset: () => void;
}

/**
 * Patch a drizzle db so every `insert()` call (on the db and on any
 * transaction handed to `db.transaction`) is counted. Each `insert(table)`
 * call corresponds to exactly one SQL statement, so this counts statements.
 */
function instrumentInserts(db: Record<string, unknown>): InsertCounts {
  const counts: InsertCounts = {
    total: 0,
    byTable: new Map(),
    reset() {
      this.total = 0;
      this.byTable.clear();
    },
  };
  const labelFor = (table: unknown): string | null => {
    for (const [label, ref] of COUNTED_TABLES) {
      if (table === ref) return label;
    }
    return null;
  };
  const patchInsert = (target: Record<string, unknown>) => {
    const original = (target.insert as (table: unknown) => unknown).bind(target);
    target.insert = (table: unknown) => {
      counts.total += 1;
      const label = labelFor(table);
      if (label) counts.byTable.set(label, (counts.byTable.get(label) ?? 0) + 1);
      return original(table);
    };
  };
  const patchExecutor = (executor: Record<string, unknown>) => {
    patchInsert(executor);
    const originalTransaction = (executor.transaction as (fn: unknown, config?: unknown) => unknown).bind(executor);
    executor.transaction = (fn: (tx: Record<string, unknown>) => unknown, config?: unknown) =>
      originalTransaction((tx: Record<string, unknown>) => {
        patchExecutor(tx);
        return fn(tx);
      }, config);
  };
  patchExecutor(db);
  return counts;
}

// The `.paperclip.yaml` extension is consumed by the importer's own hand-rolled
// block-YAML parser (not a general YAML/JSON reader), so render it with the same
// block algorithm the exporter uses to guarantee a round-trip-compatible bundle.
function renderYamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function isRenderableScalar(value: unknown): boolean {
  return (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || typeof value === "number"
    || (Array.isArray(value) && value.length === 0)
    || (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

function renderYamlBlock(value: unknown, indentLevel: number): string[] {
  const indent = "  ".repeat(indentLevel);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    const lines: string[] = [];
    for (const entry of value) {
      if (isRenderableScalar(entry)) {
        lines.push(`${indent}- ${renderYamlScalar(entry)}`);
        continue;
      }
      lines.push(`${indent}-`);
      lines.push(...renderYamlBlock(entry, indentLevel + 1));
    }
    return lines;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${indent}{}`];
    const lines: string[] = [];
    for (const [key, entry] of entries) {
      if (isRenderableScalar(entry)) {
        lines.push(`${indent}${key}: ${renderYamlScalar(entry)}`);
        continue;
      }
      lines.push(`${indent}${key}:`);
      lines.push(...renderYamlBlock(entry, indentLevel + 1));
    }
    return lines;
  }
  return [`${indent}${renderYamlScalar(value)}`];
}

function renderPaperclipYaml(value: Record<string, unknown>): string {
  return `${renderYamlBlock(value, 0).join("\n")}\n`;
}

interface SyntheticBundleOptions {
  issueCount: number;
  commentsPerIssue: number;
  documentsPerIssue: number;
}

/** Build an inline import bundle with the requested shape, valid at schemaVersion 7. */
function buildSyntheticBundle(options: SyntheticBundleOptions): {
  rootPath: string;
  files: Record<string, CompanyPortabilityFileEntry>;
} {
  const files: Record<string, CompanyPortabilityFileEntry> = {};
  files["COMPANY.md"] = ['---', 'schema: "agentcompanies/v1"', 'name: "Batching Bench Co"', '---', '', 'Synthetic import bundle.', ''].join("\n");

  const tasks: Record<string, unknown> = {};
  for (let i = 1; i <= options.issueCount; i += 1) {
    const slug = `task-${String(i).padStart(4, "0")}`;
    files[`tasks/${slug}/TASK.md`] = ['---', `name: "Task ${i}"`, "kind: task", '---', '', `Description body for task ${i}. `.repeat(6), ''].join("\n");

    const comments = [];
    for (let c = 0; c < options.commentsPerIssue; c += 1) {
      comments.push({
        body: `Comment ${c + 1} on task ${i}. `.repeat(4),
        authorType: "system",
      });
    }
    const taskDocuments = [];
    for (let d = 0; d < options.documentsPerIssue; d += 1) {
      const key = d === 0 ? "spec" : `doc-${d + 1}`;
      const docPath = `tasks/${slug}/documents/${key}.md`;
      files[docPath] = `# ${key}\n\n${`Document body for task ${i} ${key}. `.repeat(8)}`;
      taskDocuments.push({ key, title: key, format: "markdown", path: docPath });
    }

    tasks[slug] = {
      status: "todo",
      priority: "medium",
      comments,
      documents: taskDocuments,
    };
  }

  files[".paperclip.yaml"] = renderPaperclipYaml({ schemaVersion: 7, tasks });

  return { rootPath: "batching-bench", files };
}

/**
 * Build a bundle whose every task carries a *user*-authored comment. On import,
 * user comments are re-attributed to the importing user, so every issue becomes
 * "touched by me" — the exact shape that used to flood the inbox after an
 * import. The inbox seeding is what must keep them hidden.
 */
function buildTouchedIssuesBundle(issueCount: number): {
  rootPath: string;
  files: Record<string, CompanyPortabilityFileEntry>;
} {
  const files: Record<string, CompanyPortabilityFileEntry> = {};
  files["COMPANY.md"] = ['---', 'schema: "agentcompanies/v1"', 'name: "Inbox Flood Co"', '---', '', 'Synthetic import bundle.', ''].join("\n");

  const tasks: Record<string, unknown> = {};
  for (let i = 1; i <= issueCount; i += 1) {
    const slug = `task-${String(i).padStart(4, "0")}`;
    files[`tasks/${slug}/TASK.md`] = ['---', `name: "Task ${i}"`, "kind: task", '---', '', `Body for task ${i}.`, ''].join("\n");
    tasks[slug] = {
      status: "todo",
      priority: "medium",
      comments: [{ body: `A human note on task ${i}.`, authorType: "user" }],
      documents: [],
    };
  }

  files[".paperclip.yaml"] = renderPaperclipYaml({ schemaVersion: 7, tasks });
  return { rootPath: "inbox-flood", files };
}

describeEmbeddedPostgres("company import batches inserts", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let counts!: InsertCounts;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-import-batching-");
    db = createDb(tempDb.connectionString);
    counts = instrumentInserts(db as unknown as Record<string, unknown>);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const nativeSourceIds = new Set<string>();
  beforeEach(() => {
    nativeSourceIds.clear();
    counts.reset();
  });

  async function qualifyNativeBundle(files: Record<string, CompanyPortabilityFileEntry>, userId: string, nativeConversation = false, sourceOwnerId = userId) {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Native copy fixture", issuePrefix: `N${companyId.slice(0, 7)}` });
    const actor = await seedCurrentHumanSourceActor(db, [companyId], userId);
    const sourceActor = sourceOwnerId === userId ? actor : await seedCurrentHumanSourceActor(db, [companyId], sourceOwnerId);
    const conversationAgentId = nativeConversation ? randomUUID() : null;
    if (conversationAgentId) await db.insert(agents).values({ id: conversationAgentId, companyId, name: "Native source companion", role: "engineer", adapterType: "process" });
    const sourceRows = new Map<string, typeof issues.$inferSelect>();
    for (const path of Object.keys(files)) {
      const match = /^tasks\/([^/]+)\/TASK\.md$/.exec(path);
      if (!match) continue;
      const slug = match[1]!, sourceId = randomUUID();
      await issueService(db).create(companyId, { id: sourceId, title: `Native source ${slug}`, visibility: "open", createdByUserId: sourceOwnerId,
        ...(conversationAgentId ? { conversationAgentId, conversationUserId: sourceOwnerId, conversationState: "active" as const,
          assigneeAgentId: conversationAgentId, responsibleUserId: sourceOwnerId } : {}),
      }, db, undefined, { ...(conversationAgentId ? {} : { manualInputActor: sourceActor }), privacyActor: sourceActor });
      sourceRows.set(slug, (await db.select().from(issues).where(eq(issues.id, sourceId)))[0]!);
      nativeSourceIds.add(sourceId);
    }
    const extension = files[".paperclip.yaml"];
    if (typeof extension !== "string") throw new Error("Expected fixture YAML text");
    let qualified = extension;
    for (const path of Object.keys(files)) {
      const match = /^tasks\/([^/]+)\/TASK\.md$/.exec(path);
      if (!match) continue;
      const slug = match[1]!;
      const source = sourceRows.get(slug)!;
      const privacySources = await db.select({ sourceKind: issuePrivacySources.sourceKind, sourceId: issuePrivacySources.sourceId })
        .from(issuePrivacySources).where(eq(issuePrivacySources.issueId, source.id));
      const proof = { sourceCompanyId: companyId, sourceIssueId: source.id, visibility: source.visibility,
        privacyRootIssueId: source.privacyRootIssueId, privacyParentIssueId: source.privacyParentIssueId,
        privacySources, responsibleUserId: source.responsibleUserId, createdByUserId: source.createdByUserId };
      qualified = qualified.replace(`  ${slug}:\n`, `  ${slug}:\n${renderYamlBlock(proof, 2).join("\n")}\n`);
    }
    files[".paperclip.yaml"] = qualified;
    counts.reset();
    return companyId;
  }

  it("imports many issues with a bounded number of issue-insert statements", async () => {
    const profileStartedAt = performance.now();
    const profile = (stage: string) => {
      if (process.env.PORTABILITY_IMPORT_PROFILE === "1") {
        console.info(`[portability-import-profile] ${stage} ${Math.round(performance.now() - profileStartedAt)}ms`);
      }
    };
    const issueCount = 50;
    const commentsPerIssue = 2;
    const documentsPerIssue = 1;
    const bundle = buildSyntheticBundle({ issueCount, commentsPerIssue, documentsPerIssue });
    profile("bundle-built");
    const sourceCompanyId = await qualifyNativeBundle(bundle.files, "user-batching-regression");
    profile("source-qualified");
    const portability = companyPortabilityService(db);

    profile("import-enter");
    const result = await portability.importBundle(
      {
        source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: sourceCompanyId },
        collisionStrategy: "rename",
      },
      "user-batching-regression",
    );
    profile("import-returned");

    const companyId = result.company.id;
    const issueInserts = counts.byTable.get("issues") ?? 0;
    const commentInserts = counts.byTable.get("issue_comments") ?? 0;

    // The whole point: a 50-issue import must not issue one insert per issue.
    expect(issueInserts).toBeGreaterThan(0);
    expect(issueInserts).toBeLessThan(issueCount);
    // 50 issues fit in a single chunk; the exact number is small and stable.
    expect(issueInserts).toBeLessThanOrEqual(2);
    expect(commentInserts).toBeLessThanOrEqual(2);

    // And the data must actually land, unchanged in shape.
    const [{ issueRows }] = await db
      .select({ issueRows: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined));
    const [{ commentRows }] = await db
      .select({ commentRows: sql<number>`count(*)::int` })
      .from(issueComments)
      .where(eq(issueComments.companyId, companyId));
    // Count the issue-document links so company-bootstrap routine documents
    // (seeded on company creation) don't skew the imported-document count.
    const [{ documentLinkRows }] = await db
      .select({ documentLinkRows: sql<number>`count(*)::int` })
      .from(issueDocuments)
      .where(eq(issueDocuments.companyId, companyId));

    expect(issueRows).toBe(issueCount);
    expect(commentRows).toBe(issueCount * commentsPerIssue);
    expect(documentLinkRows).toBe(issueCount * documentsPerIssue);
    expect(result.warnings).toEqual([]);

    // Identifiers are a contiguous range allocated from the company counter.
    const identifiers = await db
      .select({ identifier: issues.identifier })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined));
    const uniqueIdentifiers = new Set(identifiers.map((row) => row.identifier));
    expect(uniqueIdentifiers.size).toBe(issueCount);
  });

  it("keeps imported issues out of the importing user's inbox", async () => {
    const importingUserId = "board-inbox-user";
    const bundle = buildTouchedIssuesBundle(3);
    const sourceCompanyId = await qualifyNativeBundle(bundle.files, importingUserId, false, randomUUID());
    const portability = companyPortabilityService(db);

    const result = await portability.importBundle(
      {
        source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: sourceCompanyId },
        collisionStrategy: "rename",
      },
      importingUserId,
    );
    const companyId = result.company.id;

    const importedIssues = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined));
    expect(importedIssues.length).toBe(3);
    const importedIds = new Set(importedIssues.map((row) => row.id));

    // Every imported issue is seeded with a per-user inbox archive, attributed
    // to the importing board user (not an agent).
    const archives = await db
      .select({
        issueId: issueInboxArchives.issueId,
        archivedByActorType: issueInboxArchives.archivedByActorType,
      })
      .from(issueInboxArchives)
      .where(and(
        eq(issueInboxArchives.companyId, companyId),
        eq(issueInboxArchives.userId, importingUserId),
      ));
    expect(new Set(archives.map((row) => row.issueId))).toEqual(importedIds);
    expect(archives.every((row) => row.archivedByActorType === "user")).toBe(true);

    const issuesSvc = issueService(db);

    // Sanity: the imported issues really are "touched by me" (their user comment
    // was re-attributed to the importing user), so without the archive filter
    // they would all flood the inbox.
    const touched = await issuesSvc.list(companyId, { touchedByUserId: importingUserId });
    expect(new Set(touched.map((issue) => issue.id))).toEqual(importedIds);

    // The inbox "mine" query (touched AND not inbox-archived) returns none of
    // them — the seeding is load-bearing.
    const mineInbox = await issuesSvc.list(companyId, {
      touchedByUserId: importingUserId,
      inboxArchivedByUserId: importingUserId,
    });
    expect(mineInbox.filter((issue) => importedIds.has(issue.id))).toEqual([]);

    // Normal (non-import) creation is unaffected: an issue the same user creates
    // after the import is not archived and shows up in their inbox.
    const fresh = await issuesSvc.create(companyId, {
      title: "Freshly created work",
      status: "todo",
      priority: "medium",
      createdByUserId: importingUserId,
    });
    const mineAfterCreate = await issuesSvc.list(companyId, {
      touchedByUserId: importingUserId,
      inboxArchivedByUserId: importingUserId,
    });
    expect(mineAfterCreate.map((issue) => issue.id)).toContain(fresh.id);
    expect(mineAfterCreate.filter((issue) => importedIds.has(issue.id))).toEqual([]);
  });

  it("imports in_progress issues with a null startedAt", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Carried Over Co",
      issuePrefix: "CAR",
      requireBoardApprovalForNewAgents: false,
    });
    // pauseAutomations imports assignees paused; paused agents keep assignments.
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Carried Coder",
      role: "engineer",
      status: "paused",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await issueService(db).importIssues(companyId, [{
      id: randomUUID(),
      ref: "carried-over",
      visibility: "open", privacyRootIssueId: null, privacyParentIssueId: null, privacySources: [],
      responsibleUserId: null, createdByUserId: null,
      projectId: null,
      projectWorkspaceId: null,
      title: "Carried-over work",
      description: null,
      assigneeAgentId: agentId,
      status: "in_progress",
      priority: "medium",
      billingCode: null,
      assigneeAdapterOverrides: null,
      executionWorkspaceSettings: null,
      labelIds: [],
      monitorNotes: null,
      monitorScheduledBy: null,
    }]);

    const [imported] = await db
      .select({ status: issues.status, startedAt: issues.startedAt })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined));
    expect(imported?.status).toBe("in_progress");
    // An import-time startedAt would misrepresent carried-over work
    // as a newly started active episode.
    expect(imported?.startedAt).toBeNull();
  });

  it("preserves bundle timestamps and parent hierarchy through a real import", async () => {
    const files: Record<string, CompanyPortabilityFileEntry> = {};
    files["COMPANY.md"] = ['---', 'schema: "agentcompanies/v1"', 'name: "Timestamp Fidelity Co"', '---', '', 'Synthetic import bundle.', ''].join("\n");
    const taskFile = (name: string) => ['---', `name: "${name}"`, "kind: task", '---', '', `${name} body.`, ''].join("\n");
    files["tasks/a-child/TASK.md"] = taskFile("Child");
    files["tasks/m-grandchild/TASK.md"] = taskFile("Grandchild");
    files["tasks/z-parent/TASK.md"] = taskFile("Parent");
    files[".paperclip.yaml"] = renderPaperclipYaml({
      schemaVersion: 7,
      tasks: {
        // The child slug sorts before its parent so the importer's
        // parents-first row ordering (not manifest order) must satisfy the
        // parent foreign key.
        "a-child": {
          status: "todo",
          priority: "medium",
          parent: "z-parent",
          createdAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-03-05T00:00:00.000Z",
          comments: [{
            body: "Older than the preserved updatedAt.",
            authorType: "system",
            createdAt: "2026-02-01T00:00:00.000Z",
          }],
        },
        "m-grandchild": {
          status: "todo",
          priority: "medium",
          parent: "a-child",
          createdAt: "2026-01-06T00:00:00.000Z",
          updatedAt: "2026-01-07T00:00:00.000Z",
        },
        "z-parent": {
          status: "done",
          priority: "medium",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          completedAt: "2026-02-20T00:00:00.000Z",
          comments: [{
            body: "Newer than the preserved updatedAt.",
            authorType: "system",
            createdAt: "2026-04-01T00:00:00.000Z",
          }],
        },
      },
    });

    const sourceCompanyId = await qualifyNativeBundle(files, "user-timestamp-fidelity");
    const portability = companyPortabilityService(db);
    const result = await portability.importBundle(
      {
        source: { type: "inline", rootPath: "timestamp-fidelity", files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: sourceCompanyId },
        collisionStrategy: "rename",
      },
      "user-timestamp-fidelity",
    );
    expect(result.warnings).toEqual([]);

    const rows = await db
      .select({
        id: issues.id,
        title: issues.title,
        parentId: issues.parentId,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        startedAt: issues.startedAt,
        completedAt: issues.completedAt,
      })
      .from(issues)
      .where(and(eq(issues.companyId, result.company.id), notInArray(issues.id, [...nativeSourceIds])));
    const parent = rows.find((row) => row.title === "Parent")!;
    const child = rows.find((row) => row.title === "Child")!;
    const grandchild = rows.find((row) => row.title === "Grandchild")!;

    // The parent chain of three lands intact.
    expect(parent.parentId).toBeNull();
    expect(child.parentId).toBe(parent.id);
    expect(grandchild.parentId).toBe(child.id);

    expect(parent.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(parent.completedAt).toEqual(new Date("2026-02-20T00:00:00.000Z"));
    expect(parent.startedAt).toBeNull();
    expect(child.createdAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
    expect(grandchild.createdAt).toEqual(new Date("2026-01-06T00:00:00.000Z"));
    expect(grandchild.updatedAt).toEqual(new Date("2026-01-07T00:00:00.000Z"));

    // A comment older than the preserved updatedAt must not regress it...
    expect(child.updatedAt).toEqual(new Date("2026-03-05T00:00:00.000Z"));
    // ...while a newer imported comment still bumps recency forward.
    expect(parent.updatedAt).toEqual(new Date("2026-04-01T00:00:00.000Z"));
  });

  it("imports a v6 bundle without the timestamp fields using import-time defaults", async () => {
    // A little slack absorbs clock drift between this process and Postgres.
    const importStart = Date.now() - 1_000;
    const files: Record<string, CompanyPortabilityFileEntry> = {};
    files["COMPANY.md"] = ['---', 'schema: "agentcompanies/v1"', 'name: "Legacy Shape Co"', '---', '', 'Synthetic import bundle.', ''].join("\n");
    files["tasks/legacy-task/TASK.md"] = ['---', 'name: "Legacy task"', "kind: task", '---', '', 'Legacy body.', ''].join("\n");
    files[".paperclip.yaml"] = renderPaperclipYaml({
      schemaVersion: 6,
      tasks: {
        "legacy-task": {
          status: "todo",
          priority: "medium",
          comments: [{
            body: "Predates the import.",
            authorType: "system",
            createdAt: "2026-01-01T00:00:00.000Z",
          }],
        },
      },
    });

    const sourceCompanyId = await qualifyNativeBundle(files, "user-legacy-shape");
    const portability = companyPortabilityService(db);
    const result = await portability.importBundle(
      {
        source: { type: "inline", rootPath: "legacy-shape", files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: sourceCompanyId },
        collisionStrategy: "rename",
      },
      "user-legacy-shape",
    );
    expect(result.warnings).toContain(
      "This package declares schemaVersion 6 and predates task timestamp and parent link transfer; that task data imports only if the bundle carries it.",
    );

    const [row] = await db
      .select({
        parentId: issues.parentId,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
        startedAt: issues.startedAt,
      })
      .from(issues)
      .where(and(eq(issues.companyId, result.company.id), notInArray(issues.id, [...nativeSourceIds])));
    expect(row?.parentId).toBeNull();
    expect(row?.startedAt).toBeNull();
    // Without preserved timestamps the row keeps the old behavior: created and
    // updated at import time, and the comment bump does not drag updatedAt
    // back to the older comment createdAt.
    expect(row!.createdAt.getTime()).toBeGreaterThanOrEqual(importStart);
    expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(importStart);
  });

  it("preserves a public company run but refuses unsupported private task and Memory context imports", async () => {
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 0, documentsPerIssue: 0 });
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(bundle.files, userId);
    const agentId = randomUUID(), companyRunId = randomUUID();
    await db.insert(agents).values({ id: agentId, companyId, name: "Native importer", role: "engineer", adapterType: "process" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" });
    await db.insert(heartbeatRuns).values({ id: companyRunId, companyId, agentId, responsibleUserId: userId,
      scopeKind: "company", status: "running", contextSnapshot: {} });
    const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId, runId: companyRunId, onBehalfOfUserId: userId };
    const input = { source: { type: "inline" as const, rootPath: bundle.rootPath, files: bundle.files },
      include: { company: false, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const portability = companyPortabilityService(db);
    expect(await canActorReadHeartbeatRunPrivacy(db, { type: "none" }, { id: companyRunId, companyId })).toBe(true);
    await expect(portability.importBundle(input, null, { actor })).resolves.toMatchObject({ company: { id: companyId } });

    const sourceId = [...nativeSourceIds][0]!, privateRunId = randomUUID();
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: sourceId,
      responsibleUserId: userId, createdByUserId: userId }).where(eq(issues.id, sourceId));
    await db.insert(issueAccessGrants).values({ companyId, issueId: sourceId, subjectType: "agent", subjectId: agentId,
      source: "explicit", grantedByUserId: userId });
    await db.insert(heartbeatRuns).values({ id: privateRunId, companyId, agentId, responsibleUserId: userId,
      scopeKind: "issue", issueId: sourceId, nativeIssueId: sourceId, status: "running", contextSnapshot: { issueId: sourceId } });
    const privateActor = { ...actor, runId: privateRunId };
    expect(await canActorReadHeartbeatRunPrivacy(db, privateActor, { id: privateRunId, companyId })).toBe(true);
    await expect(portability.importBundle(input, null, { actor: privateActor })).rejects.toMatchObject({ status: 422 });

    const [binding] = await db.insert(memoryBindings).values({ companyId, key: "import-guard", name: "Private import source", providerKey: "local" }).returning();
    const [memory] = await db.insert(memoryRecords).values({ companyId, bindingId: binding.id, providerKey: "local",
      memoryType: "lesson", scopeType: "agent", scopeId: agentId, ownerAgentId: agentId, privateOwnerUserId: userId,
      content: "Private Memory must not become unsupported imported configuration", sourceProvenanceQualified: true,
      observedAt: new Date(), createdByActorType: "user", createdByActorId: userId }).returning();
    const [manifest] = await db.insert(contextManifests).values({ companyId, agentId, runId: companyRunId,
      queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) }).returning();
    await db.insert(contextManifestMemoryRoots).values({ companyId, manifestId: manifest.id, memoryRecordId: memory.id, sourceVersion: "1" });
    expect(await canActorReadMemorySources(db, companyId, actor, memory.id)).toBe(true);
    // Retained private Memory context narrows access to the original company run.
    expect(await canActorReadHeartbeatRunPrivacy(db, { type: "none" }, { id: companyRunId, companyId })).toBe(false);
    await expect(portability.importBundle(input, null, { actor })).rejects.toMatchObject({ status: 422 });
    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId))).toEqual([{ id: agentId }]);
  });

  it.each(["explicit", "conversation"] as const)("copies an authorized %s-private source with retained ownership and roots", async kind => {
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 0, documentsPerIssue: 0 });
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(bundle.files, userId, kind === "conversation");
    const sourceId = [...nativeSourceIds][0]!;
    const visibility = kind === "explicit" ? "private" : "open";
    const rootId = kind === "explicit" ? sourceId : null;
    await db.update(issues).set({ visibility, privacyRootIssueId: rootId, responsibleUserId: userId,
      createdByUserId: userId }).where(eq(issues.id, sourceId));
    bundle.files[".paperclip.yaml"] = renderPaperclipYaml({ schemaVersion: 8, tasks: { "task-0001": {
      status: "todo", priority: "medium", sourceCompanyId: companyId, sourceIssueId: sourceId, visibility,
      privacyRootIssueId: rootId, privacyParentIssueId: null, privacySources: [], responsibleUserId: userId, createdByUserId: userId,
    } } });
    const actor = { type: "board" as const, source: "session" as const, userId };
    const input = { source: { type: "inline" as const, rootPath: bundle.rootPath, files: bundle.files },
      include: { company: false, agents: false, projects: false, issues: true },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const portability = companyPortabilityService(db);
    await expect(portability.importBundle(input, userId, { actor, privateWorkAdmission: "closed" })).rejects.toMatchObject({ status: 422 });
    await portability.importBundle(input, userId, { actor });
    const [copy] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), notInArray(issues.id, [...nativeSourceIds])));
    expect(copy).toMatchObject({ visibility: "private", privacyRootIssueId: sourceId, responsibleUserId: userId, createdByUserId: userId });
    expect(await canActorReadIssuePrivacy(db, actor, copy)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, { type: "none" }, copy)).toBe(false);
    expect(await db.select().from(issuePrivacySources).where(eq(issuePrivacySources.issueId, copy.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind: "issue", sourceId })]));
    const foreignCompanyId = randomUUID();
    await db.insert(companies).values({ id: foreignCompanyId, name: "Owned foreign target", issuePrefix: `F${foreignCompanyId.slice(0, 7)}` });
    await db.insert(companyMemberships).values({ companyId: foreignCompanyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await expect(portability.importBundle({ ...input, target: { mode: "existing_company", companyId: foreignCompanyId } }, userId, { actor }))
      .rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(issues).where(eq(issues.companyId, foreignCompanyId))).toEqual([]);
  });

  it("round-trips explicit empty provenance and retains the native task source restriction", async () => {
    const seed = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 0, documentsPerIssue: 0 });
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(seed.files, userId);
    const sourceId = [...nativeSourceIds][0]!;
    const portability = companyPortabilityService(db);
    const exported = await portability.exportBundle(companyId, {
      include: { company: false, agents: false, projects: false, issues: true, skills: false }, issues: [sourceId],
    }, { actor: { type: "board", source: "session", userId } });
    expect(exported.manifest.issues).toHaveLength(1);
    expect(exported.manifest.issues[0]).toMatchObject({ sourceCompanyId: companyId, sourceIssueId: sourceId,
      privacyRootIssueId: null, privacyParentIssueId: null, privacySources: [], responsibleUserId: userId, createdByUserId: userId });
    await portability.importBundle({
      source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
      include: { company: false, agents: false, projects: false, issues: true },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename",
    }, userId);
    const [copy] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), notInArray(issues.id, [...nativeSourceIds])));
    expect(copy).toBeDefined();
    if (!copy) throw new Error("Expected a copied task");
    expect(await db.select().from(issuePrivacySources).where(eq(issuePrivacySources.issueId, copy.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ sourceKind: "issue", sourceId })]));
    expect(await canActorReadIssuePrivacy(db, { type: "none" }, copy)).toBe(true);
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: sourceId,
      responsibleUserId: userId, createdByUserId: userId }).where(eq(issues.id, sourceId));
    expect(await canActorReadIssuePrivacy(db, { type: "none" }, copy)).toBe(false);
  });

  it("rolls back copied tasks and comments when a document child insert fails", async () => {
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 2, documentsPerIssue: 2 });
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(bundle.files, userId);
    const extension = bundle.files[".paperclip.yaml"];
    if (typeof extension !== "string") throw new Error("Expected fixture YAML text");
    // Both document keys normalize to the same native issue-document identity.
    bundle.files[".paperclip.yaml"] = extension.replace('key: "doc-2"', 'key: "SPEC"');
    await expect(companyPortabilityService(db).importBundle({
      source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
      include: { company: false, agents: false, projects: false, issues: true },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename",
    }, userId)).rejects.toThrow();
    expect(await db.select().from(issues).where(and(eq(issues.companyId, companyId), notInArray(issues.id, [...nativeSourceIds])))).toEqual([]);
    expect(await db.select().from(issueComments).where(eq(issueComments.companyId, companyId))).toEqual([]);
    expect(await db.select().from(documents).where(eq(documents.companyId, companyId))).toEqual([]);
    expect(counts.byTable.get("issues")).toBe(1);
    expect(counts.byTable.get("issue_comments")).toBe(1);
    expect(counts.byTable.get("issue_documents")).toBe(1);
  });

  it("rejects unproven legacy and forged private task provenance before copying content", async () => {
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 1, documentsPerIssue: 1 });
    const legacyFiles = { ...bundle.files };
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(bundle.files, userId);
    const input = { include: { company: false, agents: false, projects: false, issues: true },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const portability = companyPortabilityService(db);
    await expect(portability.importBundle({ ...input,
      source: { type: "inline", rootPath: bundle.rootPath, files: legacyFiles },
    }, userId)).rejects.toMatchObject({ status: 422 });
    const sourceId = [...nativeSourceIds][0]!;
    await db.update(issues).set({ visibility: "private", privacyRootIssueId: sourceId,
      responsibleUserId: userId, createdByUserId: userId }).where(eq(issues.id, sourceId));
    await expect(portability.importBundle({ ...input,
      source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
    }, userId)).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(issues).where(and(eq(issues.companyId, companyId), notInArray(issues.id, [...nativeSourceIds])))).toEqual([]);
    expect(counts.byTable.get("issues") ?? 0).toBe(0);
  });

  it.each(["suspended", "viewer"] as const)("rechecks current Human %s authority after the import counter row wait", async withdrawal => {
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 1, documentsPerIssue: 1 });
    const userId = randomUUID();
    const companyId = await qualifyNativeBundle(bundle.files, userId);
    let release!: () => void;
    let locked!: (pid: number) => void;
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    const lockedPromise = new Promise<number>(resolve => { locked = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
      const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`);
      locked(Number(backend.pid));
      await releasePromise;
    });
    const holderPid = await lockedPromise;
    const outcome = companyPortabilityService(db).importBundle({
      source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
      include: { company: false, agents: false, projects: false, issues: true },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename",
    }, userId).then(value => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await db.execute(sql`select 1 from pg_stat_activity where ${holderPid}::integer = any(pg_blocking_pids(pid))`);
        if (rows.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await db.update(companyMemberships).set(withdrawal === "suspended" ? { status: "suspended" } : { membershipRole: "viewer" }).where(and(
        eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    } finally { release(); await blocker; }
    expect((await outcome).error).toMatchObject({ status: 403 });
    expect(await db.select().from(issues).where(and(eq(issues.companyId, companyId), notInArray(issues.id, [...nativeSourceIds])))).toEqual([]);
    expect(await db.select().from(issueComments).where(eq(issueComments.companyId, companyId))).toEqual([]);
  });

  it("rolls back the whole work-product batch when a later chunk fails", async () => {
    // Seed a real company + issue to hang work products off of.
    const bundle = buildSyntheticBundle({ issueCount: 1, commentsPerIssue: 0, documentsPerIssue: 0 });
    const portability = companyPortabilityService(db);
    const sourceCompanyId = await qualifyNativeBundle(bundle.files, "user-work-product-atomicity");
    const seeded = await portability.importBundle(
      {
        source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
        include: { company: true, agents: false, projects: false, issues: true },
        target: { mode: "existing_company", companyId: sourceCompanyId },
        collisionStrategy: "rename",
      },
      "user-work-product-atomicity",
    );
    const companyId = seeded.company.id;
    const [issueRow] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined))
      .limit(1);
    expect(issueRow?.id).toBeTruthy();

    const buildRow = (issueId: string, index: number): ImportIssueWorkProductRow => ({
      companyId,
      issueId,
      projectId: null,
      type: "pull_request",
      provider: "github",
      externalId: null,
      title: `Work product ${index}`,
      url: null,
      status: "open",
      reviewState: "none",
      isPrimary: false,
      healthStatus: "unknown",
      summary: null,
      metadata: null,
      executionWorkspaceId: null,
      runtimeServiceId: null,
      createdByRunId: null,
      sourceTrust: null,
    });

    // 501 rows span two chunks (chunk size is 500). The first 500 are valid;
    // the 501st points at a non-existent issue so the *second* chunk's insert
    // fails after the first chunk already ran. Without a wrapping transaction
    // the first 500 would have committed; with it, nothing may persist.
    const rows: ImportIssueWorkProductRow[] = [];
    for (let i = 0; i < 500; i += 1) rows.push(buildRow(issueRow!.id, i));
    rows.push(buildRow(randomUUID(), 500));

    await expect(workProductService(db).createManyForImport(rows)).rejects.toThrow();

    const [{ workProductRows }] = await db
      .select({ workProductRows: sql<number>`count(*)::int` })
      .from(issueWorkProducts)
      .where(eq(issueWorkProducts.companyId, companyId));
    expect(workProductRows).toBe(0);
  });

  const benchmark = process.env.PORTABILITY_IMPORT_BENCH === "1" ? it : it.skip;
  benchmark(
    "benchmark: large import stays in the tens of statements, not thousands",
    async () => {
      const issueCount = 500;
      const commentsPerIssue = 5;
      const documentsPerIssue = 1;
      const bundle = buildSyntheticBundle({ issueCount, commentsPerIssue, documentsPerIssue });
      const totalRows =
        issueCount + issueCount * commentsPerIssue + issueCount * documentsPerIssue * 3;
      const portability = companyPortabilityService(db);

      const sourceCompanyId = await qualifyNativeBundle(bundle.files, "user-batching-benchmark");
      const startedAt = performance.now();
      const result = await portability.importBundle(
        {
          source: { type: "inline", rootPath: bundle.rootPath, files: bundle.files },
          include: { company: true, agents: false, projects: false, issues: true },
          target: { mode: "existing_company", companyId: sourceCompanyId },
          collisionStrategy: "rename",
        },
        "user-batching-benchmark",
      );
      const elapsedMs = performance.now() - startedAt;

      const perTable = Object.fromEntries(counts.byTable);
      // Analytical "before": the old path inserted one row per statement.
      const beforeStatements = totalRows;
      const afterStatements = counts.total;

      // eslint-disable-next-line no-console
      console.log(
        `[import-batching-bench] ${issueCount} issues x ${commentsPerIssue} comments x ${documentsPerIssue} doc\n`
          + `  wall-clock: ${elapsedMs.toFixed(0)}ms\n`
          + `  insert statements (after batching): ${afterStatements}\n`
          + `  insert statements (before, one per row): ~${beforeStatements}\n`
          + `  reduction: ${(beforeStatements / Math.max(1, afterStatements)).toFixed(0)}x\n`
          + `  per-table insert statements: ${JSON.stringify(perTable)}`,
      );

      const companyId = result.company.id;
      const [{ issueRows }] = await db
        .select({ issueRows: sql<number>`count(*)::int` })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), nativeSourceIds.size ? notInArray(issues.id, [...nativeSourceIds]) : undefined));
      expect(issueRows).toBe(issueCount);

      // Two orders of magnitude fewer statements than the per-row baseline.
      expect(afterStatements * 50).toBeLessThan(beforeStatements);
      expect(counts.byTable.get("issues") ?? 0).toBeLessThanOrEqual(2);
    },
    120_000,
  );
});
