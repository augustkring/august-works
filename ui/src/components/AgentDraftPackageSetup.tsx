import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentPackageSetupCommandSchema, type AgentAuthoringDraftView, type AgentPackageSetupCommand, type AgentPackageSetupReview, type AgentPackageSetupReceipt } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { ApiError } from "@/api/client";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

/** The Original package and governance owners supply every reviewed fact.
 * Unknown acknowledgements retain only the original command identity and are
 * reconciled by an explicit read; they never trigger another POST. */
export function AgentDraftPackageSetup({ company, principal, draft, enabled, canUseAuthority, onConfirmed }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean;
  canUseAuthority: () => boolean; onConfirmed: (draft: AgentAuthoringDraftView) => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), label = useId();
  const [purposeId, setPurposeId] = useState<string | null>(null), [open, setOpen] = useState(false);
  const [purposeConsent, setPurposeConsent] = useState(false), [activationConsent, setActivationConsent] = useState(false);
  const [unknown, setUnknown] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true), attempt = useRef<AgentPackageSetupCommand | null>(null), decisionHash = useRef<string | null>(null);
  const latest = useRef({ company, principal, draft, enabled, canUseAuthority }); latest.current = { company, principal, draft, enabled, canUseAuthority };
  const storageKey = `aw:v9:package-setup:${encodeURIComponent(company)}:${encodeURIComponent(principal)}:${draft.id}`;
  function current(write = true) {
    const value = latest.current;
    return alive.current && value.company === company && value.principal === principal && value.draft.id === draft.id &&
      value.draft.companyId === company && value.draft.createdByUserId === principal && value.canUseAuthority() &&
      (write ? value.enabled && value.draft.version === draft.version && authority.canWrite() : authority.canRead());
  }
  useEffect(() => {
    alive.current = true; attempt.current = null; setUnknown(false); setFailure(null);
    try { const stored = sessionStorage.getItem(storageKey); if (stored) {
      const parsed = agentPackageSetupCommandSchema.safeParse(JSON.parse(stored));
      if (parsed.success) { attempt.current = parsed.data; setUnknown(true); }
    } } catch { /* Storage grants no authority. */ }
    return () => { alive.current = false; };
  }, [storageKey]);
  const reviewKey = ["agent-package-setup", company, principal, draft.id, draft.version, purposeId, authority.epoch];
  const review = useQuery({ queryKey: reviewKey, queryFn: ({ signal }) => authority.read(async () => {
    if (!current()) throw new Error("current setup required");
    const value = await agentAuthoringApi.packageSetupReview(company, principal, draft.id, purposeId, signal);
    if (!current() || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version)
      throw new Error("current setup required");
    return value;
  }), enabled: enabled && authority.writeReady && draft.kind === "hire" && !!draft.preparation && !unknown,
    retry: false, gcTime: 0, staleTime: 0 });
  useEffect(() => { setOpen(false); setPurposeConsent(false); setActivationConsent(false); }, [authority.epoch, enabled, draft.version, review.data?.reviewHash, purposeId, review.isFetching, review.isError]);
  function currentReview() {
    const state = client.getQueryState(reviewKey), value = client.getQueryData<AgentPackageSetupReview>(reviewKey);
    if (!current() || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated ||
      !value || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version || !value.canConfirm)
      throw new Error("current setup required");
    return value;
  }
  async function accept(value: AgentPackageSetupReceipt) {
    if (!current(false) || !attempt.current || value.requestId !== attempt.current.requestId || value.companyId !== company ||
      value.draftId !== draft.id || value.agentId !== draft.preparation?.agentId) throw new Error("current original receipt required");
    const latestDraft = await authority.read(() => agentAuthoringApi.get(company, principal, draft.id));
    if (!current(false) || latestDraft.companyId !== company || latestDraft.id !== draft.id || latestDraft.createdByUserId !== principal)
      throw new Error("current original receipt required");
    try { sessionStorage.removeItem(storageKey); } catch { /* Known receipt remains in the Original owner. */ }
    attempt.current = null; setUnknown(false); setOpen(false); setFailure(null); onConfirmed(latestDraft);
  }
  const confirm = useMutation({ mutationFn: () => authority.write(async () => {
    const value = currentReview();
    if (!purposeConsent || !activationConsent || value.reviewHash !== decisionHash.current || !value.selectedPurposeId)
      throw new Error("current setup consent required");
    const command = agentPackageSetupCommandSchema.parse({ requestId: crypto.randomUUID(), expectedVersion: draft.version,
      expectedReviewHash: value.reviewHash, purposeId: value.selectedPurposeId, confirmIntendedPurpose: true, confirmPackageActivation: true });
    sessionStorage.setItem(storageKey, JSON.stringify(command)); attempt.current = command;
    return agentAuthoringApi.confirmPackageSetup(company, principal, draft.id, command);
  }), onSuccess: async value => {
    if (!current(false)) return;
    try { await accept(value); } catch { if (current(false)) { setUnknown(!!attempt.current); setFailure(t("agentPackageSetup.changed")); } }
  }, onError: error => { if (current(false)) {
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      try { sessionStorage.removeItem(storageKey); } catch { /* No acknowledged setup effect exists. */ }
      attempt.current = null;
      void client.invalidateQueries({ queryKey: ["agent-package-setup", company, principal, draft.id] });
    }
    setUnknown(!!attempt.current); setOpen(false);
    setFailure(t(attempt.current ? "agentPackageSetup.unknown" : "agentPackageSetup.changed"));
  } } });
  const check = useMutation({ mutationFn: () => authority.read(async () => {
    if (!current(false) || !attempt.current) throw new Error("current original receipt required");
    return agentAuthoringApi.packageSetupReceipt(company, principal, draft.id, attempt.current.requestId);
  }), onSuccess: async value => { if (!current(false)) return;
    if (!value) { setFailure(t("agentPackageSetup.unknown")); return; }
    try { await accept(value); } catch { if (current(false)) setFailure(t("agentPackageSetup.changed")); }
  }, onError: () => { if (current(false)) setFailure(t("agentPackageSetup.changed")); } });
  if (!enabled || draft.kind !== "hire" || !draft.preparation) return null;
  if (!current(false) || !authority.readReady) return <p role="status">{t("agentSafeTest.checking")}</p>;
  const visible = review.isSuccess && !review.isFetching && !review.isError && !unknown;
  const pending = confirm.isPending || check.isPending;
  return <section className="space-y-3" aria-label={t("agentPackageSetup.title")}>
    <h2 className="text-lg font-semibold">{t("agentPackageSetup.title")}</h2>
    <p>{t("agentPackageSetup.boundary")}</p>
    {failure ? <p role="alert">{failure}</p> : null}
    {unknown ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => check.mutate()}>{t("agentPackageSetup.checkOriginal")}</Button> : null}
    {!unknown && !visible ? <p role="status">{t(review.isError ? "agentPackageSetup.unavailable" : "agentSafeTest.checking")}</p> : null}
    {visible && review.data.packageCurrent ? <p role="status">{t("agentPackageSetup.ready")}</p> : null}
    {visible && !review.data.packageCurrent ? <>
      <p className="whitespace-pre-wrap">{review.data.intendedPurpose}</p>
      <label htmlFor={`${label}-purpose`} className="block font-medium">{t("agentPackageSetup.purpose")}</label>
      <select id={`${label}-purpose`} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground"
        value={purposeId ?? review.data.selectedPurposeId ?? ""} disabled={pending || !authority.writeReady}
        onChange={event => setPurposeId(event.target.value || null)}>
        <option value="">{t("agentPackageSetup.choose")}</option>
        {review.data.purposes.map(purpose => <option key={purpose.id} value={purpose.id}>{purpose.name}</option>)}
      </select>
      {review.data.blockers.map(code => <p key={code}>{t(`agentPackageSetup.blockers.${code}`)}</p>)}
      {!review.data.purposes.length ? <Link className="inline-flex min-h-11 items-center underline" to="/ai-governance">{t("agentPackageSetup.reviewPurpose")}</Link> : null}
      <Button className="min-h-11" variant="outline" disabled={pending || !authority.writeReady || !review.data.canConfirm}
        onClick={() => { try { decisionHash.current = currentReview().reviewHash; setPurposeConsent(false); setActivationConsent(false); setOpen(true); }
          catch { setFailure(t("agentPackageSetup.changed")); } }}>{t("agentPackageSetup.review")}</Button>
    </> : null}
    <AlertDialog open={open && !unknown && review.isSuccess && !review.isFetching && current()} onOpenChange={setOpen}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("agentPackageSetup.review")}</AlertDialogTitle>
        <AlertDialogDescription>{t("agentPackageSetup.boundary")}</AlertDialogDescription></AlertDialogHeader>
        <p>{review.data?.packageName} · {review.data?.packageVersion}</p>
        <p className="whitespace-pre-wrap">{review.data?.intendedPurpose}</p>
        <p>{review.data?.purposes.find(purpose => purpose.id === review.data?.selectedPurposeId)?.name}</p>
        <label htmlFor={`${label}-purpose-consent`} className="flex min-h-11 items-start gap-3"><input id={`${label}-purpose-consent`} type="checkbox"
          checked={purposeConsent} onChange={event => setPurposeConsent(event.target.checked)} /><span>{t("agentPackageSetup.confirmPurpose")}</span></label>
        <label htmlFor={`${label}-activation-consent`} className="flex min-h-11 items-start gap-3"><input id={`${label}-activation-consent`} type="checkbox"
          checked={activationConsent} onChange={event => setActivationConsent(event.target.checked)} /><span>{t("agentPackageSetup.confirmActivation")}</span></label>
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel>
          <Button className="min-h-11" disabled={!purposeConsent || !activationConsent || pending || !authority.writeReady} onClick={() => confirm.mutate()}>{t("agentPackageSetup.confirm")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
