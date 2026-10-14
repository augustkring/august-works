import { afterEach, expect, it, vi } from "vitest";
import { readInsightForecastResults } from "./insight-forecast-results";
const companyId = "10000000-0000-4000-8000-000000000001", specId = "10000000-0000-4000-8000-000000000002", versionId = "10000000-0000-4000-8000-000000000003", artifactId = "10000000-0000-4000-8000-000000000004";
const definition = { name: "PRIVATE recorded estimate", businessQuestion: "What does the declared model estimate?", decisionUse: "Inform a review without approving a decision", ownerUserId: "manager-a", metricId: companyId, metricVersionId: versionId,
  scope: { type: "company", id: null }, frequency: "daily_utc", horizon: 2, provider: "aw_native", candidate: { kind: "moving_average", window: 2 }, baselines: [{ kind: "naive" }], minimumHistory: 7, captureLatencySeconds: 3600,
  backtest: { minimumTrainingPoints: 2, minimumOrigins: 3, gapPeriods: 1, maximumMAE: 100, minimumRelativeMAEImprovement: 0 }, knownFailureModes: ["Changes outside the observed history are not modeled"], sensitivity: "internal", purpose: "management_intelligence", governanceObligationRefs: [companyId], retentionDays: 30 };
const spec = { id: specId, companyId, revision: 2, status: "published", publishedVersionId: versionId };
const version = { id: versionId, companyId, specId, definition, contentHash: "a".repeat(64), expiresAt: "2026-11-01T00:00:00Z" };
const artifact = { id: artifactId, companyId, specId, versionId, kind: "run", cutoff: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T01:00:00Z", expiresAt: version.expiresAt, currentQualification: "qualified",
  result: { engineVersion: "aw-native-business-forecast-v1", status: "qualified", definitionHash: version.contentHash, inputHash: "b".repeat(64), unit: "objects",
    points: [{ from: "2026-10-01T00:00:00Z", until: "2026-10-02T00:00:00Z", value: 0, interval: null }, { from: "2026-10-02T00:00:00Z", until: "2026-10-03T00:00:00Z", value: 2.5, interval: null }],
    uncertainty: { method: "unavailable", coverageLevel: null, reason: "Native baselines supply no prediction interval" }, limitations: ["No future predictive accuracy is established"] } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function transport(change?: (path: string, data: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (raw: string, input: RequestInit) => {
    const url = new URL(raw, "http://local.test"); expect(url.searchParams.get("expectedUserId")).toBe("manager-a"); expect(input.method ?? "GET").toBe("GET"); expect(input.signal).toBeTruthy();
    const data = url.pathname.endsWith("/runs") ? { items: [artifact], nextCursor: null, coverage: "bounded_current_authorized_page" }
      : url.pathname.endsWith(`/${specId}`) ? { spec, versions: [version] } : { items: [spec], nextCursor: null, coverage: "bounded_current_authorized_page" };
    return new Response(JSON.stringify(change ? change(url.pathname, structuredClone(data)) : data), { status: 200, headers: { "content-type": "application/json" } });
  }));
}
it("reads retained forecast outputs only and preserves zero and unavailable uncertainty", async () => {
  transport(); const read = await readInsightForecastResults(companyId, "manager-a", new AbortController().signal);
  expect(read.items[0].artifact?.result.points[0]).toMatchObject({ value: 0, interval: null }); expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["foreign_company", "changed_publication", "wrong_hash", "wrong_kind", "duplicate_run", "missing_horizon", "broken_window", "invented_interval", "wrong_engine"])("refuses %s without private excerpts", async failure => {
  transport((path, data) => {
    if (path.endsWith(`/${specId}`) && failure === "changed_publication") data.spec.publishedVersionId = artifactId;
    if (path.endsWith("/runs")) {
      if (failure === "foreign_company") data.items[0].companyId = artifactId;
      if (failure === "wrong_hash") data.items[0].result.definitionHash = "c".repeat(64);
      if (failure === "wrong_kind") data.items[0].kind = "backtest";
      if (failure === "duplicate_run") data.items.push(data.items[0]);
      if (failure === "missing_horizon") data.items[0].result.points.pop();
      if (failure === "broken_window") data.items[0].result.points[1].from = "2026-10-02T01:00:00Z";
      if (failure === "invented_interval") data.items[0].result.points[0].interval = { method: "statsforecast_model", level: 0.95, lower: -1, upper: 1, level80: { lower: -0.5, upper: 0.5 } };
      if (failure === "wrong_engine") data.items[0].result.engineVersion = "aw-statsforecast-business-forecast-v1";
    }
    return data;
  });
  await expect(readInsightForecastResults(companyId, "manager-a", new AbortController().signal)).rejects.toThrow("insight_forecast_results_unavailable");
});
