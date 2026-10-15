import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentRetirementCommand, AgentRetirementView } from "@paperclipai/shared";
import { Link, useParams } from "../lib/router";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { agentRetirementApi } from "../api/agent-retirement";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/button";

type Surface = "ready" | "loading" | "unavailable";
export function AgentRetirementEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9"), identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany(), { agentId } = useParams(), { t } = useTranslation("experience");
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (!identity.userId || !agentId) return <p role={identity.settled ? "alert" : "status"}>{t(identity.settled ? "retirement.unavailable" : "loading")}</p>;
  const surface: Surface = feature.query.isPending || feature.query.isFetching ? "loading"
    : feature.query.isError || !feature.enabled || identity.localImplicit ? "unavailable" : "ready";
  // Keep the same principal's frozen intent mounted during account/settings
  // checks. The owner below hides it until the original current read settles.
  return <AgentRetirement key={`${selectedCompanyId}:${identity.userId}:${agentId.toLowerCase()}`}
    company={selectedCompanyId} principal={identity.userId} agentId={agentId.toLowerCase()} surface={surface} />;
}

export function AgentRetirement({ company, principal, agentId, surface = "ready" }: {
  company: string; principal: string; agentId: string; surface?: Surface;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient(), authority = useV9PrivateReadAuthority(principal);
  const [sourceEpoch, setSourceEpoch] = useState(0), [confirmed, setConfirmed] = useState<{ token: string; epoch: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLDivElement>(null), focused = useRef(false);
  const section = useRef<HTMLElement>(null), back = useRef<HTMLAnchorElement>(null);
  const restoreFocus = useRef<"heading" | "back" | null>(null);
  const frozen = useRef<AgentRetirementCommand | null>(null), inFlight = useRef(false);
  const prefix = ["agent-retirement", company, principal, agentId];
  const query = useQuery({ queryKey: [...prefix, authority.epoch, sourceEpoch],
    queryFn: ({ signal }) => authority.read(() => agentRetirementApi.get(company, agentId, principal, signal)),
    enabled: authority.readReady && surface === "ready", retry: false, gcTime: 0, staleTime: 0,
    refetchOnWindowFocus: true, refetchInterval: () => document.visibilityState === "visible" ? 15000 : false,
    refetchIntervalInBackground: false });
  function refresh() {
    void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix });
    setSourceEpoch(old => old + 1);
  }
  useCompanyLiveEvent(event => {
    if (event.companyId === company && ["activity.logged", "analytical.context.access_lost"].includes(event.type)) refresh();
  });
  const mutation = useMutation({ mutationKey: [...prefix, "retire"], gcTime: 0, retry: false,
    mutationFn: (command: AgentRetirementCommand) => authority.write(() => agentRetirementApi.retire(company, agentId, principal, command)),
    onSuccess: value => {
      if (!authority.confirmed(value)) return;
      frozen.current = null; setConfirmed(null);
      // Display only a fresh original-owner read. A later source event must
      // not let a retained acknowledgement restore erased or changed content.
      refresh();
    },
    onError: error => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        frozen.current = null; setConfirmed(null); refresh();
      }
    },
    onSettled: () => { inFlight.current = false; },
  });
  const current = surface === "ready" && authority.readReady && query.isSuccess && !query.isFetching;
  if (!current && section.current?.contains(document.activeElement))
    restoreFocus.current = document.activeElement === back.current ? "back" : "heading";
  useEffect(() => {
    if (current && restoreFocus.current && document.activeElement === document.body) {
      if (restoreFocus.current === "back") back.current?.focus(); else heading.current?.focus();
    }
    if (current) restoreFocus.current = null;
    if (current && !focused.current && !document.activeElement?.closest('[role="dialog"]')) {
      heading.current?.focus(); focused.current = true;
    }
    if (current && query.data?.state === "retired") { frozen.current = null; setConfirmed(null); }
  }, [current, query.data?.state]);
  useEffect(() => {
    if ((authority.failed || query.isError || mutation.isError) && !document.activeElement?.closest('[role="dialog"]')) alert.current?.focus();
  }, [authority.failed, query.isError, mutation.isError]);
  if (surface === "unavailable" || authority.failed || query.isError)
    return <div ref={alert} role="alert" tabIndex={-1} className="space-y-4"><p>{t("retirement.unavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking || surface !== "ready"} onClick={() => {
        if (authority.canRead()) refresh(); else void authority.recheck().catch(() => {});
      }}>{t("tryAgain")}</Button></div>;
  if (!current) return <p role="status">{t("loading")}</p>;
  const value = query.data!, accepted = confirmed?.token === value.sourceToken && confirmed.epoch === authority.epoch;
  function send(retry = false) {
    if (inFlight.current || mutation.isPending || !authority.canRead() || surface !== "ready" || !value.canRetire) return;
    if (retry) { if (!frozen.current) return; }
    else {
      if (!accepted || frozen.current) return;
      frozen.current = Object.freeze({ requestId: crypto.randomUUID(), expectedSourceToken: value.sourceToken,
        confirmRetirement: true, pendingWorkPolicy: "require_settled", accessPolicy: "detach_agent_only", retentionPolicy: "existing_company_policy" });
    }
    inFlight.current = true; mutation.mutate(frozen.current!);
  }
  return <section ref={section} className="space-y-6">
    <h1 ref={heading} tabIndex={-1} className="break-words text-2xl font-semibold">{t("retirement.title", { name: value.name })}</h1>
    <AgentRetirementSummary value={value} />
    {mutation.isError && value.state !== "retired" && <div ref={alert} role="alert" tabIndex={-1} className="space-y-3">
      <p>{t("retirement.unconfirmed")}</p>
      {frozen.current && <Button className="min-h-11" disabled={mutation.isPending || !value.canRetire} onClick={() => send(true)}>{t("retirement.retrySame")}</Button>}
      <Button className="min-h-11" disabled={mutation.isPending} onClick={refresh}>{t("retirement.checkStatus")}</Button>
    </div>}
    {value.canRetire && !frozen.current && <label className="flex min-h-11 items-center gap-3">
      <input type="checkbox" className="h-5 w-5" checked={accepted} disabled={mutation.isPending}
        onChange={event => setConfirmed(event.target.checked ? { token: value.sourceToken, epoch: authority.epoch } : null)} />
      <span>{t("retirement.confirm")}</span>
    </label>}
    <footer className="flex flex-wrap items-center justify-between gap-3">
      <Link ref={back} className="inline-flex min-h-11 items-center underline" to={`/agents/${agentId}/monitor`}>{t("retirement.back")}</Link>
      {value.canRetire && !frozen.current && <Button variant="destructive" className="min-h-11" disabled={!accepted || mutation.isPending} onClick={() => send()}>{t("retirement.retire")}</Button>}
    </footer>
  </section>;
}

export function AgentRetirementSummary({ value }: { value: AgentRetirementView }) {
  const { t, i18n } = useTranslation("experience");
  return <>
    <p>{t("retirement.boundary")}</p>
    {value.alreadyStopped && value.state !== "retired" && <p>{t("retirement.alreadyStopped")}</p>}
    <p>{t("retirement.observed")} <time dateTime={value.observedAt}>{new Date(value.observedAt).toLocaleString(i18n.resolvedLanguage)}</time></p>
    {value.state === "retired" ? <p role="status">{t("retirement.completed")}</p> : value.blockers.length > 0 ? <>
      <h2 className="text-lg font-semibold">{t("retirement.required")}</h2>
      <ul className="space-y-2">{value.blockers.map(code => <li key={code}>{t(`retirement.blocker.${code}`)}</li>)}</ul>
    </> : <p>{t("retirement.ready")}</p>}
    <h2 className="text-lg font-semibold">{t(value.state === "retired" ? "retirement.removed" : "retirement.toRemove")}</h2>
    {value.affectedAccess ? <dl className="space-y-2">{Object.entries(value.affectedAccess).map(([key, count]) =>
      <div key={key} className="flex flex-wrap justify-between gap-3"><dt>{t(`retirement.access.${key}`)}</dt><dd>{count}</dd></div>)}</dl>
      : <p>{t("retirement.accessUnavailable")}</p>}
    {value.state === "blocked" && <div className="flex flex-wrap gap-4">
      <Link className="inline-flex min-h-11 items-center underline" to="/issues">{t("retirement.reviewWork")}</Link>
      <Link className="inline-flex min-h-11 items-center underline" to="/apps">{t("retirement.reviewApps")}</Link>
      <Link className="inline-flex min-h-11 items-center underline" to="/agents">{t("retirement.reviewAgents")}</Link>
    </div>}
  </>;
}
