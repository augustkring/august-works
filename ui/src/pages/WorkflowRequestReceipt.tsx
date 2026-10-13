import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowRequestLocatorSchema, type WorkflowRequestKind } from "@paperclipai/shared";
import { useParams, Link } from "../lib/router";
import { useTranslation } from "../i18n";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { workflowsApi } from "../api/workflows";
import { clearWorkflowRequest } from "../lib/pending-workflow-requests";
import { Button } from "../components/ui/button";

/** This read-only recovery entry survives workflow and experience rollout. */
export function WorkflowRequestReceiptEntry() {
  const { selectedCompanyId } = useCompany(), identity = useV9CurrentAccount(), { workflowId, kind, requestId } = useParams(), { t } = useTranslation("experience");
  if (!identity.settled) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "workflowRequestRecovery.unconfirmed" : "loading")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId) return <p role="alert">{t("workflowIntent.accountRequired")}</p>;
  const parsed = workflowRequestLocatorSchema.safeParse({ companyId: selectedCompanyId, principal: identity.userId, workflowId, kind, requestId });
  if (!parsed.success) return <p role="alert">{t("workflowRequestRecovery.unconfirmed")}</p>;
  return <WorkflowRequestReceipt key={JSON.stringify(parsed.data)} company={parsed.data.companyId} principal={parsed.data.principal}
    workflow={parsed.data.workflowId} kind={parsed.data.kind} requestId={parsed.data.requestId} />;
}

export function WorkflowRequestReceipt({ company, principal, workflow, kind, requestId }: {
  company: string; principal: string; workflow: string; kind: WorkflowRequestKind; requestId: string;
}) {
  const { t } = useTranslation("experience"), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal), client = useQueryClient();
  const [epoch, setEpoch] = useState(0), source = useRef(0), prefix = ["v9-workflow-request", company, principal, workflow, kind, requestId];
  const key = [...prefix, authority.epoch, epoch], scope = useRef({ company, principal, workflow, kind, requestId, selectedCompanyId, authority });
  scope.current = { company, principal, workflow, kind, requestId, selectedCompanyId, authority };
  const current = () => scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.kind === kind && scope.current.requestId === requestId && scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Current workflow request scope changed");
      const value = await workflowsApi.requestReceipt(company, principal, workflow, kind, requestId, signal);
      if (!current()) throw new Error("Current workflow request scope changed"); return value;
    }) });
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix }); void client.invalidateQueries({ queryKey: prefix, refetchType: "none" }); };
  useCompanyLiveEvent(event => {
    if (event.companyId === company && (event.type === "analytical.context.access_lost" || /workflow|membership|permission|role|erased|deleted|withdraw/i.test(`${event.payload.entityType}:${event.payload.action}`))) refresh();
  });
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const heading = useExperienceHeading(`${company}:${principal}:${workflow}:${kind}:${requestId}`, !fresh, query.isError);
  useEffect(() => {
    if (fresh) { try { clearWorkflowRequest({ companyId: company, principal, workflowId: workflow, kind, requestId }); } catch { /* Retain the Original locator when persistence is unavailable. */ } }
  }, [fresh, company, principal, workflow, kind, requestId]);
  if (!current()) return <p role="status">{t("loading")}</p>;
  const value = fresh ? query.data : null;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}`}>{t("workflowRequestRecovery.back")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t(value ? "workflowRequestRecovery.confirmed" : "workflowRequestRecovery.heading")}</h1>
    <p>{t("workflowRequestRecovery.boundary")}</p>
    {query.isError ? <div role="alert" className="space-y-3"><p>{t("workflowRequestRecovery.unconfirmed")}</p>
      <Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div> : !value ? <p role="status">{t("loading")}</p> : <section className="space-y-3" aria-label={t("workflowRequestRecovery.recorded")}>
      <p>{t(`workflowRequestRecovery.recordedKind.${value.kind}`)}</p>
      <p>{t("workflowRequestRecovery.historical")}</p>
      <p className="break-all font-mono">{value.receipt.requestId}</p>
      {(value.kind === "test" || value.kind === "launch") && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/runs/${value.receipt.runId}`}>{t("workflowRequestRecovery.inspectRun")}</Link>}
      {value.kind === "publication" && <p>{t("workflowRequestRecovery.publishedVersion", { revision: value.receipt.revisionId })}</p>}
      {value.kind === "lifecycle" && <p>{t(`workflowRequestRecovery.status.${value.receipt.status}`)}</p>}
    </section>}
  </div>;
}
