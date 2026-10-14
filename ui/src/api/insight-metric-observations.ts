import { insightMetricPageSchema, insightMetricDetailSchema, insightMetricObservationsSchema, type InsightMetricObservationPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

/** Read existing Native owners only. No metric query/calculation/publication,
 * model call, observation receipt or result store is created by visiting Insights. */
export async function readInsightMetricObservations(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightMetricObservationPage> {
  insightMetricDetailSchema.shape.metric.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/business-metrics`;
  const current = async (path: string) => {
    signal.throwIfAborted();
    const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound);
    return api.get<unknown>(bound, { signal, cache: "no-store" });
  };
  try {
    const listed = insightMetricPageSchema.parse(await current(base));
    if (listed.items.some(item => item.companyId !== companyId) || new Set(listed.items.map(item => item.id)).size !== listed.items.length) throw new Error();
    const candidates = listed.items.filter(item => item.status === "published" && item.publishedVersionId).slice(0, 3);
    const items = await Promise.all(candidates.map(async item => {
      const [defined, recorded] = await Promise.all([
        current(`${base}/${item.id}`).then(value => insightMetricDetailSchema.parse(value)),
        current(`${base}/${item.id}/observations`).then(value => insightMetricObservationsSchema.parse(value)),
      ]);
      if (defined.metric.companyId !== companyId || defined.metric.id !== item.id ||
        defined.metric.status !== "published" || defined.metric.publishedVersionId !== item.publishedVersionId ||
        defined.versions.some(value => value.companyId !== companyId || value.metricId !== item.id) ||
        recorded.items.some(value => value.companyId !== companyId || value.metricId !== item.id || value.versionId !== item.publishedVersionId) ||
        new Set(recorded.items.map(value => value.id)).size !== recorded.items.length) throw new Error();
      const selected = defined.versions.find(value => value.id === item.publishedVersionId);
      if (!selected || new Set(defined.versions.map(value => value.id)).size !== defined.versions.length ||
        recorded.items.some(value => value.definitionHash !== selected.contentHash)) throw new Error();
      if (recorded.items.some(value => value.status === "observed" && (
        selected.definition.calculation.kind === "native_count" && (!Number.isSafeInteger(value.value) || value.value! < 0) ||
        selected.definition.calculation.kind === "native_ratio" && (value.value! < 0 || value.value! > 1)))) throw new Error();
      signal.throwIfAborted();
      return { metricId: item.id, name: selected.definition.name, definition: selected.definition,
        observations: recorded.items.slice(0, 3), hasMoreObservations: recorded.nextCursor !== null || recorded.items.length > 3 };
    }));
    signal.throwIfAborted();
    return { items, boundedPage: true, hasMoreMetrics: listed.nextCursor !== null || listed.items.filter(item => item.status === "published").length > 3 };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    // Titles, metric definitions and Source errors are private business data.
    // Preserve authentication/status failures for the existing safe recovery UI.
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_metric_observation_unavailable");
  }
}
