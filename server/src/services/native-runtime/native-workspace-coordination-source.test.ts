import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { heartbeatRuns, issues, projectWorkspaces, workspaceOperations } from "@paperclipai/db";
import { nativeSha256 } from "./canonical.js";
import { composeNativeWorkspaceCoordinationMap, exactNativeWorkspaceCoordination,
  formatNativeWorkspaceCoordination, readNativeWorkspaceCoordination, type NativeWorkspaceCoordinationCapture } from "./native-workspace-coordination-source.js";

// Pure capture/render-map controls only. Actual operation/ACL/row locks remain
// integration obligations; a constructed capture is not database authority.
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function fixture() {
  const consumer = { companyId: randomUUID(), runId: randomUUID(), agentId: randomUUID(), issueId: randomUUID() };
  const holder = { runId: randomUUID(), agentId: randomUUID(), issueId: randomUUID(), issueIdentifier: "TEST-4" };
  const note = formatNativeWorkspaceCoordination(holder);
  const observation = { schema: "paperclip.native.workspace-coordination.v1" as const, ...consumer,
    responsibleUserId: randomUUID(), projectId: randomUUID(), projectWorkspaceId: randomUUID(),
    holderRunId: holder.runId, holderAgentId: holder.agentId, holderIssueId: holder.issueId,
    holderIdentifier: holder.issueIdentifier, observedAt: "2026-11-03T00:00:00.000Z", activityAt: "2026-11-02T23:59:59.000Z",
    appendixHash: hash(note) };
  const capture: NativeWorkspaceCoordinationCapture = { operationId: randomUUID(), observation,
    observationDigest: nativeSha256(observation) };
  const base = "# Exact current Task\nOriginal Human bytes.";
  const baseMap = { version: 1 as const, renderedMarkdownDigest: hash(base), renderedMarkdownLength: base.length,
    references: [{ kind: "task" as const, id: consumer.issueId }] };
  return { consumer, holder, note, capture, base, baseMap, renderedMarkdown: `${base}\n${note}` };
}
describe("workspace-coordination immutable admission capture and exact map", () => {
  it("preserves the exact base references while covering only its actual fixed appendix", () => {
    const f = fixture();
    expect(exactNativeWorkspaceCoordination(f.capture, f.consumer)).toEqual(f.capture);
    const map = composeNativeWorkspaceCoordinationMap({ ...f.consumer, ...f });
    expect(map?.references).toBe(f.baseMap.references);
    expect(map?.renderedMarkdownDigest).toBe(hash(f.renderedMarkdown));
    expect(map?.renderedMarkdownLength).toBe(f.renderedMarkdown.length);
    expect(f.baseMap.renderedMarkdownDigest).toBe(hash(f.base));
  });
  it("uses the existing identifier-or-ID note without holder body/title bytes", () => {
    const f = fixture();
    expect(f.note).toBe(`shared workspace is concurrently held by run ${f.holder.runId} (issue TEST-4); expect concurrent mutations, coordinate via commits`);
    expect(formatNativeWorkspaceCoordination({ ...f.holder, issueIdentifier: null }))
      .toContain(`(issue ${f.holder.issueId})`);
  });
  it("rejects foreign bindings, self-reference, changed snapshot and malformed capture", () => {
    const f = fixture();
    for (const key of ["companyId", "runId", "agentId", "issueId"] as const)
      expect(exactNativeWorkspaceCoordination(f.capture, { ...f.consumer, [key]: randomUUID() })).toBeNull();
    for (const capture of [null, {}, { ...f.capture, observationDigest: "0".repeat(64) },
      { ...f.capture, observation: { ...f.capture.observation, holderRunId: f.consumer.runId } },
      { ...f.capture, observation: { ...f.capture.observation, holderIssueId: f.consumer.issueId } },
      { ...f.capture, observation: { ...f.capture.observation, holderIdentifier: "CHANGED" } },
      { ...f.capture, unexpected: "PRIVATE_TOKEN" }])
      expect(exactNativeWorkspaceCoordination(capture, f.consumer)).toBeNull();
  });
  it("refuses a substituted base, missing or duplicate note, bad original map and no capture", () => {
    const f = fixture();
    for (const renderedMarkdown of [f.base, `CHANGED\n${f.note}`, `${f.renderedMarkdown}\n${f.note}`, `${f.base}\nCHANGED`])
      expect(composeNativeWorkspaceCoordinationMap({ ...f.consumer, ...f, renderedMarkdown })).toBeNull();
    expect(composeNativeWorkspaceCoordinationMap({ ...f.consumer, ...f, capture: null })).toBeNull();
    expect(composeNativeWorkspaceCoordinationMap({ ...f.consumer, ...f, baseMap: null })).toBeNull();
    expect(composeNativeWorkspaceCoordinationMap({ ...f.consumer, ...f,
      baseMap: { ...f.baseMap, renderedMarkdownLength: f.base.length + 1 } })).toBeNull();
  });
});

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("../authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../authorization.js")>(),
  authorizationService: () => ({ decide: async () => ({ allowed: access.allowed }) }),
  canActorReadIssuePrivacy: async () => access.allowed,
}));

// Synthetic relational IO enforces actual Drizzle predicate parameters. This
// verifies reader construction and denial behavior, not PostgreSQL locks/ACLs.
function readerFixture() {
  const f = fixture(), observation = f.capture.observation;
  const rows = new Map<object, Array<Record<string, unknown>>>([
    [heartbeatRuns, [{ id: observation.runId, companyId: observation.companyId, agentId: observation.agentId,
      responsibleUserId: observation.responsibleUserId, contextSnapshot: { issueId: observation.issueId } },
    { id: observation.holderRunId, companyId: observation.companyId, agentId: observation.holderAgentId,
      status: "running", contextSnapshot: { issueId: observation.holderIssueId } }]],
    [issues, [{ id: observation.issueId, companyId: observation.companyId, projectId: observation.projectId,
      projectWorkspaceId: observation.projectWorkspaceId, hiddenAt: null },
    { id: observation.holderIssueId, companyId: observation.companyId, projectId: observation.projectId,
      projectWorkspaceId: observation.projectWorkspaceId, identifier: observation.holderIdentifier, hiddenAt: null }]],
    [projectWorkspaces, [{ id: observation.projectWorkspaceId, companyId: observation.companyId, projectId: observation.projectId }]],
    [workspaceOperations, [{ id: f.capture.operationId, companyId: observation.companyId, heartbeatRunId: observation.runId,
      issueId: observation.issueId, phase: "workspace_config_freshness", status: "succeeded", command: null, cwd: null,
      metadata: { nativeWorkspaceCoordinationObservation: observation },
      startedAt: new Date(observation.observedAt), finishedAt: new Date(observation.observedAt) }]],
  ]);
  const locks: string[] = [], dialect = new PgDialect();
  const db = { execute: async () => ({}), transaction: async (read: (tx: unknown) => Promise<unknown>): Promise<unknown> => read(db),
    select: () => ({ from: (table: object) => ({ where: (predicate: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    let ordered = false;
    const query = { orderBy: () => { ordered = true; return query; }, for: async (lock: string) => {
      locks.push(lock);
      const query = dialect.sqlToQuery(predicate), values = query.params;
      // Queries use exact same-company scope and owner ID, plus original
      // consumer Run/Task for the operation. No test-supplied 'verified' flag.
      if (table === workspaceOperations) {
        expect(values).toEqual([observation.companyId, observation.runId, observation.issueId, f.capture.operationId]);
        return (rows.get(table) ?? []).filter(row => row.companyId === values[0] && row.heartbeatRunId === values[1] &&
          row.issueId === values[2] && row.id === values[3]);
      }
      expect(values[0]).toBe(observation.companyId);
      if (table === issues || table === heartbeatRuns) {
        expect(ordered).toBe(true); expect(values).toHaveLength(3);
        expect(values.slice(1)).toEqual([...values.slice(1)].sort());
        return (rows.get(table) ?? []).filter(row => row.companyId === values[0] && values.slice(1).includes(row.id));
      }
      expect(values).toHaveLength(2);
      return (rows.get(table) ?? []).filter(row => row.companyId === values[0] && row.id === values[1]);
    } }; return query;
  } }) }) };
  // This cast is confined to synthetic IO in the unit; production owner uses
  // the real transaction and cannot accept this alias from a caller.
  const syntheticDb = db as unknown as Parameters<typeof readNativeWorkspaceCoordination>[0];
  const read = () => readNativeWorkspaceCoordination(syntheticDb, { ...f.consumer, capture: f.capture,
    reader: { type: "board", source: "session", userId: observation.responsibleUserId } });
  return { ...f, rows, read, locks };
}
describe("workspace-coordination independent immutable observation reader (synthetic IO)", () => {
  it("keeps the original observation readable after the holder finishes", async () => {
    access.allowed = true; const f = readerFixture();
    await expect(f.read()).resolves.toEqual(f.capture);
    f.rows.get(heartbeatRuns)![1]!.status = "succeeded";
    await expect(f.read()).resolves.toEqual(f.capture);
    expect(f.locks.length).toBeGreaterThan(0); expect(f.locks.every(lock => lock === "share")).toBe(true);
  });
  it("denies removed/foreign/mutated records, stable owners, identifiers and current reader access", async () => {
    const mutations: Array<(f: ReturnType<typeof readerFixture>) => void> = [
      f => f.rows.set(workspaceOperations, []),
      f => { f.rows.get(workspaceOperations)![0]!.companyId = randomUUID(); },
      f => { f.rows.get(workspaceOperations)![0]!.metadata = {}; },
      f => { f.rows.get(workspaceOperations)![0]!.status = "running"; },
      f => { f.rows.get(heartbeatRuns)![1]!.agentId = randomUUID(); },
      f => { f.rows.get(issues)![1]!.identifier = "CHANGED"; },
      f => { f.rows.get(issues)![1]!.projectWorkspaceId = randomUUID(); },
      f => { f.rows.get(projectWorkspaces)![0]!.projectId = randomUUID(); },
      f => { f.rows.get(issues)![1]!.hiddenAt = new Date(); },
    ];
    for (const mutate of mutations) { access.allowed = true; const f = readerFixture(); mutate(f); await expect(f.read()).rejects.toThrow(); }
    const f = readerFixture(); access.allowed = false;
    try { await expect(f.read()).rejects.toThrow("Native workspace coordination Task reader changed"); }
    finally { access.allowed = true; }
  });
});
