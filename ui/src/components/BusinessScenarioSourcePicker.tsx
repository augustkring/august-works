import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { sameBusinessScenarioUnit, type BusinessScenarioDefinition, type BusinessScenarioUnit } from "@paperclipai/shared";
import { businessMetricsApi } from "@/api/business-metrics";
import { businessForecastingApi } from "@/api/business-forecasting";
import { scenarioUnitLabel } from "./BusinessScenarioResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Source = BusinessScenarioDefinition["inputs"][number];
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
/** The picker supplies identity/version pins and an inferred native unit only.
 * Numerical facts remain owned and captured by the server's canonical owners. */
export function BusinessScenarioSourcePicker({ companyId, userId, value, onChange, onValidityChange }: {
  companyId: string; userId: string | null; value: Source; onChange: (value: Source) => void; onValidityChange: (valid: boolean) => void;
}) {
  const [ownerId, setOwnerId] = useState(value.kind === "metric_observation" ? value.metricId : value.specId);
  const [runId, setRunId] = useState(value.kind === "forecast_point" ? value.runId : "");
  const [now, setNow] = useState(Date.now());
  const account = userId ?? undefined, key = ["scenario-source", companyId, userId], metricKind = value.kind === "metric_observation";
  const metrics = useInfiniteQuery({ queryKey: [...key, "metrics"], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessMetricsApi.list(companyId, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, enabled: metricKind, refetchInterval: 30000 });
  const metric = useQuery({ queryKey: [...key, "metric", ownerId], queryFn: () => businessMetricsApi.detail(companyId, ownerId, account), enabled: metricKind && !!ownerId, refetchInterval: 30000 });
  const observations = useInfiniteQuery({ queryKey: [...key, "observations", ownerId], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessMetricsApi.observations(companyId, ownerId, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, enabled: metricKind && !!ownerId, refetchInterval: 30000 });
  const forecasts = useInfiniteQuery({ queryKey: [...key, "forecasts"], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessForecastingApi.list(companyId, pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !metricKind, refetchInterval: 30000 });
  const forecast = useQuery({ queryKey: [...key, "forecast", ownerId], queryFn: () => businessForecastingApi.detail(companyId, ownerId, account), enabled: !metricKind && !!ownerId, refetchInterval: 30000 });
  const runs = useInfiniteQuery({ queryKey: [...key, "runs", ownerId], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessForecastingApi.artifacts(companyId, ownerId, "run", pageParam, account), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !metricKind && !!ownerId, refetchInterval: 30000 });
  const run = useQuery({ queryKey: [...key, "run", ownerId, runId], queryFn: () => businessForecastingApi.artifact(companyId, ownerId, runId, "run", account), enabled: !metricKind && !!ownerId && !!runId, refetchInterval: 30000 });
  const forecastMetricId = forecast.data?.versions.find(item => item.id === run.data?.versionId)?.definition.metricId ?? "";
  const forecastMetric = useQuery({ queryKey: [...key, "metric", forecastMetricId], queryFn: () => businessMetricsApi.detail(companyId, forecastMetricId, account), enabled: !metricKind && !!forecastMetricId, refetchInterval: 30000 });
  const queries = metricKind ? [metrics, ...(ownerId ? [metric, observations] : [])] : [forecasts, ...(ownerId ? [forecast, runs] : []), ...(runId ? [run] : []), ...(forecastMetricId ? [forecastMetric] : [])];
  const unavailable = queries.some(query => query.isFetching || query.isError || query.isPending);
  const retained = (expiry: string) => Date.parse(expiry) > Math.max(now, Date.now());
  const metricPin = metricKind ? metric.data?.versions.find(item => item.id === metric.data?.metric.publishedVersionId) : forecastMetric.data?.versions.find(item => item.id === forecast.data?.versions.find(version => version.id === run.data?.versionId)?.definition.metricVersionId);
  const unit: BusinessScenarioUnit = metricPin?.definition.calculation.kind === "native_count" ? { [metricPin.definition.grain]: 1 } : {};
  const observationRows = !unavailable ? observations.data?.pages.flatMap(page => page.items).filter(item => item.companyId === companyId && item.metricId === ownerId && item.versionId === metricPin?.id && item.status === "observed" && item.value !== null && retained(item.expiresAt)) ?? [] : [];
  const runRows = !unavailable ? runs.data?.pages.flatMap(page => page.items).filter(item => item.companyId === companyId && item.specId === ownerId && item.currentQualification === "qualified" && retained(item.expiresAt)) ?? [] : [];
  const activeRun = !unavailable && run.data?.companyId === companyId && run.data.specId === ownerId && run.data.currentQualification === "qualified" && retained(run.data.expiresAt) ? run.data : undefined;
  const nativeMetric = !!metricPin && metricPin.companyId === companyId && metricPin.definition.authorityMode === "aw_native" && ["native_count", "native_ratio"].includes(metricPin.definition.calculation.kind);
  const valid = !unavailable && nativeMetric && sameBusinessScenarioUnit(value.unit, unit) && (metricKind
    ? value.kind === "metric_observation" && metric.data?.metric.companyId === companyId && metric.data.metric.status === "published" && value.metricId === ownerId && value.metricVersionId === metricPin!.id && observationRows.some(item => item.id === value.observationId)
    : value.kind === "forecast_point" && !!activeRun && value.specId === ownerId && value.runId === activeRun.id && value.versionId === activeRun.versionId && !!activeRun.result.points[value.pointIndex]);
  useEffect(() => { onValidityChange(valid); }, [valid, onValidityChange]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return <fieldset className="min-w-0 space-y-3 rounded-md border p-3"><legend className="px-1 font-medium">Native source · {value.key}</legend>
    <label className="block space-y-2">Source name<Input aria-label={`Source name ${value.key}`} value={value.key} onChange={event => onChange({ ...value, key: event.target.value })} maxLength={64} required /></label>
    <label className="block space-y-2">Source kind<select aria-label={`Source kind ${value.key}`} className={selectStyle} value={value.kind} onChange={event => { setOwnerId(""); setRunId(""); onChange(event.target.value === "metric_observation" ? { kind: "metric_observation", key: value.key, metricId: "", metricVersionId: "", observationId: "", unit: {} } : { kind: "forecast_point", key: value.key, specId: "", versionId: "", runId: "", pointIndex: 0, unit: {} }); }}><option value="metric_observation">Native metric observation</option><option value="forecast_point">Qualified native forecast point</option></select></label>
    <label className="block space-y-2">{metricKind ? "Published metric" : "Published forecast"}<select aria-label={`Published ${metricKind ? "metric" : "forecast"} ${value.key}`} className={selectStyle} value={ownerId} onChange={event => { setOwnerId(event.target.value); setRunId(""); onValidityChange(false); }}><option value="">Choose a native definition</option>{!unavailable && (metricKind ? metrics.data?.pages.flatMap(page => page.items).filter(item => item.companyId === companyId && item.status === "published").map(item => <option key={item.id} value={item.id}>{item.key}</option>) : forecasts.data?.pages.flatMap(page => page.items).filter(item => item.companyId === companyId && item.status === "published").map(item => <option key={item.id} value={item.id}>{item.key}</option>))}</select></label>
    {(metricKind ? metrics.hasNextPage : forecasts.hasNextPage) && <Button type="button" variant="outline" disabled={unavailable} onClick={() => void (metricKind ? metrics : forecasts).fetchNextPage()}>Load more source definitions</Button>}
    {metricKind && ownerId && <label className="block space-y-2">Observed window<select aria-label={`Observed window ${value.key}`} className={selectStyle} value={value.kind === "metric_observation" && valid ? value.observationId : ""} onChange={event => { const selected = observationRows.find(item => item.id === event.target.value); if (selected) onChange({ kind: "metric_observation", key: value.key, metricId: selected.metricId, metricVersionId: selected.versionId, observationId: selected.id, unit }); }}><option value="">Choose a current authorized observation</option>{observationRows.map(item => <option key={item.id} value={item.id}>{item.from.slice(0, 10)} to {item.until.slice(0, 10)} · observed {new Date(item.asOf).toLocaleString()}</option>)}</select></label>}
    {metricKind && observations.hasNextPage && <Button type="button" variant="outline" disabled={unavailable} onClick={() => void observations.fetchNextPage()}>Load more source observations</Button>}
    {!metricKind && ownerId && <label className="block space-y-2">Qualified forecast run<select aria-label={`Qualified forecast run ${value.key}`} className={selectStyle} value={runId} onChange={event => { setRunId(event.target.value); onValidityChange(false); }}><option value="">Choose retained qualified forecast evidence</option>{runRows.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.result.status}</option>)}</select></label>}
    {!metricKind && runs.hasNextPage && <Button type="button" variant="outline" disabled={unavailable} onClick={() => void runs.fetchNextPage()}>Load more source forecast runs</Button>}
    {!metricKind && activeRun && <label className="block space-y-2">Forecast period<select aria-label={`Forecast period ${value.key}`} className={selectStyle} value={value.kind === "forecast_point" && valid ? String(value.pointIndex) : ""} onChange={event => { const index = Number(event.target.value); if (event.target.value !== "" && activeRun.result.points[index]) onChange({ kind: "forecast_point", key: value.key, specId: activeRun.specId, versionId: activeRun.versionId, runId: activeRun.id, pointIndex: index, unit }); }}><option value="">Choose an exact future period</option>{activeRun.result.points.map((point, index) => <option key={point.from} value={index}>{point.from.slice(0, 10)} to {point.until.slice(0, 10)}</option>)}</select></label>}
    {valid && <p className="text-sm">Native unit: {scenarioUnitLabel(unit)}. Source facts will be captured by their native owner when the proposal is saved.</p>}
    {unavailable && <p role="status">Rechecking current source authority…</p>}{queries.some(query => query.isError) && <p role="alert">Current source authority could not be verified.</p>}
    {!valid && !unavailable && <p className="text-sm text-muted-foreground">Review the exact source pin on these bounded authorized pages before saving. An empty page does not establish missing evidence.</p>}
  </fieldset>;
}
