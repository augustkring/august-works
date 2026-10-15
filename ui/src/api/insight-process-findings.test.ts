import { afterEach, expect, it, vi } from "vitest";
import { readInsightProcessFindings } from "./insight-process-findings";

const companyId = "10000000-0000-4000-8000-000000000001", definitionId = "10000000-0000-4000-8000-000000000002",
  versionId = "10000000-0000-4000-8000-000000000003", runId = "10000000-0000-4000-8000-000000000004", findingId = "10000000-0000-4000-8000-000000000005";
const createdAt = "2026-10-01T00:00:00Z", expiresAt = "2026-11-01T00:00:00Z";
const definition = { name: "PRIVATE recorded process", businessQuestion: "Which recorded paths require review?", ownerUserId: "manager-a", reviewFrequencyDays: 30,
  retentionDays: 30, scope: "company", sensitivity: "internal", purpose: "process_intelligence", governanceObligationRefs: [companyId],
  requiredSourceProviders: ["activity_log"], objectTypes: ["issue"], requiredActivities: ["issue.created", "issue.updated"], minimumCoverageSeconds: 3600,
  analysisFamilies: ["rework"], requiresArrivalEvidence: false, maxLateArrivalRate: 0 };
const root = { id: definitionId, companyId, status: "published", publishedVersionId: versionId };
const run = { id: runId, companyId, definitionId, versionId, definitionHash: "a".repeat(64), eventSetHash: "b".repeat(64),
  from: createdAt, until: "2026-10-02T00:00:00Z", createdAt, expiresAt };
const finding = { id: findingId, companyId, definitionId, analysisRunId: runId, findingType: "rework", severity: "medium", status: "OPEN", version: 1,
  summary: "Recorded reopening", interpretation: "PRIVATE human interpretation of the observed reopening", facts: { semantics: "human_process_interpretation_of_observed_facts",
    observed: { reopenCount: 0, unknownPeriod: null }, limitations: ["No causal effect is established"] }, definitionHash: run.definitionHash, eventSetHash: run.eventSetHash,
  contentHash: "c".repeat(64), createdAt, expiresAt };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(change?: (path: string, data: any) => any, userId: string | null = "manager-a") {
  vi.stubGlobal("fetch", vi.fn(async (raw: string, input: RequestInit) => {
    const url = new URL(raw, "http://local.test");
    expect(url.searchParams.get("expectedUserId")).toBe(userId);
    expect(input.method ?? "GET").toBe("GET"); expect(input.signal).toBeTruthy();
    const data = url.pathname.endsWith("/findings") ? { items: [finding], nextCursor: null }
      : url.pathname.endsWith("/runs") ? { items: [run], nextCursor: null, coverage: "bounded_current_authorized_page" }
      : url.pathname.endsWith(`/${definitionId}`) ? { root, effectiveVersion: { id: versionId, companyId, definitionId, contentHash: run.definitionHash, expiresAt, definition } }
      : { items: [root], nextCursor: null, coverage: "bounded_current_authorized_page" };
    return new Response(JSON.stringify(change ? change(url.pathname, structuredClone(data)) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
it("reads the actual retained owner paths and keeps zero distinct from unknown without writes", async () => {
  transport(); const result = await readInsightProcessFindings(companyId, "manager-a", new AbortController().signal);
  expect(result).toMatchObject({ boundedPage: true, items: [{ definitionId, run: { id: runId }, findings: [{ facts: { observed: { reopenCount: 0, unknownPeriod: null } } }] }] });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it.each(["foreign_definition", "changed_publication", "foreign_run", "duplicate_run", "wrong_definition_hash", "foreign_finding", "wrong_event_set", "duplicate_finding", "finding_outlives_run"])("refuses %s without private excerpts", async failure => {
  transport((path, data) => {
    if (path.endsWith(`/${definitionId}`)) {
      if (failure === "foreign_definition") data.effectiveVersion.companyId = findingId;
      if (failure === "changed_publication") data.root.publishedVersionId = findingId;
    }
    if (path.endsWith("/runs")) {
      if (failure === "foreign_run") data.items[0].companyId = findingId;
      if (failure === "duplicate_run") data.items.push(data.items[0]);
      if (failure === "wrong_definition_hash") data.items[0].definitionHash = "d".repeat(64);
    }
    if (path.endsWith("/findings")) {
      if (failure === "foreign_finding") data.items[0].companyId = findingId;
      if (failure === "wrong_event_set") data.items[0].eventSetHash = "d".repeat(64);
      if (failure === "duplicate_finding") data.items.push(data.items[0]);
      if (failure === "finding_outlives_run") data.items[0].expiresAt = "2026-12-01T00:00:00Z";
    }
    return data;
  });
  await expect(readInsightProcessFindings(companyId, "manager-a", new AbortController().signal)).rejects.toThrow("insight_process_findings_unavailable");
});
it("does not borrow a run from a previous definition or imply a complete search", async () => {
  transport((path, data) => { if (path.endsWith("/runs")) data.items[0].versionId = findingId; return data; });
  const result = await readInsightProcessFindings(companyId, "manager-a", new AbortController().signal);
  expect(result.items[0]).toMatchObject({ run: null, findings: [], hasMoreEvidence: true }); expect(fetch).toHaveBeenCalledTimes(3);
});
it("keeps the local implicit account binding absent", async () => {
  transport(undefined, null); await readInsightProcessFindings(companyId, null, new AbortController().signal);
});
