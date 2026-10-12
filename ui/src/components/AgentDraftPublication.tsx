import { AgentSelectedMemory } from "./AgentSelectedMemory";
import { AgentSelectedKnowledge } from "./AgentSelectedKnowledge";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentDraftPublicationCommandSchema, type AgentAuthoringDraftView, type AgentDraftPublicationCommand,
  type AgentDraftPublicationReceipt, type AgentDraftPublicationReview } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import type { AgentAuthoringOptions } from "@/api/agent-authoring";
import { agentAuthoringBlockerKey } from "@/lib/agent-authoring-copy";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";
import { AgentPause } from "./AgentPause";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

export function AgentDraftPublication({ company, principal, draft, enabled, canUseAuthority, options, receiptOnly = false, onPublished }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean; options: AgentAuthoringOptions | null;
  receiptOnly?: boolean; onPublished?: (receipt: AgentDraftPublicationReceipt) => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), label = useId();
  const alive = useRef(true), latest = useRef({ company, principal, draft, enabled, canUseAuthority });
  latest.current = { company, principal, draft, enabled, canUseAuthority };
  const attempt = useRef<AgentDraftPublicationCommand | null>(null), decisionHash = useRef<string | null>(null);
  const [unknown, setUnknown] = useState(false), [open, setOpen] = useState(false), [publication, setPublication] = useState(false), [activation, setActivation] = useState(false);
  const [receipt, setReceipt] = useState<AgentDraftPublicationReceipt | null>(null), [failure, setFailure] = useState<string | null>(null);
  const [receiptIdentity, setReceiptIdentity] = useState<string | null>(null);
  const agentId = draft.agentId ?? draft.preparation?.agentId ?? null;
  // Recovery belongs to the Original command, including after a saved draft
  // version changes. Only its identity is read; it is never automatically sent.
  const storageKey = `aw:v9:agent-publication:${encodeURIComponent(company)}:${encodeURIComponent(principal)}:${draft.id}`;
  function current(write = false) {
    const value = latest.current;
    return alive.current && value.enabled && value.canUseAuthority() && (write ? authority.canWrite() : authority.canRead()) &&
      value.company === company && value.principal === principal && value.draft.id === draft.id && value.draft.companyId === company &&
      value.draft.createdByUserId === principal && value.draft.version === draft.version;
  }
  useEffect(() => {
    alive.current = true; attempt.current = null; setUnknown(false); setReceipt(null); setReceiptIdentity(null); setFailure(null);
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) { const parsed = agentDraftPublicationCommandSchema.safeParse(JSON.parse(stored));
        if (parsed.success) { attempt.current = parsed.data; setReceiptIdentity(parsed.data.requestId); setUnknown(true); } }
    } catch { /* A stored identity grants no authority. */ }
    return () => { alive.current = false; };
  }, [storageKey]);
  const reviewKey = ["agent-draft-publication", company, principal, authority.epoch, draft.id, draft.version];
  const review = useQuery({ queryKey: reviewKey, enabled: !receiptOnly && enabled && authority.writeReady && !!agentId && !receipt && !unknown,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true)) throw new Error(t("agentPublication.changed"));
      const value = await agentAuthoringApi.publicationReview(company, principal, draft.id, signal);
      if (!current(true) || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version || value.agentId !== agentId)
        throw new Error(t("agentPublication.changed"));
      return value;
    }) });
  const historical = useQuery({ queryKey: ["agent-draft-publication-receipt", company, principal, authority.epoch, draft.id, receiptIdentity],
    enabled: receiptOnly && enabled && authority.readReady && !!agentId && !unknown,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error(t("agentPublication.changed"));
      const value = await agentAuthoringApi.publicationReceipt(company, principal, draft.id, receiptIdentity ?? undefined, signal);
      if (!current() || value && (value.companyId !== company || value.draftId !== draft.id || value.agentId !== agentId ||
          receiptIdentity !== null && value.requestId !== receiptIdentity))
        throw new Error(t("agentPublication.changed"));
      return value;
    }) });
  useEffect(() => {
    if (receiptOnly && !unknown && historical.isSuccess && !historical.isFetching && current()) {
      setReceipt(historical.data);
      if (historical.data && receiptIdentity === null) setReceiptIdentity(historical.data.requestId);
    }
  }, [receiptOnly, historical.isSuccess, historical.isFetching, historical.data, authority.epoch, unknown]);
  useEffect(() => { setOpen(false); setPublication(false); setActivation(false); }, [authority.epoch, enabled, draft.version, review.data?.reviewHash, review.isFetching, review.isError]);
  function currentReview() {
    const state = client.getQueryState(reviewKey), value = client.getQueryData<AgentDraftPublicationReview>(reviewKey);
    if (!current(true) || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated || !value ||
      !value.canPublish || value.version !== draft.version) throw new Error(t("agentPublication.changed"));
    return value;
  }
  function accept(value: AgentDraftPublicationReceipt) {
    if (!current() || value.companyId !== company || value.draftId !== draft.id || value.agentId !== agentId || value.requestId !== attempt.current?.requestId)
      throw new Error(t("agentPublication.changed"));
    // Keep the Original command identity for authoritative receipt recovery on reload.
    attempt.current = null; setUnknown(false); setOpen(false); setPublication(false); setActivation(false); setFailure(null); setReceiptIdentity(value.requestId); setReceipt(value);
    for (const prefix of ["agents", "agent", "agent-authoring-review", "hire-agent-review"])
      void client.invalidateQueries({ queryKey: [prefix, company] });
    if (!receiptOnly && current()) onPublished?.(value);
  }
  const publish = useMutation({ mutationFn: async () => {
    if (attempt.current || unknown || receipt) throw new Error(t("agentPublication.unknown"));
    const value = currentReview();
    if (!publication || !activation || decisionHash.current !== value.reviewHash) throw new Error(t("agentPublication.changed"));
    const command: AgentDraftPublicationCommand = { requestId: crypto.randomUUID(), expectedVersion: draft.version,
      expectedReviewHash: value.reviewHash, activate: true, confirmPublication: true, confirmActivation: true };
    sessionStorage.setItem(storageKey, JSON.stringify(command)); attempt.current = command;
    return authority.write(() => agentAuthoringApi.publish(company, principal, draft.id, command));
  }, onSuccess: value => { if (!authority.confirmed(value) || !current()) return;
    try { accept(value); } catch { setUnknown(true); setFailure(t("agentPublication.changed")); }
  }, onError: () => { if (current()) { setUnknown(!!attempt.current); setOpen(false); setFailure(t(attempt.current ? "agentPublication.unknown" : "agentPublication.changed")); } } });
  const check = useMutation({ mutationFn: () => authority.read(async () => {
    if (!current() || !attempt.current) throw new Error(t("agentPublication.changed"));
    return agentAuthoringApi.publicationReceipt(company, principal, draft.id, attempt.current.requestId);
  }), onSuccess: value => { if (!current()) return;
    if (!value) { setFailure(t("agentPublication.unknown")); return; }
    try { accept(value); } catch { setFailure(t("agentPublication.changed")); }
  }, onError: () => { if (current()) setFailure(t("agentPublication.changed")); } });
  if (!agentId) return <p>{t("agentSafeTest.prepareFirst")}</p>;
  if (!enabled) return <p>{t("agentSafeTest.saveFirst")}</p>;
  if (!authority.readReady || !current()) return <p role="status">{t("agentSafeTest.checking")}</p>;
  const pending = publish.isPending || check.isPending;
  const showReceipt = receipt && (!receiptOnly || historical.isSuccess && !historical.isFetching && historical.data?.requestId === receipt.requestId);
  const change = (key: string, before: string | undefined, after: string | undefined) => <div key={key}>
    <dt>{t(key)}</dt><dd className="whitespace-pre-wrap break-words">{before || t("customAgent.notSet")} → {after || t("customAgent.notSet")}</dd>
  </div>;
  return <section className="space-y-3" aria-label={t("agentPublication.title")}>
    <h2 className="text-lg font-semibold">{t("agentPublication.title")}</h2>
    <p>{t("agentPublication.boundary")}</p>
    {failure ? <p role="alert">{failure}</p> : null}
    {showReceipt && receipt ? <>
      <p role="status">{t("agentPublication.receipt", { version: receipt.publishedVersion })}</p>
      <p className="whitespace-pre-wrap">{receipt.publishedContent.name} · {receipt.publishedContent.outcome}</p>
      {receipt.packageInstallation ? <p>{t("agentPublication.packageVersion", { version: receipt.packageInstallation.version })}</p> : null}
      <p>{t("agentPublication.scope")}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline" className="min-h-11"><Link to={`/agents/${receipt.agentId}`} onClick={event => { if (!current()) event.preventDefault(); }}>{t("agentPublication.openAgent")}</Link></Button>
        <Button asChild variant="outline" className="min-h-11"><Link to={`/agents/${receipt.agentId}/monitor`} onClick={event => { if (!current()) event.preventDefault(); }}>{t("agentPublication.manageAgent")}</Link></Button>
      </div>
      <AgentPause company={company} principal={principal} agentId={receipt.agentId} enabled={current()} />
    </> : null}
    {receiptOnly && !showReceipt && !unknown ? <p role="status">{historical.isFetching ? t("agentSafeTest.checking") : historical.isError || receiptIdentity !== null ? t("agentPublication.unavailable") : t("hireSetup.noReceipt")}</p> : null}
    {unknown ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => check.mutate()}>{t("agentPublication.checkOriginal")}</Button> : null}
    {review.isFetching ? <p role="status">{t("agentSafeTest.checking")}</p> : null}
    {review.isError ? <p role="status">{t("agentPublication.unavailable")}</p> : null}
    {review.isSuccess && !review.isFetching && !unknown && !receipt ? <>
      {review.data.blockers.length ? <ul className="list-disc space-y-2 pl-5">{review.data.blockers.map((item, index) => <li key={index}>{t(agentAuthoringBlockerKey(item.code))}</li>)}</ul> : null}
      {review.data.blockers.some(item => item.code === "hire_package_activation_required") ? <Button asChild variant="outline" className="min-h-11">
        <Link to="/agents/packages">{t("agentPublication.reviewPackage")}</Link></Button> : null}
      <Button className="min-h-11" disabled={!review.data.canPublish || pending || !authority.writeReady}
        onClick={() => { try { decisionHash.current = currentReview().reviewHash; setPublication(false); setActivation(false); setOpen(true); }
          catch { setFailure(t("agentPublication.changed")); } }}>{t("agentPublication.review")}</Button>
    </> : null}
    <AlertDialog open={open && !unknown && !receiptOnly && !receipt && review.isSuccess && !review.isFetching && current(true)} onOpenChange={value => { setOpen(value); if (!value) { setPublication(false); setActivation(false); } }}>
      <AlertDialogContent className="max-h-(--sz-85vh) overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{t("agentPublication.confirmTitle")}</AlertDialogTitle>
        <AlertDialogDescription>{t("agentPublication.boundary")}</AlertDialogDescription></AlertDialogHeader>
        <dl className="max-h-60 space-y-2 overflow-y-auto" tabIndex={0} aria-label={t("agentPublication.changes")}>
          <dt>{t("agentPublication.versions", { before: review.data?.previousVersion ?? 0, after: review.data?.nextVersion ?? 1 })}</dt><dd>{review.data?.after.name}</dd>
          {change("customAgent.responsibility", review.data?.before?.outcome, review.data?.after.outcome)}
          {change("customAgent.agentName", review.data?.before?.name, review.data?.after.name)}
          {change("customAgent.customerDescription", review.data?.before?.description, review.data?.after.description)}
          {change("customAgent.internalDescription", review.data?.before?.internalDescription, review.data?.after.internalDescription)}
          {change("customAgent.accountableOwner", options?.owners.find(item => item.id === review.data?.before?.ownerUserId)?.name,
            options?.owners.find(item => item.id === review.data?.after.ownerUserId)?.name ?? t("hireSetup.ownerUnconfirmed"))}
          {(["purpose", "responsibilities", "prohibited", "missingInformation", "escalation", "communication"] as const).map(key =>
            change(`customAgent.${key}`, review.data?.before?.instructions[key], review.data?.after.instructions[key]))}
          <dt>{t("agentSafeTest.model")}</dt><dd>{review.data?.provider} · {review.data?.model}</dd>
          <dt>{t("agentPublication.perCallCost")}</dt><dd>{review.data?.maximumPerModelCallMinor === null || !review.data ? t("customAgent.notSet") : `${(review.data.maximumPerModelCallMinor / 100).toFixed(2)} USD`}</dd>
          <dt>{t("agentSafeTest.procedures")}</dt><dd><ul className="max-h-40 overflow-y-auto" tabIndex={0} aria-label={t("agentSafeTest.procedures")}>
            {review.data?.requiredProcedures.map(item => <li key={item.skillId}>{item.name}</li>)}
            {review.data?.requiredPlaybooks?.map(item => <li key={item.playbookId}>{item.name}</li>)}
          </ul></dd>
          <AgentSelectedKnowledge sources={review.data?.selectedKnowledge} /><AgentSelectedMemory sources={review.data?.selectedMemory} />
        </dl>
        <label htmlFor={`${label}-publication`} className="flex min-h-11 items-start gap-3"><input id={`${label}-publication`} type="checkbox" checked={publication} onChange={event => setPublication(event.target.checked)} /><span>{t("agentPublication.confirmPublication")}</span></label>
        <label htmlFor={`${label}-activation`} className="flex min-h-11 items-start gap-3"><input id={`${label}-activation`} type="checkbox" checked={activation} onChange={event => setActivation(event.target.checked)} /><span>{t("agentPublication.confirmActivation")}</span></label>
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel><Button className="min-h-11" disabled={!publication || !activation || pending || !authority.writeReady} onClick={() => publish.mutate()}>{t("agentPublication.publish")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
