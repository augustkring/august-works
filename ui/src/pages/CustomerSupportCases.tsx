import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEEDBACK_CONTACTS,
  SUPPORT_CASE_COPY,
  deriveSupportCaseSubject,
  supportCaseDetailSchema,
  supportCaseListSchema,
  supportCaseCategorySchema,
  supportCaseImpactSchema,
  supportCaseIntakePolicySchema, supportCaseSafeContextSchema, SUPPORT_CASE_LIMITS,
  type CreateSupportCase,
  type ReplySupportCase,
  type SupportCaseCategory,
  type SupportCaseDetail,
  type SupportCaseImpact,
} from "@paperclipai/shared";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9CurrentAccount, hasCurrentV9Session } from "../hooks/useV9CurrentAccount";
import { Link, useLocation, useNavigate } from "../lib/router";
import { getCompanyPathSegments } from "../lib/shell-navigation";
import { Button } from "../components/ui/button";

type SupportCaseDelivery = SupportCaseDetail["delivery"];

function errorCode(error: unknown) {
  return error instanceof ApiError ? (error.body as { details?: { code?: unknown } } | null)?.details?.code : undefined;
}
function hasAccountError(error: unknown) {
  return error instanceof ApiError && ([401, 403].includes(error.status) || errorCode(error) === "ACCOUNT_CHANGED");
}
function hasSessionError(error: unknown) {
  return hasAccountError(error) || error instanceof ApiError && error.status === 404;
}

function safeDetail(value: unknown, companyId: string, caseId?: string): SupportCaseDetail {
  const detail = supportCaseDetailSchema.parse(value);
  if (detail.companyId !== companyId || (caseId && detail.id !== caseId)) throw new Error("Support case source changed");
  return detail;
}

function supportPath(companyId: string, suffix = "") {
  return `/companies/${encodeURIComponent(companyId)}/support${suffix}`;
}

export function CustomerSupportCases() {
  const { t } = useTranslation("experience");
  const { selectedCompanyId } = useCompany();
  const identity = useV9CurrentAccount();
  const principal = identity.localImplicit ? null : identity.userId;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      {selectedCompanyId && principal ? (
        <CustomerSupportCasesForAccount
          key={`${selectedCompanyId}:${principal}`}
          companyId={selectedCompanyId}
          principal={principal}
        />
      ) : (
        <p role="status">{t(selectedCompanyId ? "supportCases.signInRequired" : "selectCompany")}</p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("supportCases.needHuman")} <a className="underline" href={FEEDBACK_CONTACTS.support}>{t("supportCases.contactSupport")}</a>
      </p>
    </div>
  );
}

function CustomerSupportCasesForAccount({ companyId, principal }: { companyId: string; principal: string }) {
  const { t, i18n } = useTranslation("experience");
  const client = useQueryClient();
  const identity = useV9CurrentAccount();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const location = useLocation(), navigate = useNavigate();
  const carried = location.state as { companyId?: unknown; expectedUserId?: unknown; returnPathname?: unknown } | null;
  const candidate = carried?.companyId === companyId && carried.expectedUserId === principal ? carried.returnPathname : null;
  const returnPathname = typeof candidate === "string" && candidate.startsWith("/") && !candidate.startsWith("//") && !/[\\?#\s]/.test(candidate)
    && new URL(candidate, window.location.origin).origin === window.location.origin
    && new URL(candidate, window.location.origin).pathname === candidate
    && getCompanyPathSegments(candidate, selectedCompany?.issuePrefix).length > 0 && candidate !== location.pathname
    ? candidate : "/work";
  const [composing, setComposing] = useState(true);
  const selected = supportCaseDetailSchema.shape.id.safeParse(new URLSearchParams(location.search).get("case"));
  const selectedCaseId = selected.success ? selected.data : null;
  const activeCase = useRef(selectedCaseId);
  activeCase.current = selectedCaseId;
  function setSelectedCaseId(id: string | null) {
    activeCase.current = id;
    const params = new URLSearchParams(location.search);
    if (id) params.set("case", id); else params.delete("case");
    navigate({ pathname: location.pathname, search: params.toString() ? "?" + params.toString() : "" }, { state: location.state });
    setTimelineCursor(null);
  }
  const [listCursor, setListCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [timelineCursor, setTimelineCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [accessEpoch, setAccessEpoch] = useState(0);
  const [caseUnavailable, setCaseUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false), [replying, setReplying] = useState(false);
  const mounted = useRef(true), activeScope = useRef("");
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selectedCaseId) detailHeading.current?.focus(); }, [selectedCaseId]);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SupportCaseCategory>("other");
  const [impact, setImpact] = useState<SupportCaseImpact | "">("");
  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [safeContext, setSafeContext] = useState(() => {
    const carried = location.state as { companyId?: unknown; expectedUserId?: unknown; safeContext?: unknown } | null;
    if (carried?.companyId !== companyId || carried.expectedUserId !== principal) return undefined;
    const parsed = supportCaseSafeContextSchema.safeParse(carried.safeContext);
    return parsed.success ? parsed.data : undefined;
  });
  const [submission, setSubmission] = useState<{ key: string; payload: CreateSupportCase } | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const reply = selectedCaseId ? replyDrafts[selectedCaseId] ?? "" : "";
  function setReply(body: string) { if (selectedCaseId) setReplyDrafts(previous => ({ ...previous, [selectedCaseId]: body })); }
  const [replySubmission, setReplySubmission] = useState<{ caseId: string; key: string; payload: ReplySupportCase } | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState<string | null>(null);
  const createInFlight = useRef(false);
  const replyInFlight = useRef(false);
  const ready = selectedCompanyId === companyId && identity.settled && !identity.localImplicit &&
    identity.userId === principal && !identity.failed && !accessLost &&
    hasCurrentV9Session(client, principal, identity.sessionId);
  const baseKey = useMemo(() => ["customer-support-cases", companyId, principal] as const, [companyId, principal]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void client.cancelQueries({ queryKey: baseKey });
      client.removeQueries({ queryKey: baseKey });
    };
  }, [client, baseKey]);
  const scope = `${companyId}:${principal}:${identity.sessionId}:${identity.authorityEpoch}:${accessEpoch}`;
  activeScope.current = scope;
  const readKey = [...baseKey, identity.sessionId, identity.authorityEpoch, accessEpoch] as const;
  function current() { return mounted.current && activeScope.current === scope && hasCurrentV9Session(client, principal, identity.sessionId); }
  function queryString(cursor: { createdAt: string; id: string } | null = null) {
    const params = new URLSearchParams({ expectedUserId: principal });
    if (cursor) { params.set("beforeCreatedAt", cursor.createdAt); params.set("beforeId", cursor.id); }
    return params.toString();
  }
  const policyQuery = useQuery({
    queryKey: [...readKey, "policy"], enabled: ready,
    queryFn: async ({ signal }) => {
      if (!current()) throw new Error("Account changed");
      const policy = supportCaseIntakePolicySchema.parse(await api.get(
        `${supportPath(companyId, "/policy")}?${queryString()}`, { signal, cache: "no-store" },
      ));
      if (!current()) throw new Error("Account changed");
      return policy;
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const listQuery = useQuery({
    queryKey: [...readKey, "list", listCursor], enabled: ready,
    queryFn: async ({ signal }) => {
      if (!current()) throw new Error("Account changed");
      const list = supportCaseListSchema.parse(await api.get(
        `${supportPath(companyId, "/cases")}?${queryString(listCursor)}`,
        { signal, cache: "no-store" },
      ));
      if (list.companyId !== companyId || !current())
        throw new Error("Support source changed");
      return list;
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const detailQuery = useQuery({
    queryKey: [...readKey, "detail", selectedCaseId, timelineCursor], enabled: ready && !!selectedCaseId,
    queryFn: async ({ signal }) => {
      if (!selectedCaseId || !current()) throw new Error("Account changed");
      const detail = safeDetail(await api.get(
        `${supportPath(companyId, `/cases/${encodeURIComponent(selectedCaseId)}`)}?${queryString(timelineCursor)}`,
        { signal, cache: "no-store" },
      ), companyId, selectedCaseId);
      if (!current()) throw new Error("Account changed");
      return detail;
    },
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });

  useCompanyLiveEvent((event) => {
    if (event.companyId !== companyId) return;
    const action = typeof event.payload.action === "string" ? event.payload.action : "";
    const relevant = event.type === "analytical.context.access_lost" ||
      (event.type === "activity.logged" && (/support|permission|membership|privacy|erased|deleted|company/i.test(action) || event.payload.entityType === "company_membership"));
    if (!relevant) return;
    const authorityChanged = event.type === "analytical.context.access_lost" ||
      /permission|membership|privacy|erased|deleted|withdraw/i.test(action) || event.payload.entityType === "company_membership";
    if (authorityChanged) {
      activeScope.current = "rechecking";
      void client.cancelQueries({ queryKey: baseKey });
      client.removeQueries({ queryKey: baseKey });
      setAccessEpoch(value => value + 1);
      return;
    }
    void client.invalidateQueries({ queryKey: baseKey });
  });

  function loseAccess() {
    activeScope.current = "access-lost";
    setAccessLost(true);
    setDescription(""); setSubject(""); setReplyDrafts({}); setSafeContext(undefined);
    setSubmission(null); setReplySubmission(null); setSubmitMessage(null); setReplyMessage(null);
    void client.cancelQueries({ queryKey: baseKey });
    client.removeQueries({ queryKey: baseKey });
  }
  function erasedRequest() {
    setSubmission(null); setReplySubmission(null); setDescription(""); setSubject(""); setReplyDrafts({});
    setSafeContext(undefined); setSelectedCaseId(null); setCaseUnavailable(true);
    activeScope.current = "erased";
    client.removeQueries({ queryKey: baseKey });
    setAccessEpoch(value => value + 1);
  }
  useEffect(() => {
    if (accessLost) return;
    if ((policyQuery.error && hasSessionError(policyQuery.error)) || (listQuery.error && hasSessionError(listQuery.error)) ||
      hasAccountError(detailQuery.error)) {
      loseAccess();
    } else if (detailQuery.error instanceof ApiError && detailQuery.error.status === 404) {
      activeScope.current = "case-unavailable";
      if (selectedCaseId) setReplyDrafts(previous => { const next = { ...previous }; delete next[selectedCaseId]; return next; });
      if (replySubmission?.caseId === selectedCaseId) setReplySubmission(null);
      setSelectedCaseId(null);
      setCaseUnavailable(true);
      client.removeQueries({ queryKey: [...readKey, "detail"] });
      void client.invalidateQueries({ queryKey: baseKey });
    }
  }, [policyQuery.error, listQuery.error, detailQuery.error, client, baseKey, accessLost]);
  useEffect(() => { if (detailQuery.data?.id) detailHeading.current?.focus(); }, [detailQuery.data?.id]);

  const isDanish = (i18n.resolvedLanguage ?? i18n.language).startsWith("da");
  const labels = isDanish ? SUPPORT_CASE_COPY.da : SUPPORT_CASE_COPY.en;
  const translatedSubject = useMemo(() => deriveSupportCaseSubject(description), [description]);
  const shownSubject = subjectEdited ? subject : translatedSubject;
  const busy = submitting || replying;

  function deliveryMessage(delivery: SupportCaseDelivery) {
    if (delivery === "delivered") return t("supportCases.deliveryDelivered");
    if (delivery === "not_required") return t("supportCases.deliveryNotRequired");
    if (delivery === "unknown") return t("supportCases.externalDeliveryUnknown");
    return labels.deliveryPending;
  }

  function acceptDetail(value: unknown, caseId?: string) {
    if (!current() || selectedCompanyId !== companyId || activeCase.current !== (caseId ?? null)) return false;
    const detail = safeDetail(value, companyId);
    if (caseId && detail.id !== caseId && detail.followUpOfId !== caseId) throw new Error("Support reply source changed");
    client.setQueryData([...readKey, "detail", detail.id, null], detail);
    void client.invalidateQueries({ queryKey: baseKey });
    if (!current()) return false;
    setSelectedCaseId(detail.id);
    if (caseId && detail.id !== caseId) setReplyMessage(t("supportCases.followUpCreated"));
    return true;
  }

  async function recoverRequest(key: string) {
    if (!current()) return null;
    const found = await api.get<unknown>(
      `${supportPath(companyId, `/cases/requests/${encodeURIComponent(key)}`)}?expectedUserId=${encodeURIComponent(principal)}`,
      { cache: "no-store" },
    );
    return current() ? safeDetail(found, companyId) : null;
  }

  async function submitCase() {
    if (createInFlight.current || !ready || !hasCurrentV9Session(client, principal, identity.sessionId) || !description.trim()) return;
    const attempt = submission ?? {
      key: crypto.randomUUID(),
      payload: {
        expectedUserId: principal,
        idempotencyKey: "",
        description,
        category: supportCaseCategorySchema.parse(category),
        impact: impact ? supportCaseImpactSchema.parse(impact) : null,
        ...(shownSubject.trim() ? { subject: shownSubject.trim() } : {}),
        ...(safeContext ? { safeContext } : {}),
      } as CreateSupportCase,
    };
    if (!attempt.payload.idempotencyKey) attempt.payload.idempotencyKey = attempt.key;
    setSubmission(attempt);
    createInFlight.current = true;
    setSubmitting(true);
    setSubmitMessage(null);
    try {
      const result = await api.post<unknown>(supportPath(companyId, "/cases"), attempt.payload);
      if (!current() || selectedCompanyId !== companyId) return;
      const detail = safeDetail(result, companyId);
      if (!acceptDetail(detail)) return;
      setSubmission(null);
      setDescription(""); setSubject(""); setSubjectEdited(false); setCategory("other"); setImpact("");
      setSubmitMessage(deliveryMessage(detail.delivery));
    } catch (error) {
      if (!current()) return;
      if (hasAccountError(error)) { loseAccess(); return; }
      if (errorCode(error) === "SUPPORT_REQUEST_ERASED") { erasedRequest(); return; }
      try {
        const recovered = await recoverRequest(attempt.key);
        if (recovered) {
          if (!acceptDetail(recovered)) return;
          setSubmission(null);
          setDescription(""); setSubject(""); setSubjectEdited(false); setCategory("other"); setImpact("");
          setSubmitMessage(deliveryMessage(recovered.delivery));
          return;
        }
      } catch { /* Keep the same idempotency key for an explicit retry. */ }
      if (current()) setSubmitMessage(t("supportCases.deliveryUnknown"));
    } finally {
      createInFlight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  async function submitReply() {
    const detail = detailQuery.data;
    if (replyInFlight.current || !ready || !detail || !reply.trim() || (replySubmission && replySubmission.caseId !== detail.id) || !hasCurrentV9Session(client, principal, identity.sessionId)) return;
    const attempt = replySubmission ?? {
      caseId: detail.id,
      key: crypto.randomUUID(),
      payload: { expectedUserId: principal, idempotencyKey: "", body: reply, ...(safeContext ? { safeContext } : {}) } as ReplySupportCase,
    };
    if (!attempt.payload.idempotencyKey) attempt.payload.idempotencyKey = attempt.key;
    setReplySubmission(attempt);
    replyInFlight.current = true;
    setReplying(true);
    setReplyMessage(null);
    try {
      const result = await api.post<unknown>(
        supportPath(companyId, `/cases/${encodeURIComponent(attempt.caseId)}/replies`),
        attempt.payload,
      );
      const ack = safeDetail(result, companyId);
      if (!acceptDetail(ack, attempt.caseId)) return;
      if (current()) {
        setReply(""); setReplySubmission(null);
        setReplyMessage(ack.followUpOfId ? t("supportCases.followUpCreated") : deliveryMessage(ack.delivery));
      }
    } catch (error) {
      if (!current()) return;
      if (hasAccountError(error)) { loseAccess(); return; }
      if (errorCode(error) === "SUPPORT_REQUEST_ERASED") { erasedRequest(); return; }
      try {
        const recovered = await recoverRequest(attempt.key);
        if (recovered) {
          if (!acceptDetail(recovered, attempt.caseId)) return;
          setReply(""); setReplySubmission(null);
          setReplyMessage(recovered.followUpOfId ? t("supportCases.followUpCreated") : deliveryMessage(recovered.delivery));
          return;
        }
      } catch { /* Keep the same idempotency key for an explicit retry. */ }
      if (current()) setReplyMessage(t("supportCases.deliveryUnknown"));
    } finally {
      replyInFlight.current = false;
      if (mounted.current) setReplying(false);
    }
  }

  const statusText = (status: string) => labels.statuses[status as keyof typeof labels.statuses] ?? status;
  const categories = supportCaseCategorySchema.options;
  const impacts = supportCaseImpactSchema.options;
  const privacy = policyQuery.data?.available ? policyQuery.data : null;
  function contextPreview(context: NonNullable<SupportCaseDetail["safeContext"]>) {
    return <dl className="space-y-1 text-sm">
      {context.surface && <div><dt className="font-medium">{t("supportCases.contextPage")}</dt><dd>{t(`supportCases.surfaces.${context.surface}`)}</dd></div>}
      {context.operationId && <div><dt className="font-medium">{t("supportCases.contextOperation")}</dt><dd className="break-words">{context.operationId}</dd></div>}
      {context.occurredAt && <div><dt className="font-medium">{t("supportCases.contextTime")}</dt><dd>{new Date(context.occurredAt).toLocaleString(isDanish ? "da-DK" : "en-GB")}</dd></div>}
      {context.errorCode && <div><dt className="font-medium">{t("supportCases.contextError")}</dt><dd>{context.errorCode}</dd></div>}
    </dl>;
  }
  function draftContext() {
    return safeContext ? <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="font-medium">{t("supportCases.contextPreview")}</h3>
      {contextPreview(safeContext)}
      <Button type="button" variant="outline" className="min-h-11" disabled={!!submission || !!replySubmission} onClick={() => setSafeContext(undefined)}>{t("supportCases.removeContext")}</Button>
    </section> : null;
  }

  if (!ready) return <section aria-busy="true" className="space-y-4">
    <h1 className="text-2xl font-semibold">{t("supportCases.title")}</h1>
    <p role="status">{accessLost ? t("supportCases.accessChanged") : t("loading")}</p>
  </section>;

  return <section className="space-y-6" aria-busy={policyQuery.isFetching || listQuery.isFetching}>
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">{t("supportCases.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("supportCases.intro")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link className="inline-flex min-h-11 items-center underline" to={returnPathname}>{t("supportCases.backToWork")}</Link>
        <Link className="inline-flex min-h-11 items-center underline" to="/company/support-access">{t("supportCases.accessHistory")}</Link>
      </div>
    </header>

    {accessLost ? <p role="alert">{t("supportCases.accessChanged")}</p> : null}
    {caseUnavailable && <p role="status">{t("supportCases.caseUnavailable")}</p>}
    {(policyQuery.isPending || listQuery.isPending) && <p role="status">{t("loading")}</p>}
    {(policyQuery.isError || listQuery.isError) && !accessLost && <div role="alert" className="space-y-3">
      <p>{t("supportCases.loadFailed")}</p>
      <Button className="min-h-11" variant="outline" onClick={() => { void policyQuery.refetch(); void listQuery.refetch(); }}>{t("supportCases.retryLoad")}</Button>
    </div>}
    {policyQuery.data?.available === false && !accessLost && <p role="status">{t("supportCases.notConfigured")}</p>}
    {privacy && !accessLost && <div className="space-y-1 rounded-md border border-border p-3 text-sm">
      <p>{t("supportCases.recipient", { recipientName: privacy.recipientName })}</p>
      <p>{t("supportCases.retention", { count: privacy.retentionDays })}</p>
      <a className="underline" href={privacy.privacyNoticeUrl} target="_blank" rel="noreferrer">{t("supportCases.privacyNotice")}</a>
    </div>}

    {selectedCaseId && detailQuery.data && ready && !accessLost && <article className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 ref={detailHeading} tabIndex={-1} className="font-medium">{detailQuery.data.subject}</h2><p className="text-sm text-muted-foreground">{detailQuery.data.reference} · {statusText(detailQuery.data.status)}</p></div>
        <Button variant="outline" className="min-h-11" onClick={() => setSelectedCaseId(null)}>{t("supportCases.backToCases")}</Button>
      </div>
      <p className="whitespace-pre-wrap break-words">{detailQuery.data.description}</p>
      {detailQuery.data.safeContext && contextPreview(detailQuery.data.safeContext)}
      {detailQuery.data.requestedResponse && <div role="status" className="rounded-md border border-border p-3">
        <p className="font-medium">{labels.statuses.WAITING_FOR_YOU}</p>
        <p className="whitespace-pre-wrap break-words">{detailQuery.data.requestedResponse}</p>
      </div>}
      <p className="text-sm text-muted-foreground">{deliveryMessage(detailQuery.data.delivery)}</p>
      {detailQuery.data.timeline.filter(entry => entry.kind !== "request").map((entry) => <div key={entry.id} className="space-y-1 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">{entry.author === "support" ? t("supportCases.support") : t("supportCases.customer")} · {statusText(entry.status)}</p>
        <p className="whitespace-pre-wrap break-words">{entry.body}</p>
        {entry.safeContext && contextPreview(entry.safeContext)}
      </div>)}
      {replySubmission && replySubmission.caseId !== selectedCaseId ? <Button variant="outline" className="min-h-11" onClick={() => setSelectedCaseId(replySubmission.caseId)}>{t("supportCases.pendingReply")}</Button> : <>
      <label className="block space-y-2 text-sm font-medium">{t("supportCases.replyLabel")}
        <textarea aria-label={t("supportCases.replyLabel")} maxLength={SUPPORT_CASE_LIMITS.reply} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-foreground" value={reply} disabled={!!replySubmission} onChange={(event) => setReply(event.target.value)} />
      </label>
      {draftContext()}
      <Button className="min-h-11" disabled={!reply.trim() || !ready || busy} onClick={() => void submitReply()}>
        {replySubmission ? t("supportCases.retryReply") : t("supportCases.sendReply")}
      </Button>
      {replyMessage && <p role="status">{replyMessage}</p>}
      </>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {timelineCursor && <Button variant="outline" className="min-h-11" onClick={() => setTimelineCursor(null)}>{t("supportCases.latestMessages")}</Button>}
        {detailQuery.data.nextCursor && <Button variant="outline" className="min-h-11" onClick={() => setTimelineCursor(detailQuery.data!.nextCursor)}>{t("supportCases.earlierMessages")}</Button>}
      </div>
      {detailQuery.isError && !hasSessionError(detailQuery.error) && <p role="alert">{t("supportCases.detailRefreshFailed")}</p>}
    </article>}

    {!selectedCaseId && listQuery.data && ready && !accessLost && <section className="space-y-3">
      <h2 className="text-lg font-medium">{t("supportCases.recentCases")}</h2>
      {listQuery.data.entries.length === 0 ? <p role="status">{t("supportCases.noCases")}</p> : <ul className="divide-y divide-border">
        {listQuery.data.entries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-medium">{entry.subject}</p><p className="text-sm text-muted-foreground">{entry.reference} · {statusText(entry.status)}</p></div>
          <Button variant="outline" className="min-h-11" onClick={() => { setSelectedCaseId(entry.id); setReplyMessage(null); }}>{t("supportCases.openCase")}</Button>
        </li>)}
      </ul>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {listCursor && <Button variant="outline" className="min-h-11" onClick={() => setListCursor(null)}>{t("supportCases.latestCases")}</Button>}
        {listQuery.data.nextCursor && <Button variant="outline" className="min-h-11" onClick={() => setListCursor(listQuery.data!.nextCursor)}>{t("supportCases.earlierCases")}</Button>}
      </div>
    </section>}

    {!selectedCaseId && !composing && ready && !accessLost && <Button variant="outline" className="min-h-11" onClick={() => setComposing(true)}>{t("supportCases.resumeDraft")}</Button>}
    {!selectedCaseId && composing && privacy && ready && !accessLost && <form className="space-y-4 border-t border-border pt-5" onSubmit={(event) => { event.preventDefault(); void submitCase(); }}>
      <h2 className="text-lg font-medium">{t("supportCases.newCase")}</h2>
      <label className="block space-y-2 text-sm font-medium">{labels.description}
        <textarea aria-label={labels.description} className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-foreground" maxLength={SUPPORT_CASE_LIMITS.description} required value={description} disabled={!!submission} onChange={(event) => setDescription(event.target.value)} aria-describedby="support-description-help" />
      </label>
      <p id="support-description-help" className="text-sm text-muted-foreground">{labels.descriptionHelp}</p>
      <label className="block space-y-2 text-sm font-medium">{t("supportCases.subjectPreview")}
        <input aria-label={t("supportCases.subjectPreview")} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" maxLength={SUPPORT_CASE_LIMITS.subject} value={shownSubject} disabled={!!submission} onChange={(event) => { setSubject(event.target.value); setSubjectEdited(true); }} />
      </label>
      <label className="block space-y-2 text-sm font-medium">{t("supportCases.category")}
        <select aria-label={t("supportCases.category")} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={category} disabled={!!submission} onChange={(event) => setCategory(supportCaseCategorySchema.parse(event.target.value))}>
          {categories.map((value) => <option key={value} value={value}>{labels.categories[value]}</option>)}
        </select>
      </label>
      <label className="block space-y-2 text-sm font-medium">{t("supportCases.impact")}
        <select aria-label={t("supportCases.impact")} className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground" value={impact} disabled={!!submission} onChange={(event) => setImpact(event.target.value ? supportCaseImpactSchema.parse(event.target.value) : "")}>
          <option value="">{t("supportCases.noImpact")}</option>
          {impacts.map((value) => <option key={value} value={value}>{labels.impacts[value]}</option>)}
        </select>
      </label>
      {draftContext()}
      <div className="flex items-center justify-between gap-3">
      <Button variant="outline" className="min-h-11" type="button" disabled={busy} onClick={() => setComposing(false)}>{t("supportCases.cancel")}</Button>
      <Button className="min-h-11" type="submit" disabled={!description.trim() || busy || !ready}>
        {submission ? t("supportCases.retrySubmit") : t("supportCases.submit")}
      </Button>
      </div>
      {submitMessage && <p role="status">{submitMessage}</p>}
      <p className="text-sm text-muted-foreground">{t("supportCases.noAccessGrant")}</p>
    </form>}
  </section>;
}
