import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { readInsightExperimentResults } from "../api/insight-experiment-results";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";

export function ExperienceExperimentResults({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now), [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => { if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "business_experiment") setRevision(value => value + 1); });
  const read = useQuery({ queryKey: ["experience-insights-experiment-results", companyId, userId, scope, revision], queryFn: ({ signal }) => readInsightExperimentResults(companyId, userId, signal), gcTime: 0, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    const deadlines = read.data?.items.map(item => Date.parse(item.expiresAt)).filter(value => value > now);
    if (!deadlines?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value);
  const percent = (value: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 2 }).format(value);
  // Keep empty families in the destination directory; disclose bounds or errors.
  if (!read.isPending && !read.isFetching && !read.isError && read.data?.items.length === 0 && !read.data.hasMoreExperiments) return null;
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  return <section aria-labelledby="insight-experiment-results-title" className="space-y-4">
    <h2 id="insight-experiment-results-title" className="text-lg font-semibold">{t("insightExperiments.heading")}</h2><p>{t("insightExperiments.boundary")}</p>
    {read.isError ? <div role="alert"><p>{t("insightExperiments.unavailable")}</p><button type="button" className="min-h-11 text-primary underline" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
      : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
      : !read.data?.items.length ? <p role="status">{t("insightExperiments.empty")}</p>
      : <ul className="space-y-4">{read.data.items.map(item => {
        const analysis = item.summary.analysis, interpretation = item.summary.interpretation;
        const qualified = item.currentQualification === "current" && item.summary.currentQualification === "current" && analysis?.currentQualification === "current";
        const gates = analysis?.qualityGates;
        const numbers = qualified && analysis?.result.numericallyQualified && analysis.result.status !== "invalid" &&
          analysis.causalAuthority === "conditional_on_registered_randomization_and_human_attestations" && gates?.assignmentReceipts && gates.exposureReports && gates.finalOutcomeCapture === "complete" && gates.identityJoins && gates.baselineBalance && gates.concurrentReviewAdmitted;
        return <li key={item.experimentId} className="min-w-0 break-words space-y-2 border-b py-4">
          {Date.parse(item.expiresAt) <= Math.max(now, Date.now()) ? <p role="status">{t("insightExperiments.expired")}</p> : <>
            <h3 className="font-semibold">{item.definition.name}</h3><p>{item.definition.hypothesis}</p><p>{item.definition.decisionQuestion}</p>
            <p>{t("insightExperiments.period", { from: time(item.definition.sampleOrDurationPlan.from), until: time(item.definition.sampleOrDurationPlan.until) })}</p>
            <p>{t("insightExperiments.provenance")}</p>
            {!analysis ? <p role="status">{t("insightExperiments.noAnalysis")}</p>
              : !qualified ? <p role="status">{t("insightExperiments.needsReview")}</p> : <>
                <p>{t(`insightExperiments.status.${analysis.result.status}`)}</p><p>{t("insightExperiments.analyzed", { time: time(analysis.analyzedAt) })}</p>
                {!numbers ? <p role="status">{t("insightExperiments.withheld")}</p>
                  : <ul className="space-y-3">{analysis.result.metrics.map(metric => <li key={metric.key} className="space-y-1">
                    <h4 className="font-semibold">{[item.definition.primaryMetric, ...item.definition.guardrailMetrics, ...item.definition.secondaryMetrics].find(value => value.key === metric.key)!.name} · {t(`insightExperiments.role.${metric.role}`)}</h4>
                    <p>{t("insightExperiments.control", { successes: number(metric.control.successes), units: number(metric.control.units), rate: percent(metric.control.rate) })}</p>
                    <p>{t("insightExperiments.treatment", { successes: number(metric.treatment.successes), units: number(metric.treatment.units), rate: percent(metric.treatment.rate) })}</p>
                    <p>{t("insightExperiments.effect", { value: number(metric.effect * 100) })}</p>
                    {metric.interval && <p>{t("insightExperiments.interval", { lower: number(metric.interval.lower * 100), upper: number(metric.interval.upper * 100), coverage: percent(metric.interval.familywiseCoverage) })}</p>}
                    <p>{t(`insightExperiments.metricInterpretation.${metric.interpretation}`)}</p>
                  </li>)}</ul>}
                {interpretation && <><p className="font-semibold">{t("insightExperiments.humanConclusion")} · {t(`insightExperiments.conclusion.${interpretation.conclusion}`)}</p><p className="whitespace-pre-wrap">{interpretation.rationale}</p><p>{t("insightExperiments.advisory")}</p></>}
                <details><summary className="min-h-11 cursor-pointer">{t("insightExperiments.limitations")}</summary><ul className="list-disc space-y-1 pl-5">{[item.definition.population.externalValidityLimits, ...analysis.result.limitations].map((value, index) => <li key={index}>{value}</li>)}</ul></details>
              </>}
          </>}
        </li>;
      })}</ul>}
    {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreExperiments && <p>{t("insightExperiments.more")}</p>}
    <Link to="/business-experiments" className="inline-flex min-h-11 text-primary underline items-center">{t("insightExperiments.inspect")}</Link>
  </section>;
}
