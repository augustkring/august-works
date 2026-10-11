import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ActivationConnectionConsentCommand, ActivationConnectionConsentReceipt, ActivationConnectionReview } from "@paperclipai/shared";
import { activationConnectionApi } from "../api/activation-connections";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { onboardingConsentAttemptKey, readOnboardingConsentAttempt, saveOnboardingConsentAttempt } from "../features/connections/onboarding-consent-attempt";
import { ConnectionSetupFlow } from "../features/connections/ConnectionSetupFlow";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";

const permissionFields = ["neededNow", "why", "usedBy", "canRead", "canChange", "notRequested", "automatic", "asksFirst"] as const;

/** Separate purpose approval and original provider setup. Neither an OAuth
 * callback nor this UI supplies Agent authority, Safe Test or first-value proof. */
export function ActivationConnectionConsent({ companyId, principal, runId, version, packageVersionId, applicationKey, enabled, canUseAuthority, onSetupChanged }: {
  companyId: string; principal: string; runId: string; version: number; packageVersionId: string;
  applicationKey: string; enabled: boolean; canUseAuthority: () => boolean; onSetupChanged: () => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal), client = useQueryClient(), checkboxId = useId();
  const [decision, setDecision] = useState<"approve" | "withdraw" | null>(null), [confirmed, setConfirmed] = useState(false),
    [unknown, setUnknown] = useState(false), [setup, setSetup] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const attemptKey = onboardingConsentAttemptKey(companyId, principal, runId, version, applicationKey);
  const [restoredAttempt] = useState(() => {
    try { return readOnboardingConsentAttempt(window.sessionStorage, attemptKey); } catch { return null; }
  });
  const attempt = useRef<ActivationConnectionConsentCommand | null>(restoredAttempt);
  const decisionReviewHash = useRef<string | null>(null), decisionReceipt = useRef<ActivationConnectionConsentReceipt | null>(null);
  const queryRoot = ["activation-connection-consent", companyId, principal, authority.epoch, runId, version, packageVersionId, applicationKey];
  const reviewKey = [...queryRoot, "review"], receiptKey = [...queryRoot, "receipt"];
  const scopeCurrent = () => authority.canRead() && canUseAuthority();
  async function currentRead<T>(operation: () => Promise<T>) {
    return authority.read(async () => {
      if (!scopeCurrent()) throw new Error(t("activation.connectionConsent.contextChanged"));
      const value = await operation();
      if (!scopeCurrent()) throw new Error(t("activation.connectionConsent.contextChanged"));
      return value;
    });
  }
  const review = useQuery({ queryKey: reviewKey, queryFn: ({ signal }) => currentRead(async () => {
    const value = await activationConnectionApi.review(companyId, principal, applicationKey, signal);
    if (value.onboardingRunId !== runId || value.onboardingVersion !== version || value.packageVersionId !== packageVersionId)
      throw new Error(t("activation.connectionConsent.contextChanged"));
    return value;
  }), enabled: authority.readReady && enabled && canUseAuthority(), retry: false, staleTime: 0, gcTime: 0 });
  const receipt = useQuery({ queryKey: receiptKey, queryFn: ({ signal }) => currentRead(async () => {
    const value = await activationConnectionApi.currentReceipt(companyId, principal, applicationKey, signal);
    if (value && value.onboardingRunId !== runId) throw new Error(t("activation.connectionConsent.contextChanged"));
    return value;
  }), enabled: authority.readReady && canUseAuthority(), retry: false, staleTime: 0, gcTime: 0 });
  useEffect(() => { setDecision(null); setConfirmed(false); setSetup(false); }, [authority.epoch, review.data?.reviewHash]);
  function currentReview() {
    const state = client.getQueryState(reviewKey), value = client.getQueryData<ActivationConnectionReview>(reviewKey);
    if (!enabled || !scopeCurrent() || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated ||
        !value || value.onboardingRunId !== runId || value.onboardingVersion !== version || value.packageVersionId !== packageVersionId)
      throw new Error(t("activation.connectionConsent.contextChanged"));
    return value;
  }
  function currentReceipt() {
    const state = client.getQueryState(receiptKey), value = client.getQueryData<ActivationConnectionConsentReceipt | null>(receiptKey);
    if (!scopeCurrent() || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated)
      throw new Error(t("activation.connectionConsent.contextChanged"));
    return value;
  }
  const approve = useMutation({ mutationFn: async () => {
    const value = currentReview();
    if (!confirmed || currentReceipt() || decisionReviewHash.current !== value.reviewHash) throw new Error(t("activation.connectionConsent.contextChanged"));
    if (!attempt.current) {
      const command = { requestKey: crypto.randomUUID(), confirmConnectionAuthorization: true as const, expectedReviewHash: value.reviewHash };
      saveOnboardingConsentAttempt(window.sessionStorage, attemptKey, command);
      attempt.current = command;
    }
    if (attempt.current.expectedReviewHash !== value.reviewHash) throw new Error(t("activation.connectionConsent.contextChanged"));
    return authority.write(() => currentRead(() => activationConnectionApi.approve(companyId, principal, applicationKey, attempt.current!)));
  }, onSuccess: value => {
    if (!authority.confirmed(value) || !scopeCurrent()) return;
    client.setQueryData(receiptKey, value); setUnknown(false); setDecision(null); setConfirmed(false); setFailure(null);
  }, onError: () => { setUnknown(true); setDecision(null); setSetup(false); setFailure(t("activation.connectionConsent.unknown")); } });
  const withdraw = useMutation({ mutationFn: async () => {
    const value = currentReceipt();
    if (!enabled || !confirmed || !value || value.id !== decisionReceipt.current?.id || value.reviewHash !== decisionReceipt.current?.reviewHash)
      throw new Error(t("activation.connectionConsent.contextChanged"));
    return authority.write(() => currentRead(() => activationConnectionApi.withdraw(companyId, principal, value.requestKey, value.reviewHash)));
  }, onSuccess: value => {
    if (!authority.confirmed(value) || !scopeCurrent()) return;
    client.setQueryData(receiptKey, null); window.sessionStorage.removeItem(attemptKey); attempt.current = null; setUnknown(false); setDecision(null); setConfirmed(false); setSetup(false);
    setFailure(t("activation.connectionConsent.withdrawn")); onSetupChanged();
  }, onError: () => { setDecision(null); setSetup(false); setFailure(t("activation.connectionConsent.unknown")); } });
  const pending = approve.isPending || withdraw.isPending;
  async function checkReceipt() {
    setSetup(false);
    try {
      const original = attempt.current ? await currentRead(() => activationConnectionApi.receipt(companyId, principal, attempt.current!.requestKey)) :
        await currentRead(() => activationConnectionApi.currentReceipt(companyId, principal, applicationKey));
      client.setQueryData(receiptKey, original?.status === "withdrawn" ? null : original);
      if (original) { setUnknown(false); setFailure(null); }
      if (original?.status === "connected" || original?.status === "withdrawn") onSetupChanged();
    } catch (error) { setFailure(error instanceof Error ? error.message : t("activation.connectionConsent.unknown")); }
  }
  if (!authority.readReady || !canUseAuthority()) return <p role="status">{t("activation.connectionConsent.checking")}</p>;
  if (review.isPending || receipt.isPending || review.isFetching || receipt.isFetching) return <p role="status">{t("activation.connectionConsent.checking")}</p>;
  const reviewed = review.data, saved = receipt.data;
  const samePurpose = saved && reviewed && saved.packageVersionId === packageVersionId && saved.applicationId === reviewed.applicationId &&
    saved.onboardingVersion === version && saved.reviewHash === reviewed.reviewHash;
  return <section className="space-y-4 rounded-lg border border-border p-4" aria-label={`${t("activation.connectionConsent.title")}: ${reviewed?.applicationName ?? applicationKey} (${applicationKey})`}>
    <h2 className="text-lg font-semibold break-words">{reviewed?.applicationName ?? applicationKey}</h2>
    {review.isError || receipt.isError ? <p role="status">{t("activation.connectionConsent.unavailable")}</p> : null}
    {reviewed ? <dl className="space-y-3">{permissionFields.map(field => <div key={field}>
      <dt className="font-medium">{t(`activation.connectionConsent.fields.${field}`)}</dt>
      <dd className="break-words">{Array.isArray(reviewed.preview[field]) ? <ul className="list-disc space-y-1 pl-5">
        {(reviewed.preview[field] as string[]).map(statement => <li key={statement}>{statement}</li>)}</ul> : reviewed.preview[field] as string}</dd>
    </div>)}</dl> : null}
    <p>{t("activation.connectionConsent.boundary")}</p>
    {failure ? <p role="alert">{failure}</p> : null}
    {saved ? <p role="status">{t(`activation.connectionConsent.status.${samePurpose ? saved.status : "changed"}`)}</p> : null}
    <AlertDialog open={decision !== null} onOpenChange={open => { if (!open) { setDecision(null); setConfirmed(false); } }}>
      {!saved && reviewed && (!unknown || attempt.current?.expectedReviewHash === reviewed.reviewHash) ? <AlertDialogTrigger asChild><Button className="min-h-11" disabled={!enabled || pending}
        onClick={() => { try { decisionReviewHash.current = currentReview().reviewHash; setDecision("approve"); setConfirmed(false); }
          catch { setFailure(t("activation.connectionConsent.contextChanged")); } }}>{t("activation.connectionConsent.reviewDecision")}</Button></AlertDialogTrigger> : null}
      {saved ? <AlertDialogTrigger asChild><Button className="min-h-11" variant="outline" disabled={!enabled || pending}
        onClick={() => { try { decisionReceipt.current = currentReceipt() ?? null; setDecision("withdraw"); setConfirmed(false); }
          catch { setFailure(t("activation.connectionConsent.contextChanged")); } }}>{t("activation.connectionConsent.withdraw")}</Button></AlertDialogTrigger> : null}
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t(`activation.connectionConsent.${decision === "withdraw" ? "withdrawTitle" : "approveTitle"}`)}</AlertDialogTitle>
        <AlertDialogDescription>{t(`activation.connectionConsent.${decision === "withdraw" ? "withdrawBoundary" : "boundary"}`)}</AlertDialogDescription></AlertDialogHeader>
        <label htmlFor={checkboxId} className="flex min-h-11 items-start gap-3"><input id={checkboxId} type="checkbox" checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)} /><span>{t(`activation.connectionConsent.${decision === "withdraw" ? "confirmWithdrawal" : "confirmApproval"}`)}</span></label>
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel><Button className="min-h-11" disabled={!confirmed || pending || !enabled}
          onClick={() => decision === "withdraw" ? withdraw.mutate() : approve.mutate()}>{t("activation.connectionConsent.confirm")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {unknown || (restoredAttempt && !saved) || saved?.status === "allocating" ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => void checkReceipt()}>
      {t("activation.connectionConsent.checkReceipt")}</Button> : null}
    {samePurpose && saved && ["approved", "allocated"].includes(saved.status) ? <Button className="min-h-11" disabled={!enabled || pending}
      onClick={() => { try { currentReview(); currentReceipt(); setSetup(true); }
        catch { setFailure(t("activation.connectionConsent.contextChanged")); } }}>{t("activation.connectionConsent.providerSetup")}</Button> : null}
    {setup && samePurpose && saved && reviewed ? <ConnectionSetupFlow key={`${saved.id}:${saved.connectionId ?? "new"}:${authority.epoch}`} host="dialog"
      serviceSlug={reviewed.galleryKey} forceNewConnection deferredOnboarding={{ companyId, principal, requestKey: saved.requestKey,
        applicationId: reviewed.applicationId, galleryKey: reviewed.galleryKey, methodKey: reviewed.connectionMethodKey,
        connectionId: saved.connectionId ?? undefined, canUseAuthority: () => { try { return currentReview().reviewHash === saved.reviewHash && currentReceipt()?.id === saved.id; } catch { return false; } },
        withAuthority: currentRead, deferredAgentAccessLabel: t("activation.connectionConsent.deferAgentAccess") }}
      onCancel={() => setSetup(false)} onPhaseChange={phase => { if (phase === "needs_retry") void checkReceipt(); }}
      onComplete={() => { setSetup(false); void checkReceipt(); }} /> : null}
  </section>;
}
