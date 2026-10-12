import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentDraftTestCommandSchema, verificationReviewSchema, type AgentAuthoringDraftView, type AgentDraftTestCommand, type AgentDraftTestReview, type AgentDraftTestView, type VerificationPacket } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

/** Only the saved candidate is submitted. An unresolved command is reconciled
 * by its original identity and is never automatically dispatched again. */
export function AgentDraftSafeTest({ company, principal, draft, enabled, canUseAuthority }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), checkboxId = useId();
  const alive = useRef(true), latest = useRef({ company, principal, draft, enabled, canUseAuthority });
  latest.current = { company, principal, draft, enabled, canUseAuthority };
  const [scenarioIndex, setScenarioIndex] = useState(0), [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [unknown, setUnknown] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const attempt = useRef<AgentDraftTestCommand | null>(null), decisionHash = useRef<string | null>(null);
  const storageKey = `aw:v9:agent-test:${encodeURIComponent(company)}:${encodeURIComponent(principal)}:${draft.id}:${draft.version}`;
  const agentId = draft.agentId ?? draft.preparation?.agentId ?? null;
  const scenarios = draft.content?.scenarios ?? [];
  function current(write = false) {
    const value = latest.current;
    return alive.current && value.enabled && value.canUseAuthority() && (write ? authority.canWrite() : authority.canRead()) &&
      value.company === company && value.principal === principal && value.draft.id === draft.id && value.draft.companyId === company &&
      value.draft.createdByUserId === principal && value.draft.version === draft.version;
  }
  useEffect(() => {
    alive.current = true; attempt.current = null; setUnknown(false); setFailure(null);
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) { const parsed = agentDraftTestCommandSchema.safeParse(JSON.parse(stored));
        if (parsed.success && parsed.data.expectedVersion === draft.version) { attempt.current = parsed.data; setUnknown(true); } }
    } catch { /* Stored identity supplies no permission. */ }
    return () => { alive.current = false; };
  }, [storageKey, draft.version]);
  const historyKey = ["agent-draft-tests", company, principal, authority.epoch, draft.id, draft.version];
  const reviewKey = [...historyKey, "review", scenarioIndex];
  const history = useQuery({ queryKey: historyKey, enabled: enabled && authority.readReady && !!agentId,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error(t("agentSafeTest.changed"));
      const values = await agentAuthoringApi.tests(company, principal, draft.id, signal);
      if (!current() || values.some(value => value.companyId !== company || value.draftId !== draft.id || value.agentId !== agentId)) throw new Error(t("agentSafeTest.changed"));
      return values;
    }) });
  const review = useQuery({ queryKey: reviewKey, enabled: enabled && authority.writeReady && !!agentId && !!scenarios[scenarioIndex],
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true)) throw new Error(t("agentSafeTest.changed"));
      const value = await agentAuthoringApi.testReview(company, principal, draft.id, scenarioIndex, signal);
      if (!current(true) || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version || value.agentId !== agentId || value.scenarioIndex !== scenarioIndex)
        throw new Error(t("agentSafeTest.changed"));
      return value;
    }) });
  useEffect(() => { setOpen(false); setConfirmed(false); }, [authority.epoch, enabled, scenarioIndex, review.data?.reviewHash]);
  function currentReview() {
    const state = client.getQueryState(reviewKey), value = client.getQueryData<AgentDraftTestReview>(reviewKey);
    if (!current(true) || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated || !value || value.version !== draft.version)
      throw new Error(t("agentSafeTest.changed"));
    return value;
  }
  function accept(value: AgentDraftTestView) {
    if (!current() || value.companyId !== company || value.draftId !== draft.id || value.version > draft.version || value.agentId !== agentId || value.requestId !== attempt.current?.requestId)
      throw new Error(t("agentSafeTest.changed"));
    sessionStorage.removeItem(storageKey); attempt.current = null; setUnknown(false); setOpen(false); setConfirmed(false); setFailure(null);
    client.setQueryData<AgentDraftTestView[]>(historyKey, previous => [value, ...(previous ?? []).filter(item => item.id !== value.id)]);
    void client.invalidateQueries({ queryKey: reviewKey, exact: true });
    refreshReadiness();
  }
  function refreshReadiness() {
    if (!current()) return;
    for (const prefix of ["agent-authoring-review", "hire-agent-review"])
      void client.invalidateQueries({ queryKey: [prefix, company, principal, draft.id] });
  }
  const run = useMutation({ mutationFn: async () => {
    if (attempt.current || unknown) throw new Error(t("agentSafeTest.unknown"));
    const value = currentReview();
    if (!confirmed || decisionHash.current !== value.reviewHash) throw new Error(t("agentSafeTest.changed"));
    const command: AgentDraftTestCommand = { requestId: crypto.randomUUID(), expectedVersion: draft.version, scenarioIndex,
      expectedReviewHash: value.reviewHash, confirmRepresentativeTest: true, confirmCompanyVisibleResult: true };
    sessionStorage.setItem(storageKey, JSON.stringify(command)); attempt.current = command;
    return authority.write(() => agentAuthoringApi.startTest(company, principal, draft.id, command));
  }, onSuccess: value => { if (!authority.confirmed(value) || !current()) return;
    try { accept(value); } catch { setUnknown(true); setFailure(t("agentSafeTest.changed")); }
  }, onError: () => { if (current()) { setUnknown(!!attempt.current); setOpen(false); setFailure(t(attempt.current ? "agentSafeTest.unknown" : "agentSafeTest.changed")); } } });
  const check = useMutation({ mutationFn: () => authority.read(async () => {
    if (!current() || !attempt.current) throw new Error(t("agentSafeTest.changed"));
    return agentAuthoringApi.testReceipt(company, principal, draft.id, attempt.current.requestId);
  }), onSuccess: value => { if (!current()) return;
    if (!value) { setFailure(t("agentSafeTest.unknown")); return; }
    try { accept(value); } catch { setFailure(t("agentSafeTest.changed")); }
  }, onError: () => { if (current()) setFailure(t("agentSafeTest.changed")); } });
  if (!agentId) return <p>{t("agentSafeTest.prepareFirst")}</p>;
  if (!enabled) return <p>{t("agentSafeTest.saveFirst")}</p>;
  if (!authority.readReady || !current()) return <p role="status">{t("agentSafeTest.checking")}</p>;
  const pending = run.isPending || check.isPending;
  return <section className="space-y-3" aria-label={t("agentSafeTest.title")}>
    <h2 className="text-lg font-semibold">{t("agentSafeTest.title")}</h2>
    <p>{t("agentSafeTest.boundary")}</p>
    {scenarios.length > 1 ? <label className="block space-y-2">{t("agentSafeTest.scenario")}<select className="min-h-11 rounded-md border bg-background p-2" value={scenarioIndex}
      disabled={pending || unknown} onChange={event => setScenarioIndex(Number(event.target.value))}>
      {scenarios.map((scenario, index) => <option key={index} value={index}>{scenario}</option>)}
    </select></label> : null}
    {review.isFetching ? <p role="status">{t("agentSafeTest.checking")}</p> : null}
    {review.isError ? <p role="status">{t("agentSafeTest.unavailable")}</p> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    {review.data && !review.isFetching && !review.isError && !unknown ? <Button className="min-h-11" disabled={pending || !authority.writeReady}
      onClick={() => { try { decisionHash.current = currentReview().reviewHash; setConfirmed(false); setOpen(true); } catch { setFailure(t("agentSafeTest.changed")); } }}>{t("agentSafeTest.review")}</Button> : null}
    <AlertDialog open={open} onOpenChange={value => { setOpen(value); if (!value) setConfirmed(false); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("agentSafeTest.confirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{t("agentSafeTest.boundary")}</AlertDialogDescription></AlertDialogHeader>
        <dl className="space-y-2"><dt>{t("agentSafeTest.candidateVersion", { version: draft.version })}</dt><dd>{draft.content?.name}</dd>
          <dt>{t("agentSafeTest.model")}</dt><dd>Anthropic · {review.data?.model}</dd>
          <dt>{t("agentSafeTest.scenario")}</dt><dd className="whitespace-pre-wrap">{review.data?.scenario}</dd>
          <dt>{t("agentSafeTest.maximumCost")}</dt><dd>{review.data ? `${(review.data.maximumCostMinor / 100).toFixed(2)} USD` : ""}</dd></dl>
        <p>{t("agentSafeTest.modelDisclosure")}</p>
        <p>{t("agentSafeTest.sharedResult")}</p>
        <label htmlFor={checkboxId} className="flex min-h-11 items-start gap-3"><input id={checkboxId} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          <span>{t("agentSafeTest.confirmation")}</span></label>
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel><Button className="min-h-11" disabled={!confirmed || pending || !authority.writeReady}
          onClick={() => run.mutate()}>{t("agentSafeTest.run")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {unknown ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => check.mutate()}>{t("agentSafeTest.checkOriginal")}</Button> : null}
    <Button className="min-h-11" variant="outline" disabled={pending || history.isFetching} onClick={() => { void history.refetch(); refreshReadiness(); }}>{t("agentSafeTest.refresh")}</Button>
    {history.isError ? <p role="alert">{t("agentSafeTest.changed")}</p> : null}
    {!history.isFetching && !history.isError ? history.data?.map(value => <AgentDraftTestResult key={`${value.id}:${authority.epoch}`} value={value} company={company} principal={principal} draftId={draft.id}
      canUseAuthority={() => current() && !pending && !history.isFetching} onChanged={() => { void history.refetch(); refreshReadiness(); }} />) : null}
  </section>;
}

function AgentDraftTestResult({ value, company, principal, draftId, canUseAuthority, onChanged }: {
  value: AgentDraftTestView; company: string; principal: string; draftId: string; canUseAuthority: () => boolean; onChanged: () => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal);
  const latest = useRef({ value, canUseAuthority }); latest.current = { value, canUseAuthority };
  const alive = useRef(true), [packet, setPacket] = useState<VerificationPacket | null>(null), [failure, setFailure] = useState<string | null>(null);
  const [rationale, setRationale] = useState(""), [objective, setObjective] = useState(false), [evidenceConfirmed, setEvidenceConfirmed] = useState(false);
  const [humanApproved, setHumanApproved] = useState(false);
  const [judgements, setJudgements] = useState<Record<string, boolean>>({}), [result, setResult] = useState<"pass" | "fail" | "inconclusive" | "needs_human" | "">("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function current() { return alive.current && authority.canRead() && latest.current.canUseAuthority() && latest.current.value.id === value.id &&
    latest.current.value.candidateCurrent && latest.current.value.runtimeCurrent && latest.current.value.resultCurrent && latest.current.value.execution === "succeeded"; }
  useEffect(() => { setPacket(null); setJudgements({}); setResult(""); setRationale(""); setObjective(false); setEvidenceConfirmed(false); setHumanApproved(false); },
    [value.candidateCurrent, value.runtimeCurrent, value.resultCurrent, value.result, authority.epoch]);
  const load = useMutation({ mutationFn: () => authority.read(async () => {
    if (!current()) throw new Error(t("agentSafeTest.changed"));
    const loaded = await agentAuthoringApi.testVerificationPacket(company, principal, draftId, value.requestId);
    if (!current() || loaded.planId !== value.planId || loaded.workerId !== null) throw new Error(t("agentSafeTest.changed"));
    return loaded;
  }), onSuccess: loaded => { if (current()) { setPacket(loaded); setFailure(null); } }, onError: () => { if (alive.current && canUseAuthority()) setFailure(t("agentSafeTest.changed")); } });
  const verify = useMutation({ mutationFn: () => authority.write(async () => {
    if (!current() || !packet || !result) throw new Error(t("agentSafeTest.changed"));
    const refs = evidenceConfirmed ? packet.evidence.map(evidence => evidence.ref) : [];
    const input = verificationReviewSchema.parse({ expectedPlanVersion: packet.planVersion, expectedResultHash: packet.resultHash, workerId: null,
      result, rationale, objectiveSatisfied: objective, explicitHighImpactApproval: humanApproved,
      ...Object.fromEntries((["businessInvariants", "evidenceRequirements", "prohibitedOutcomes"] as const).map(group => [group,
        packet.contract[group].map((_, index) => ({ index, satisfied: !!judgements[`${group}:${index}`], evidenceRefs: refs }))])) });
    return agentAuthoringApi.verifyTest(company, principal, draftId, value.requestId, input);
  }), onSuccess: receipt => { if (authority.confirmed(receipt) && current() && receipt.id === value.id) { setPacket(null); onChanged(); } },
    onError: () => { if (alive.current && canUseAuthority()) { setPacket(null); setFailure(t("agentSafeTest.reviewUnresolved")); onChanged(); } } });
  return <article className="space-y-3 rounded-md border p-3">
    <h3 className="font-semibold">{t("agentSafeTest.scenario")}</h3><p className="whitespace-pre-wrap">{value.scenario}</p>
    <p role="status">{t(`agentSafeTest.execution.${value.execution}`)} · {t(`agentSafeTest.verification.${value.verification}`)}</p>
    <p>{t(value.testQualified ? "agentSafeTest.qualified" : "agentSafeTest.notQualified")}</p>
    {!value.candidateCurrent || !value.runtimeCurrent || (value.execution === "succeeded" && !value.resultCurrent) ? <p>{t("agentSafeTest.stale")}</p> : null}
    {value.result !== null ? <><h3 className="font-semibold">{t("agentSafeTest.actual")}</h3><pre className="whitespace-pre-wrap break-words">{value.result}</pre></> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    {current() ? <Button className="min-h-11" variant="outline" disabled={load.isPending || verify.isPending} onClick={() => load.mutate()}>{t("agentSafeTest.reviewResult")}</Button> : null}
    {packet && current() ? <fieldset className="space-y-3" disabled={verify.isPending || !authority.writeReady}>
      <legend className="font-semibold">{t("agentSafeTest.humanReview")}</legend><p>{packet.contract.objective}</p>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={objective} onChange={event => setObjective(event.target.checked)} />{t("agentSafeTest.objectiveSatisfied")}</label>
      {(["businessInvariants", "evidenceRequirements", "prohibitedOutcomes"] as const).map(group => <fieldset key={group} className="space-y-2"><legend>{t(`agentSafeTest.${group}`)}</legend>
        {packet.contract[group].map((criterion, index) => <label key={index} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={!!judgements[`${group}:${index}`]}
          onChange={event => setJudgements(previous => ({ ...previous, [`${group}:${index}`]: event.target.checked }))} />{criterion}</label>)}
      </fieldset>)}
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={evidenceConfirmed} onChange={event => setEvidenceConfirmed(event.target.checked)} />{t("agentSafeTest.evidenceConfirmation")}</label>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={humanApproved} onChange={event => setHumanApproved(event.target.checked)} />{t("agentSafeTest.humanApproval")}</label>
      <label className="block space-y-2">{t("agentSafeTest.reviewDecision")}<select className="min-h-11 rounded-md border bg-background p-2" value={result} onChange={event => setResult(event.target.value as typeof result)}>
        <option value="">{t("agentSafeTest.chooseDecision")}</option>{(["pass", "fail", "inconclusive", "needs_human"] as const).map(decision => <option key={decision} value={decision}>{t(`agentSafeTest.verification.${decision}`)}</option>)}
      </select></label>
      <label className="block space-y-2">{t("agentSafeTest.rationale")}<Textarea maxLength={2000} value={rationale} onChange={event => setRationale(event.target.value)} /></label>
      <Button className="min-h-11" disabled={!result || (result === "pass" && !humanApproved) || rationale.trim().length < 20 || verify.isPending} onClick={() => verify.mutate()}>{t("agentSafeTest.submitReview")}</Button>
    </fieldset> : null}
  </article>;
}
