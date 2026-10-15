import { insightForecastPageSchema, insightForecastDetailSchema, insightForecastRunsSchema, type InsightForecastResultPage } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";
export async function readInsightForecastResults(companyId: string, userId: string | null, signal: AbortSignal): Promise<InsightForecastResultPage> {
  insightForecastDetailSchema.shape.spec.shape.companyId.parse(companyId);
  const base = `/companies/${companyId}/business-forecasts`;
  const current = async (path: string) => {
    signal.throwIfAborted(); const bound = userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
    detachInflightGet(bound); return api.get<unknown>(bound, { signal, cache: "no-store" });
  };
  try {
    const listed = insightForecastPageSchema.parse(await current(base));
    if (listed.items.some(item => item.companyId !== companyId) || new Set(listed.items.map(value => value.id)).size !== listed.items.length) throw new Error();
    const published = listed.items.filter(item => item.status === "published" && item.publishedVersionId);
    const items = await Promise.all(published.slice(0, 3).map(async item => {
      const id = item.id, detail = insightForecastDetailSchema.parse(await current(`${base}/${id}`));
      if (detail.spec.id !== id || detail.spec.companyId !== companyId || detail.spec.revision !== item.revision || detail.spec.status !== "published" || detail.spec.publishedVersionId !== item.publishedVersionId ||
        detail.versions.some(value => value.companyId !== companyId || value.specId !== id) || new Set(detail.versions.map(value => value.id)).size !== detail.versions.length) throw new Error();
      const pin = detail.versions.find(value => value.id === item.publishedVersionId);
      if (!pin) throw new Error();
      const history = insightForecastRunsSchema.parse(await current(`${base}/${id}/runs`));
      if (history.items.some(value => value.companyId !== companyId || value.specId !== id) || new Set(history.items.map(value => value.id)).size !== history.items.length) throw new Error();
      const artifact = history.items.find(value => value.versionId === pin.id) ?? null;
      if (artifact) {
        const result = artifact.result;
        if (result.definitionHash !== pin.contentHash || result.status === "qualified" && (result.points.length !== pin.definition.horizon || result.unit === null) ||
          result.points.some((value, index, values) => Date.parse(value.until) - Date.parse(value.from) !== (pin.definition.frequency === "daily_utc" ? 1 : 7) * 86400000 || index > 0 && value.from !== values[index - 1].until)) throw new Error();
        if (pin.definition.provider === "aw_native" ? result.engineVersion !== "aw-native-business-forecast-v1" || result.providerProvenance !== undefined || result.points.some(value => value.interval !== null) || result.uncertainty.method !== "unavailable"
          : result.engineVersion !== "aw-statsforecast-business-forecast-v1" || JSON.stringify(result.providerProvenance) !== JSON.stringify(pin.definition.providerProfile)) throw new Error();
        if (result.points.some(value => value.interval !== null && (result.uncertainty.method !== "statsforecast_model" || result.uncertainty.coverageLevel !== 0.95))) throw new Error();
      }
      signal.throwIfAborted(); return { specId: id, definition: pin.definition, expiresAt: pin.expiresAt, artifact, hasMoreRuns: history.nextCursor !== null || history.items.length > (artifact ? 1 : 0) };
    }));
    signal.throwIfAborted(); return { items, hasMoreForecasts: listed.nextCursor !== null || published.length > 3, boundedPage: true };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error && typeof error === "object" && "status" in error) throw error;
    throw new Error("insight_forecast_results_unavailable");
  }
}
