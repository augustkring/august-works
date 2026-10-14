import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { readInsightMetricObservations } from "../api/insight-metric-observations";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";

export function ExperienceMetricObservations({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now);
  const [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => {
    if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "business_metric")
      setRevision(previous => previous + 1);
  });
  const read = useQuery({
    queryKey: ["experience-insights-metric-observations", companyId, userId, scope, revision],
    queryFn: ({ signal }) => readInsightMetricObservations(companyId, userId, signal),
    gcTime: 0, retry: false, refetchInterval: 30000,
  });
  useEffect(() => {
    const expires = read.data?.items.flatMap(item => item.observations.map(value => Date.parse(value.expiresAt))).filter(value => value > now);
    if (!expires?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...expires) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  // Keep empty families in the destination directory; disclose bounds or errors.
  if (!read.isPending && !read.isFetching && !read.isError && read.data?.items.length === 0 && !read.data.hasMoreMetrics) return null;
  const time = (value: string, timezone: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  const recorded = read.data?.items.filter(item => item.observations.length > 0) ?? [];
  return (
    <section aria-labelledby="insight-metric-observations-title" className="space-y-4">
      <h2 id="insight-metric-observations-title" className="text-lg font-semibold">{t("insightObservations.heading")}</h2>
      <p>{t("insightObservations.boundary")}</p>
      {read.isError ? <div role="alert"><p>{t("insightObservations.unavailable")}</p><button type="button" className="min-h-11 text-primary underline" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
        : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
        : !read.data?.items.length ? <p role="status">{t("insightObservations.empty")}</p>
        : !recorded.length ? <p role="status">{t("insightObservations.noRecorded")}</p>
        : <ul className="space-y-4">{recorded.map(item => (
          <li key={item.metricId} className="min-w-0 break-words space-y-2 border-b py-4">
            <h3 className="font-semibold">{item.name}</h3>
            <p>{item.definition.businessQuestion}</p>
            <p>{item.definition.populationDescription}</p>
            <p>{t(item.definition.timeSemantics === "created_in_window_current_state" ? "insightObservations.currentState" : "insightObservations.externalSemantics")}</p>
            <p>{t(`insightObservations.authority.${item.definition.authorityMode}`)}</p>
            {!item.observations.length ? <p role="status">{t("insightObservations.noObservation")}</p>
              : <ol className="space-y-3">{item.observations.map(value => {
                const expired = Date.parse(value.expiresAt) <= Math.max(now, Date.now());
                const observed = !expired && value.status === "observed" && value.value !== null;
                return <li key={value.id} className="space-y-1">
                  <p>{t("insightObservations.window", { from: time(value.from, item.definition.timezone), until: time(value.until, item.definition.timezone), timezone: item.definition.timezone })}</p>
                  <p className="font-semibold">{observed ? item.definition.calculation.kind === "native_ratio"
                    ? new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 }).format(value.value!)
                    : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: item.definition.calculation.kind === "native_count" ? 0 : 3 }).format(value.value!)} ${item.definition.calculation.kind === "native_count" ? t(`insightObservations.units.${item.definition.calculation.population.entity}`, { count: value.value! }) : item.definition.unit}`
                    : t(expired ? "insightObservations.expired" : `insightObservations.status.${value.status}`)}</p>
                  <p>{t("insightObservations.asOf", { time: time(value.asOf, item.definition.timezone) })}</p>
                </li>;
              })}</ol>}
            {item.hasMoreObservations && <p>{t("insightObservations.moreObservations")}</p>}
          </li>
        ))}</ul>}
      {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreMetrics && <p>{t("insightObservations.moreMetrics")}</p>}
      <Link to="/business-metrics" className="inline-flex min-h-11 items-center text-primary underline">{t("insightObservations.inspect")}</Link>
    </section>
  );
}
