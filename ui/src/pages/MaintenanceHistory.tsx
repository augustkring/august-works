import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "../lib/router";
import { useAccountIdentity } from "../api/companies-query";
import { maintenanceHistoryApi } from "../api/maintenance-history";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";

export function MaintenanceHistoryEntry() {
  const feature = useV9FeatureEnabled("maintenance_autopilot_v9"),
    identity = useAccountIdentity(),
    { selectedCompanyId } = useCompany(),
    { installationId } = useParams(),
    { t } = useTranslation("experience");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  if (feature.query.isError || identity.failed)
    return <p role="alert">{t("maintenanceHistoryUnavailable")}</p>;
  if (feature.query.isPending || !identity.settled)
    return <p role="status">{t("loading")}</p>;
  if (!feature.enabled || !principal || !installationId)
    return <p role="alert">{t("maintenanceHistoryUnavailable")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  return (
    <MaintenanceHistory
      key={`${selectedCompanyId}:${principal}:${installationId}`}
      company={selectedCompanyId}
      principal={principal}
      installationId={installationId}
    />
  );
}
export function MaintenanceHistory({
  company,
  principal,
  installationId,
}: {
  company: string;
  principal: string;
  installationId: string;
}) {
  const { t } = useTranslation("experience"),
    client = useQueryClient();
  const [epoch, setEpoch] = useState(0),
    heading = useRef<HTMLHeadingElement>(null),
    alert = useRef<HTMLDivElement>(null),
    focused = useRef(false);
  const main = useRef<HTMLElement>(null),
    restoreHref = useRef<string | null>(null);
  const prefix = ["maintenance-history", company, principal, installationId];
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: ({ signal }) =>
      maintenanceHistoryApi.get(company, principal, installationId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    setEpoch((old) => old + 1);
  });
  const current = query.isSuccess && !query.isFetching;
  if (
    !current &&
    !query.isError &&
    main.current?.contains(document.activeElement)
  )
    restoreHref.current = document.activeElement?.getAttribute("href") ?? null;
  useEffect(() => {
    if (
      current &&
      restoreHref.current &&
      document.activeElement === document.body
    ) {
      Array.from(main.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])
        .find((link) => link.getAttribute("href") === restoreHref.current)
        ?.focus();
      restoreHref.current = null;
    }
    if (
      current &&
      !focused.current &&
      !document.activeElement?.closest('[role="dialog"]')
    ) {
      heading.current?.focus();
      focused.current = true;
    }
  }, [current]);
  useEffect(() => {
    if (query.isError && !document.activeElement?.closest('[role="dialog"]'))
      alert.current?.focus();
  }, [query.isError]);
  if (query.isError)
    return (
      <div ref={alert} role="alert" tabIndex={-1} className="space-y-4">
        <p>{t("maintenanceHistoryUnavailable")}</p>
        <Button className="min-h-11" onClick={() => void query.refetch()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (!current) return <p role="status">{t("loading")}</p>;
  const view = query.data!;
  return (
    <section ref={main} className="space-y-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("maintenanceHistoryTitle")}
      </h1>
      <p className="text-muted-foreground">{t("maintenanceHistoryBoundary")}</p>
      <section
        aria-label={t("maintenanceHistoryCurrent")}
        className="space-y-2 rounded-lg border border-border p-4"
      >
        <h2 className="text-lg font-medium">
          {t("maintenanceHistoryCurrent")}
        </h2>
        <p>{t(`maintenanceInstallationStatus.${view.installationStatus}`)}</p>
        <p>
          {t("maintenanceHistoryVersion", {
            version: view.installationVersion,
          })}
        </p>
        <p>
          {t("maintenanceHistoryObserved")}{" "}
          <time dateTime={view.observedAt}>
            {new Date(view.observedAt).toLocaleString()}
          </time>
        </p>
      </section>
      {!view.entries.length && <p>{t("maintenanceHistoryEmpty")}</p>}
      <ul className="space-y-2">
        {view.entries.map((entry) => (
          <li
            key={entry.receiptId}
            className="space-y-2 rounded-lg border border-border p-4"
          >
            <p>
              {t(
                entry.outcome === "configured_activation_required"
                  ? "maintenanceHistoryConfigured"
                  : "maintenanceHistoryReview",
              )}
            </p>
            <time dateTime={entry.recordedAt}>
              {new Date(entry.recordedAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
      {view.hasMore && <p>{t("maintenanceHistoryBounded")}</p>}
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/packages"
      >
        {t("maintenanceHistoryBack")}
      </Link>
    </section>
  );
}
