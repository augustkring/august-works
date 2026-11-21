import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FEEDBACK_CONTACTS, PRODUCT_IDENTITY, supportAssistantAvailabilitySchema, supportAssistantResponseSchema,
  type SupportAssistantResponse } from "@paperclipai/shared";
import { api } from "../api/client";
import type { V9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function CustomerSupportAssistant({ companyId, principal, locale, ready, authority }: {
  companyId: string | null; principal: string; locale: "en" | "da"; ready: boolean; authority: V9PrivateReadAuthority;
}) {
  const { t } = useTranslation("experience");
  const id = useId();
  const alive = useRef(true), active = useRef(ready);
  active.current = ready;
  const controller = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<SupportAssistantResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!ready) {
    controller.current?.abort();
    if (submittedQuestion !== null && response === null) setFailed(true);
  } }, [ready, submittedQuestion, response]);
  const availability = useQuery({
    queryKey: ["support-assistant-availability", companyId, principal, locale, authority.epoch],
    enabled: ready && !!companyId && !!principal,
    queryFn: async ({ signal }) => authority.read(async () => supportAssistantAvailabilitySchema.parse(await api.get(
      `/companies/${companyId}/support/assistant?${new URLSearchParams({ expectedUserId: principal, locale })}`, { signal },
    ))),
    retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false,
  });
  const available = ready && authority.canRead() && !availability.isError && availability.data?.available
    ? availability.data : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !companyId || !question.trim() || !consent || pending || submittedQuestion === question.trim()) return;
    const requestId = crypto.randomUUID(), text = question.trim();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true); setFailed(false); setResponse(null); setSubmittedQuestion(text);
    try {
      const result = await authority.write(async () => supportAssistantResponseSchema.parse(await api.post(
        `/companies/${companyId}/support/assistant/answers`, { requestId, expectedUserId: principal, question: text,
          locale, consent: true, consentPolicyRevision: available.policyRevision }, { signal: request.signal },
      )));
      if (!alive.current || !active.current || request.signal.aborted || !authority.confirmed(result)) return;
      if (result.requestId !== requestId || (result.kind === "guidance" && result.citations.some(citation =>
        citation.locale !== locale || new URL(citation.href).origin !== PRODUCT_IDENTITY.docsOrigin)))
        throw new Error("Support guidance could not be verified");
      setResponse(result);
    } catch {
      if (alive.current && active.current && !request.signal.aborted) setFailed(true);
    } finally {
      if (alive.current) setPending(false);
    }
  }

  if (!ready) return null;
  return <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-lg border border-border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={`${id}-title`} className="font-medium">{t("helpAssistant.title")}</h2>
      <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={FEEDBACK_CONTACTS.support}>
        {t("supportCases.contactSupport")}
      </a>
    </div>
    <p className="text-sm text-muted-foreground">{t("helpAssistant.scope")}</p>
    {availability.isFetching && <p role="status" className="text-sm">{t("helpAssistant.checking")}</p>}
    {!availability.isFetching && !available && <p role="status" className="text-sm">{t("helpAssistant.unavailable")}</p>}
    {available && <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">{t("helpAssistant.included")}</p>
      <label htmlFor={`${id}-question`} className="block text-sm font-medium">{t("helpAssistant.question")}</label>
      <Textarea id={`${id}-question`} value={question} maxLength={4000} rows={3} disabled={pending}
        aria-describedby={`${id}-privacy`} onChange={event => {
          setQuestion(event.target.value); setConsent(false); setResponse(null); setFailed(false); setSubmittedQuestion(null);
        }} />
      <div id={`${id}-privacy`} className="space-y-1 text-sm text-muted-foreground">
        <p>{t("helpAssistant.noSecrets")}</p>
        <p>{available.processingNotice}</p>
        <a className="underline underline-offset-4" href={available.privacyNoticeUrl} target="_blank" rel="noreferrer">
          {t("helpAssistant.privacy")}
        </a>
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} disabled={pending}
          onChange={event => setConsent(event.target.checked)} />
        <span>{t("helpAssistant.consent", { provider: available.providerName })}</span>
      </label>
      <Button type="submit" disabled={pending || !consent || !question.trim() || submittedQuestion === question.trim()}>
        {t(pending ? "helpAssistant.asking" : "helpAssistant.ask")}
      </Button>
    </form>}
    {pending && <p role="status" className="text-sm">{t("helpAssistant.asking")}</p>}
    {(failed || (response && response.kind !== "guidance")) && <p role="status" className="text-sm">
      {t("helpAssistant.cannotVerify")}
    </p>}
    {response?.kind === "guidance" && authority.canRead() && <div role="status" className="space-y-3">
      <p className="text-sm">{t("helpAssistant.guidanceOnly")}</p>
      {response.citations.map(citation => <figure key={citation.id} className="space-y-2 border-l-2 border-border pl-3">
        <blockquote className="whitespace-pre-wrap text-sm">{citation.text}</blockquote>
        <figcaption className="text-sm">
          <a href={citation.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">{citation.title}</a>
          <span className="block text-xs text-muted-foreground">{t("helpAssistant.source", {
            maturity: citation.maturity === "preview" ? t("helpAssistant.preview") : "GA", date: citation.lastVerifiedAt,
          })}</span>
        </figcaption>
      </figure>)}
    </div>}
  </section>;
}
