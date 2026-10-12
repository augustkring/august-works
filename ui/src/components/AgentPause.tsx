import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentPauseCommandSchema, type AgentPauseCommand, type AgentPauseReceipt, type AgentPauseReview } from "@paperclipai/shared";
import { agentPauseApi } from "@/api/agent-pause";
import { ApiError } from "@/api/client";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

export function AgentPause({ company, principal, agentId, enabled = true, onPaused }: {
  company: string; principal: string; agentId: string; enabled?: boolean; onPaused?: () => void;
}) {
  const { t } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal, true), client = useQueryClient();
  const [open, setOpen] = useState(false), [policy, setPolicy] = useState<"drain" | "cancel" | null>(null);
  const [unknown, setUnknown] = useState(false), [receipt, setReceipt] = useState<AgentPauseReceipt | null>(null), [failed, setFailed] = useState(false);
  const alive = useRef(true), latest = useRef({ company, principal, agentId, enabled });
  latest.current = { company, principal, agentId, enabled };
  const attempted = useRef<AgentPauseCommand | null>(null), decision = useRef<string | null>(null);
  const storageKey = `aw:v9:pause:${encodeURIComponent(company)}:${encodeURIComponent(principal)}:${agentId}`;
  const key = ["agent-pause-review", company, principal, agentId, authority.epoch];
  function current() { return alive.current && latest.current.enabled && latest.current.company === company && latest.current.principal === principal && latest.current.agentId === agentId && authority.canRead(); }
  useEffect(() => {
    alive.current = true; setOpen(false); setPolicy(null); setUnknown(false); setReceipt(null); attempted.current = null;
    try { const saved = sessionStorage.getItem(storageKey); if (saved) { const parsed = agentPauseCommandSchema.safeParse(JSON.parse(saved));
      if (parsed.success) { attempted.current = parsed.data; setUnknown(true); } } } catch { /* Stored identity grants no permission. */ }
    return () => { alive.current = false; };
  }, [storageKey]);
  const review = useQuery({ queryKey: key, enabled: enabled && authority.readReady, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({ signal }) => authority.read(async () => {
      const value = await agentPauseApi.review(company, principal, agentId, signal);
      if (!current() || value.companyId !== company || value.agentId !== agentId) throw new Error("Pause source changed");
      return value;
    }) });
  useEffect(() => { setOpen(false); setPolicy(null); }, [authority.epoch, enabled, review.data?.sourceToken, review.isFetching, review.isError]);
  useEffect(() => { if (attempted.current) setUnknown(true); }, [authority.epoch]);
  function fresh() {
    const state = client.getQueryState(key), value = client.getQueryData<AgentPauseReview>(key);
    if (!current() || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated || !value?.canPause) throw new Error("Pause source changed");
    return value;
  }
  function accept(value: AgentPauseReceipt, refreshMonitor = true) {
    if (!current() || value.companyId !== company || value.agentId !== agentId || value.requestId !== attempted.current?.requestId) throw new Error("Pause receipt changed");
    // Preserve only Original identity across parent/session remounts. It must
    // be read back from the owner before displaying any retained receipt.
    attempted.current = null; setUnknown(false); setReceipt(value); setOpen(false); setFailed(false);
    if (refreshMonitor) {
      void client.invalidateQueries({ queryKey: ["agent-monitor", company, principal, agentId] });
      void client.invalidateQueries({ queryKey: ["agents"] }); void client.invalidateQueries({ queryKey: key }); onPaused?.();
    }
  }
  const original = useQuery({ queryKey: ["agent-pause-original-receipt", company, principal, agentId, attempted.current?.requestId, authority.epoch],
    enabled: enabled && authority.readReady && unknown && !!attempted.current, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current() || !attempted.current) throw new Error("Pause source changed");
      return agentPauseApi.receipt(company, principal, agentId, attempted.current.requestId, signal);
    }) });
  useEffect(() => {
    if (!unknown || !attempted.current || !current() || !original.isSuccess || original.isFetching || !original.data) return;
    try { accept(original.data, false); } catch { setFailed(true); }
  }, [unknown, original.data, original.isSuccess, original.isFetching, enabled, authority.epoch]);
  const pause = useMutation({ mutationFn: () => {
    if (attempted.current || unknown || receipt) throw new Error("The original pause needs reconciliation");
    const source = fresh(); if (!policy || decision.current !== source.sourceToken) throw new Error("Pause decision changed");
    const command: AgentPauseCommand = { requestId: crypto.randomUUID(), expectedSourceToken: source.sourceToken, pendingWork: policy, confirmPause: true };
    sessionStorage.setItem(storageKey, JSON.stringify(command)); attempted.current = command;
    return authority.write(() => agentPauseApi.pause(company, principal, agentId, command));
  }, onSuccess: value => { if (authority.confirmed(value)) { try { accept(value); } catch { setUnknown(true); } } },
  onError: error => {
    if (!current()) return;
    if (error instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
      attempted.current = null; sessionStorage.removeItem(storageKey); setUnknown(false); void review.refetch();
    } else setUnknown(!!attempted.current);
    setOpen(false); setFailed(true);
  } });
  const check = useMutation({ mutationFn: () => authority.read(async () => {
    if (!current() || !attempted.current) throw new Error("Pause source changed");
    return agentPauseApi.receipt(company, principal, agentId, attempted.current.requestId);
  }), onSuccess: value => { if (current() && value) { try { accept(value, false); } catch { setFailed(true); } } }, onError: () => { if (current()) setFailed(true); } });
  if (!enabled || !authority.readReady || !current()) return null;
  const pending = pause.isPending || check.isPending || original.isFetching;
  return <section className="space-y-3" aria-label={t("agentPauseCustomer.title")}>
    {receipt ? <p role="status">{t("agentPauseCustomer.accepted")}</p> : null}
    {unknown ? <><p role="alert">{t("agentPauseCustomer.unknown")}</p><Button className="min-h-11" variant="outline" disabled={pending} onClick={() => check.mutate()}>{t("agentPauseCustomer.check")}</Button></> : null}
    {failed && !unknown ? <p role="alert">{t("agentPauseCustomer.changed")}</p> : null}
    {review.isError && !unknown && !receipt ? <p role="status">{t("agentPauseCustomer.unavailable")}</p> : null}
    {!unknown && review.isSuccess && !review.isFetching && review.data.canPause ? <Button className="min-h-11" variant="outline" disabled={pending} onClick={() => {
      try { decision.current = fresh().sourceToken; if (receipt) { sessionStorage.removeItem(storageKey); setReceipt(null); }
        setPolicy(null); setOpen(true); } catch { setFailed(true); }
    }}>{t("agentPauseCustomer.action")}</Button> : null}
    <AlertDialog open={open && !unknown && !receipt && review.isSuccess && !review.isFetching && current()} onOpenChange={value => { setOpen(value); if (!value) setPolicy(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("agentPauseCustomer.confirm", { name: review.data?.name })}</AlertDialogTitle>
        <AlertDialogDescription>{t("agentPauseCustomer.boundary")}</AlertDialogDescription></AlertDialogHeader>
        {(["drain", "cancel"] as const).map(value => <label className="flex min-h-11 items-start gap-3" key={value}>
          <input type="radio" name={`pause-work-${agentId}`} value={value} checked={policy === value} onChange={() => setPolicy(value)} /><span>{t(`agentPauseCustomer.${value}`)}</span></label>)}
        <AlertDialogFooter><AlertDialogCancel>{t("feedback.cancel")}</AlertDialogCancel><Button className="min-h-11" disabled={!policy || pending} onClick={() => pause.mutate()}>{t("agentPauseCustomer.action")}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
