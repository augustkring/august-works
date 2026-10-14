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
type Form = { source: string; name: string; duration: string; summary: string; consequence: string; objective: string; agentId: string;
  conditionSource: "trigger" | "variables" | "steps"; path: string; operator: "===" | "!==" | ">" | ">=" | "<" | "<=";
  valueType: "string" | "number" | "boolean" | "null"; value: string };
type Field = "name" | "duration" | "summary" | "consequence" | "objective" | "agentId" | "path" | "value";
const sourceKey = (view: WorkflowDraftStepReview) => JSON.stringify([view.draftRevisionId, view.updatedAt, view.nodeId, view.nodeType]);

export function WorkflowDraftStep({ company, principal, workflow, node }: { company: string; principal: string; workflow: string; node: string }) {
  const { t } = useTranslation("experience"), client = useQueryClient(), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0), source = useRef(0), [form, setForm] = useState<Form | null>(null), [invalid, setInvalid] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
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
    consequence: value.configuration.kind === "approval" ? value.configuration.consequence : "",
    objective: value.configuration.kind === "agent_task" ? value.configuration.objective : "",
    agentId: "",
    conditionSource: value.configuration.kind === "condition" ? value.configuration.source : "trigger",
    path: value.configuration.kind === "condition" ? value.configuration.path.join("\n") : "",
    operator: value.configuration.kind === "condition" ? value.configuration.operator : "===",
    valueType: value.configuration.kind === "condition" ? value.configuration.value === null ? "null" : typeof value.configuration.value as Form["valueType"] : "string",
    value: value.configuration.kind === "condition" ? String(value.configuration.value ?? "") : "" });
  useEffect(() => { if (view && !form) initialize(view); }, [view, form]);
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix }); };
  useCompanyLiveEvent(event => {
    if (event.companyId !== company) return;
    // Its own exact journal event changes this draft, not its current account
    // authority. Confirmation still requires the scoped Original HTTP receipt.
    const details = event.payload.details as { requestId?: unknown } | undefined;
    if (event.type === "activity.logged" && event.payload.action === "workflow.customer_draft_step_saved" &&
      event.payload.entityType === "workflow" && event.payload.entityId === workflow && event.payload.actorId === principal && details?.requestId === inFlight.current) return;
    if (event.type === "analytical.context.access_lost" || /workflow|agent|membership|permission|role|privacy|erased|deleted|withdraw/i.test(`${event.payload.entityType}:${event.payload.action}`)) { setSaved(null); refresh(); }
  });
  const mutation = useMutation({ retry: false, gcTime: 0,
    mutationFn: (command: WorkflowDraftStepCommand) => locator.write(command.requestId, () => workflowDraftEditApi.save(company, workflow, principal, command)),
    onSuccess: receipt => {
      if (!locator.confirm(receipt)) return;
      setSaved(receipt); setForm(null); setInvalid(false); setFieldErrors({}); refresh();
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
  useEffect(() => { if (Object.keys(fieldErrors).length && current()) error.current?.focus(); }, [fieldErrors]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!view || !form || sourceKey(view) !== form.source || !locator.ready || locator.failed || locator.blockedBy || mutation.isPending || !current()) return;
    if (view.configuration.kind === "agent_task" && form.agentId && !view.agentSelection?.choices.some(choice => choice.agentId === form.agentId)) {
      setFieldErrors({ agentId: t("workflowDraftStep.errors.agentId") }); setInvalid(true); return;
    }
    const parsed = workflowDraftStepCommandSchema.safeParse({ requestId: crypto.randomUUID(), expectedWorkflowId: workflow,
      expectedDraftRevisionId: view.draftRevisionId, expectedPublishedRevisionId: view.publishedRevisionId, expectedUpdatedAt: view.updatedAt,
      expectedNodeId: node, expectedNodeType: view.nodeType, name: form.name,
      configuration: view.configuration.kind === "wait" ? { kind: "wait", durationSeconds: Number(form.duration) }
        : view.configuration.kind === "approval" ? { kind: "approval", summary: form.summary, consequence: form.consequence }
        : view.configuration.kind === "agent_task" ? { kind: "agent_task", objective: form.objective, ...(form.agentId ? { agentId: form.agentId } : {}) }
        : view.configuration.kind === "condition" ? { kind: "condition", source: form.conditionSource, path: form.path.split("\n"), operator: form.operator,
          value: form.valueType === "null" ? null : form.valueType === "boolean" ? form.value === "true" : form.valueType === "number" ? form.value.trim() ? Number(form.value) : NaN : form.value }
        : { kind: "keep" } });
    if (!parsed.success) {
      const errors: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === "name" ? "name" : issue.path[1] === "durationSeconds" ? "duration" : issue.path[1];
        if (["name", "duration", "summary", "consequence", "objective", "agentId", "path", "value"].includes(String(field))) errors[field as Field] = t(`workflowDraftStep.errors.${String(field)}`);
      }
      setFieldErrors(errors); setInvalid(true); return;
    }
    setInvalid(false); setFieldErrors({}); setSaved(null); inFlight.current = parsed.data.requestId; mutation.mutate(parsed.data);
  }
  const fieldProps = (field: Field) => ({ id: `draft-step-${field}`, "aria-labelledby": `draft-step-${field}-label`, "aria-invalid": !!fieldErrors[field], "aria-describedby": fieldErrors[field] ? `draft-step-${field}-error` : undefined });
  const fieldError = (field: Field) => fieldErrors[field] ? <p id={`draft-step-${field}-error`} className="text-sm text-destructive">{fieldErrors[field]}</p> : null;
  const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline focus-visible:outline-ring";
  if (!current()) return <p role="status">{t("loading")}</p>;
  const stale = !!view && !!form && sourceKey(view) !== form.source;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}?revision=draft`}>{t("workflowRequestRecovery.back")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("workflowDraftStep.heading")}</h1>
    <p>{t("workflowDraftStep.boundary")}</p>
    {saved && fresh && <p role="status">{t(saved.changed ? "workflowDraftStep.saved" : "workflowDraftStep.unchanged", { version: saved.version })}</p>}
    {locator.failed && <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p>}
    {locator.blockedBy && !mutation.isPending && <section className="space-y-3" aria-label={t("workflowRequestRecovery.pending")}>
      <p role="status">{t("workflowDraftStep.unconfirmed")}</p>
      <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/requests/${locator.blockedBy.kind}/${locator.blockedBy.requestId}`}>{t("workflowRequestRecovery.open")}</Link>
    </section>}
    {query.isError ? <div role="alert" className="space-y-3"><p>{t("workflowDraftStep.unavailable")}</p><Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div>
      : !view || !form ? <p role="status">{t("loading")}</p> : <form onSubmit={submit} noValidate className="space-y-4">
        <p>{t("workflowDraftVersion", { version: view.version })}</p>
        {(invalid || mutation.isError || stale) && <div ref={error} tabIndex={-1} role="alert" className="space-y-3">
          <p>{t(stale ? "workflowDraftStep.changed" : invalid ? "workflowDraftStep.invalid" : "workflowDraftStep.unconfirmed")}</p>
          {invalid && <ul className="list-disc pl-5">{Object.entries(fieldErrors).map(([field, message]) => <li key={field}><a className="inline-flex min-h-11 items-center underline" href={`#draft-step-${field}`} onClick={event => { event.preventDefault(); document.getElementById(`draft-step-${field}`)?.focus(); }}>{message}</a></li>)}</ul>}
          {stale && <Button type="button" className="min-h-11" onClick={() => { initialize(view); setInvalid(false); setFieldErrors({}); mutation.reset(); }}>{t("workflowDraftStep.reviewLatest")}</Button>}
        </div>}
        <fieldset disabled={mutation.isPending || !!locator.blockedBy || locator.failed || stale} className="space-y-4">
          <label className="block space-y-2"><span id="draft-step-name-label">{t("workflowDraftStep.name")}</span><Input {...fieldProps("name")} className="min-h-11" required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />{fieldError("name")}</label>
          {view.configuration.kind === "wait" && <label className="block space-y-2"><span id="draft-step-duration-label">{t("workflowDraftStep.duration")}</span>
            <Input {...fieldProps("duration")} className="min-h-11" required type="number" min={1} max={604800} step={1} value={form.duration} onChange={event => setForm({ ...form, duration: event.target.value })} />{fieldError("duration")}</label>}
          {view.configuration.kind === "approval" && <>
            <label className="block space-y-2"><span id="draft-step-summary-label">{t("workflowDraftStep.summary")}</span><Textarea {...fieldProps("summary")} required maxLength={1000} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} />{fieldError("summary")}</label>
            <label className="block space-y-2"><span id="draft-step-consequence-label">{t("workflowDraftStep.consequence")}</span><Textarea {...fieldProps("consequence")} required maxLength={2000} value={form.consequence} onChange={event => setForm({ ...form, consequence: event.target.value })} />{fieldError("consequence")}</label>
          </>}
          {view.configuration.kind === "agent_task" && <section className="space-y-4" aria-label={t("workflowDraftStep.agent.heading")}>
            <p>{t("workflowDraftStep.agent.boundary")}</p>
            {view.agentSelection && <label className="block space-y-2"><span id="draft-step-agentId-label">{t("workflowDraftStep.agent.choose")}</span>
              <select {...fieldProps("agentId")} className={selectClass} value={form.agentId} onChange={event => setForm({ ...form, agentId: event.target.value })}>
                <option value="">{view.agentSelection.selectedName ? t("workflowDraftStep.agent.keepNamed", { name: view.agentSelection.selectedName }) : t("workflowDraftStep.agent.keep")}</option>
                {form.agentId && !view.agentSelection.choices.some(choice => choice.agentId === form.agentId) && <option value={form.agentId}>{t("workflowDraftStep.agent.unavailable")}</option>}
                {view.agentSelection.choices.map(choice => <option key={choice.agentId} value={choice.agentId}>{choice.name}</option>)}
              </select>{fieldError("agentId")}<span className="block text-sm text-muted-foreground">{t("workflowDraftStep.agent.choiceBoundary")}</span>
            </label>}
            {view.agentSelection && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/advanced?${new URLSearchParams({ node })}`}>{t("workflowEditDraft")}</Link>}
            <p>{t(view.configuration.waitForCompletion ? "workflowDraftStep.agent.waits" : "workflowDraftStep.agent.continues")}</p>
            <label className="block space-y-2"><span id="draft-step-objective-label">{t("workflowDraftStep.agent.objective")}</span>
              <Textarea {...fieldProps("objective")} required maxLength={10000} value={form.objective} onChange={event => setForm({ ...form, objective: event.target.value })} />{fieldError("objective")}</label>
          </section>}
          {view.configuration.kind === "condition" && <section className="space-y-4" aria-label={t("workflowDraftStep.condition.heading")}>
            <p>{t("workflowDraftStep.condition.boundary")}</p>
            <label className="block space-y-2"><span>{t("workflowDraftStep.condition.source")}</span><select className={selectClass} value={form.conditionSource} onChange={event => setForm({ ...form, conditionSource: event.target.value as Form["conditionSource"] })}>
              {["trigger", "variables", "steps"].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.sources.${value}`)}</option>)}
            </select></label>
            <label className="block space-y-2"><span id="draft-step-path-label">{t("workflowDraftStep.condition.path")}</span><Textarea {...fieldProps("path")} required value={form.path} onChange={event => setForm({ ...form, path: event.target.value })} />{fieldError("path")}
              <span className="block text-sm text-muted-foreground">{t("workflowDraftStep.condition.pathHelp")}</span></label>
            <label className="block space-y-2"><span>{t("workflowDraftStep.condition.operator")}</span><select className={selectClass} value={form.operator} onChange={event => setForm({ ...form, operator: event.target.value as Form["operator"] })}>
              {["===", "!==", ">", ">=", "<", "<="].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.operators.${value}`)}</option>)}
            </select></label>
            <label className="block space-y-2"><span id={form.valueType === "null" ? "draft-step-value-label" : undefined}>{t("workflowDraftStep.condition.valueType")}</span><select {...form.valueType === "null" ? fieldProps("value") : {}} className={selectClass} value={form.valueType} onChange={event => setForm({ ...form, valueType: event.target.value as Form["valueType"], value: event.target.value === "boolean" ? "true" : "" })}>
              {["string", "number", "boolean", "null"].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.types.${value}`)}</option>)}
            </select></label>
            {form.valueType !== "null" && <label className="block space-y-2"><span id="draft-step-value-label">{t("workflowDraftStep.condition.value")}</span>
              {form.valueType === "boolean" ? <select {...fieldProps("value")} className={selectClass} value={form.value} onChange={event => setForm({ ...form, value: event.target.value })}><option value="true">{t("workflowDraftStep.condition.true")}</option><option value="false">{t("workflowDraftStep.condition.false")}</option></select>
                : <Input {...fieldProps("value")} className="min-h-11" type={form.valueType === "number" ? "number" : "text"} step="any" maxLength={1000} value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} />}{fieldError("value")}</label>}
            {form.valueType === "null" && fieldError("value")}
          </section>}
          {view.configuration.kind === "advanced" && <div className="space-y-2"><p>{t("workflowDraftStep.advanced")}</p>
            <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/advanced?${new URLSearchParams({ node })}`}>{t("workflowEditDraft")}</Link>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}?revision=draft`}>{t("workflowDraftStep.cancel")}</Link>
            <Button type="submit" className="min-h-11" disabled={!locator.ready || !!locator.blockedBy || locator.failed || stale || mutation.isPending}>{t(mutation.isPending ? "workflowDraftStep.saving" : "workflowDraftStep.save")}</Button>
          </div>
        </fieldset>
      </form>}
  </div>;
}
