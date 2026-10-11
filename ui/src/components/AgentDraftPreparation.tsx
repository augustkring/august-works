import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentDraftPrepareSchema, type AgentAuthoringDraftView, type AgentDraftPrepare, type AgentDraftPreparationReview } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";

/** Explicit inactive identity preparation, never Safe Test or publication.
 * Reloads reconcile the original draft; no command is automatically replayed. */
export function AgentDraftPreparation({ company, principal, draft, enabled, canUseAuthority, onConfirmed }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean;
  canUseAuthority: () => boolean; onConfirmed: (value: AgentAuthoringDraftView) => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), checkboxId = useId();
  const alive = useRef(true), latest = useRef({ company, principal, draft, enabled, canUseAuthority });
  latest.current = { company, principal, draft, enabled, canUseAuthority };
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [unknown, setUnknown] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const storageKey = `aw:v9:draft-preparation:${encodeURIComponent(company)}:${encodeURIComponent(principal)}:${draft.id}:${draft.version}`;
  const attempt = useRef<AgentDraftPrepare | null>(null), decisionHash = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    attempt.current = null; setUnknown(false); setFailure(null);
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) { const parsed = agentDraftPrepareSchema.safeParse(JSON.parse(stored));
        if (parsed.success && parsed.data.expectedVersion === draft.version) { attempt.current = parsed.data; setUnknown(true); } }
    } catch { /* Invalid stored identity supplies no authority. */ }
    return () => { alive.current = false; };
  }, [storageKey, draft.version]);
  const reviewKey = ["agent-draft-preparation", company, principal, authority.epoch, draft.id, draft.version, "review"];
  function current(requiresWrite = true) {
    const value = latest.current;
    return alive.current && (!requiresWrite || value.enabled) && value.canUseAuthority() && (requiresWrite ? authority.canWrite() : authority.canRead()) &&
      value.company === company && value.principal === principal && value.draft.companyId === company &&
      value.draft.id === draft.id && value.draft.version === draft.version && value.draft.createdByUserId === principal;
  }
  const review = useQuery({ queryKey: reviewKey, queryFn: ({ signal }) => authority.read(async () => {
    if (!current()) throw new Error(t("agentPreparation.changed"));
    const value = await agentAuthoringApi.preparationReview(company, principal, draft.id, signal);
    if (!current() || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version)
      throw new Error(t("agentPreparation.changed"));
    return value;
  }), enabled: enabled && authority.writeReady && !draft.agentId && !draft.preparation, retry: false, gcTime: 0, staleTime: 0 });
  useEffect(() => { setOpen(false); setConfirmed(false); }, [authority.epoch, draft.version, review.data?.reviewHash, enabled]);
  function currentReview() {
    const state = client.getQueryState(reviewKey), value = client.getQueryData<AgentDraftPreparationReview>(reviewKey);
    if (!current() || latest.current.draft.preparation || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated ||
        !value || value.version !== draft.version || value.draftId !== draft.id || value.companyId !== company)
      throw new Error(t("agentPreparation.changed"));
    return value;
  }
  function accept(value: AgentAuthoringDraftView, requiresWrite = true) {
    if (!current(requiresWrite) || value.companyId !== company || value.id !== draft.id || value.createdByUserId !== principal || value.version < draft.version)
      throw new Error(t("agentPreparation.changed"));
    sessionStorage.removeItem(storageKey); attempt.current = null;
    if (!value.preparation) void client.invalidateQueries({ queryKey: reviewKey, exact: true });
    setUnknown(false); setOpen(false); setConfirmed(false); setFailure(null); onConfirmed(value);
  }
  const prepare = useMutation({ mutationFn: async () => {
    const reviewed = currentReview();
    if (!confirmed || decisionHash.current !== reviewed.reviewHash) throw new Error(t("agentPreparation.changed"));
    if (!attempt.current) {
      const command = { requestId: crypto.randomUUID(), expectedVersion: draft.version, expectedReviewHash: reviewed.reviewHash,
        confirmInactiveAgentPreparation: true as const };
      sessionStorage.setItem(storageKey, JSON.stringify(command)); attempt.current = command;
    }
    if (attempt.current.expectedReviewHash !== reviewed.reviewHash) throw new Error(t("agentPreparation.changed"));
    return authority.write(() => agentAuthoringApi.prepare(company, principal, draft.id, attempt.current!));
  }, onSuccess: value => {
    if (!authority.confirmed(value) || !current()) return;
    try { accept(value); } catch { setUnknown(true); setFailure(t("agentPreparation.changed")); }
  }, onError: () => { if (current()) { setUnknown(true); setOpen(false); setFailure(t("agentPreparation.unknown")); } } });
  const check = useMutation({ mutationFn: () => authority.read(() => {
    if (!current(false)) throw new Error(t("agentPreparation.changed"));
    return agentAuthoringApi.get(company, principal, draft.id);
  }), onSuccess: value => { try { accept(value, false); } catch { if (current(false)) setFailure(t("agentPreparation.changed")); } },
    onError: () => { if (current(false)) setFailure(t("agentPreparation.changed")); } });
  if (!authority.readReady || !canUseAuthority()) return <p role="status">{t("agentPreparation.checking")}</p>;
  if (draft.agentId) return null;
  if (draft.preparation) return <section className="space-y-3" aria-label={t("agentPreparation.title")}>
    <h2 className="text-lg font-semibold">{t("agentPreparation.title")}</h2>
    <p>{draft.preparation.name}</p><p role="status">{t(`agentPreparation.status.${draft.preparation.status}`)}</p>
    <p>{t("agentPreparation.boundary")}</p>
  </section>;
  if (!enabled) return <p>{t("agentPreparation.saveFirst")}</p>;
  const pending = prepare.isPending || check.isPending;
  return <section className="space-y-3" aria-label={t("agentPreparation.title")}>
    <h2 className="text-lg font-semibold">{t("agentPreparation.title")}</h2>
    <p>{t("agentPreparation.boundary")}</p>
    {review.isPending || review.isFetching ? <p role="status">{t("agentPreparation.checking")}</p> : null}
    {review.isError ? <p role="status">{t("agentPreparation.unavailable")}</p> : null}
    {review.data ? <dl className="space-y-2"><dt className="font-medium">{t("agentPreparation.name")}</dt><dd>{review.data.name}</dd>
      <dt className="font-medium">{t("agentPreparation.responsibility")}</dt><dd className="whitespace-pre-wrap">{review.data.outcome}</dd>
      <dt className="font-medium">{t("agentPreparation.owner")}</dt><dd>{review.data.accountableOwner.name}</dd></dl> : null}
    {review.data?.requiresBoardApproval ? <p>{t("agentPreparation.boardApproval")}</p> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    <AlertDialog open={open} onOpenChange={value => { setOpen(value); if (!value) setConfirmed(false); }}>
      {review.data && !review.isFetching && !review.isError && (!unknown || attempt.current?.expectedReviewHash === review.data.reviewHash)
        ? <AlertDialogTrigger asChild><Button className="min-h-11" disabled={pending || !authority.writeReady}
          onClick={() => { try { decisionHash.current = currentReview().reviewHash; setOpen(true); setConfirmed(false); }
            catch { setFailure(t("agentPreparation.changed")); } }}>{t("agentPreparation.review")}</Button></AlertDialogTrigger> : null}
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("agentPreparation.confirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{t("agentPreparation.boundary")}</AlertDialogDescription></AlertDialogHeader>
        {review.data ? <dl className="space-y-2"><dt className="font-medium">{t("agentPreparation.name")}</dt><dd>{review.data.name}</dd>
          <dt className="font-medium">{t("agentPreparation.responsibility")}</dt><dd className="whitespace-pre-wrap">{review.data.outcome}</dd>
          <dt className="font-medium">{t("agentPreparation.owner")}</dt><dd>{review.data.accountableOwner.name}</dd></dl> : null}
        {review.data?.requiresBoardApproval ? <p>{t("agentPreparation.boardApproval")}</p> : null}
        <label htmlFor={checkboxId} className="flex min-h-11 items-start gap-3"><input id={checkboxId} type="checkbox" checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)} /><span>{t("agentPreparation.confirmation")}</span></label>
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel><Button className="min-h-11" disabled={!confirmed || pending || !authority.writeReady}
          onClick={() => prepare.mutate()}>{t("agentPreparation.confirm")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {unknown ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => check.mutate()}>{t("agentPreparation.checkOriginal")}</Button> : null}
  </section>;
}
