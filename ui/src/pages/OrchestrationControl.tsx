import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { orchestrationControlCommandSchema, type OrchestrationControlReceipt } from "@paperclipai/shared";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { orchestrationControlApi } from "@/api/orchestration-control";
import { clearOrchestrationControl, pendingOrchestrationControl, retainOrchestrationControl } from "@/lib/pending-orchestration-controls";
import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Safety/recovery entry deliberately survives both rollout gates. */
export function OrchestrationControlEntry() {
  const { selectedCompanyId } = useCompany(), { planId } = useParams(), identity = useV9CurrentAccount(), { t } = useTranslation("experience");
  // Keep the same person's unsent review in memory during session rechecks.
  // The mounted surface's current-authority fence hides all private state.
  // A different principal/company/plan still remounts the whole form.
  if (!identity.settled && !identity.userId) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "orchestrationControl.unavailable" : "loading")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId || !planId) return <p role="alert">{t("workflowIntent.accountRequired")}</p>;
  return <OrchestrationControl key={`${selectedCompanyId}:${identity.userId}:${planId}`} company={selectedCompanyId} principal={identity.userId} plan={planId} />;
}

export function OrchestrationControl({ company, principal, plan }: { company: string; principal: string; plan: string }) {
  const { t } = useTranslation("experience"), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal), client = useQueryClient();
  const [epoch, setEpoch] = useState(0), source = useRef(0), alive = useRef(true), submitted = useRef(false);
  const [requestId, setRequestId] = useState<string | null>(null), [storageReady, setStorageReady] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const [action, setAction] = useState<"pause" | "cancel">("cancel"), [rationale, setRationale] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [invalid, setInvalid] = useState(false), [confirmed, setConfirmed] = useState<{ receipt: OrchestrationControlReceipt; authorityEpoch: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), error = useRef<HTMLDivElement>(null);
  const prefix = ["v9-orchestration-control", company, principal, plan], key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, plan, selectedCompanyId, authority }); scope.current = { company, principal, plan, selectedCompanyId, authority };
  const current = () => alive.current && scope.current.company === company && scope.current.principal === principal && scope.current.plan === plan &&
    scope.current.selectedCompanyId === company && scope.current.authority.canRead();
  // Establish the lifecycle fence before Query's subscription can start a read
  // during React's effect teardown/setup cycle. Late unmounted reads stay barred.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current() || source.current !== epoch) throw new Error("Current control scope changed");
      const value = await orchestrationControlApi.get(company, principal, plan, signal);
      if (!current() || source.current !== epoch) throw new Error("Current control scope changed");
      return value;
    }) });
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix });
    void client.invalidateQueries({ queryKey: prefix, refetchType: "none" }); };
  useCompanyLiveEvent(event => {
    if (event.companyId === company && /orchestrat|supervision|issue|membership|permission|role|erased|deleted|withdraw/i.test(`${event.payload.entityType}:${event.payload.action}`)) refresh();
  });
  useEffect(() => {
    try { setRequestId(pendingOrchestrationControl(company, principal, plan)); setStorageReady(true); }
    catch { setStorageFailed(true); }
  }, [company, principal, plan]);
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const accept = (receipt: OrchestrationControlReceipt, authorityEpoch: number) => {
    if (!current() || scope.current.authority.epoch !== authorityEpoch) throw new Error("Original control receipt needs current account review");
    setConfirmed({ receipt, authorityEpoch }); refresh();
  };
  const create = useMutation({ retry: false, mutationFn: async () => {
    const currentState = client.getQueryState(key);
    if (!current() || !fresh || currentState?.isInvalidated || currentState?.fetchStatus === "fetching" || !storageReady || requestId || submitted.current)
      throw new Error("Current control review is unavailable");
    const command = orchestrationControlCommandSchema.safeParse({ requestId: crypto.randomUUID(), expectedVersion: query.data!.version,
      action, rationale, acknowledgeCompletedEffectsRemain: acknowledged });
    if (!command.success) { setInvalid(true); throw new Error("Review the control fields"); }
    if (!(action === "pause" ? query.data!.canPause : query.data!.canStop)) throw new Error("Current control admission changed");
    const admittedEpoch = scope.current.authority.epoch;
    try { retainOrchestrationControl(company, principal, plan, command.data.requestId); }
    catch { setStorageFailed(true); throw new Error("Control recovery is unavailable"); }
    submitted.current = true; setRequestId(command.data.requestId); setInvalid(false);
    const receipt = await orchestrationControlApi.request(company, principal, plan, command.data);
    accept(receipt, admittedEpoch);
  } });
  const recover = useMutation({ retry: false, mutationFn: () => authority.read(async () => {
    if (!current() || !requestId) throw new Error("Original control request is unavailable");
    const admittedEpoch = scope.current.authority.epoch;
    const receipt = await orchestrationControlApi.receipt(company, principal, plan, requestId);
    accept(receipt, admittedEpoch);
  }) });
  const receipt = fresh && confirmed?.authorityEpoch === authority.epoch && query.data.version >= confirmed.receipt.resultingVersion ? confirmed.receipt : null;
  useEffect(() => {
    if (!receipt) return;
    try { clearOrchestrationControl(company, principal, plan, receipt.requestId); } catch { /* Keep the locator for Original reads. */ }
    heading.current?.focus();
  }, [receipt?.requestId, company, principal, plan]);
  useEffect(() => { if (current() && (invalid || storageFailed || recover.isError)) error.current?.focus(); }, [invalid, storageFailed, recover.isError]);
  const busy = create.isPending || recover.isPending;
  if (!current()) return authority.failed ? <div role="alert" className="space-y-3">
    <p>{t("orchestrationControl.unavailable")}</p>
    <Button className="min-h-11" onClick={() => void authority.recheck().catch(() => {})}>{t("tryAgain")}</Button>
  </div> : <p role="status">{t("loading")}</p>;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to="/orchestration">{t("orchestrationControl.back")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t(receipt ? "orchestrationControl.requested" : "orchestrationControl.heading")}</h1>
    <p>{t("orchestrationControl.boundary")}</p>
    {query.isError ? <div ref={error} role="alert" tabIndex={-1} className="space-y-3"><p>{t("orchestrationControl.unavailable")}</p>
      <Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div> : !fresh ? <p role="status">{t("loading")}</p> : <>
      <p>{t(`orchestrationExperience.status.${query.data.status}`)}</p>
      <Link className="inline-flex min-h-11 items-center underline" to={`/issues/${query.data.taskId}`}>{t("orchestrationExperience.openTask")}</Link>
      {receipt ? <section className="space-y-3" aria-label={t("orchestrationControl.receipt")}>
        <p>{t(receipt.action === "pause" ? "orchestrationControl.pauseRequested" : "orchestrationControl.stopRequested")}</p>
        <p>{t("orchestrationControl.pendingPropagation")}</p>
        <p className="break-all font-mono">{receipt.requestId}</p>
      </section> : requestId ? <section className="space-y-3" aria-label={t("orchestrationControl.recovery")}>
        <p role="status">{t("orchestrationControl.unknown")}</p>
        <Button className="min-h-11" disabled={busy} onClick={() => recover.mutate()}>{t("orchestrationControl.checkOriginal")}</Button>
        {recover.isError && <div ref={error} role="alert" tabIndex={-1}>{t("orchestrationControl.stillUnknown")}</div>}
      </section> : storageFailed ? <div ref={error} role="alert" tabIndex={-1}>{t("orchestrationControl.storageFailed")}</div>
        : !query.data.canPause && !query.data.canStop ? <p role="status">{t("orchestrationControl.terminal")}</p> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy) create.mutate(); }}>
          <div className="space-y-2"><label htmlFor="orchestration-control-action" className="block font-medium">{t("orchestrationControl.action")}</label>
            <select id="orchestration-control-action" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={action} disabled={busy}
              onChange={event => setAction(event.target.value as "pause" | "cancel")}>
              <option value="cancel" disabled={!query.data.canStop}>{t("orchestrationControl.stop")}</option>
              <option value="pause" disabled={!query.data.canPause}>{t("orchestrationControl.pause")}</option>
            </select></div>
          <p>{t(action === "pause" ? "orchestrationControl.pauseConsequence" : "orchestrationControl.stopConsequence")}</p>
          <div className="space-y-2"><label htmlFor="orchestration-control-rationale" className="block font-medium">{t("orchestrationControl.rationale")}</label>
            <Textarea id="orchestration-control-rationale" value={rationale} minLength={20} maxLength={2000} required disabled={busy}
              aria-invalid={invalid || undefined} aria-describedby="orchestration-control-rationale-help" onChange={event => { setRationale(event.target.value); setInvalid(false); }} />
            <p id="orchestration-control-rationale-help" className="text-sm text-muted-foreground">{t("orchestrationControl.rationaleHelp")}</p></div>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={acknowledged} required disabled={busy}
            onChange={event => setAcknowledged(event.target.checked)} />{t("orchestrationControl.acknowledge")}</label>
          {invalid && <div ref={error} role="alert" tabIndex={-1}>{t("orchestrationControl.validation")}</div>}
          <footer className="flex items-center justify-between gap-4"><Link className="inline-flex min-h-11 items-center underline" to="/orchestration">{t("orchestrationControl.back")}</Link>
            <Button type="submit" className="min-h-11" disabled={busy || !storageReady || !acknowledged || rationale.trim().length < 20}>
              {t(busy ? "loading" : action === "pause" ? "orchestrationControl.requestPause" : "orchestrationControl.requestStop")}</Button></footer>
        </form>}
    </>}
  </div>;
}
