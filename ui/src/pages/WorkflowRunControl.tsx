import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowRunControlSchema, workflowStopCommandSchema, type WorkflowStopReceipt } from "@paperclipai/shared";
import { Link, useParams } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { workflowReadSourceChanged } from "../lib/workflow-source-invalidation";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { workflowRunControlApi } from "../api/workflow-run-control";
import { clearWorkflowStop, pendingWorkflowStop, retainWorkflowStop } from "../lib/pending-workflow-stops";
import { useTranslation } from "../i18n";
import { Button } from "../components/ui/button";

export function WorkflowRunControlEntry() {
  const { selectedCompanyId } = useCompany(), identity = useV9CurrentAccount(), { workflowId, runId } = useParams(), { t } = useTranslation("experience");
  if (!identity.settled) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "workflowRunControl.unavailable" : "loading")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId) return <p role="alert">{t("workflowIntent.accountRequired")}</p>;
  if (!workflowRunControlSchema.shape.workflowId.safeParse(workflowId).success || !workflowRunControlSchema.shape.runId.safeParse(runId).success)
    return <p role="alert">{t("workflowRunControl.unavailable")}</p>;
  return <WorkflowRunControl key={`${selectedCompanyId}:${identity.userId}:${workflowId}:${runId}`} company={selectedCompanyId}
    principal={identity.userId} workflow={workflowId!} run={runId!} />;
}

/** Exact retained run control survives rollout without restoring private
 * inputs/results. One POST; lost acknowledgement permits Original GET only. */
export function WorkflowRunControl({ company, principal, workflow, run }: { company: string; principal: string; workflow: string; run: string }) {
  const { t } = useTranslation("experience"), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal), client = useQueryClient();
  const [epoch, setEpoch] = useState(0), source = useRef(0), alive = useRef(true), submitted = useRef(false);
  const [requestId, setRequestId] = useState<string | null>(null), [storageReady, setStorageReady] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false), [confirmed, setConfirmed] = useState<{ receipt: WorkflowStopReceipt; authorityEpoch: number } | null>(null);
  const error = useRef<HTMLDivElement>(null);
  const prefix = ["v9-workflow-run-control", company, principal, workflow, run], key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, workflow, run, selectedCompanyId, authority }); scope.current = { company, principal, workflow, run, selectedCompanyId, authority };
  const current = () => alive.current && scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.run === run && scope.current.selectedCompanyId === company && scope.current.authority.canRead();
  // The lifecycle fence must precede Query's effect subscription on remount.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current() || source.current !== epoch) throw new Error("Current retained run scope changed");
      const value = await workflowRunControlApi.get(company, principal, workflow, run, signal);
      if (!current() || source.current !== epoch) throw new Error("Current retained run scope changed"); return value;
    }) });
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix }); void client.invalidateQueries({ queryKey: prefix, refetchType: "none" }); };
  useCompanyLiveEvent(event => {
    if (event.companyId === company && workflowReadSourceChanged(event)) refresh();
  });
  useEffect(() => { try { setRequestId(pendingWorkflowStop(company, principal, workflow, run)); setStorageReady(true); } catch { setStorageFailed(true); } }, [company, principal, workflow, run]);
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const accept = (receipt: WorkflowStopReceipt, authorityEpoch: number) => {
    if (!current() || scope.current.authority.epoch !== authorityEpoch) throw new Error("The retained Stop needs current account confirmation");
    setConfirmed({ receipt, authorityEpoch }); refresh();
  };
  const create = useMutation({ retry: false, mutationFn: async () => {
    const state = client.getQueryState(key);
    if (!current() || !fresh || state?.isInvalidated || state?.fetchStatus === "fetching" || !query.data!.canRequestStop || !acknowledged || !storageReady || storageFailed || requestId || submitted.current)
      throw new Error("Current retained Stop review is unavailable");
    const command = workflowStopCommandSchema.parse({ requestId: crypto.randomUUID(), expectedWorkflowId: workflow,
      expectedRevisionId: query.data!.revisionId, expectedUpdatedAt: query.data!.updatedAt, acknowledgeCompletedEffectsRemain: acknowledged });
    const admittedEpoch = scope.current.authority.epoch;
    try { retainWorkflowStop(company, principal, workflow, run, command.requestId); } catch { setStorageFailed(true); throw new Error("Run Stop recovery is unavailable"); }
    submitted.current = true; setRequestId(command.requestId);
    accept(await workflowRunControlApi.stop(company, principal, workflow, run, command), admittedEpoch);
  } });
  const recover = useMutation({ retry: false, mutationFn: () => authority.read(async () => {
    if (!current() || !requestId) throw new Error("The retained Stop is unconfirmed");
    const admittedEpoch = scope.current.authority.epoch;
    accept(await workflowRunControlApi.receipt(company, principal, workflow, run, requestId), admittedEpoch);
  }) });
  const receipt = fresh && confirmed?.authorityEpoch === authority.epoch && query.data.revisionId === confirmed.receipt.revisionId ? confirmed.receipt : null;
  const heading = useExperienceHeading(`${company}:${principal}:${workflow}:${run}:stop:${receipt?.requestId ?? "review"}`, !fresh, query.isError);
  useEffect(() => { if (!receipt) return;
    try { clearWorkflowStop(company, principal, workflow, run, receipt.requestId); } catch { /* Retain its Original locator. */ }
  }, [receipt?.requestId, company, principal, workflow, run]);
  useEffect(() => { if (current() && (storageFailed || recover.isError)) error.current?.focus(); }, [storageFailed, recover.isError]);
  const busy = create.isPending || recover.isPending;
  if (!current()) return <p role="status">{t("loading")}</p>;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}`}>{t("workflowRequestRecovery.back")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t(receipt ? "workflowRunControl.recorded" : "workflowRunControl.heading")}</h1>
    <p>{t("workflowRunControl.boundary")}</p>
    {query.isError ? <div ref={error} tabIndex={-1} role="alert" className="space-y-3"><p>{t("workflowRunControl.unavailable")}</p>
      <Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div> : !fresh ? <p role="status">{t("loading")}</p> : <>
      <p>{t(`workflowRunControl.purpose.${query.data.purpose}`)}</p><p>{t("workflowRunControl.recordedStatus", { status: t(`workflowRunStatus.${query.data.status}`) })}</p>
      {receipt ? <section className="space-y-3" aria-label={t("workflowRunControl.receipt")}>
        <p>{t("workflowRunControl.requested")}</p><p>{t("workflowRunControl.propagation")}</p><p className="break-all font-mono">{receipt.requestId}</p>
      </section> : requestId ? <section className="space-y-3" aria-label={t("workflowRunControl.recovery")}>
        <p role="status">{t(create.isPending ? "workflowRunControl.requesting" : "workflowRunControl.unknown")}</p>
        <Button className="min-h-11" disabled={busy} onClick={() => recover.mutate()}>{t("workflowRunControl.checkOriginal")}</Button>
        {recover.isError && <div ref={error} tabIndex={-1} role="alert">{t("workflowRunControl.stillUnknown")}</div>}
      </section> : storageFailed ? <div ref={error} tabIndex={-1} role="alert">{t("workflowRequestRecovery.storageFailed")}</div>
        : !query.data.canRequestStop ? <p role="status">{t("workflowRunControl.terminal")}</p> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy) create.mutate(); }}>
          <p>{t("workflowRunControl.consequence")}</p>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={acknowledged} required disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />{t("workflowRunControl.acknowledge")}</label>
          <Button type="submit" className="min-h-11" disabled={busy || !storageReady || !acknowledged}>{t(busy ? "loading" : "workflowRunControl.requestStop")}</Button>
        </form>}
    </>}
  </div>;
}
