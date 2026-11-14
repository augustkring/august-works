import { useQuery } from "@tanstack/react-query";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import { useTranslation } from "@/i18n";
import { productNoticesApi } from "@/api/product-notices";

export function CapabilityLifecycleNotices({ companyId, enabled }: { companyId: string | null; enabled: boolean }) {
  const { t, i18n } = useTranslation("experience");
  const query = useQuery({
    queryKey: ["capability-lifecycle-notices", companyId],
    queryFn: ({ signal }) => productNoticesApi.capabilityLifecycle(companyId!, signal),
    enabled: Boolean(companyId && enabled),
    retry: false,
    refetchInterval: 60_000,
  });
  const data = query.data;
  if (!companyId || !enabled || query.isError || !data || data.notices.length === 0) return null;
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("da") ? "da-DK" : "en-GB";
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  return <aside aria-label={t("announcement.lifecycle.landmark")} className="space-y-2 border-t bg-background p-2 md:px-3">
    {data.notices.map(notice => <article key={notice.capabilityKey} className="rounded-md border p-3 text-sm">
      <h2 className="font-medium">{t("announcement.lifecycle.title", { name: notice.customerName })}</h2>
      <p className="text-muted-foreground">{t("announcement.lifecycle.deprecationDate", { date: date(notice.deprecationAt) })}</p>
      {notice.sunsetAt && <p className="text-muted-foreground">{t("announcement.lifecycle.sunsetDate", { date: date(notice.sunsetAt) })}</p>}
      <p>{t("announcement.lifecycle.replacement", { capability: notice.replacementCapability })}</p>
      <a className="text-primary underline underline-offset-4" href={`${PRODUCT_IDENTITY.docsOrigin}/${locale === "da-DK" ? "da/" : ""}help/${notice.migrationGuideSlug}`} target="_blank" rel="noreferrer">
        {t("announcement.lifecycle.migrationGuide")}
      </a>
    </article>)}
  </aside>;
}
