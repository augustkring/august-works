import { useQuery } from "@tanstack/react-query";
import { PRODUCT_IDENTITY, serviceHealthProjectionSchema } from "@paperclipai/shared";
import { useTranslation } from "react-i18next";

/** Public provider communication, shared across companies. No tenant context
 * is sent to the status provider and this projection never decides authority. */
export function ServiceHealth({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation("experience");
  const query = useQuery({
    queryKey: ["public-service-health-v1"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/service-status", { signal, cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Service status unavailable");
      return serviceHealthProjectionSchema.parse(await response.json());
    },
    staleTime: 15_000, refetchInterval: 60_000, retry: false,
  });
  const data = query.isError ? undefined : query.data;
  const current = data?.state === "current" ? data : null;
  const incidents = current?.incidents.filter(item => !["resolved", "postmortem"].includes(item.status)) ?? [];
  const maintenance = current?.scheduledMaintenance.filter(item => item.status !== "completed") ?? [];
  const impaired = current?.components.some(item => item.status !== "operational") ?? false;
  const issueReported = !!current && (current.indicator !== "none" && current.indicator !== "maintenance" ||
    current.components.some(item => ["degraded_performance", "partial_outage", "major_outage"].includes(item.status)) || incidents.length > 0);
  const active = !!current && (current.indicator !== "none" || impaired || incidents.length > 0 || maintenance.length > 0);
  const accountImpactUnknown = current?.customerImpact === "unknown" && issueReported;
  const statusUrl = data?.statusUrl ?? PRODUCT_IDENTITY.statusOrigin;
  if (compact) return active ? <aside aria-label={t("serviceStatus.title")} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-2 text-sm">
    <span>{t("serviceStatus.active")}</span>
    {accountImpactUnknown && <span>{t("serviceStatus.accountImpactUnknown")}</span>}
    <a href={statusUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">{t("serviceStatus.view")}</a>
  </aside> : null;

  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("da") ? "da-DK" : "en-GB";
  function timestamp(value: string) { return new Date(value).toLocaleString(locale); }
  return <section aria-labelledby="public-service-health-title" className="space-y-3 rounded-lg border border-border p-4">
    <h2 id="public-service-health-title" className="font-medium">{t("serviceStatus.title")}</h2>
    <p className="text-sm text-muted-foreground">{current ? t(active ? "serviceStatus.active" : "serviceStatus.noIncident")
      : query.isPending ? t("serviceStatus.loading") : t("serviceStatus.unavailable")}</p>
    {accountImpactUnknown && <p className="text-sm text-muted-foreground">{t("serviceStatus.accountImpactUnknown")}</p>}
    {current && <>
      <ul className="space-y-1 text-sm">{current.components.map(component => <li key={component.id}>
        {component.name}: {t(`serviceStatus.states.${component.status}`)}
      </li>)}</ul>
      {[...current.incidents, ...current.scheduledMaintenance].length > 0 && <ul className="space-y-3 text-sm">
        {[...current.incidents, ...current.scheduledMaintenance].map(item => <li key={item.id} className="space-y-1">
          <a className="font-medium underline underline-offset-4" href={item.href} target="_blank" rel="noreferrer">{item.name}</a>
          <p>{t(`serviceStatus.states.${item.status}`)}</p>
          {item.scheduledFor && <p>{t("serviceStatus.starts", { value: timestamp(item.scheduledFor) })}</p>}
          {item.scheduledUntil && <p>{t("serviceStatus.ends", { value: timestamp(item.scheduledUntil) })}</p>}
          <p className="text-muted-foreground">{t("serviceStatus.updated", { value: timestamp(item.updatedAt) })}</p>
        </li>)}
      </ul>}
      <p className="text-xs text-muted-foreground">{t("serviceStatus.checked", { value: timestamp(current.observedAt) })}</p>
    </>}
    <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <a className="underline underline-offset-4" href={statusUrl} target="_blank" rel="noreferrer">{t("serviceStatus.view")}</a>
      <a className="underline underline-offset-4" href={statusUrl} target="_blank" rel="noreferrer">{t("serviceStatus.subscribe")}</a>
      <a className="underline underline-offset-4" href={`${statusUrl}/history`} target="_blank" rel="noreferrer">{t("serviceStatus.history")}</a>
    </p>
  </section>;
}
