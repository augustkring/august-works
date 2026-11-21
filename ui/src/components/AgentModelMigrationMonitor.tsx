import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentModelMigrationMonitorCommandSchema, type AgentAuthoringDraftView, type AgentModelMigrationMonitorCommand } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";

export function AgentModelMigrationMonitor({ company, principal, draft, enabled, canUseAuthority }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), label = useId();
  const alive = useRef(true), attempt = useRef<AgentModelMigrationMonitorCommand | null>(null);
  const [unknown, setUnknown] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const [recordedRequest, setRecordedRequest] = useState<string | null>(null);
  const [recordedDecision, setRecordedDecision] = useState<"healthy" | "hold" | null>(null);
  const current = () => alive.current && enabled && canUseAuthority() && authority.canRead() && draft.companyId === company &&
    draft.createdByUserId === principal && draft.status === "draft";
  const review = useQuery({ queryKey: ["agent-model-migration-monitor-current-review", company, principal, authority.epoch, draft.id],
    enabled: enabled && authority.readReady && current(), retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      const value = await agentAuthoringApi.currentModelMigrationMonitorReview(company, principal, draft.id, signal);
      if (!current() || value && (value.companyId !== company || value.draftId !== draft.id || value.agentId !== (draft.agentId ?? draft.preparation?.agentId)))
        throw new Error(t("agentMigrationMonitor.changed"));
      return value;
    }) });
  const migration = review.data ?? null;
  const recoveryKey = migration ? `aw:v10:model-migration-monitor:${company}:${principal}:${draft.id}:${migration.migrationRevisionId}` : null;
  const saved = useQuery({ queryKey: ["agent-model-migration-monitor-receipt", company, principal, authority.epoch, draft.id, migration?.migrationRevisionId],
    enabled: !!migration && enabled && authority.readReady && current(), retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      const value = await agentAuthoringApi.modelMigrationMonitorReceipt(company, principal, draft.id, migration!.migrationRevisionId, signal);
      if (!current() || value && (value.companyId !== company || value.draftId !== draft.id || value.migrationRevisionId !== migration!.migrationRevisionId))
        throw new Error(t("agentMigrationMonitor.changed"));
      return value;
    }) });
  useEffect(() => {
    attempt.current = null; setUnknown(false); setFailure(null); setRecordedRequest(null); setRecordedDecision(null);
    if (!recoveryKey) return;
    try {
      const raw = sessionStorage.getItem(recoveryKey);
      if (!raw) return;
      const parsed = agentModelMigrationMonitorCommandSchema.safeParse(JSON.parse(raw));
      if (parsed.success) { attempt.current = parsed.data; setUnknown(true); }
    } catch { /* Stored request identity does not grant authority. */ }
  }, [recoveryKey]);
  const reviewKey = ["agent-model-migration-monitor-current-review", company, principal, authority.epoch, draft.id];
  const record = useMutation({ mutationFn: async () => {
    const value = client.getQueryData<Awaited<ReturnType<typeof agentAuthoringApi.currentModelMigrationMonitorReview>>>(reviewKey);
    const state = client.getQueryState(reviewKey);
    if (!current() || !migration || !authority.writeReady || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated || !value?.canRecord)
      throw new Error(t("agentMigrationMonitor.changed"));
    if (attempt.current || unknown) throw new Error(t("agentMigrationMonitor.unknown"));
    const command: AgentModelMigrationMonitorCommand = { requestId: crypto.randomUUID(), expectedReviewHash: value.reviewHash, confirmMonitoring: true };
    sessionStorage.setItem(recoveryKey!, JSON.stringify(command));
    attempt.current = agentModelMigrationMonitorCommandSchema.parse(command);
    return authority.write(() => agentAuthoringApi.recordModelMigrationMonitor(company, principal, draft.id, migration.migrationRevisionId, command));
  }, onSuccess: value => {
    const acknowledged = authority.confirmed(value), active = current(), sameMigration = value.migrationRevisionId === migration?.migrationRevisionId;
    if (!acknowledged || !active || !sameMigration) return;
    setUnknown(false); setFailure(null); setRecordedRequest(value.requestId); setRecordedDecision(value.decision);
    if (recoveryKey) sessionStorage.removeItem(recoveryKey);
    void client.invalidateQueries({ queryKey: ["agent-model-migration-monitor-receipt", company, principal, authority.epoch, draft.id] });
  }, onError: () => { if (current()) { setUnknown(!!attempt.current); setFailure(t(attempt.current ? "agentMigrationMonitor.unknown" : "agentMigrationMonitor.changed")); } } });
  const check = useMutation({ mutationFn: async () => {
    if (!current() || !migration || !attempt.current) throw new Error(t("agentMigrationMonitor.changed"));
    return agentAuthoringApi.modelMigrationMonitorReceipt(company, principal, draft.id, migration.migrationRevisionId);
  }, onSuccess: value => {
    if (!current() || !value || value.requestId !== attempt.current?.requestId || !authority.confirmed(value)) return;
    setUnknown(false); setFailure(null); setRecordedRequest(value.requestId); setRecordedDecision(value.decision);
    if (recoveryKey) sessionStorage.removeItem(recoveryKey);
  }, onError: () => { if (current()) setFailure(t("agentMigrationMonitor.changed")); } });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!enabled || !authority.readReady || !current()) return <p role="status">{t("agentMigrationMonitor.checking")}</p>;
  if (review.isPending || review.isFetching) return <p role="status">{t("agentMigrationMonitor.checking")}</p>;
  if (review.isError) return <p role="alert">{t("agentMigrationMonitor.unavailable")}</p>;
  if (!migration) return <p>{t("agentMigrationMonitor.notRequired")}</p>;
  if (saved.isError) return <p role="alert">{t("agentMigrationMonitor.unavailable")}</p>;
  const existing = saved.data;
  const alreadyRecordedCurrent = !!review.data && (existing?.reviewHash === review.data.reviewHash ||
    (!!recordedRequest && attempt.current?.expectedReviewHash === review.data.reviewHash));
  return <section className="space-y-3" aria-labelledby={label}>
    <h2 id={label} className="text-lg font-semibold">{t("agentMigrationMonitor.title")}</h2>
    <p>{t("agentMigrationMonitor.instructions")}</p>
    {failure ? <p role="alert">{failure}</p> : null}
    {existing || recordedRequest ? <p role="status">{t((existing?.decision ?? recordedDecision) === "hold" ? "agentMigrationMonitor.recordedHold" : "agentMigrationMonitor.recorded",
      { version: existing?.publishedVersion ?? migration.publishedVersion })}</p> : null}
    {!alreadyRecordedCurrent && review.data ? <>
      {review.data.blockers.includes("monitor_requires_a_fresh_draft_from_the_current_published_agent")
        ? <p role="status">{t("agentMigrationMonitor.newDraft")}</p> : null}
      {review.data.blockers.length ? <p role="status">{t("agentMigrationMonitor.pending", { count: review.data.tests.length })}</p> :
        <p role="status">{t(review.data.recommendation === "healthy" ? "agentMigrationMonitor.ready" : "agentMigrationMonitor.holdReady", { count: review.data.tests.length })}</p>}
      {review.data.canRecord ? <Button className="min-h-11" disabled={!authority.writeReady || record.isPending || unknown}
        onClick={() => record.mutate()}>{t(review.data.recommendation === "healthy" ? "agentMigrationMonitor.record" : "agentMigrationMonitor.recordHold")}</Button> : null}
    </> : null}
    {unknown ? <Button className="min-h-11" variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>{t("agentMigrationMonitor.checkOriginal")}</Button> : null}
  </section>;
}
