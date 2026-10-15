import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { readInsightManagementReviewSummaries } from "../api/insight-management-review-summaries";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
export function ExperienceManagementReviews({ companyId, userId, scope }: { companyId: string; userId: string | null; scope: string }) {
  const { t, i18n } = useTranslation("experience");
  const [now, setNow] = useState(Date.now), [revision, setRevision] = useState(0);
  useCompanyLiveEvent(event => { if (event.companyId === companyId && event.type === "activity.logged" && event.payload.entityType === "management_review") setRevision(value => value + 1); });
  const read = useQuery({ queryKey: ["experience-insights-management-review-summaries", companyId, userId, scope, revision], queryFn: ({ signal }) => readInsightManagementReviewSummaries(companyId, userId, signal), gcTime: 0, retry: false, refetchInterval: 30000 });
  useEffect(() => {
    const deadlines = read.data?.items.map(item => Date.parse(item.expiresAt)).filter(value => value > now);
    if (!deadlines?.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, Math.min(...deadlines) - Date.now())));
    return () => clearTimeout(timer);
  }, [read.data, now]);
  // Keep empty families in the destination directory; disclose bounds or errors.
  if (!read.isPending && !read.isFetching && !read.isError && read.data?.items.length === 0 && !read.data.hasMoreReviews) return null;
  const time = (value: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const fact = (value: string | number | boolean | null) => value === null ? t("insightReviews.unknown") : typeof value === "boolean" ? t(value ? "insightReviews.yes" : "insightReviews.no") : typeof value === "number" ? new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 15 }).format(value) : value;
  return <section aria-labelledby="insight-management-review-title" className="space-y-4">
    <h2 id="insight-management-review-title" className="text-lg font-semibold">{t("insightReviews.heading")}</h2><p>{t("insightReviews.boundary")}</p>
    {read.isError ? <div role="alert"><p>{t("insightReviews.unavailable")}</p><button type="button" className="min-h-11 text-primary underline" onClick={() => { void read.refetch(); }}>{t("tryAgain")}</button></div>
      : read.isPending || read.isFetching ? <p role="status">{t("loading")}</p>
      : !read.data?.items.length ? <p role="status">{t("insightReviews.empty")}</p>
      : <ul className="space-y-4">{read.data.items.map(item => <li key={item.id} className="min-w-0 break-words space-y-2 border-b py-4">
        {Date.parse(item.expiresAt) <= Math.max(now, Date.now()) ? <p role="status">{t("insightReviews.expired")}</p> : <>
          <h3 className="font-semibold">{item.name}</h3><p>{t(`insightReviews.type.${item.reviewType}`)}</p>
          <p>{t("insightReviews.period", { from: time(item.packet.period.from), until: time(item.packet.period.until) })}</p>
          <p>{t("insightReviews.asOf", { time: time(item.packet.asOf) })}</p>
          {item.currentQualification !== "current" ? <p role="status">{t("insightReviews.needsReview")}</p> : <>
            <p>{t("insightReviews.agendaBoundary")}</p>
            <ol className="space-y-3">{item.packet.agenda.map(agenda => <li key={agenda.key} className="space-y-1">
              <h4 className="font-semibold">{t(`insightReviews.category.${agenda.category}`)}</h4><p>{agenda.nextAction}</p><p>{t("insightReviews.due", { time: time(agenda.dueAt) })}</p>
              <p>{t("insightReviews.citations", { keys: agenda.sourceKeys.join(", ") })}</p>
              {agenda.hypothesis !== null && <><p>{t("insightReviews.humanHypothesis")}</p><p>{agenda.hypothesis}</p></>}
            </li>)}</ol>
            <details><summary className="min-h-11 cursor-pointer">{t("insightReviews.evidence")}</summary>
              <ul className="space-y-3">{item.packet.claims.map(claim => <li key={claim.key} className="space-y-1">
                <p>{t("insightReviews.citations", { keys: claim.sourceKeys.join(", ") })} · {t(`insightReviews.grade.${claim.grade}`)}</p>
                <dl>{Object.entries(claim.facts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{fact(value)}</dd></div>)}</dl>
                <ul className="list-disc space-y-1 pl-5">{claim.limitations.map((value, index) => <li key={index}>{value}</li>)}</ul>
              </li>)}</ul>
              <ul className="list-disc space-y-1 pl-5">{item.packet.limitations.map((value, index) => <li key={index}>{value}</li>)}</ul>
            </details>
          </>}
        </>}
      </li>)}</ul>}
    {!read.isPending && !read.isFetching && !read.isError && read.data?.hasMoreReviews && <p>{t("insightReviews.more")}</p>}
    <Link to="/management-reviews" className="inline-flex min-h-11 text-primary underline items-center">{t("insightReviews.inspect")}</Link>
  </section>;
}
