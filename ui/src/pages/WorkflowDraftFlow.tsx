import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowDraftFlowCommandSchema, type WorkflowDraftFlowCommand, type WorkflowDraftFlowOperation,
  type WorkflowDraftFlowReview, type WorkflowDraftStepReceipt } from "@paperclipai/shared";
import { useParams, Link } from "../lib/router";
import { useTranslation } from "../i18n";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useWorkflowRequestLocator } from "../hooks/useWorkflowRequestLocator";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { workflowDraftFlowApi } from "../api/workflow-draft-flow";
import { workflowReadSourceChanged } from "../lib/workflow-source-invalidation";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

export function WorkflowDraftFlowEntry() {
  const identity = useV9CurrentAccount(), { selectedCompanyId } = useCompany(), { workflowId } = useParams(), { t } = useTranslation("experience");
  if (!identity.settled) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "workflowLoadFailed" : "loading")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId) return <p role="alert">{t("workflowIntent.accountRequired")}</p>;
  if (!workflowId) return <p role="alert">{t("workflowDraftFlow.unavailable")}</p>;
  return <WorkflowDraftFlow key={JSON.stringify([selectedCompanyId, identity.userId, workflowId])} company={selectedCompanyId} principal={identity.userId} workflow={workflowId} />;
}
type Field = "name" | "duration" | "summary" | "consequence" | "deadline" | "path" | "value" | "earlierNode" | "trueName" | "trueDuration" | "falseName" | "falseDuration";
type Condition = Extract<WorkflowDraftFlowOperation, { kind: "append_condition" }>["condition"];
type Form = { source: string; kind: "append_wait" | "append_approval" | "append_condition"; name: string; duration: string; summary: string; consequence: string; deadline: string;
  conditionSource: Condition["source"]; path: string; operator: Condition["operator"]; valueType: "string" | "number" | "boolean" | "null"; value: string;
  earlierNode: string; trueName: string; trueDuration: string; falseName: string; falseDuration: string };
const sourceKey = (view: WorkflowDraftFlowReview) => JSON.stringify([view.draftRevisionId, view.updatedAt, view.steps.at(-1)?.nodeId ?? null]);

export function WorkflowDraftFlow({ company, principal, workflow }: { company: string; principal: string; workflow: string }) {
  const { t } = useTranslation("experience"), client = useQueryClient(), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0), source = useRef(0), [form, setForm] = useState<Form | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({}), [saved, setSaved] = useState<WorkflowDraftStepReceipt | null>(null);
  const [invalid, setInvalid] = useState(false), inFlight = useRef<string | null>(null), error = useRef<HTMLDivElement>(null);
  const prefix = ["v9-workflow-draft-flow", company, principal, workflow], key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, workflow, selectedCompanyId, authority }); scope.current = { company, principal, workflow, selectedCompanyId, authority };
  const current = () => scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Current draft flow scope changed"); const value = await workflowDraftFlowApi.review(company, workflow, principal, signal);
      if (!current()) throw new Error("Current draft flow scope changed"); return value;
    }) });
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const view = fresh ? query.data : null, locator = useWorkflowRequestLocator(company, principal, workflow, "draft_build", !!view);
  const initialize = (value: WorkflowDraftFlowReview) => setForm({ source: sourceKey(value), kind: "append_wait", name: "", duration: "", summary: "", consequence: "", deadline: value.deadlineSeconds === null ? "" : String(value.deadlineSeconds),
    conditionSource: "trigger", path: "", operator: "===", valueType: "string", value: "", earlierNode: "", trueName: "", trueDuration: "", falseName: "", falseDuration: "" });
  useEffect(() => { if (view && !form) initialize(view); }, [view, form]);
  const refresh = () => { source.current++; setEpoch(source.current); void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix }); };
  useCompanyLiveEvent(event => {
    if (event.companyId !== company) return;
    const details = event.payload.details as { requestId?: unknown } | undefined;
    if (event.type === "activity.logged" && event.payload.action === "workflow.customer_draft_flow_saved" && event.payload.entityType === "workflow" && event.payload.entityId === workflow && event.payload.actorId === principal && details?.requestId === inFlight.current) return;
    if (workflowReadSourceChanged(event)) { setSaved(null); refresh(); }
  });
  const mutation = useMutation({ retry: false, gcTime: 0,
    mutationFn: (command: WorkflowDraftFlowCommand) => locator.write(command.requestId, () => workflowDraftFlowApi.save(company, workflow, principal, command)),
    onSuccess: receipt => {
      if (!locator.confirm(receipt)) return; setSaved(receipt); setForm(null); setInvalid(false); setFieldErrors({}); refresh();
      void client.invalidateQueries({ queryKey: ["workflow-experience", company, principal, workflow] });
    },
    onError: err => {
      const code = err instanceof ApiError ? (err.body as { details?: { code?: unknown } } | null)?.details?.code : null;
      if (err instanceof ApiError && err.status === 409 && code === "workflow_draft_flow_conflict") { if (inFlight.current) locator.refused(inFlight.current); refresh(); }
    }, onSettled: () => { inFlight.current = null; },
  });
  const heading = useExperienceHeading(`${company}:${principal}:${workflow}`, !fresh, query.isError);
  useEffect(() => { if (Object.keys(fieldErrors).length && current()) error.current?.focus(); }, [fieldErrors]);
  useEffect(() => { if (mutation.isError && current() && !document.activeElement?.closest('a[href],button,[role="dialog"]')) error.current?.focus(); }, [mutation.isError]);
  const stale = !!view && !!form && sourceKey(view) !== form.source;
  const disabled = !view || !form || !current() || !locator.ready || locator.failed || !!locator.blockedBy || mutation.isPending || stale;
  function save(operation: WorkflowDraftFlowOperation) {
    if (disabled || !view) return;
    const parsed = workflowDraftFlowCommandSchema.safeParse({ requestId: crypto.randomUUID(), expectedWorkflowId: workflow, expectedDraftRevisionId: view.draftRevisionId,
      expectedPublishedRevisionId: view.publishedRevisionId, expectedUpdatedAt: view.updatedAt, expectedLastNodeId: view.steps.at(-1)?.nodeId ?? null, operation });
    if (!parsed.success) {
      const errors: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[1] === "condition" ? issue.path[2] === "path" && form?.conditionSource === "steps" && !form.earlierNode ? "earlierNode" : issue.path[2]
          : issue.path[1] === "whenTrue" ? issue.path[2] === "name" ? "trueName" : "trueDuration"
            : issue.path[1] === "whenFalse" ? issue.path[2] === "name" ? "falseName" : "falseDuration"
              : issue.path[1] === "durationSeconds" ? "duration" : issue.path[1] === "deadlineSeconds" ? "deadline" : issue.path[1];
        if (["name", "duration", "summary", "consequence", "deadline", "path", "value", "earlierNode", "trueName", "trueDuration", "falseName", "falseDuration"].includes(String(field)))
          errors[field as Field] = t(field === "deadline" ? "workflowDraftFlow.deadlineError" : field === "earlierNode" ? "workflowDraftFlow.condition.stepError"
            : `workflowDraftStep.errors.${field === "trueName" || field === "falseName" ? "name" : field === "trueDuration" || field === "falseDuration" ? "duration" : String(field)}`);
      }
      setFieldErrors(errors); setInvalid(true); return;
    }
    setInvalid(false); setFieldErrors({}); setSaved(null); inFlight.current = parsed.data.requestId; mutation.mutate(parsed.data);
  }
  function submit(event: FormEvent) { event.preventDefault(); if (!form) return;
    save(form.kind === "append_wait" ? { kind: "append_wait", name: form.name, durationSeconds: Number(form.duration) }
      : form.kind === "append_condition" ? { kind: "append_condition", name: form.name,
        condition: { kind: "condition", source: form.conditionSource, path: [...(form.conditionSource === "steps" ? [form.earlierNode] : []), ...form.path.split("\n")], operator: form.operator,
          value: form.valueType === "null" ? null : form.valueType === "boolean" ? form.value === "true" : form.valueType === "number" ? form.value.trim() ? Number(form.value) : NaN : form.value },
        whenTrue: { name: form.trueName, durationSeconds: Number(form.trueDuration) }, whenFalse: { name: form.falseName, durationSeconds: Number(form.falseDuration) } }
      : { kind: "append_approval", name: form.name, summary: form.summary, consequence: form.consequence }); }
  const fieldProps = (field: Field) => ({ id: `draft-flow-${field}`, "aria-labelledby": `draft-flow-${field}-label`, "aria-invalid": !!fieldErrors[field],
    "aria-describedby": fieldErrors[field] ? `draft-flow-${field}-error` : undefined });
  const fieldError = (field: Field) => fieldErrors[field] ? <p id={`draft-flow-${field}-error`} className="text-sm text-destructive">{fieldErrors[field]}</p> : null;
  const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline focus-visible:outline-ring";
  if (!current()) return <p role="status">{t("loading")}</p>;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}?revision=draft`}>{t("workflowRequestRecovery.back")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("workflowDraftFlow.heading")}</h1><p>{t("workflowDraftStep.boundary")}</p>
    {saved && fresh && <p role="status">{t("workflowDraftStep.saved", { version: saved.version })}</p>}
    {locator.failed && <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p>}
    {locator.blockedBy && !mutation.isPending && <section className="space-y-3" aria-label={t("workflowRequestRecovery.pending")}><p role="status">{t("workflowDraftStep.unconfirmed")}</p>
      <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/requests/${locator.blockedBy.kind}/${locator.blockedBy.requestId}`}>{t("workflowRequestRecovery.open")}</Link></section>}
    {query.isError ? <div role="alert" className="space-y-3"><p>{t("workflowDraftFlow.unavailable")}</p><Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div>
      : !view || !form ? <p role="status">{t("loading")}</p> : <>
        <p>{t("workflowDraftVersion", { version: view.version })}</p>
        {view.deadlineSeconds !== null && <p>{t("workflowDraftFlow.recordedDeadline", { seconds: view.deadlineSeconds })}</p>}
        {(invalid || mutation.isError || stale) && <div ref={error} tabIndex={-1} role="alert" className="space-y-3"><p>{t(stale ? "workflowDraftStep.changed" : invalid ? "workflowDraftStep.invalid" : "workflowDraftStep.unconfirmed")}</p>
          {invalid && <ul className="list-disc pl-5">{Object.entries(fieldErrors).map(([field, message]) => <li key={field}><a className="inline-flex min-h-11 items-center underline" href={`#draft-flow-${field}`} onClick={event => { event.preventDefault(); document.getElementById(`draft-flow-${field}`)?.focus(); }}>{message}</a></li>)}</ul>}
          {stale && <Button className="min-h-11" onClick={() => { initialize(view); setInvalid(false); setFieldErrors({}); mutation.reset(); }}>{t("workflowDraftStep.reviewLatest")}</Button>}</div>}
        {view.availability === "advanced" ? <section className="space-y-3"><p>{t("workflowDraftFlow.advanced")}</p><Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/advanced`}>{t("workflowEditDraft")}</Link></section>
          : view.availability === "empty" ? <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); save({ kind: "start_manual", name: t("workflowDraftFlow.manualName"), deadlineSeconds: Number(form.deadline) }); }}><p>{t("workflowDraftFlow.empty")}</p><p>{t("workflowDraftFlow.manualBoundary")}</p>
            <label className="block space-y-2"><span id="draft-flow-deadline-label">{t("workflowDraftFlow.deadline")}</span><Input {...fieldProps("deadline")} className="min-h-11" required type="number" min={1} max={60} step={1} value={form.deadline} disabled={disabled} onChange={event => setForm({ ...form, deadline: event.target.value })} />{fieldError("deadline")}</label>
            <p className="text-sm text-muted-foreground">{t("workflowDraftFlow.deadlineHelp")}</p><Button type="submit" className="min-h-11" disabled={disabled}>{t(mutation.isPending ? "workflowDraftStep.saving" : "workflowDraftFlow.start")}</Button></form>
          : <>
            <section aria-label={t("workflowDraftFlow.steps")}><ol className="list-decimal space-y-2 pl-6">{view.steps.map(step => <li key={step.nodeId} className="break-words"><Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/draft/steps/${encodeURIComponent(step.nodeId)}`}>{step.name}</Link></li>)}</ol></section>
            {view.steps.length >= 100 ? <p role="status">{t("workflowDraftFlow.limit")}</p> : <form noValidate onSubmit={submit} className="space-y-4"><h2 className="text-lg font-medium">{t("workflowDraftFlow.add")}</h2>
              <fieldset disabled={disabled} className="space-y-4">
                <label className="block space-y-2"><span>{t("workflowDraftFlow.kind")}</span><select className={selectClass} value={form.kind} onChange={event => { setForm({ ...form, kind: event.target.value as Form["kind"] }); setInvalid(false); setFieldErrors({}); }}><option value="append_wait">{t("workflowDraftFlow.wait")}</option><option value="append_approval">{t("workflowDraftFlow.approval")}</option><option value="append_condition" disabled={view.steps.length > 97}>{t("workflowDraftFlow.condition.kind")}</option></select></label>
                <label className="block space-y-2"><span id="draft-flow-name-label">{t("workflowDraftStep.name")}</span><Input {...fieldProps("name")} className="min-h-11" required maxLength={200} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />{fieldError("name")}</label>
                {form.kind === "append_wait" ? <label className="block space-y-2"><span id="draft-flow-duration-label">{t("workflowDraftStep.duration")}</span><Input {...fieldProps("duration")} className="min-h-11" required type="number" min={1} max={604800} step={1} value={form.duration} onChange={event => setForm({ ...form, duration: event.target.value })} />{fieldError("duration")}</label> : form.kind === "append_condition" ? <section className="space-y-4" aria-label={t("workflowDraftFlow.condition.kind")}>
                  <p>{t("workflowDraftFlow.condition.boundary")}</p>
                  <label className="block space-y-2"><span>{t("workflowDraftStep.condition.source")}</span><select className={selectClass} value={form.conditionSource} onChange={event => setForm({ ...form, conditionSource: event.target.value as Form["conditionSource"] })}>
                    {["trigger", "variables", "steps"].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.sources.${value}`)}</option>)}
                  </select></label>
                  {form.conditionSource === "steps" && <label className="block space-y-2"><span id="draft-flow-earlierNode-label">{t("workflowDraftFlow.condition.step")}</span><select {...fieldProps("earlierNode")} className={selectClass} value={form.earlierNode} onChange={event => setForm({ ...form, earlierNode: event.target.value })}>
                    <option value="">{t("workflowDraftFlow.condition.chooseStep")}</option>{view.steps.map(step => <option key={step.nodeId} value={step.nodeId}>{step.name}</option>)}
                  </select>{fieldError("earlierNode")}</label>}
                  <label className="block space-y-2"><span id="draft-flow-path-label">{t("workflowDraftStep.condition.path")}</span><Textarea {...fieldProps("path")} required value={form.path} onChange={event => setForm({ ...form, path: event.target.value })} />{fieldError("path")}
                    <span className="block text-sm text-muted-foreground">{t("workflowDraftFlow.condition.pathHelp")}</span></label>
                  <label className="block space-y-2"><span>{t("workflowDraftStep.condition.operator")}</span><select className={selectClass} value={form.operator} onChange={event => setForm({ ...form, operator: event.target.value as Form["operator"] })}>
                    {["===", "!==", ">", ">=", "<", "<="].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.operators.${value}`)}</option>)}
                  </select></label>
                  <label className="block space-y-2"><span id={form.valueType === "null" ? "draft-flow-value-label" : undefined}>{t("workflowDraftStep.condition.valueType")}</span><select {...form.valueType === "null" ? fieldProps("value") : {}} className={selectClass} value={form.valueType} onChange={event => setForm({ ...form, valueType: event.target.value as Form["valueType"], value: event.target.value === "boolean" ? "true" : "" })}>
                    {["string", "number", "boolean", "null"].map(value => <option key={value} value={value}>{t(`workflowDraftStep.condition.types.${value}`)}</option>)}
                  </select></label>
                  {form.valueType !== "null" && <label className="block space-y-2"><span id="draft-flow-value-label">{t("workflowDraftStep.condition.value")}</span>
                    {form.valueType === "boolean" ? <select {...fieldProps("value")} className={selectClass} value={form.value} onChange={event => setForm({ ...form, value: event.target.value })}><option value="true">{t("workflowDraftStep.condition.true")}</option><option value="false">{t("workflowDraftStep.condition.false")}</option></select>
                      : <Input {...fieldProps("value")} className="min-h-11" type={form.valueType === "number" ? "number" : "text"} step="any" maxLength={1000} value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} />}{fieldError("value")}</label>}
                  {form.valueType === "null" && fieldError("value")}
                  {(["true", "false"] as const).map(branch => <fieldset key={branch} className="space-y-3"><legend className="font-medium">{t(`workflowDraftFlow.condition.${branch}`)}</legend>
                    <label className="block space-y-2"><span id={`draft-flow-${branch}Name-label`}>{t("workflowDraftStep.name")}</span><Input {...fieldProps(`${branch}Name`)} className="min-h-11" required maxLength={200} value={form[`${branch}Name`]} onChange={event => setForm({ ...form, [`${branch}Name`]: event.target.value })} />{fieldError(`${branch}Name`)}</label>
                    <label className="block space-y-2"><span id={`draft-flow-${branch}Duration-label`}>{t("workflowDraftStep.duration")}</span><Input {...fieldProps(`${branch}Duration`)} className="min-h-11" required type="number" min={1} max={604800} step={1} value={form[`${branch}Duration`]} onChange={event => setForm({ ...form, [`${branch}Duration`]: event.target.value })} />{fieldError(`${branch}Duration`)}</label>
                  </fieldset>)}
                </section> : <>
                  <p>{t("workflowDraftFlow.approvalBoundary")}</p>
                  <label className="block space-y-2"><span id="draft-flow-summary-label">{t("workflowDraftStep.summary")}</span><Textarea {...fieldProps("summary")} required maxLength={1000} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} />{fieldError("summary")}</label>
                  <label className="block space-y-2"><span id="draft-flow-consequence-label">{t("workflowDraftStep.consequence")}</span><Textarea {...fieldProps("consequence")} required maxLength={2000} value={form.consequence} onChange={event => setForm({ ...form, consequence: event.target.value })} />{fieldError("consequence")}</label></>}
                <Button type="submit" className="min-h-11" disabled={disabled}>{t(mutation.isPending ? "workflowDraftStep.saving" : "workflowDraftFlow.add")}</Button>
              </fieldset></form>}
            {view.steps.length > 1 && <section className="space-y-3"><p>{t("workflowDraftFlow.removeBoundary", { name: view.steps.at(-1)!.name })}</p><Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => save({ kind: "remove_last" })}>{t("workflowDraftFlow.remove")}</Button></section>}
          </>}
      </>}
    <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}?revision=draft`}>{t("workflowDraftFlow.review")}</Link>
  </div>;
}
