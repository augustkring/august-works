import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FEEDBACK_CONTACTS,
  feedbackCategorySchema,
  type CreateCustomerFeedback,
} from "@paperclipai/shared";
import { useLocation, Link } from "../lib/router";
import { customerFeedbackApi } from "../api/customer-feedback";
import { useCompany } from "../context/CompanyContext";
import { useAccountIdentity } from "../api/companies-query";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

function surface(
  path: string,
): CreateCustomerFeedback["context"]["surfaceKey"] {
  const segments = path.split("/");
  if (segments.includes("dashboard")) return "home";
  if (segments.includes("needs-you") || segments.includes("decisions"))
    return "needs_you";
  if (segments.includes("agents")) return "agents";
  if (segments.includes("apps")) return "apps";
  if (
    segments.includes("welcome") ||
    segments.includes("onboarding") ||
    segments.includes("activation")
  )
    return "onboarding";
  if (segments.includes("workflows") || segments.includes("orchestration"))
    return "workflow";
  if (segments.includes("settings")) return "company";
  if (segments.includes("issues") || segments.includes("work")) return "work";
  return "other";
}
function FeedbackForm({
  companyId,
  principal,
}: {
  companyId: string;
  principal: string;
}) {
  const { t, i18n } = useTranslation("experience"),
    location = useLocation();
  const [open, setOpen] = useState(false),
    [category, setCategory] =
      useState<CreateCustomerFeedback["category"]>("BUG");
  const [body, setBody] = useState(""),
    [goal, setGoal] = useState(""),
    [blocksWork, setBlocksWork] = useState(false),
    [omitName, setOmitName] = useState(false),
    [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [context, setContext] = useState<
    CreateCustomerFeedback["context"] | null
  >(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const attempted = useRef<CreateCustomerFeedback | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    categoryInput = useRef<HTMLSelectElement>(null),
    returnFocus = useRef<HTMLElement | null>(null),
    receiptFocus = useRef<HTMLDivElement>(null),
    errorFocus = useRef<HTMLParagraphElement>(null);
  const send = useMutation({
    mutationFn: (input: CreateCustomerFeedback) =>
      customerFeedbackApi.create(companyId, principal, input),
    retry: false,
  });
  function show(event?: Event) {
    returnFocus.current =
      event instanceof CustomEvent &&
      event.detail?.returnFocus === "global_feedback"
        ? trigger.current
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setContext({
      surfaceKey: surface(location.pathname),
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
    if (open && send.isError) errorFocus.current?.focus();
    else if (open && send.isSuccess) receiptFocus.current?.focus();
  }, [open, send.isError, send.isSuccess]);
  useEffect(() => {
    document.addEventListener("paperclip:open-feedback", show);
    return () => document.removeEventListener("paperclip:open-feedback", show);
  }, [location.pathname, i18n.resolvedLanguage]);
  function edit(change: () => void) {
    change();
    attempted.current = null;
    setRequestKey(crypto.randomUUID());
    send.reset();
  }
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        className="min-h-11"
        onClick={() => show()}
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
            if (send.data) receiptFocus.current?.focus();
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
          {send.data ? (
            <div
              ref={receiptFocus}
              tabIndex={-1}
              role="status"
              className="space-y-3 outline-none"
            >
              <p>{t("feedback.received")}</p>
              <p>{send.data.feedbackId}</p>
              <Link
                className="inline-flex min-h-11 items-center underline"
                to={`/my-feedback?feedbackId=${send.data.id}`}
                onClick={() => setOpen(false)}
              >
                {t("feedback.history")}
              </Link>
              <Button
                type="button"
                className="min-h-11"
                onClick={() => {
                  setOpen(false);
                  setBody("");
                  setGoal("");
                  setBlocksWork(false);
                  setOmitName(false);
                  setIncludeDiagnostics(false);
                  attempted.current = null;
                  setRequestKey(crypto.randomUUID());
                  send.reset();
                }}
              >
                {t("feedback.close")}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (context) {
                  attempted.current ??= {
                    idempotencyKey: requestKey,
                    category,
                    body,
                    goal: category === "OTHER" ? "" : goal,
                    blocksWork: category === "BUG" && blocksWork,
                    omitName,
                    context,
                    includeDiagnostics,
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
                  disabled={send.isPending}
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
                  disabled={send.isPending}
                  value={body}
                  onChange={(event) => edit(() => setBody(event.target.value))}
                />
              </label>
              {category !== "OTHER" && (
                <label className="block space-y-2">
                  <span>{t(`feedback.goals.${category}`)}</span>
                  <Textarea
                    maxLength={2000}
                    disabled={send.isPending}
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
                    disabled={send.isPending}
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
                  disabled={send.isPending}
                  checked={includeDiagnostics}
                  onChange={(event) =>
                    edit(() => setIncludeDiagnostics(event.target.checked))
                  }
                />
                {t("feedback.diagnostics")}
              </label>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  disabled={send.isPending}
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
              <p className="text-sm text-muted-foreground">
                {t("feedback.imagesUnavailable")}
              </p>
              {send.isError && (
                <p
                  ref={errorFocus}
                  tabIndex={-1}
                  role="alert"
                  className="outline-none"
                >
                  {t("feedback.failed")}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setOpen(false)}
                >
                  {t("feedback.cancel")}
                </Button>
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={send.isPending || !body.trim()}
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
  const { enabled } = useV9FeatureEnabled("customer_feedback_v9"),
    { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  return enabled && identity.settled && principal && selectedCompanyId ? (
    <FeedbackForm
      key={`${selectedCompanyId}:${principal}`}
      companyId={selectedCompanyId}
      principal={principal}
    />
  ) : null;
}
