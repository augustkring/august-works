import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "../lib/router";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { agentMonitorApi } from "../api/agent-monitor";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";

export function AgentMonitorEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  const identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany();
  const { agentId } = useParams();
  const { t } = useTranslation("experience");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  if (feature.query.isError || identity.failed)
    return <p role="alert">{t("agentMonitorUnavailable")}</p>;
  if (feature.query.isPending || !identity.settled)
    return <p role="status">{t("loading")}</p>;
  if (!feature.enabled || identity.failed)
    return <p role="alert">{t("agentMonitorUnavailable")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (!principal || !agentId)
    return <p role="alert">{t("agentMonitorUnavailable")}</p>;
  return (
    <AgentMonitor
      key={`${selectedCompanyId}:${principal}:${agentId}`}
      company={selectedCompanyId}
      principal={principal}
      agentId={agentId}
    />
  );
}
export function AgentMonitor({
  company,
  principal,
  agentId,
}: {
  company: string;
  principal: string;
  agentId: string;
}) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0);
  const prefix = ["agent-monitor", company, principal, agentId];
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  const main = useRef<HTMLElement>(null);
  const restoreHref = useRef<string | null>(null);
  const alert = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: [...prefix, authority.epoch, epoch],
    queryFn: ({ signal }) =>
      authority.read(() => agentMonitorApi.get(company, principal, agentId, signal)),
    enabled: authority.readReady,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company) return;
    if (
      event.type === "activity.logged" ||
      event.type.startsWith("heartbeat.")
    ) {
      void client.cancelQueries({ queryKey: prefix });
      client.removeQueries({ queryKey: prefix });
      setEpoch((old) => old + 1);
    }
  });
  const current = authority.readReady && query.isSuccess && !query.isFetching;
  if (
    !current &&
    !query.isError &&
    main.current?.contains(document.activeElement)
  ) {
    restoreHref.current = document.activeElement?.getAttribute("href") ?? null;
  }
  useEffect(() => {
    if (
      current &&
      restoreHref.current &&
      document.activeElement === document.body
    ) {
      const target = Array.from(
        main.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
      ).find((link) => link.getAttribute("href") === restoreHref.current);
      target?.focus();
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
    if ((query.isError || authority.failed) && !document.activeElement?.closest('[role="dialog"]'))
      alert.current?.focus();
  }, [query.isError, authority.failed]);
  if (query.isError || authority.failed)
    return (
      <div ref={alert} role="alert" tabIndex={-1} className="space-y-4">
        <p>{t("agentMonitorUnavailable")}</p>
        <Button className="min-h-11" onClick={() => void (authority.readReady ? query.refetch() : authority.recheck())}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (!current) return <p role="status">{t("loading")}</p>;
  const view = query.data!;
  return (
    <section ref={main} className="space-y-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("agentMonitorTitle", { name: view.name })}
      </h1>
      <p className="text-muted-foreground">{t("agentMonitorBoundary")}</p>
      <section
        aria-label={t("agentMonitorState")}
        className="space-y-2 rounded-lg border border-border p-4"
      >
        <h2 className="text-lg font-medium">{t("agentMonitorState")}</h2>
        <p>{t(`agentMonitorLifecycle.${view.lifecycle}`)}</p>
        {view.pauseReason && (
          <p>{t(`agentMonitorPause.${view.pauseReason}`)}</p>
        )}
        <p>
          {t("agentMonitorObserved")}{" "}
          <time dateTime={view.observedAt}>
            {new Date(view.observedAt).toLocaleString()}
          </time>
        </p>
        <p>
          {t("agentMonitorLastRun")}{" "}
          {view.lastHeartbeatAt ? (
            <time dateTime={view.lastHeartbeatAt}>
              {new Date(view.lastHeartbeatAt).toLocaleString()}
            </time>
          ) : (
            t("agentMonitorNoRun")
          )}
        </p>
      </section>
      <section aria-label={t("agentMonitorRecent")} className="space-y-4">
        <h2 className="text-lg font-medium">{t("agentMonitorRecent")}</h2>
        {!view.recent.runs.length && <p>{t("agentMonitorNoRun")}</p>}
        <ul className="space-y-2">
          {view.recent.runs.map((run) => (
            <li key={run.id} className="rounded-lg border border-border p-4">
              <Link
                className="inline-flex min-h-11 items-center underline"
                to={`/agents/${agentId}/runs/${run.id}`}
              >
                {t(`agentMonitorRunStatus.${run.status}`)}
              </Link>
              <p>
                <time dateTime={run.createdAt}>
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </p>
            </li>
          ))}
        </ul>
        {view.recent.hasMore && <p>{t("agentMonitorBounded")}</p>}
      </section>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to={`/agents/${agentId}`}
      >
        {t("agentMonitorAdvanced")}
      </Link>
    </section>
  );
}
