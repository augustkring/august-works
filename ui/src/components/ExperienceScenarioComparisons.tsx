import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import type { BusinessScenarioUnit } from "@paperclipai/shared";
import { readInsightScenarioComparisons } from "../api/insight-scenario-comparisons";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";

export function ExperienceScenarioComparisons({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now), [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => {
    if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "business_scenario") setRevision(value => value + 1);
  });
  const read = useQuery({ queryKey: ["experience-insights-scenario-comparisons", companyId, userId, scope, revision],
    queryFn: ({ signal }) => readInsightScenarioComparisons(companyId, userId, signal), gcTime: 0, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    const deadlines = read.data?.items.flatMap(item => [item.expiresAt, ...(item.run ? [item.run.expiresAt] : [])]).map(Date.parse).filter(deadline => deadline > now);
    if (!deadlines?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  const retained = (expiresAt: string) => Date.parse(expiresAt) > Math.max(now, Date.now());
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 15 }).format(value);
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const unit = (value: BusinessScenarioUnit, quantity?: number) => {
    const terms = Object.entries(value).filter(([, power]) => power !== 0);
    if (!terms.length) return t("insightScenarios.units.dimensionless");
    if (terms.length === 1 && terms[0][1] === 1 && !terms[0][0].startsWith("currency_") && quantity !== undefined)
      return t(`insightScenarios.units.${terms[0][0]}`, { count: Math.abs(quantity) });
    const label = ([dimension, power]: [string, number]) => `${dimension.startsWith("currency_") ? dimension.slice(9) : t(`insightScenarios.units.${dimension}`)}${Math.abs(power) === 1 ? "" : `^${Math.abs(power)}`}`;
    const numerator = terms.filter(([, power]) => power > 0).map(label).join(" × ") || "1";
    const denominator = terms.filter(([, power]) => power < 0).map(label).join(" × ");
    return denominator ? `${numerator} / (${denominator})` : numerator;
  };
  return <section aria-labelledby="insight-scenario-comparisons-title" className="space-y-4">
    <h2 id="insight-scenario-comparisons-title" className="text-lg font-semibold">{t("insightScenarios.heading")}</h2>
    <p>{t("insightScenarios.boundary")}</p>
    {read.isError ? <div role="alert"><p>{t("insightScenarios.unavailable")}</p><button type="button" className="min-h-11 text-primary underline" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
      : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
      : !read.data?.items.length ? <p role="status">{t("insightScenarios.empty")}</p>
      : <ul className="space-y-4">{read.data.items.map(item => <li key={item.scenarioId} className="min-w-0 break-words space-y-2 border-b py-4">
        {!retained(item.expiresAt) ? <p role="status">{t("insightScenarios.expired")}</p> : <>
          <h3 className="font-semibold">{item.definition.name}</h3><p>{item.definition.objective}</p><p>{item.definition.decisionUse}</p>
          {item.currentQualification !== "current" || item.run?.currentQualification === "needs_revalidation" ? <p role="status">{t("insightScenarios.needsReview")}</p>
            : !item.run ? <p role="status">{t("insightScenarios.noRun")}</p>
            : !retained(item.run.expiresAt) ? <p role="status">{t("insightScenarios.expired")}</p>
            : item.run.result.status !== "calculated" ? <p role="status">{t(`insightScenarios.status.${item.run.result.status}`)}</p>
            : <>
              <p>{t("insightScenarios.recorded", { time: time(item.run.createdAt) })}</p><p>{t("insightScenarios.nominalOnly")}</p>
              <ul className="space-y-3">{item.run.result.cases.map(scenarioCase => <li key={scenarioCase.key} className="space-y-2">
                <h4 className="font-semibold">{scenarioCase.name} · {t(`insightScenarios.kind.${scenarioCase.kind}`)}</h4>
                <ul className="space-y-2">{item.definition.cases.find(declared => declared.key === scenarioCase.key)!.changes.map((change, index) => <li key={index}>
                  <p>{t(`insightScenarios.changes.${change.kind}`, { name: item.definition.assumptions.find(assumption => assumption.key === change.assumptionKey)!.name, value: number(change.value) })}</p>
                  <p>{change.rationale}</p>
                </li>)}</ul>
                <dl className="space-y-3">{scenarioCase.outputs.slice(0, 3).map(output => <div key={output.key} className="space-y-1">
                  <dt className="font-medium">{item.definition.outputs.find(declared => declared.key === output.key)!.name}</dt>
                  <dd>{t("insightScenarios.value", { value: number(output.nominal), unit: unit(output.unit, output.nominal) })}</dd>
                  <dd>{t("insightScenarios.change", { value: number(output.differenceFromBase), unit: unit(output.unit, output.differenceFromBase) })}</dd>
                  <dd>{t(`insightScenarios.constraint.${output.constraint}`)}</dd>
                </div>)}</dl>
                {scenarioCase.outputs.length > 3 && <p>{t("insightScenarios.moreOutputs")}</p>}
              </li>)}</ul>
              <details><summary className="min-h-11 cursor-pointer">{t("insightScenarios.assumptions")}</summary>
                <ul className="space-y-3">{item.definition.assumptions.map(assumption => <li key={assumption.key} className="space-y-1">
                  <p className="font-medium">{assumption.name}</p><p>{number(assumption.nominal)} {unit(assumption.unit, assumption.nominal)}</p>
                  <p>{t("insightScenarios.range", { minimum: number(assumption.range.minimum), maximum: number(assumption.range.maximum), unit: unit(assumption.unit) })}</p>
                  <p>{t(`insightScenarios.confidence.${assumption.confidence}`)}</p>
                  <p>{assumption.uncertaintyRationale}</p>
                </li>)}</ul>
                <ul className="list-disc space-y-1 pl-5">{[...item.definition.nonModeledEffects, ...item.run.result.limitations].map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
              </details>
            </>}
          {item.hasMoreRuns && <p>{t("insightScenarios.moreRuns")}</p>}
        </>}
      </li>)}</ul>}
    {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreScenarios && <p>{t("insightScenarios.moreScenarios")}</p>}
    <Link to="/business-scenarios" className="inline-flex min-h-11 text-primary underline items-center">{t("insightScenarios.inspect")}</Link>
  </section>;
}
