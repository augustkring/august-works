import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { announcementsApi } from "../api/announcements";

/** Public publication content; account-scoped queries avoid retaining results across sign-in changes. */
export function CustomerChangelog({ locale, active, scope }: { locale: "en" | "da"; active: boolean; scope: string }) {
  const { t } = useTranslation("experience");
  const query = useQuery({
    queryKey: ["customer-changelog", scope, locale],
    enabled: active,
    queryFn: ({ signal }) => announcementsApi.changelog(locale, signal),
    retry: false, staleTime: 0, gcTime: 0,
  });
  const data = active && !query.isError ? query.data : undefined;
  return <section aria-labelledby="customer-changelog-title" aria-busy={active && query.isFetching}
    className="space-y-3 rounded-lg border border-border p-4">
    <h2 id="customer-changelog-title" className="font-medium">{t("changelog.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("changelog.coverage")}</p>
    {!active ? <p>{t("changelog.signIn")}</p> : query.isError ? <p role="alert">{t("changelog.unavailable")}</p>
      : !data ? <p role="status">{t("changelog.loading")}</p>
      : <>
        {data.state !== "available" && <p role="status">{t(`changelog.${data.state}`)}</p>}
        {data.state === "available" && data.entries.length === 0 && <p>{t("changelog.empty")}</p>}
        {data.entries.map(entry => <article key={entry.id} className="space-y-2 border-t border-border pt-3">
          <h3 className="font-medium">{entry.title}</h3>
          <p className="text-sm text-muted-foreground">{entry.releaseNote.releaseId} · <time dateTime={entry.publishedAt}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entry.publishedAt))}
          </time></p>
          {entry.releaseNote.locale !== locale && <p className="text-sm">{t("changelog.language", { locale: entry.releaseNote.locale })}</p>}
          <p>{entry.description}</p>
          <ul className="list-disc space-y-1 pl-5">{entry.releaseNote.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
          <p><strong>{t("changelog.audience")}</strong> {entry.releaseNote.affectedAudience}</p>
          <p><strong>{t("changelog.action")}</strong> {entry.releaseNote.requiredAction ?? t("changelog.noAction")}</p>
          <ul aria-label={t("changelog.documentation")} className="space-y-1">
            {entry.releaseNote.documentation.map(link => <li key={link.url}><a className="text-primary underline underline-offset-4"
              href={link.url} target="_blank" rel="noreferrer">{link.label}</a></li>)}
          </ul>
          <p><strong>{t("changelog.rollback")}</strong> {entry.releaseNote.rollback ?? t("changelog.notProvided")}</p>
          <p className="font-medium">{t("changelog.limitations")}</p>
          {entry.releaseNote.knownLimitations.length ? <ul className="list-disc space-y-1 pl-5">
            {entry.releaseNote.knownLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
          </ul> : <p>{t("changelog.noneStated")}</p>}
        </article>)}
      </>}
  </section>;
}
