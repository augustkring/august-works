import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";
import { useTranslation } from "react-i18next";
import {
  FEEDBACK_CONTACTS,
  feedbackCategorySchema,
  customerFeedbackPolicySchema,
  type CreateCustomerFeedback,
  type CustomerFeedback,
} from "@paperclipai/shared";
import { useLocation, Link } from "../lib/router";
import {
  customerFeedbackApi,
  isRejectedFeedbackRequest,
} from "../api/customer-feedback";
import { useCompany } from "../context/CompanyContext";
import { hasCurrentV9Session, useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { api } from "../api/client";
import { feedbackImagesApi } from "../api/feedback-images";
import { FeedbackImageSelection, useSelectedFeedbackImages, type SelectedFeedbackImage } from "./FeedbackImageSelection";
import { FeedbackImages } from "./FeedbackImages";
import {
  feedbackClientEnvironment,
  feedbackPageContext,
} from "../lib/feedback-safe-context";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

function FeedbackForm({
  companyId,
  principal,
  accountReady,
  accountFailed,
  authorityEpoch,
  sessionId,
  allowLocalImplicit,
}: {
  companyId: string;
  principal: string;
  accountReady: boolean;
  accountFailed: boolean;
  authorityEpoch: number;
  sessionId: string | null;
  allowLocalImplicit: boolean;
}) {
  const { t, i18n } = useTranslation("experience"),
    location = useLocation();
  const client = useQueryClient();
  const privateAuthority = useV9PrivateReadAuthority(principal, allowLocalImplicit);
  const selectedImages = useSelectedFeedbackImages();
  const imageAttempt = useRef<readonly SelectedFeedbackImage[] | null>(null);
  const sending = useRef(false);
  const current = useRef({ ready: accountReady, authorityEpoch, epoch: 0 });
  if (current.current.ready !== accountReady || current.current.authorityEpoch !== authorityEpoch)
    current.current = { ready: accountReady, authorityEpoch, epoch: current.current.epoch + 1 };
  const canUseContext = () => current.current.ready &&
    hasCurrentV9Session(client, principal, sessionId, allowLocalImplicit) &&
    client.getQueryState(queryKeys.instance.experimentalSettings)?.status === "success" &&
    client.getQueryState(queryKeys.instance.experimentalSettings)?.fetchStatus === "idle" &&
    client.getQueryState(queryKeys.instance.experimentalSettings)?.isInvalidated === false &&
    client.getQueryData<{ customer_feedback_v9?: boolean }>(queryKeys.instance.experimentalSettings)?.customer_feedback_v9 === true;
  const contextReady = accountReady && canUseContext();
  const [open, setOpen] = useState(false),
    [category, setCategory] =
      useState<CreateCustomerFeedback["category"]>("BUG");
  const [body, setBody] = useState(""),
    [goal, setGoal] = useState(""),
    [blocksWork, setBlocksWork] = useState(false),
    [omitName, setOmitName] = useState(false),
    [includeDiagnostics, setIncludeDiagnostics] = useState(false),
    [includeExperienceMeasure, setIncludeExperienceMeasure] = useState(false),
    [satisfaction, setSatisfaction] = useState<NonNullable<CreateCustomerFeedback["experienceMeasure"]>["satisfaction"] | "">(""),
    [effort, setEffort] = useState<NonNullable<CreateCustomerFeedback["experienceMeasure"]>["effort"] | "">("");
  const [context, setContext] = useState<
    CreateCustomerFeedback["context"] | null
  >(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const imagePolicy = useQuery({
    queryKey: ["customer-feedback-image-policy", companyId, principal, authorityEpoch],
    enabled: open && contextReady, retry: false, staleTime: 0, gcTime: 0,
    queryFn: async ({ signal }) => customerFeedbackPolicySchema.parse(
      await api.get("/customer-feedback/policy", { signal, cache: "no-store" })),
  });
  const imagesEnabled = imagePolicy.isSuccess && !imagePolicy.isFetching && imagePolicy.data.attachments.enabled;
  useEffect(() => {
    // Binary drafts stay in this account/form only. Rechecking authority drops
    // local previews; it never retries an image upload after session recovery.
    selectedImages.change([]);
    imageAttempt.current = null;
  }, [authorityEpoch]);
  const attempted = useRef<CreateCustomerFeedback | null>(null);
  const hadUnknownAcceptance = useRef(false), receiptReadInFlight = useRef(false);
  const [recovered, setRecovered] = useState<{ receipt: CustomerFeedback; epoch: number; attachmentsUnconfirmed: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    categoryInput = useRef<HTMLSelectElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    receiptFocus = useRef<HTMLDivElement>(null),
    errorFocus = useRef<HTMLParagraphElement>(null);
  const send = useMutation({
    mutationKey: ["customer-feedback", companyId, principal, "create"],
    gcTime: 0,
    mutationFn: async (input: CreateCustomerFeedback) => {
      if (!canUseContext()) throw new Error("Feedback context is unavailable");
      const epoch = current.current.epoch;
      const chosen = imageAttempt.current ?? [];
      const receipt = await customerFeedbackApi.create(companyId, principal, input);
      let attachmentsUnconfirmed = false;
      for (const image of chosen) {
        if (!canUseContext() || current.current.epoch !== epoch) {
          attachmentsUnconfirmed = true;
          break;
        }
        try {
          const value = await feedbackImagesApi.upload(companyId, principal, receipt.id, image.requestKey, image.file);
          if (value.status !== "ready" || !canUseContext() || current.current.epoch !== epoch)
            attachmentsUnconfirmed = true;
        } catch {
          // Feedback already has its canonical receipt. An uncertain image
          // reply cannot resend that case or automatically repeat the PUT.
          attachmentsUnconfirmed = true;
        }
      }
      return { receipt, epoch, attachmentsUnconfirmed };
    },
    retry: false,
    onError: (error) => {
      if (isRejectedFeedbackRequest(error) && !hadUnknownAcceptance.current) {
        attempted.current = null;
        imageAttempt.current = null;
        setRequestKey(crypto.randomUUID());
      } else if (attempted.current) hadUnknownAcceptance.current = true;
    },
    onSettled: () => { sending.current = false; },
  });
  const known = send.data ?? recovered;
  const requestLookup = useQuery({
    queryKey: ["customer-feedback-request-receipt", companyId, principal, requestKey, current.current.epoch],
    enabled: false, retry: false, gcTime: 0, staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!canUseContext()) throw new Error("Feedback receipt is unavailable");
      const epoch = current.current.epoch;
      const value = await customerFeedbackApi.requestReceipt(companyId, principal, requestKey, signal);
      signal.throwIfAborted();
      if (!canUseContext() || current.current.epoch !== epoch) throw new Error("Feedback access changed");
      return { ...value, epoch };
    },
  });
  const original = useQuery({
    queryKey: ["customer-feedback-receipt", companyId, principal, known?.receipt.id, current.current.epoch],
    enabled: open && accountReady && !!known && known.epoch !== current.current.epoch,
    retry: false, gcTime: 0, staleTime: 0,
    queryFn: async ({ signal }) => {
      if (!canUseContext() || !known) throw new Error("Feedback receipt is unavailable");
      const receipt = await customerFeedbackApi.get(companyId, principal, known.receipt.id, signal);
      signal.throwIfAborted();
      return receipt;
    },
  });
  const confirmed = contextReady && known
    ? known.epoch === current.current.epoch ? known.receipt
      : original.isSuccess && !original.isFetching ? original.data : null
    : null;
  function clearUnsentDraft() {
    setCategory("BUG"); setBody(""); setGoal(""); setBlocksWork(false);
    setOmitName(false); setIncludeDiagnostics(false);
    setIncludeExperienceMeasure(false); setSatisfaction(""); setEffort("");
    attempted.current = null; imageAttempt.current = null;
    hadUnknownAcceptance.current = false; selectedImages.change([]);
  }
  const clearedReceipt = useRef<string | null>(null);
  useEffect(() => {
    // A stale/unknown acknowledgement is not a receipt. Keep its original
    // request until current Source confirms it; then release local draft data
    // and preview URLs while keeping the canonical receipt view available.
    if (!confirmed || clearedReceipt.current === confirmed.id) return;
    clearedReceipt.current = confirmed.id;
    clearUnsentDraft();
  }, [confirmed?.id]);
  function show(event?: Event) {
    // Opening the public contact frame starts no work. Private draft and
    // receipt contents remain withheld until the current source is confirmed.
    returnFocus.current =
      event instanceof CustomEvent &&
      event.detail?.returnFocus === "global_feedback"
        ? trigger.current
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setContext({
      ...feedbackPageContext(location.pathname),
      clientEnvironment: feedbackClientEnvironment(navigator.userAgent),
      clientReleaseBuildId:
        typeof __PAPERCLIP_BUILD_COMMIT__ === "string" &&
        /^[a-f0-9]{40}$/.test(__PAPERCLIP_BUILD_COMMIT__)
          ? __PAPERCLIP_BUILD_COMMIT__
          : null,
      locale: i18n.resolvedLanguage ?? "en",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewportClass:
        window.innerWidth < 640
          ? "compact"
          : window.innerWidth < 1024
            ? "medium"
            : "wide",
    });
    setOpen(true);
  }
  useEffect(() => {
    if (open && !contextReady) errorFocus.current?.focus();
    else if (open && contextReady && (send.isError || original.isError)) errorFocus.current?.focus();
    else if (open && confirmed) receiptFocus.current?.focus();
    else if (open && contextReady && !attempted.current) categoryInput.current?.focus();
  }, [open, contextReady, send.isError, original.isError, confirmed?.id]);
  useEffect(() => {
    document.addEventListener("paperclip:open-feedback", show);
    return () => document.removeEventListener("paperclip:open-feedback", show);
  }, [location.pathname, i18n.resolvedLanguage, accountReady, authorityEpoch]);
  function edit(change: () => void) {
    if (attempted.current) return;
    change();
    attempted.current = null;
    setRequestKey(crypto.randomUUID());
    send.reset();
  }
  const inputsLocked = send.isPending || !!attempted.current;
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="min-h-11"
        aria-busy={!accountReady}
        onClick={() => show()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Moving focus to the native select must not also pass the
            // trigger's Enter default action to that newly focused control.
            event.preventDefault();
            show();
          }
        }}
      >
        {t("feedback.action")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          closeButtonClassName="min-h-11 min-w-11 flex items-center justify-center"
          closeButtonLabel={t("feedback.close")}
          className="max-h-dvh overflow-y-auto"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!contextReady) errorFocus.current?.focus();
            else if (confirmed) receiptFocus.current?.focus();
            else categoryInput.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current?.isConnected
              ? returnFocus.current
              : trigger.current;
            target?.focus();
          }}
        >
          <DialogTitle>{t("feedback.title")}</DialogTitle>
          <DialogDescription>{t("feedback.description")}</DialogDescription>
          <div className="flex flex-wrap gap-3 text-sm">
            <a
              className="inline-flex min-h-11 items-center underline"
              href={FEEDBACK_CONTACTS.support}
            >
              {t("feedback.support")}
            </a>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={FEEDBACK_CONTACTS.security}
            >
              {t("feedback.security")}
            </a>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={FEEDBACK_CONTACTS.privacy}
            >
              {t("feedback.privacy")}
            </a>
          </div>
          {!contextReady ? (
            <p ref={errorFocus} tabIndex={-1} role={accountFailed ? "alert" : "status"}>{t(accountFailed ? "feedback.historyFailed" : "loading")}</p>
          ) : confirmed ? (
            <div
              ref={receiptFocus}
              tabIndex={-1}
              role="status"
              className="space-y-3 outline-none"
            >
              <p>{t("feedback.received")}</p>
              <p>{confirmed.feedbackId}</p>
              {known?.attachmentsUnconfirmed && <p>{t("feedback.images.submissionUnconfirmed")}</p>}
              <FeedbackImages companyId={companyId} principal={principal} feedbackId={confirmed.id}
                authority={privateAuthority} active={!!confirmed} />
              <Link
                className="inline-flex min-h-11 items-center underline"
                to={`/my-feedback?feedbackId=${confirmed.id}`}
                onClick={() => setOpen(false)}
              >
                {t("feedback.history")}
              </Link>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => {
                  setOpen(false);
                  clearUnsentDraft();
                  setRequestKey(crypto.randomUUID());
                  setRecovered(null); send.reset();
                }}
              >
                {t("feedback.close")}
              </Button>
            </div>
          ) : known ? (
            <div className="space-y-3">
              <p ref={errorFocus} tabIndex={-1} role={original.isError ? "alert" : "status"}>
                {t(original.isError ? "feedback.receiptUnconfirmed" : "loading")}
              </p>
              {original.isError && <Button className="min-h-11" onClick={() => {
                if (canUseContext()) void original.refetch();
              }}>{t("feedback.checkReceipt")}</Button>}
              <Link className="inline-flex min-h-11 items-center underline" to="/my-feedback" onClick={() => setOpen(false)}>{t("feedback.history")}</Link>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (context && canUseContext() && !sending.current && !receiptReadInFlight.current) {
                  sending.current = true;
                  imageAttempt.current ??= Object.freeze([...selectedImages.images]);
                  attempted.current ??= {
                    idempotencyKey: requestKey,
                    category,
                    body,
                    goal: category === "OTHER" ? "" : goal,
                    blocksWork: category === "BUG" && blocksWork,
                    omitName,
                    context,
                    includeDiagnostics,
                    experienceMeasure: {
                      offered: true,
                      ...(includeExperienceMeasure && satisfaction && effort ? { consent: "granted" as const, satisfaction, effort } : {}),
                    },
                    ...(includeDiagnostics
                      ? {
                          diagnostics: {
                            safeErrorCodes: [],
                            correlationIds: [],
                          },
                        }
                      : {}),
                  };
                  send.mutate(attempted.current);
                }
              }}
            >
              <label className="block space-y-2">
                <span>{t("feedback.category")}</span>
                <select
                  ref={categoryInput}
                  disabled={inputsLocked}
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3"
                  value={category}
                  onChange={(event) =>
                    edit(() =>
                      setCategory(
                        feedbackCategorySchema.parse(event.target.value),
                      ),
                    )
                  }
                >
                  {feedbackCategorySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {t(`feedback.categories.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2">
                <span>{t(`feedback.questions.${category}`)}</span>
                <Textarea
                  required
                  maxLength={10000}
                  disabled={inputsLocked}
                  value={body}
                  onChange={(event) => edit(() => setBody(event.target.value))}
                />
              </label>
              {category !== "OTHER" && (
                <label className="block space-y-2">
                  <span>{t(`feedback.goals.${category}`)}</span>
                  <Textarea
                    maxLength={2000}
                    disabled={inputsLocked}
                    value={goal}
                    onChange={(event) =>
                      edit(() => setGoal(event.target.value))
                    }
                  />
                </label>
              )}
              {category === "BUG" && (
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    disabled={inputsLocked}
                    checked={blocksWork}
                    onChange={(event) =>
                      edit(() => setBlocksWork(event.target.checked))
                    }
                  />
                  {t("feedback.blocksWork")}
                </label>
              )}
              <details className="rounded-md border border-border p-3">
                <summary className="min-h-11 cursor-pointer">
                  {t("feedback.context")}
                </summary>
                <p className="text-sm text-muted-foreground">
                  {t("feedback.contextDetails")}
                </p>
              </details>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  disabled={inputsLocked}
                  checked={includeDiagnostics}
                  aria-describedby="feedback-diagnostics-disclosure"
                  onChange={(event) =>
                    edit(() => setIncludeDiagnostics(event.target.checked))
                  }
                />
                {t("feedback.diagnostics")}
              </label>
              <p
                id="feedback-diagnostics-disclosure"
                className="text-sm text-muted-foreground"
              >
                {t("feedback.diagnosticsEmpty")}
              </p>
              <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="feedback-experience-measure-title">
                <h3 id="feedback-experience-measure-title" className="font-medium">{t("feedback.experienceMeasure.title")}</h3>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" disabled={inputsLocked} checked={includeExperienceMeasure}
                    onChange={event => edit(() => { setIncludeExperienceMeasure(event.target.checked); if (!event.target.checked) { setSatisfaction(""); setEffort(""); } })} />
                  {t("feedback.experienceMeasure.consent")}
                </label>
                <p className="text-sm text-muted-foreground">{t("feedback.experienceMeasure.disclosure")}</p>
                {includeExperienceMeasure && <>
                  <label className="block space-y-2"><span>{t("feedback.experienceMeasure.satisfaction")}</span>
                    <select required disabled={inputsLocked} className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={satisfaction}
                      onChange={event => edit(() => setSatisfaction(event.target.value as typeof satisfaction))}>
                      <option value="">{t("feedback.experienceMeasure.choose")}</option>
                      {(["very_dissatisfied", "dissatisfied", "neither", "satisfied", "very_satisfied"] as const).map(value => <option key={value} value={value}>{t(`feedback.experienceMeasure.satisfactionOptions.${value}`)}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-2"><span>{t("feedback.experienceMeasure.effort")}</span>
                    <select required disabled={inputsLocked} className="min-h-11 w-full rounded-md border border-input bg-background px-3" value={effort}
                      onChange={event => edit(() => setEffort(event.target.value as typeof effort))}>
                      <option value="">{t("feedback.experienceMeasure.choose")}</option>
                      {(["very_difficult", "difficult", "neither", "easy", "very_easy"] as const).map(value => <option key={value} value={value}>{t(`feedback.experienceMeasure.effortOptions.${value}`)}</option>)}
                    </select>
                  </label>
                </>}
              </section>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  disabled={inputsLocked}
                  checked={omitName}
                  onChange={(event) =>
                    edit(() => setOmitName(event.target.checked))
                  }
                />
                {t("feedback.omitName")}
              </label>
              {omitName && (
                <p className="text-sm text-muted-foreground">
                  {t("feedback.nameNotice")}
                </p>
              )}
              <FeedbackImageSelection images={selectedImages.images} onChange={selectedImages.change}
                enabled={imagesEnabled} locked={inputsLocked} />
              {send.isError && (
                <p
                  ref={errorFocus}
                  tabIndex={-1}
                  role="alert"
                  className="outline-none"
                >
                  {t(
                    attempted.current
                      ? "feedback.submissionUnknown"
                      : "feedback.failed",
                  )}
                </p>
              )}
              {send.isError && attempted.current && <div className="space-y-3">
                <Button type="button" variant="outline" className="min-h-11"
                  disabled={requestLookup.isFetching || send.isPending}
                  onClick={async () => {
                    if (!canUseContext() || !attempted.current || sending.current || receiptReadInFlight.current) return;
                    receiptReadInFlight.current = true;
                    try {
                      const result = await requestLookup.refetch();
                      if (!result.data || !canUseContext() || result.data.epoch !== current.current.epoch || result.data.requestKey !== requestKey) return;
                      if (result.data.receipt) setRecovered({ receipt: result.data.receipt, epoch: result.data.epoch,
                        attachmentsUnconfirmed: (imageAttempt.current?.length ?? 0) > 0 });
                    } finally { receiptReadInFlight.current = false; }
                  }}>{t(requestLookup.isFetching ? "feedback.checkingRequest" : "feedback.checkRequest")}</Button>
                {requestLookup.isError && <p role="status">{t("feedback.requestReadFailed")}</p>}
                {requestLookup.isSuccess && requestLookup.data.receipt === null && <p role="status">{t("feedback.requestNotObserved")}</p>}
              </div>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setOpen(false)}
                >
                  {t("feedback.cancel")}
                </Button>
                {(body || goal || category !== "BUG" || blocksWork || omitName || includeDiagnostics || selectedImages.images.length > 0) &&
                <Button type="button" variant="outline" className="min-h-11" disabled={inputsLocked}
                  onClick={() => {
                    // A local discard cannot cancel or forget a request whose
                    // acceptance is unknown, even before React disables it.
                    if (sending.current || receiptReadInFlight.current || attempted.current) return;
                    clearUnsentDraft(); setRequestKey(crypto.randomUUID());
                    send.reset(); setOpen(false);
                  }}>{t("feedback.discard")}</Button>}
                <Button
                  type="submit"
                  className="ml-auto min-h-11"
                  disabled={send.isPending || requestLookup.isFetching || !body.trim() || (includeExperienceMeasure && (!satisfaction || !effort))}
                >
                  {t(send.isPending ? "feedback.sending" : "feedback.send")}
                </Button>
              </div>
              <Link
                className="inline-flex min-h-11 items-center underline"
                to="/my-feedback"
                onClick={() => setOpen(false)}
              >
                {t("feedback.history")}
              </Link>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function CustomerFeedbackDialog() {
  const { enabled, query } = useV9FeatureEnabled("customer_feedback_v9"),
    { selectedCompanyId } = useCompany(),
    identity = useV9CurrentAccount();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  return enabled && principal && selectedCompanyId ? (
    <FeedbackForm
      key={`${selectedCompanyId}:${principal}`}
      companyId={selectedCompanyId}
      principal={principal}
      accountReady={identity.settled && query.isSuccess && !query.isFetching}
      accountFailed={identity.failed || query.isError}
      authorityEpoch={identity.authorityEpoch}
      sessionId={identity.sessionId}
      allowLocalImplicit={identity.localImplicit}
    />
  ) : null;
}
