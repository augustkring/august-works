import { afterEach, expect, it, vi } from "vitest";
import { readInsightManagementReviewSummaries } from "./insight-management-review-summaries";
const companyId = "10000000-0000-4000-8000-000000000001", reviewId = "10000000-0000-4000-8000-000000000002";
const createdAt = "2026-10-01T00:00:00Z", expiresAt = "2026-11-01T00:00:00Z";
const summary = { id: reviewId, companyId, status: "published", name: "PRIVATE historical review", reviewType: "weekly_leadership", createdAt, expiresAt, publishedAt: createdAt,
  contentHash: "a".repeat(64), definitionHash: "b".repeat(64), sourceKeys: ["goal"], currentQualification: "current",
  packet: { engineVersion: "aw-native-management-skeleton-v1", definitionHash: "b".repeat(64), inputHash: "c".repeat(64), contentHash: "a".repeat(64), asOf: createdAt,
    period: { from: "2026-09-30T00:00:00Z", until: createdAt }, coverage: "explicit_selected_native_sources", executionAuthority: "read_only_historical_review", limitations: ["Selected sources are not a complete company census"],
    claims: [{ key: "claim_goal", sourceKeys: ["goal"], grade: "native_current_state", facts: { status: "planned", count: 0, target: null }, limitations: ["Current state is not historical reconstruction"] }],
    agenda: [{ key: "investigate", category: "INVESTIGATE", dueAt: expiresAt, sourceKeys: ["goal"], nextAction: "PRIVATE human next action", hypothesis: "PRIVATE Human hypothesis; no established cause", interpretation: "human_declared_agenda", hypothesisAuthority: "human_hypothesis" }] } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(change?: (path: string, data: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (raw: string, input: RequestInit) => {
    const url = new URL(raw, "http://local.test"); expect(url.searchParams.get("expectedUserId")).toBe("manager-a"); expect(input.method ?? "GET").toBe("GET"); expect(input.signal).toBeTruthy();
    const data = url.pathname.endsWith("/summary") ? summary : { items: [{ id: reviewId, status: "published", createdAt, expiresAt }], nextCursor: null, coverage: "bounded_native_review_metadata" };
    return new Response(JSON.stringify(change ? change(url.pathname, structuredClone(data)) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
it("reads only Native metadata/summary and preserves scoped citations, zero and unknown without events or writes", async () => {
  transport(); const read = await readInsightManagementReviewSummaries(companyId, "manager-a", new AbortController().signal);
  expect(read.items[0].packet.claims[0].facts).toEqual({ status: "planned", count: 0, target: null }); expect(fetch).toHaveBeenCalledTimes(2);
});
it.each(["foreign_company", "superseded", "changed_expiry", "wrong_definition_hash", "wrong_content_hash", "unknown_citation", "duplicate_agenda", "invented_authority", "wrong_hypothesis_authority"])("refuses %s without private excerpts", async failure => {
  transport((path, data) => {
    if (path.endsWith("/summary")) {
      if (failure === "foreign_company") data.companyId = reviewId;
      if (failure === "superseded") data.status = "superseded";
      if (failure === "changed_expiry") data.expiresAt = "2026-12-01T00:00:00Z";
      if (failure === "wrong_definition_hash") data.packet.definitionHash = "d".repeat(64);
      if (failure === "wrong_content_hash") data.packet.contentHash = "d".repeat(64);
      if (failure === "unknown_citation") data.packet.claims[0].sourceKeys = ["unknown"];
      if (failure === "duplicate_agenda") data.packet.agenda.push(data.packet.agenda[0]);
      if (failure === "invented_authority") data.packet.executionAuthority = "execute";
      if (failure === "wrong_hypothesis_authority") data.packet.agenda[0].hypothesisAuthority = "none";
    }
    return data;
  });
  await expect(readInsightManagementReviewSummaries(companyId, "manager-a", new AbortController().signal)).rejects.toThrow("insight_management_review_unavailable");
});
it("does not select a private draft as a published historical review", async () => {
  transport((path, data) => { if (path.endsWith("/controls")) data.items[0].status = "draft"; return data; });
  const read = await readInsightManagementReviewSummaries(companyId, "manager-a", new AbortController().signal); expect(read.items).toEqual([]); expect(fetch).toHaveBeenCalledTimes(1);
});
