import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "../lib/router";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { memoryMaintenanceHistoryApi } from "../api/memory-maintenance-history";
import { Button } from "../components/ui/button";

export function MemoryMaintenanceHistoryEntry() {
  const feature = useV9FeatureEnabled("maintenance_autopilot_v9");
  const identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany();
  const { t } = useTranslation("experience");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const authority = useV9PrivateReadAuthority(principal ?? "", identity.localImplicit);
  if (feature.query.isError || identity.failed)
    return <div role="alert" className="space-y-4">
      <p>{t("memoryMaintenance.unavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking || feature.query.isFetching} onClick={() => {
        if (identity.failed) void authority.recheck().catch(() => {});
        else void feature.query.refetch();
      }}>{t("tryAgain")}</Button>
    </div>;
  if (feature.query.isPending || feature.query.isFetching || !identity.settled)
    return <p role="status">{t("loading")}</p>;
  if (!feature.enabled || !feature.query.data?.enableCollectiveMemoryV1 || !principal)
    return <p role="alert">{t("memoryMaintenance.unavailable")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  return <MemoryMaintenanceHistory key={`${selectedCompanyId}:${principal}`} company={selectedCompanyId} principal={principal} />;
}

export function MemoryMaintenanceHistory({ company, principal }: { company: string; principal: string }) {
  const { t, i18n } = useTranslation("experience");
  const client = useQueryClient();
  const authority = useV9PrivateReadAuthority(principal, principal === "local-board");
  const [sourceEpoch, setSourceEpoch] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null), focused = useRef(false);
  const restoreFocus = useRef<"heading" | "back" | { reference: string } | null>(null);
  const prefix = ["memory-maintenance-history", company, principal];
  const query = useQuery({
    queryKey: [...prefix, authority.epoch, sourceEpoch],
    queryFn: ({ signal }) => authority.read(() => memoryMaintenanceHistoryApi.get(company, principal, signal)),
    enabled: authority.readReady, retry: false, gcTime: 0, staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () => document.visibilityState === "visible" ? 15000 : false,
    refetchIntervalInBackground: false,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    setSourceEpoch((old) => old + 1);
  });
  const current = authority.readReady && query.isSuccess && !query.isFetching;
  if (!current && main.current?.contains(document.activeElement)) {
    const reference = document.activeElement?.getAttribute("data-memory-reference");
    restoreFocus.current = document.activeElement === heading.current ? "heading" :
      document.activeElement?.getAttribute("data-memory-back") !== null ? "back" :
        reference ? { reference } : null;
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
      if (previous === "heading") heading.current?.focus();
      else if (previous === "back") main.current?.querySelector<HTMLAnchorElement>("[data-memory-back]")?.focus();
      else Array.from(main.current?.querySelectorAll<HTMLElement>("[data-memory-reference]") ?? [])
        .find((element) => element.getAttribute("data-memory-reference") === previous.reference)?.focus();
    }
    if (!focused.current) { heading.current?.focus(); focused.current = true; }
  }, [current]);
  useEffect(() => {
    if ((query.isError || authority.failed) && !document.activeElement?.closest('[role="dialog"]')) alert.current?.focus();
  }, [query.isError, authority.failed]);
  if (authority.failed || query.isError)
    return <div ref={alert} role="alert" tabIndex={-1} className="space-y-4">
      <p>{t("memoryMaintenance.unavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking} onClick={() => {
        if (authority.canRead()) void query.refetch();
        else void authority.recheck().catch(() => {});
      }}>{t("tryAgain")}</Button>
    </div>;
  if (!current) return <p role="status">{t("loading")}</p>;
  const view = query.data!;
  const time = (value: string) => new Date(value).toLocaleString(i18n.resolvedLanguage);
  return <section ref={main} className="space-y-6">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("memoryMaintenance.title")}</h1>
    <p className="text-muted-foreground">{t("memoryMaintenance.boundary")}</p>
    <p>{t("memoryMaintenance.observed")} <time dateTime={view.observedAt}>{time(view.observedAt)}</time></p>
    {!view.entries.length && <p>{t("memoryMaintenance.empty")}</p>}
    <ol className="space-y-4" aria-label={t("memoryMaintenance.attempts")}>
      {view.entries.map((entry) => <li key={entry.jobId} className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="font-medium">{t(`memoryMaintenance.outcome.${entry.outcome}`)}</h2>
        <p className="text-muted-foreground">{t(`memoryMaintenance.explanation.${entry.outcome}`)}</p>
        <p>{t("memoryMaintenance.attempt", { number: entry.attemptNumber })}</p>
        <p>{t("memoryMaintenance.submitted")} <time dateTime={entry.submittedAt}>{time(entry.submittedAt)}</time></p>
        {entry.finishedAt && <p>{t("memoryMaintenance.finished")} <time dateTime={entry.finishedAt}>{time(entry.finishedAt)}</time></p>}
        {entry.indexedRecordCount !== null && <p>{t("memoryMaintenance.records", { count: entry.indexedRecordCount })}</p>}
        <details className="space-y-2" open={expanded.has(entry.jobId)} onToggle={(event) => {
          const open = event.currentTarget.open;
          setExpanded((previous) => {
            if (previous.has(entry.jobId) === open) return previous;
            const next = new Set(previous);
            if (open) next.add(entry.jobId); else next.delete(entry.jobId);
            return next;
          });
        }}>
          <summary data-memory-reference={entry.jobId} className="flex min-h-11 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("memoryMaintenance.reference")}</summary>
          <p className="break-all">{entry.jobId}</p>
          {entry.receiptId && <p className="break-all">{t("memoryMaintenance.receipt")} {entry.receiptId}</p>}
        </details>
      </li>)}
    </ol>
    {view.hasMore && <p>{t("memoryMaintenance.bounded")}</p>}
    <Link data-memory-back className="inline-flex min-h-11 items-center underline" to="/memory">{t("memoryMaintenance.back")}</Link>
  </section>;
}
