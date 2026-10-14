import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { readInsightProcessFindings } from "../api/insight-process-findings";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";

export function ExperienceProcessFindings({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now), [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => {
    if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "process_analysis_definition") setRevision(value => value + 1);
  });
  const read = useQuery({ queryKey: ["experience-insights-process-findings", companyId, userId, scope, revision],
    queryFn: ({ signal }) => readInsightProcessFindings(companyId, userId, signal), gcTime: 0, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    const deadlines = read.data?.items.flatMap(item => [item.expiresAt, ...(item.run ? [item.run.expiresAt] : []), ...item.findings.map(finding => finding.expiresAt)])
      .map(Date.parse).filter(deadline => deadline > now);
    if (!deadlines?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  const retained = (expiresAt: string) => Date.parse(expiresAt) > Math.max(now, Date.now());
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  return <section aria-labelledby="insight-process-findings-title" className="space-y-4">
    <h2 id="insight-process-findings-title" className="text-lg font-semibold">{t("insightProcess.heading")}</h2>
    <p>{t("insightProcess.boundary")}</p>
    {read.isError ? <div role="alert"><p>{t("insightProcess.unavailable")}</p><button className="min-h-11 text-primary underline" type="button" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
      : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
      : !read.data?.items.length ? <p role="status">{t("insightProcess.empty")}</p>
      : <ul className="space-y-4">{read.data.items.map(item => <li key={item.definitionId} className="min-w-0 break-words space-y-2 border-b py-4">
        {!retained(item.expiresAt) ? <p role="status">{t("insightProcess.expired")}</p> : <>
          <h3 className="font-semibold">{item.name}</h3><p>{item.businessQuestion}</p>
          {!item.run ? <p role="status">{t("insightProcess.noRun")}</p>
            : !retained(item.run.expiresAt) ? <p role="status">{t("insightProcess.expired")}</p>
            : <><p>{t("insightProcess.window", { from: time(item.run.from), until: time(item.run.until) })}</p>
              <p>{t("insightProcess.recorded", { time: time(item.run.createdAt) })}</p>
              {!item.findings.length ? <p role="status">{t("insightProcess.noFinding")}</p>
                : <ul className="space-y-4">{item.findings.map(finding => <li key={finding.id} className="space-y-2">
                  {!retained(finding.expiresAt) ? <p role="status">{t("insightProcess.expired")}</p> : <>
                    <h4 className="font-semibold">{finding.summary}</h4>
                    <p>{t(`insightProcess.status.${finding.status}`)} · {t(`insightProcess.severity.${finding.severity}`)}</p>
                    <p>{t("insightProcess.interpretation")}</p><p className="whitespace-pre-wrap">{finding.interpretation}</p>
                    <details><summary className="cursor-pointer min-h-11">{t("insightProcess.evidence")}</summary>
                      <dl className="space-y-2">{Object.entries(finding.facts.observed).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null ? t("insightProcess.unknown") : typeof value === "number" ? new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 15 }).format(value) : value}</dd></div>)}</dl>
                      <ul className="list-disc space-y-1 pl-5">{finding.facts.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
                    </details>
                  </>}
                </li>)}</ul>}
            </>}
          {item.hasMoreEvidence && <p>{t("insightProcess.moreEvidence")}</p>}
        </>}
      </li>)}</ul>}
    {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreDefinitions && <p>{t("insightProcess.moreDefinitions")}</p>}
    <Link to="/process-intelligence" className="inline-flex min-h-11 text-primary underline items-center">{t("insightProcess.inspect")}</Link>
  </section>;
}
