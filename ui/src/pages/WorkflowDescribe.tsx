import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { v9FeatureEnabled, workflowIntentDraftCommandSchema, type WorkflowIntentDraftReceipt } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { workflowReadSourceChanged } from "../lib/workflow-source-invalidation";
import { useV9CurrentAccount, hasCurrentV9Session } from "../hooks/useV9CurrentAccount";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { clearPendingWorkflowReceipt, readPendingWorkflowReceipt, retainPendingWorkflowReceipt } from "../lib/pending-workflow-receipts";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { WorkflowAuthoringHandoff } from "../components/WorkflowAuthoringHandoff";

export function WorkflowDescribeEntry() {
  const { selectedCompanyId } = useCompany(), identity = useV9CurrentAccount();
  const { t } = useTranslation("experience");
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (!identity.userId || identity.localImplicit) return <p role="status">{t("workflowIntent.accountRequired")}</p>;
  return <WorkflowDescribe key={`${selectedCompanyId}:${identity.userId}`} company={selectedCompanyId} principal={identity.userId} />;
}

export function WorkflowDescribe({ company, principal }: { company: string; principal: string }) {
  const { t, i18n } = useTranslation("experience"), client = useQueryClient();
  const identity = useV9CurrentAccount(), feature = useV9FeatureEnabled("progressive_shell_v9");
  const { selectedCompanyId } = useCompany();
  const readReady = identity.settled && !identity.localImplicit && identity.userId === principal && selectedCompanyId === company;
  const current = useRef({ readReady, epoch: 0, accountEpoch: identity.authorityEpoch });
  if (current.current.readReady !== readReady || current.current.accountEpoch !== identity.authorityEpoch)
    current.current = { readReady, epoch: current.current.epoch + 1, accountEpoch: identity.authorityEpoch };
  const canRead = () => current.current.readReady && hasCurrentV9Session(client, principal, identity.sessionId);
  const canCreate = () => {
    const state = client.getQueryState(queryKeys.instance.experimentalSettings);
    const flags = client.getQueryData<Awaited<ReturnType<typeof instanceSettingsApi.getExperimental>>>(queryKeys.instance.experimentalSettings);
    return canRead() && !!flags && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated &&
      flags.enableWorkflowsV1 === true && v9FeatureEnabled(flags, "progressive_shell_v9");
  };
  const [form, setForm] = useState({ name: "", outcome: "", trigger: "", sources: "", conditions: "", finalEffect: "", humanJudgment: "" });
  const [requestId, setRequestId] = useState<string | null>(null), [storageReady, setStorageReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false), [validationFailed, setValidationFailed] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<{ receipt: WorkflowIntentDraftReceipt; epoch: number } | null>(null);
  const initialized = useRef(false), submitted = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLDivElement>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!readReady || initialized.current) return;
    initialized.current = true;
    try { setRequestId(readPendingWorkflowReceipt(company, principal)); setStorageReady(true); }
    catch { setStorageFailed(true); }
  }, [readReady, company, principal]);
  useCompanyLiveEvent(event => {
    if (event.companyId !== company || !workflowReadSourceChanged(event)) return;
    current.current = { ...current.current, readReady: false, epoch: current.current.epoch + 1 };
    setConfirmed(null);
    void client.invalidateQueries({ queryKey: queryKeys.auth.session });
  });
  const accept = (receipt: WorkflowIntentDraftReceipt, epoch: number) => {
    if (!alive.current || !canRead() || epoch !== current.current.epoch) throw new Error("Current workflow receipt needs review");
    setConfirmed({ receipt, epoch });
    try { clearPendingWorkflowReceipt(company, principal, receipt.requestId); }
    catch { /* Retain the exact locator; a read never becomes another creation. */ }
  };
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!storageReady || !canCreate() || submitted.current || requestId) throw new Error("Workflow draft creation is unavailable");
      const command = workflowIntentDraftCommandSchema.safeParse({ ...form, requestId: crypto.randomUUID(), locale: i18n.resolvedLanguage === "da" ? "da" : "en" });
      if (!command.success) {
        setInvalidFields(command.error.issues.flatMap(issue => typeof issue.path[0] === "string" ? [issue.path[0]] : []));
        setValidationFailed(true); throw new Error("Complete the workflow description");
      }
      const epoch = current.current.epoch;
      try { retainPendingWorkflowReceipt(company, principal, command.data.requestId); }
      catch { setStorageFailed(true); throw new Error("Workflow recovery is unavailable"); }
      submitted.current = true; setRequestId(command.data.requestId); setValidationFailed(false); setInvalidFields([]);
      const receipt = await workflowAuthoringExperienceApi.create(company, principal, command.data);
      accept(receipt, epoch);
    },
  });
  const recover = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!canRead() || !requestId) throw new Error("Current workflow receipt is unavailable");
      const epoch = current.current.epoch;
      const receipt = await workflowAuthoringExperienceApi.receipt(company, principal, requestId);
      accept(receipt, epoch);
    },
  });
  const receipt = readReady && confirmed?.epoch === current.current.epoch ? confirmed.receipt : null;
  useEffect(() => { if (receipt) heading.current?.focus(); }, [receipt?.workflowId]);
  useEffect(() => { if (readReady && (create.isError || recover.isError || storageFailed || validationFailed)) error.current?.focus(); },
    [readReady, create.isError, recover.isError, storageFailed, validationFailed]);
  const busy = create.isPending || recover.isPending;
  const fields = [
    ["name", 200], ["outcome", 400], ["trigger", 200], ["sources", 200],
    ["conditions", 200], ["finalEffect", 300], ["humanJudgment", 200],
  ] as const;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <Link className="inline-flex min-h-11 items-center underline" to="/workflows">{t("workflowBack")}</Link>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t(receipt ? "workflowIntent.saved" : "workflowIntent.heading")}</h1>
    {!readReady ? <div role={identity.failed ? "alert" : "status"} className="space-y-3">
      <p>{t(identity.failed ? "workflowIntent.accountFailed" : "loading")}</p>
      {identity.failed && <Button className="min-h-11" onClick={() => void client.refetchQueries({ queryKey: queryKeys.auth.session })}>{t("tryAgain")}</Button>}
    </div> : receipt ? <section className="space-y-4" aria-label={t("workflowIntent.receipt")}>
      <p>{t("workflowIntent.savedBoundary")}</p>
      <p>{t("workflowIntent.requestId")}: <span className="break-all font-mono">{receipt.requestId}</span></p>
      <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${receipt.workflowId}`}>{t("workflowIntent.openDraft")}</Link>
      <WorkflowAuthoringHandoff company={company} principal={principal} workflow={receipt.workflowId} />
    </section> : requestId ? <section className="space-y-4" aria-label={t("workflowIntent.recovery")}>
      <div ref={error} role="status" tabIndex={-1}>{t("workflowIntent.unconfirmed")}</div>
      <p className="text-sm text-muted-foreground">{t("workflowIntent.recoveryBoundary")}</p>
      <Button className="min-h-11" disabled={busy} onClick={() => recover.mutate()}>{t(busy ? "loading" : "workflowIntent.checkOriginal")}</Button>
      {recover.isError && <div ref={error} role="alert" tabIndex={-1}><p>{t("workflowIntent.stillUnconfirmed")}</p></div>}
    </section> : storageFailed ? <div ref={error} role="alert" tabIndex={-1}><p>{t("workflowIntent.storageFailed")}</p></div> : <form
      className="space-y-5" onSubmit={event => { event.preventDefault(); if (!busy && canCreate()) create.mutate(); }}>
      <p>{t("workflowIntent.purpose")}</p>
      <p className="text-sm text-muted-foreground">{t("workflowIntent.optional")}</p>
      {fields.map(([field, maxLength]) => {
        const id = `workflow-intent-${field}`, required = field === "name" || field === "outcome";
        const invalid = invalidFields.includes(field);
        const props = { id, maxLength, required, value: form[field], "aria-invalid": invalid || undefined,
          "aria-describedby": invalid ? `${id}-error` : undefined, disabled: busy || !storageReady || !feature.enabled || feature.query.isFetching,
          onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            setForm(value => ({ ...value, [field]: event.target.value }));
            setInvalidFields(value => value.filter(name => name !== field));
          } };
        return <div key={field} className="space-y-2">
          <label className="block font-medium" htmlFor={id}>{t(`workflowIntent.fields.${field}`)}</label>
          {field === "name" ? <Input {...props} /> : <Textarea {...props} rows={3} />}
          {invalid && <p id={`${id}-error`} className="text-sm text-destructive">{t("workflowIntent.invalidField", { max: maxLength })}</p>}
        </div>;
      })}
      {(validationFailed || create.isError) && <div ref={error} role="alert" tabIndex={-1}><p>{t("workflowIntent.validationFailed")}</p></div>}
      {!feature.enabled && <p role="status">{t("workflowIntent.unavailable")}</p>}
      <footer className="flex items-center justify-between gap-4">
        <Link className="inline-flex min-h-11 items-center underline" to="/workflows">{t("workflowIntent.back")}</Link>
        <Button type="submit" className="min-h-11" disabled={busy || !storageReady || !feature.enabled || feature.query.isFetching || !form.name.trim() || !form.outcome.trim()}>
          {t(busy ? "loading" : "workflowIntent.save")}
        </Button>
      </footer>
    </form>}
  </div>;
}
