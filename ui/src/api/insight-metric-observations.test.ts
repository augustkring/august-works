import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { readInsightMetricObservations } from "./insight-metric-observations";

const companyId = "10000000-0000-4000-8000-000000000001";
const metricId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const observationId = "10000000-0000-4000-8000-000000000004";
const definition = { name: "PRIVATE recorded workload", description: "Approved internal definition", businessQuestion: "How many tasks?",
  decisionUse: "Inspect workload", populationDescription: "Tasks created in the window in their current state", inclusions: ["Native tasks"], exclusions: [],
  authorityMode: "aw_native", valueType: "count", unit: "objects", currency: null, grain: "issue", timeGrain: "window", timezone: "UTC",
  timeSemantics: "created_in_window_current_state", dimensions: [], calculation: { kind: "native_count", population: { entity: "issue", statuses: ["todo"], projectId: null } },
  ownerUserId: "manager-a", reviewFrequencyDays: 30, freshnessSeconds: 60, missingPolicy: "explicit_unknown", goodhartRisk: "Avoid optimizing a count alone",
  purpose: "management_intelligence", sensitivity: "internal", governanceObligationRefs: [companyId], retentionDays: 30 };
const metric = { id: metricId, companyId, key: "workload", status: "published", publishedVersionId: versionId };
const observation = { id: observationId, companyId, metricId, versionId, from: "2026-10-01T00:00:00Z", until: "2026-10-14T00:00:00Z",
  asOf: "2026-10-14T00:00:00Z", expiresAt: "2026-10-14T00:01:00Z", definitionHash: "a".repeat(64), status: "observed", value: 0 };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function transport(change?: (path: string, data: any) => any) {
  return vi.stubGlobal("fetch", vi.fn(async (raw: string, input?: RequestInit) => {
    const url = new URL(raw, "http://local.test");
    expect(url.searchParams.get("expectedUserId")).toBe("manager-a");
    expect(input?.method ?? "GET").toBe("GET");
    expect(input?.signal).toBeTruthy();
    const data = url.pathname.endsWith("/observations") ? { items: [observation], nextCursor: null, coverage: "bounded_current_authorized_page" }
      : url.pathname.endsWith(`/${metricId}`) ? { metric, versions: [{ id: versionId, companyId, metricId, definition, contentHash: "a".repeat(64) }] }
      : { items: [metric], nextCursor: null };
    return new Response(JSON.stringify(change ? change(url.pathname, data) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

describe("Insights reads retained Native metric observations", () => {
  it("uses only current account-bound GETs and preserves an actual observed zero", async () => {
    transport();
    const read = await readInsightMetricObservations(companyId, "manager-a", new AbortController().signal);
    expect(read).toMatchObject({ boundedPage: true, hasMoreMetrics: false, items: [{ metricId, name: definition.name, observations: [{ value: 0, status: "observed" }] }] });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(["foreign_company", "changed_version", "changed_definition_hash", "duplicate_observation", "missing_definition", "invalid_zero", "invalid_window", "negative_native_count", "fractional_native_count"])("refuses %s without exposing private contents", async failure => {
    transport((path, data) => {
      if (path.endsWith("/observations")) {
        if (failure === "foreign_company") data.items[0] = { ...observation, companyId: metricId };
        if (failure === "changed_version") data.items[0] = { ...observation, versionId: observationId };
        if (failure === "changed_definition_hash") data.items[0] = { ...observation, definitionHash: "b".repeat(64) };
        if (failure === "duplicate_observation") data.items = [observation, observation];
        if (failure === "invalid_zero") data.items[0] = { ...observation, value: null };
        if (failure === "invalid_window") data.items[0] = { ...observation, until: observation.from };
        if (failure === "negative_native_count") data.items[0] = { ...observation, value: -1 };
        if (failure === "fractional_native_count") data.items[0] = { ...observation, value: 0.5 };
      } else if (path.endsWith(`/${metricId}`) && failure === "missing_definition") data.versions = [];
      return data;
    });
    await expect(readInsightMetricObservations(companyId, "manager-a", new AbortController().signal)).rejects.toThrow(/^insight_metric_observation_unavailable$/);
  });
  it("detaches an earlier same-account request without cancelling its consumer", async () => {
    let release: ((value: Response) => void) | undefined;
    const mock = vi.fn();
    mock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    vi.stubGlobal("fetch", mock);
    const path = `/companies/${companyId}/business-metrics?expectedUserId=manager-a`;
    const earlier = api.get(path, { cache: "no-store" });
    await vi.waitFor(() => expect(release).toBeTruthy());
    mock.mockImplementation(async () => new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await readInsightMetricObservations(companyId, "manager-a", new AbortController().signal)).toMatchObject({ items: [] });
    expect(mock).toHaveBeenCalledTimes(2);
    release!(new Response(JSON.stringify({ items: [{ ...metric, key: "PRIVATE earlier read" }], nextCursor: null }), { status: 200 }));
    await expect(earlier).resolves.toMatchObject({ items: [{ key: "PRIVATE earlier read" }] });
  });
});
