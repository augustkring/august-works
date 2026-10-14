import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { readInsightForecastResults } from "../api/insight-forecast-results";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
export function ExperienceForecastResults({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now), [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => { if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "forecast_spec") setRevision(value => value + 1); });
  const read = useQuery({ queryKey: ["experience-insights-forecast-results", companyId, userId, scope, revision], queryFn: ({ signal }) => readInsightForecastResults(companyId, userId, signal), gcTime: 0, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    const deadlines = read.data?.items.flatMap(item => [item.expiresAt, ...(item.artifact ? [item.artifact.expiresAt] : [])]).map(Date.parse).filter(value => value > now);
    if (!deadlines?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  const retained = (value: string) => Date.parse(value) > Math.max(now, Date.now());
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 15 }).format(value);
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  return <section aria-labelledby="insight-forecast-results-title" className="space-y-4">
    <h2 id="insight-forecast-results-title" className="text-lg font-semibold">{t("insightForecasts.heading")}</h2><p>{t("insightForecasts.boundary")}</p>
    {read.isError ? <div role="alert"><p>{t("insightForecasts.unavailable")}</p><button type="button" className="min-h-11 text-primary underline" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
      : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
      : !read.data?.items.length ? <p role="status">{t("insightForecasts.empty")}</p>
      : <ul className="space-y-4">{read.data.items.map(item => <li key={item.specId} className="min-w-0 break-words space-y-2 border-b py-4">
        {!retained(item.expiresAt) ? <p role="status">{t("insightForecasts.expired")}</p> : <>
          <h3 className="font-semibold">{item.definition.name}</h3><p>{item.definition.businessQuestion}</p><p>{item.definition.decisionUse}</p>
          {!item.artifact ? <p role="status">{t("insightForecasts.noRun")}</p>
            : !retained(item.artifact.expiresAt) ? <p role="status">{t("insightForecasts.expired")}</p>
            : item.artifact.currentQualification !== "qualified" || item.artifact.result.status !== "qualified" ? <p role="status">{t("insightForecasts.needsReview")}</p>
            : <>
              <p>{t("insightForecasts.cutoff", { time: time(item.artifact.cutoff) })}</p>
              <p>{t("insightForecasts.recorded", { time: time(item.artifact.createdAt) })}</p>
              {item.artifact.result.points.some(point => Date.parse(point.from) < Math.max(Date.parse(item.artifact!.cutoff), Date.parse(item.artifact!.createdAt))) && <p>{t("insightForecasts.pastPeriods")}</p>}
              <p>{t(item.definition.provider === "aw_native" ? "insightForecasts.nativeModel" : "insightForecasts.statisticalModel")}</p>
              <ol className="space-y-3">{item.artifact.result.points.slice(0, 3).map(point => <li key={point.from} className="space-y-1">
                <p>{t("insightForecasts.period", { from: time(point.from), until: time(point.until) })}</p>
                <p className="font-semibold">{t("insightForecasts.value", { value: number(point.value), unit: item.artifact!.result.unit })}</p>
                {point.interval ? <><p>{t("insightForecasts.interval", { level: 95, lower: number(point.interval.lower), upper: number(point.interval.upper), unit: item.artifact!.result.unit })}</p>
                  <p>{t("insightForecasts.interval", { level: 80, lower: number(point.interval.level80.lower), upper: number(point.interval.level80.upper), unit: item.artifact!.result.unit })}</p>
                  <p>{t("insightForecasts.intervalBoundary")}</p></> : <p>{t("insightForecasts.noInterval")}</p>}
              </li>)}</ol>
              {item.artifact.result.points.length > 3 && <p>{t("insightForecasts.morePoints")}</p>}
              <details><summary className="min-h-11 cursor-pointer">{t("insightForecasts.limitations")}</summary><ul className="list-disc space-y-1 pl-5">{[...item.definition.knownFailureModes, ...item.artifact.result.limitations].map((value, index) => <li key={index}>{value}</li>)}</ul></details>
            </>}
          {item.hasMoreRuns && <p>{t("insightForecasts.moreRuns")}</p>}
        </>}
      </li>)}</ul>}
    {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreForecasts && <p>{t("insightForecasts.moreForecasts")}</p>}
    <Link to="/business-forecasts" className="inline-flex min-h-11 text-primary underline items-center">{t("insightForecasts.inspect")}</Link>
  </section>;
}
