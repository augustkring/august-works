import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowDraftStepCommandSchema, workflowEditableNodeIdSchema, type WorkflowDraftStepReview,
  type WorkflowDraftStepCommand, type WorkflowDraftStepReceipt } from "@paperclipai/shared";
import { useParams, Link } from "../lib/router";
import { useTranslation } from "../i18n";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useWorkflowRequestLocator } from "../hooks/useWorkflowRequestLocator";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { workflowDraftEditApi } from "../api/workflow-draft-edit";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { queryKeys } from "../lib/queryKeys";

export function WorkflowDraftStepEntry() {
  const identity = useV9CurrentAccount(), { selectedCompanyId } = useCompany(), { workflowId, nodeId } = useParams(), { t } = useTranslation("experience");
  if (!identity.settled) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "workflowLoadFailed" : "loading")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId) return <p role="alert">{t("workflowIntent.accountRequired")}</p>;
  if (!workflowId || !workflowEditableNodeIdSchema.safeParse(nodeId).success) return <p role="alert">{t("workflowDraftStep.unavailable")}</p>;
  return <WorkflowDraftStep key={JSON.stringify([selectedCompanyId, identity.userId, workflowId, nodeId])}
    company={selectedCompanyId} principal={identity.userId} workflow={workflowId} node={nodeId!} />;
}
type Form = { source: string; name: string; duration: string; summary: string; consequence: string };
const sourceKey = (view: WorkflowDraftStepReview) => JSON.stringify([view.draftRevisionId, view.updatedAt, view.nodeId, view.nodeType]);

export function WorkflowDraftStep({ company, principal, workflow, node }: { company: string; principal: string; workflow: string; node: string }) {
  const { t } = useTranslation("experience"), client = useQueryClient(), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0), source = useRef(0), [form, setForm] = useState<Form | null>(null), [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState<WorkflowDraftStepReceipt | null>(null), inFlight = useRef<string | null>(null), error = useRef<HTMLDivElement>(null);
  const prefix = ["v9-workflow-draft-step", company, principal, workflow, node], key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, workflow, node, selectedCompanyId, authority });
  scope.current = { company, principal, workflow, node, selectedCompanyId, authority };
  const current = () => scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.node === node && scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Current draft step scope changed");
      const value = await workflowDraftEditApi.review(company, workflow, principal, node, signal);
      if (!current()) throw new Error("Current draft step scope changed"); return value;
    }) });
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const view = fresh ? query.data : null, locator = useWorkflowRequestLocator(company, principal, workflow, "draft_edit", !!view);
  const initialize = (value: WorkflowDraftStepReview) => setForm({ source: sourceKey(value), name: value.name,
    duration: value.configuration.kind === "wait" ? String(value.configuration.durationSeconds) : "",
    summary: value.configuration.kind === "approval" ? value.configuration.summary : "",
    consequence: value.configuration.kind === "approval" ? value.configuration.consequence : "" });
  useEffect(() => { if (view && !form) initialize(view); }, [view, form]);
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix }); };
  useCompanyLiveEvent(event => {
    if (event.companyId !== company) return;
    // Its own exact journal event changes this draft, not its current account
    // authority. Confirmation still requires the scoped Original HTTP receipt.
    const details = event.payload.details as { requestId?: unknown } | undefined;
    if (event.type === "activity.logged" && event.payload.action === "workflow.customer_draft_step_saved" &&
      event.payload.actorId === principal && details?.requestId === inFlight.current) return;
    if (event.type === "analytical.context.access_lost" || /workflow|membership|permission|role|privacy|erased|deleted|withdraw/i.test(`${event.payload.entityType}:${event.payload.action}`)) { setSaved(null); refresh(); }
  });
  const mutation = useMutation({ retry: false, gcTime: 0,
    mutationFn: (command: WorkflowDraftStepCommand) => locator.write(command.requestId, () => workflowDraftEditApi.save(company, workflow, principal, command)),
    onSuccess: receipt => {
      if (!locator.confirm(receipt)) return;
      setSaved(receipt); setForm(null); setInvalid(false); refresh();
      void client.invalidateQueries({ queryKey: ["workflow-experience", company, principal, workflow] });
    },
    onError: err => {
      const code = err instanceof ApiError ? (err.body as { details?: { code?: unknown } } | null)?.details?.code : null;
      if (err instanceof ApiError && err.status === 409 && code === "workflow_draft_step_conflict") {
        if (inFlight.current) locator.refused(inFlight.current); refresh();
      }
    },
    onSettled: () => { inFlight.current = null; },
  });
  const heading = useExperienceHeading(`${company}:${principal}:${workflow}:${node}`, !fresh, query.isError);
  useEffect(() => { if ((invalid || mutation.isError) && current() && !document.activeElement?.closest('a[href],button,[role="dialog"]')) error.current?.focus(); }, [invalid, mutation.isError]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!view || !form || sourceKey(view) !== form.source || !locator.ready || locator.failed || locator.pending || mutation.isPending || !current()) return;
    const parsed = workflowDraftStepCommandSchema.safeParse({ requestId: crypto.randomUUID(), expectedWorkflowId: workflow,
      expectedDraftRevisionId: view.draftRevisionId, expectedPublishedRevisionId: view.publishedRevisionId, expectedUpdatedAt: view.updatedAt,
      expectedNodeId: node, expectedNodeType: view.nodeType, name: form.name,
      configuration: view.configuration.kind === "wait" ? { kind: "wait", durationSeconds: Number(form.duration) }
        : view.configuration.kind === "approval" ? { kind: "approval", summary: form.summary, consequence: form.consequence } : { kind: "keep" } });
    if (!parsed.success) { setInvalid(true); return; }
    setInvalid(false); setSaved(null); inFlight.current = parsed.data.requestId; mutation.mutate(parsed.data);
  }
  if (!current()) return <p role="status">{t("loading")}</p>;
  const stale = !!view && !!form && sourceKey(view) !== form.source;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}`}>{t("workflowBack")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("workflowDraftStep.heading")}</h1>
    <p>{t("workflowDraftStep.boundary")}</p>
    {saved && fresh && <p role="status">{t(saved.changed ? "workflowDraftStep.saved" : "workflowDraftStep.unchanged", { version: saved.version })}</p>}
    {locator.failed && <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p>}
    {locator.pending && !mutation.isPending && <section className="space-y-3" aria-label={t("workflowRequestRecovery.pending")}>
      <p role="status">{t("workflowDraftStep.unconfirmed")}</p>
      <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/requests/draft_edit/${locator.pending}`}>{t("workflowRequestRecovery.open")}</Link>
    </section>}
    {query.isError ? <div role="alert" className="space-y-3"><p>{t("workflowDraftStep.unavailable")}</p><Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div>
      : !view || !form ? <p role="status">{t("loading")}</p> : <form onSubmit={submit} className="space-y-4">
        <p>{t("workflowDraftVersion", { version: view.version })}</p>
        {(invalid || mutation.isError || stale) && <div ref={error} tabIndex={-1} role="alert" className="space-y-3">
          <p>{t(stale ? "workflowDraftStep.changed" : invalid ? "workflowDraftStep.invalid" : "workflowDraftStep.unconfirmed")}</p>
          {stale && <Button type="button" className="min-h-11" onClick={() => { initialize(view); setInvalid(false); mutation.reset(); }}>{t("workflowDraftStep.reviewLatest")}</Button>}
        </div>}
        <fieldset disabled={mutation.isPending || !!locator.pending || locator.failed || stale} className="space-y-4">
          <label className="block space-y-2"><span>{t("workflowDraftStep.name")}</span><Input required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          {view.configuration.kind === "wait" && <label className="block space-y-2"><span>{t("workflowDraftStep.duration")}</span>
            <Input required type="number" min={1} max={604800} step={1} value={form.duration} onChange={event => setForm({ ...form, duration: event.target.value })} /></label>}
          {view.configuration.kind === "approval" && <>
            <label className="block space-y-2"><span>{t("workflowDraftStep.summary")}</span><Textarea required maxLength={1000} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} /></label>
            <label className="block space-y-2"><span>{t("workflowDraftStep.consequence")}</span><Textarea required maxLength={2000} value={form.consequence} onChange={event => setForm({ ...form, consequence: event.target.value })} /></label>
          </>}
          {view.configuration.kind === "advanced" && <div className="space-y-2"><p>{t("workflowDraftStep.advanced")}</p>
            <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/advanced?${new URLSearchParams({ node })}`}>{t("workflowEditDraft")}</Link>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}`}>{t("workflowDraftStep.cancel")}</Link>
            <Button type="submit" className="min-h-11" disabled={!locator.ready || !!locator.pending || locator.failed || stale || mutation.isPending}>{t(mutation.isPending ? "workflowDraftStep.saving" : "workflowDraftStep.save")}</Button>
          </div>
        </fieldset>
      </form>}
  </div>;
}
