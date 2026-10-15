import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "../lib/router";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { maintenanceHistoryApi } from "../api/maintenance-history";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";

export function MaintenanceHistoryEntry() {
  const feature = useV9FeatureEnabled("maintenance_autopilot_v9"),
    identity = useV9CurrentAccount(),
    { selectedCompanyId } = useCompany(),
    { installationId } = useParams(),
    { t } = useTranslation("experience");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const authority = useV9PrivateReadAuthority(principal ?? "", identity.localImplicit);
  if (feature.query.isError || identity.failed)
    return <div role="alert" className="space-y-4">
      <p>{t("maintenanceHistoryUnavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking || feature.query.isFetching}
        onClick={() => {
          if (identity.failed) void authority.recheck().catch(() => {});
          else void feature.query.refetch();
        }}>{t("tryAgain")}</Button>
    </div>;
  if (feature.query.isPending || feature.query.isFetching || !identity.settled)
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
  const authority = useV9PrivateReadAuthority(principal, principal === "local-board");
  const [epoch, setEpoch] = useState(0),
    heading = useRef<HTMLHeadingElement>(null),
    alert = useRef<HTMLDivElement>(null),
    focused = useRef(false);
  const main = useRef<HTMLElement>(null),
    restoreFocus = useRef<{ heading: true } | { href: string } | null>(null);
  const prefix = ["maintenance-history", company, principal, installationId];
  const query = useQuery({
    queryKey: [...prefix, authority.epoch, epoch],
    queryFn: ({ signal }) =>
      authority.read(() => maintenanceHistoryApi.get(company, principal, installationId, signal)),
    enabled: authority.readReady,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15000 : false,
    refetchIntervalInBackground: false,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    setEpoch((old) => old + 1);
  });
  const current = authority.readReady && query.isSuccess && !query.isFetching;
  if (
    !current &&
    !query.isError &&
    main.current?.contains(document.activeElement)
  ) {
    const href = document.activeElement?.getAttribute("href");
    restoreFocus.current =
      document.activeElement === heading.current
        ? { heading: true }
        : href
          ? { href }
          : null;
  }
  useEffect(() => {
    if (!current) return;
    if (document.activeElement?.closest('[role="dialog"]')) {
      focused.current = true;
      restoreFocus.current = null;
      return;
    }
    const previous = restoreFocus.current;
    restoreFocus.current = null;
    if (previous && document.activeElement === document.body) {
      if ("heading" in previous) heading.current?.focus();
      else
        Array.from(main.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])
          .find((link) => link.getAttribute("href") === previous.href)
          ?.focus();
    }
    if (!focused.current) {
      heading.current?.focus();
      focused.current = true;
    }
  }, [current]);
  useEffect(() => {
    if (query.isError && !document.activeElement?.closest('[role="dialog"]'))
      alert.current?.focus();
  }, [query.isError]);
  if (authority.failed || query.isError)
    return (
      <div ref={alert} role="alert" tabIndex={-1} className="space-y-4">
        <p>{t("maintenanceHistoryUnavailable")}</p>
        <Button className="min-h-11" disabled={authority.rechecking} onClick={() => {
          if (authority.canRead()) void query.refetch();
          else void authority.recheck().catch(() => {});
        }}>
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
      <section
        aria-label={t("maintenanceAttempts.title")}
        className="space-y-3"
      >
        <h2 className="text-lg font-medium">
          {t("maintenanceAttempts.title")}
        </h2>
        <p className="text-muted-foreground">
          {t("maintenanceAttempts.boundary")}
        </p>
        {!view.attemptHistory ? (
          <p role="status">{t("maintenanceAttempts.unavailable")}</p>
        ) : (
          <>
            {!view.attemptHistory.entries.length && (
              <p>{t("maintenanceAttempts.empty")}</p>
            )}
            <ul className="space-y-2">
              {view.attemptHistory.entries.map((attempt) => (
                <li
                  key={attempt.attemptId}
                  className="space-y-2 rounded-lg border border-border p-4"
                >
                  <p>{t(`maintenanceAttempts.outcome.${attempt.outcome}`)}</p>
                  <p className="break-all font-mono">
                    {t("maintenanceAttempts.reference")} {attempt.attemptId}
                  </p>
                  <p>
                    {t(
                      attempt.sourceMatchesCurrent
                        ? "maintenanceAttempts.currentSource"
                        : "maintenanceAttempts.historicalSource",
                    )}
                  </p>
                  <p>
                    {t("maintenanceAttempts.started")}{" "}
                    <time dateTime={attempt.startedAt}>
                      {new Date(attempt.startedAt).toLocaleString()}
                    </time>
                  </p>
                  {attempt.finishedAt && (
                    <p>
                      {t("maintenanceAttempts.finished")}{" "}
                      <time dateTime={attempt.finishedAt}>
                        {new Date(attempt.finishedAt).toLocaleString()}
                      </time>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {view.attemptHistory.hasMore && (
              <p>{t("maintenanceAttempts.bounded")}</p>
            )}
          </>
        )}
      </section>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/agents/packages"
      >
        {t("maintenanceHistoryBack")}
      </Link>
    </section>
  );
}
