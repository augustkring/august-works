import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { feedbackRetentionCommandSchema, feedbackRetentionViewSchema, type FeedbackRetentionCommand, type FeedbackRetentionView } from "@paperclipai/shared";
import { api, ApiError } from "../api/client";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

/** Current original internal operator authority only. No tenant grant or local
 * flag can authorize these C3 changes. Unknown replies retain the exact request
 * in memory; retries are explicit and never overwrite its original version. */
export function FeedbackRetentionControls({ companyId, feedbackId, principal }: {
  companyId: string; feedbackId: string; principal: string;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient();
  const authority = useV9PrivateReadAuthority(principal);
  const path = `/internal/customer-feedback/${companyId}/${feedbackId}/retention?expectedUserId=${encodeURIComponent(principal)}`;
  const queryKey = ["feedback-retention", principal, companyId, feedbackId, authority.epoch];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => authority.read(async () => {
    const value = feedbackRetentionViewSchema.parse(await api.get(path, { signal, cache: "no-store" }));
    if (value.companyId !== companyId || value.feedbackId !== feedbackId) throw Error("Retention context changed");
    return value;
  }), enabled: authority.readReady, staleTime: 0, gcTime: 0, retry: false });
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const nativeCurrent = useSyncExternalStore(subscribe, () => {
    const state = client.getQueryState(queryKey);
    return state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  }, () => false);
  const attempted = useRef<FeedbackRetentionCommand | null>(null), sending = useRef(false);
  const [review, setReview] = useState<FeedbackRetentionCommand | null>(null), reviewEpoch = useRef(-1);
  const [uncertain, setUncertain] = useState(false);
  function current() {
    const state = client.getQueryState(queryKey);
    return authority.canRead() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  }
  const change = useMutation({ mutationKey: ["feedback-retention", principal, companyId, feedbackId], gcTime: 0, retry: false,
    mutationFn: async (input: FeedbackRetentionCommand) => {
      if (!current()) throw Error("Retention review requires current authority");
      attempted.current ??= Object.freeze({ ...input, legalHold: Object.freeze({ ...input.legalHold }) });
      const value = await authority.write(async () => feedbackRetentionViewSchema.parse(await api.post(path, attempted.current)));
      if (!authority.confirmed(value) || value.companyId !== companyId || value.feedbackId !== feedbackId)
        throw Error("Retention reply requires current authority");
      return value;
    }, onSuccess: value => {
      if (!current() || !authority.confirmed(value)) { setUncertain(true); setReview(null); return; }
      attempted.current = null; setUncertain(false); setReview(null);
      void client.invalidateQueries({ queryKey: ["feedback-retention", principal, companyId, feedbackId] });
    }, onError: error => {
      // Native validation/CAS conflicts have no receipt. Other failures can
      // conceal an applied command and must retain its exact original key.
      const refusal = error instanceof ApiError && ([400, 422].includes(error.status) ||
        (error.status === 409 && ["Retention controls changed; review again", "An image operation is unconfirmed; settle its original owner before applying a hold"]
          .includes(String((error.body as { error?: unknown } | null)?.error))));
      if (refusal && current()) {
        attempted.current = null; setUncertain(false);
      } else setUncertain(true);
      setReview(null);
    }, onSettled: () => { sending.current = false; },
  });
  if (!authority.readReady || query.isFetching || query.isPending || (!nativeCurrent && !query.isError))
    return <p role="status">{t("feedback.retentionChecking")}</p>;
  if (query.isError || !current()) return <div role="alert">
    <p>{t("feedback.retentionUnavailable")}</p>
    <Button type="button" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t("tryAgain")}</Button>
  </div>;
  return <section className="space-y-4 rounded-lg border border-border p-4" aria-label={t("feedback.retentionTitle")}>
    <h3 className="text-base font-semibold">{t("feedback.retentionTitle")}</h3>
    <p className="text-sm text-muted-foreground">{t("feedback.retentionPolicy")}</p>
    <RetentionEditor key={`${query.data.version}:${authority.epoch}`} value={query.data}
      disabled={change.isPending || uncertain} review={input => { if (current()) { reviewEpoch.current = authority.epoch; setReview(input); } }} />
    {change.isError && <p role="alert">{t(uncertain ? "feedback.retentionUnknown" : "feedback.retentionRejected")}</p>}
    {uncertain && <Button type="button" className="min-h-11" variant="outline" disabled={change.isPending}
      onClick={() => { if (current() && attempted.current) { reviewEpoch.current = authority.epoch; setReview(attempted.current); } }}>{t("feedback.retentionRetryExact")}</Button>}
    <AlertDialog open={!!review && reviewEpoch.current === authority.epoch && current()} onOpenChange={open => { if (!open) setReview(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t("feedback.retentionConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("feedback.retentionConfirmBody")}</AlertDialogDescription></AlertDialogHeader>
        {review && <div className="space-y-2 break-words whitespace-pre-wrap">
          <p>{t(review.legalHold.active ? "feedback.retentionHoldOn" : "feedback.retentionHoldOff")}</p>
          {review.legalHold.active && <p>{review.legalHold.reason}</p>}
          {review.legalHold.releaseAt && <p>{review.legalHold.releaseAt}</p>}
          {review.extensionUntil && <><p>{review.extensionUntil}</p><p>{review.extensionReason}</p></>}
        </div>}
        <AlertDialogFooter>
          <Button type="button" variant="outline" className="min-h-11" disabled={change.isPending} onClick={() => setReview(null)}>{t("cancel")}</Button>
          <Button type="button" className="min-h-11" disabled={change.isPending || !current()} onClick={() => {
            if (review && reviewEpoch.current === authority.epoch && current() && !sending.current) { sending.current = true; change.mutate(review); }
          }}>{t("feedback.retentionConfirm")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function RetentionEditor({ value, disabled, review }: {
  value: FeedbackRetentionView; disabled: boolean; review(input: FeedbackRetentionCommand): void;
}) {
  const { t } = useTranslation("experience"), id = useId();
  const [held, setHeld] = useState(value.legalHold.active), [reason, setReason] = useState(value.legalHold.reason);
  const [release, setRelease] = useState(value.legalHold.releaseAt?.slice(0, 16) ?? "");
  const [extension, setExtension] = useState(value.extensionUntil?.slice(0, 16) ?? ""), [extensionReason, setExtensionReason] = useState(value.extensionReason);
  const [invalid, setInvalid] = useState(false);
  const clock = (date: string) => date ? new Date(`${date}Z`).toISOString() : null;
  return <fieldset disabled={disabled} className="space-y-3">
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={held} onChange={event => setHeld(event.target.checked)} />{t("feedback.retentionHold")}</label>
    {held && <>
      <label htmlFor={`${id}-reason`}>{t("feedback.retentionReason")}</label>
      <Textarea id={`${id}-reason`} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
      <label htmlFor={`${id}-release`}>{t("feedback.retentionRelease")}</label>
      <Input id={`${id}-release`} type="datetime-local" value={release} onChange={event => setRelease(event.target.value)} />
    </>}
    <label htmlFor={`${id}-extension`}>{t("feedback.retentionExtension")}</label>
    <Input id={`${id}-extension`} type="datetime-local" value={extension} onChange={event => setExtension(event.target.value)} />
    {extension && <><label htmlFor={`${id}-extension-reason`}>{t("feedback.retentionReason")}</label>
      <Textarea id={`${id}-extension-reason`} maxLength={1000} value={extensionReason} onChange={event => setExtensionReason(event.target.value)} /></>}
    {invalid && <p role="alert">{t("feedback.retentionInvalid")}</p>}
    <Button type="button" variant="outline" className="min-h-11" onClick={() => {
      try {
        const input = feedbackRetentionCommandSchema.parse({ requestKey: crypto.randomUUID(), expectedVersion: value.version,
          confirmRetentionChange: true, legalHold: { active: held, releaseAt: held ? (release === (value.legalHold.releaseAt?.slice(0, 16) ?? "") ? value.legalHold.releaseAt : clock(release)) : null, reason: held ? reason : "" },
          extensionUntil: extension === (value.extensionUntil?.slice(0, 16) ?? "") ? value.extensionUntil : clock(extension), extensionReason: extension ? extensionReason : "" });
        setInvalid(false); review(input);
      } catch { setInvalid(true); }
    }}>{t("feedback.retentionReview")}</Button>
  </fieldset>;
}
