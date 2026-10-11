import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { feedbackRetentionErasureReceiptSchema, feedbackRetentionErasureReviewSchema,
  type FeedbackRetentionErasureCommand, type FeedbackRetentionErasureReceipt, type FeedbackRetentionErasureReview } from "@paperclipai/shared";
import { api, ApiError } from "../api/client";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Button } from "./ui/button";
import { FeedbackImages } from "./FeedbackImages";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

/** A separate C3 decision, mediated by the original verified internal owner.
 * Unknown acknowledgements only trigger protected GETs. Resuming the exact
 * immutable command needs another explicit confirmation; no new request key. */
export function FeedbackRetentionErasure({ companyId, feedbackId, principal, onCaseRequested, onCaseNotApplied, initialAttempt = null }: {
  companyId: string; feedbackId: string; principal: string; onCaseRequested(): void; onCaseNotApplied?(): void; initialAttempt?: FeedbackRetentionErasureCommand | null;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient(), authority = useV9PrivateReadAuthority(principal);
  const path = `/internal/customer-feedback/${companyId}/${feedbackId}/retention-erasures`;
  const identity = `?expectedUserId=${encodeURIComponent(principal)}`;
  const [attempt, setAttempt] = useState<FeedbackRetentionErasureCommand | null>(initialAttempt);
  const attempted = useRef<FeedbackRetentionErasureCommand | null>(initialAttempt ?
    Object.freeze({ ...initialAttempt, target: Object.freeze({ ...initialAttempt.target }) }) : null), sending = useRef(false);
  const [proposal, setProposal] = useState<FeedbackRetentionErasureCommand | null>(null), proposalEpoch = useRef(-1);
  const [unknown, setUnknown] = useState(false);
  const reviewKey = ["feedback-erasure-review", principal, companyId, feedbackId, authority.epoch];
  const receiptKey = ["feedback-erasure-receipt", principal, companyId, feedbackId, attempt?.requestKey, authority.epoch];
  const scoped = (value: FeedbackRetentionErasureReceipt, command: FeedbackRetentionErasureCommand) => {
    if (value.companyId !== companyId || value.feedbackId !== feedbackId || JSON.stringify(value.target) !== JSON.stringify(command.target))
      throw Error("Erasure receipt context changed");
    return value;
  };
  const submit = useMutation({ mutationKey: ["feedback-retention-erasure", principal, companyId, feedbackId], retry: false, gcTime: 0,
    mutationFn: async (input: FeedbackRetentionErasureCommand) => {
      if (!authority.canRead()) throw Error("Current account required");
      attempted.current ??= Object.freeze({ ...input, target: Object.freeze({ ...input.target }) });
      const command = attempted.current;
      const value = await authority.write(async () => scoped(feedbackRetentionErasureReceiptSchema.parse(await api.post(path + identity, command)), command));
      if (!authority.confirmed(value)) throw Error("Current erasure receipt required");
      return value;
    }, onSuccess: value => {
      if (!authority.confirmed(value)) { setUnknown(true); return; }
      client.setQueryData(receiptKey, value); setUnknown(false); setProposal(null);
      if (value.target.kind === "case") onCaseRequested();
      void client.invalidateQueries({ queryKey: ["feedback-triage", principal, companyId] });
      void client.invalidateQueries({ queryKey: ["feedback-erasure-review", principal, companyId, feedbackId] });
      void client.invalidateQueries({ queryKey: ["feedback-images", "operator", companyId, principal, feedbackId] });
    }, onError: error => {
      const refused = error instanceof ApiError && (error.status === 400 || error.status === 422 ||
        (error.status === 409 && ["Retention erasure source changed; review again", "Retention erasure is not currently eligible"]
          .includes(String((error.body as { error?: unknown } | null)?.error))));
      if (refused && authority.canRead()) {
        void client.invalidateQueries({ queryKey: ["feedback-triage", principal, companyId] });
        if (attempted.current?.target.kind === "case") onCaseNotApplied?.();
        attempted.current = null; setAttempt(null); setUnknown(false);
        void client.invalidateQueries({ queryKey: ["feedback-erasure-review", principal, companyId, feedbackId] });
      } else {
        setUnknown(true);
        if (attempted.current?.target.kind === "case") onCaseRequested();
      }
      void client.invalidateQueries({ queryKey: ["feedback-images", "operator", companyId, principal, feedbackId] });
      setProposal(null);
    }, onSettled: () => { sending.current = false; },
  });
  const review = useQuery({ queryKey: reviewKey, enabled: authority.readReady && !submit.isPending, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      const value = feedbackRetentionErasureReviewSchema.parse(await api.get(path + "/review" + identity, { signal, cache: "no-store" }));
      if (value.companyId !== companyId || value.feedbackId !== feedbackId) throw Error("Erasure review context changed");
      return value;
    }),
  });
  const receipt = useQuery({ queryKey: receiptKey, enabled: authority.readReady && !!attempt && !submit.isPending, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!attempt) throw Error("Original erasure request required");
      return scoped(feedbackRetentionErasureReceiptSchema.parse(await api.get(path + "/requests/" + attempt.requestKey + identity,
        { signal, cache: "no-store" })), attempt);
    }),
  });
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const reviewState = useSyncExternalStore(subscribe, () => client.getQueryState(reviewKey), () => undefined);
  const receiptState = useSyncExternalStore(subscribe, () => client.getQueryState(receiptKey), () => undefined);
  const current = (key: readonly unknown[]) => {
    const state = client.getQueryState(key);
    return authority.canRead() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  };
  const currentReview = reviewState?.status === "success" && current(reviewKey) ? review.data : null;
  const currentReceipt = receiptState?.status === "success" && current(receiptKey) ? receipt.data : null;
  function canConfirm(command: FeedbackRetentionErasureCommand) {
    if (!authority.canRead() || submit.isPending) return false;
    const nativeReview = client.getQueryData<FeedbackRetentionErasureReview>(reviewKey);
    const nativeReceipt = client.getQueryData<FeedbackRetentionErasureReceipt>(receiptKey);
    if (attempted.current) return command.requestKey === attempted.current.requestKey &&
      ((current(receiptKey) && nativeReceipt?.status === "pending") || (current(reviewKey) && nativeReview?.reviewHash === command.expectedReviewHash));
    return current(reviewKey) && nativeReview?.reviewHash === command.expectedReviewHash;
  }
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("feedback.erasure.title")}>
    <h3 className="text-base font-semibold">{t("feedback.erasure.title")}</h3>
    {!authority.readReady ? <p role="status">{t("feedback.retentionChecking")}</p> : <>
    {submit.isPending ? <p role="status">{t("feedback.erasure.checking")}</p> : currentReceipt ?
      <p role="status">{t(currentReceipt.status === "completed" ? "feedback.erasure.completed" : "feedback.erasure.pending")}</p> :
      unknown ? <p role="alert">{t("feedback.erasure.unknown")}</p> : null}
    {!attempt && currentReview && <>
      <p className="text-sm text-muted-foreground">{t("feedback.erasure.policy", { closed: currentReview.configuration.closedFeedbackDays,
        images: currentReview.configuration.imageDays, open: currentReview.configuration.openFeedbackMonths })}</p>
      <p>{t(currentReview.held ? "feedback.erasure.held" : "feedback.erasure.caseDeadline", { date: currentReview.caseDueAt })}</p>
      <Button type="button" className="min-h-11" variant="outline" disabled={!currentReview.caseCanErase || submit.isPending} onClick={() => {
        if (!current(reviewKey)) return;
        proposalEpoch.current = authority.epoch; setProposal({ requestKey: crypto.randomUUID(), confirmErasure: true,
          expectedReviewHash: currentReview.reviewHash, target: { kind: "case" } });
      }}>{t("feedback.erasure.case")}</Button>
      {currentReview.images.map((image, index) => <div key={image.id} className="space-y-2">
        <p>{t("feedback.erasure.imageDeadline", { number: index + 1, date: image.dueAt })}</p>
        <Button type="button" className="min-h-11" variant="outline" disabled={!image.canErase || submit.isPending} onClick={() => {
          if (!current(reviewKey)) return;
          proposalEpoch.current = authority.epoch; setProposal({ requestKey: crypto.randomUUID(), confirmErasure: true,
            expectedReviewHash: currentReview.reviewHash, target: { kind: "image", imageId: image.id } });
        }}>{t("feedback.erasure.image", { number: index + 1 })}</Button>
      </div>)}
    </>}
    {attempt && currentReceipt?.status !== "completed" && <>
      {!currentReceipt && !unknown && <p role={receipt.isError ? "alert" : "status"}>{t(receipt.isError ? "feedback.erasure.unavailable" : "feedback.erasure.checking")}</p>}
      <Button type="button" className="min-h-11" variant="outline" disabled={submit.isPending || receipt.isFetching}
        onClick={() => void receipt.refetch()}>{t("feedback.erasure.check")}</Button>
      <Button type="button" className="min-h-11" variant="outline" disabled={!canConfirm(attempt)} onClick={() => {
        if (!canConfirm(attempt)) return;
        proposalEpoch.current = authority.epoch; setProposal(attempt);
      }}>{t("feedback.erasure.resume")}</Button>
    </>}
    {attempt && currentReceipt?.status === "completed" && currentReceipt.target.kind === "image" && <Button type="button" className="min-h-11" variant="outline"
      onClick={() => { if (!current(receiptKey)) return; attempted.current = null; setAttempt(null); setUnknown(false); setProposal(null); }}>
      {t("feedback.erasure.another")}</Button>}
    {!attempt && !currentReview && <><p role={review.isError ? "alert" : "status"}>{t(review.isError ? "feedback.erasure.unavailable" : "feedback.erasure.checking")}</p>
      {review.isError && <Button type="button" className="min-h-11" variant="outline" onClick={() => void review.refetch()}>{t("tryAgain")}</Button>}</>}
    <AlertDialog open={!!proposal && proposalEpoch.current === authority.epoch && canConfirm(proposal)} onOpenChange={open => { if (!open) setProposal(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("feedback.erasure.confirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{t(proposal?.target.kind === "image" ? "feedback.erasure.confirmImage" : "feedback.erasure.confirmCase")}</AlertDialogDescription>
      </AlertDialogHeader>
      {currentReview && proposal && currentReview.reviewHash === proposal.expectedReviewHash && <p className="break-words text-sm">{t("feedback.erasure.caseDeadline", { date: currentReview.caseDueAt })}</p>}
      {proposal?.target.kind === "image" && <FeedbackImages companyId={companyId} feedbackId={feedbackId} principal={principal}
        authority={authority} active={canConfirm(proposal)} internal imageIds={[proposal.target.imageId]} />}
      <AlertDialogFooter>
        <AlertDialogCancel asChild><Button type="button" className="min-h-11" variant="outline" disabled={submit.isPending} onClick={() => setProposal(null)}>{t("feedback.cancel")}</Button></AlertDialogCancel>
        <Button type="button" className="min-h-11" disabled={!proposal || !canConfirm(proposal)} onClick={() => {
          if (!proposal || proposalEpoch.current !== authority.epoch || !canConfirm(proposal) || sending.current) return;
          sending.current = true; setAttempt(proposal);
          if (proposal.target.kind === "case") onCaseRequested();
          submit.mutate(proposal);
        }}>{t("feedback.erasure.confirm")}</Button>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    </>}
  </section>;
}
