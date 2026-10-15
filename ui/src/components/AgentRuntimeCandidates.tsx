import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentRuntimeCandidateConformanceCommandSchema, type AgentRuntimeCandidateConformanceCommand, type AgentAuthoringDraftView, type AgentRuntimeCandidateView } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { v5Api } from "@/api/v5";
import { useCompany } from "@/context/CompanyContext";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type TestCommand = AgentRuntimeCandidateConformanceCommand;
/** Advanced, explicit proposals. Unknown requests retain their immutable key
 * and body and are recovered by original reads, never automatic dispatch. */
export function AgentRuntimeCandidates({ company, principal, draft, enabled, selectionEnabled, canUseAuthority, selectedId, onSelect }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean;
  selectedId: string | null; onSelect: (candidateId: string) => void;
  selectionEnabled: boolean;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient();
  const { companies } = useCompany(), id = useId();
  const alive = useRef(true), latest = useRef({ company, principal, draft, enabled, canUseAuthority });
  latest.current = { company, principal, draft, enabled, canUseAuthority };
  const [expanded, setExpanded] = useState(false), [profileId, setProfileId] = useState(""), [peerCompany, setPeerCompany] = useState("");
  const [ceiling, setCeiling] = useState("100"), [consent, setConsent] = useState(false), [visibility, setVisibility] = useState(false);
  const [failure, setFailure] = useState(false), [uncertain, setUncertain] = useState(false), [created, setCreated] = useState<AgentRuntimeCandidateView | null>(null);
  const createAttempt = useRef<{ requestId: string; expectedVersion: number; modelProfileId: string } | null>(null);
  const testAttempt = useRef<TestCommand | null>(null), testTarget = useRef<string | null>(null), busy = useRef(false), [receipt, setReceipt] = useState<Awaited<ReturnType<typeof agentAuthoringApi.startRuntimeCandidateConformance>> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = (write = false) => alive.current && (write ? authority.canWrite() : authority.canRead()) &&
    (!write || selectionEnabled) &&
    latest.current.enabled && latest.current.canUseAuthority() && latest.current.company === company && latest.current.principal === principal &&
    latest.current.draft.id === draft.id && latest.current.draft.version === draft.version && draft.createdByUserId === principal;
  const catalogKey = ["agent-runtime-candidate-catalog", company, principal, authority.epoch, draft.id, draft.version];
  const catalog = useQuery({ queryKey: catalogKey, enabled: expanded && enabled && authority.writeReady,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true)) throw new Error("Runtime candidate context changed");
      const value = await agentAuthoringApi.runtimeCandidateCatalog(company, principal, draft.id, signal);
      if (!current(true) || value.version !== draft.version) throw new Error("Runtime candidate context changed");
      return value;
    }) });
  const candidateId = selectedId ?? created?.id ?? null, saved = candidateId !== null && draft.content?.runtimeCandidateId === candidateId;
  const peers = useQuery({ queryKey: ["agent-runtime-candidate-peer", company, principal, authority.epoch, peerCompany],
    enabled: expanded && current() && !!peerCompany, retry: false, gcTime: 0, staleTime: 0,
    queryFn: () => authority.read(async () => { if (!current()) throw new Error("Runtime peer context changed");
      const value = await v5Api.identities(peerCompany); if (!current()) throw new Error("Runtime peer context changed"); return value; }) });
  const peer = peers.data?.find(value => value.id === catalog.data?.identityId);
  const reviewKey = ["agent-runtime-candidate-review", company, principal, authority.epoch, draft.id, draft.version, candidateId, peerCompany, peer?.agentId, ceiling];
  const review = useQuery({ queryKey: reviewKey, enabled: expanded && saved && current(true) && !!peer && Number.isInteger(Number(ceiling)) && Number(ceiling) >= 1 && Number(ceiling) <= 10000,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true) || !candidateId || !peer) throw new Error("Runtime review changed");
      const value = await agentAuthoringApi.runtimeCandidateConformanceReview(company, principal, draft.id, candidateId,
        { maximumCostCents: Number(ceiling), isolationPeer: { companyId: peerCompany, agentId: peer.agentId } }, signal);
      if (!current(true) || value.version !== draft.version) throw new Error("Runtime review changed"); return value;
    }) });
  useEffect(() => { setConsent(false); setVisibility(false); }, [authority.epoch, enabled, review.data?.reviewHash, review.isFetching]);
  useEffect(() => { if (failure && current()) alert.current?.focus(); }, [failure]);
  function fresh(key: unknown[]) { const state = client.getQueryState(key); return state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated; }
  const operation = useMutation({ retry: false, gcTime: 0, mutationFn: async (kind: "create" | "check_creation" | "test" | "check_test") => {
    if (!current(kind === "create" || kind === "test") || busy.current) return;
    busy.current = true; setFailure(false);
    const epoch = authority.epoch;
    try {
      if (kind === "create" || kind === "check_creation") {
        if (!createAttempt.current) {
          if (kind !== "create" || !fresh(catalogKey) || !catalog.data?.choices.some(choice => choice.modelProfileId === profileId)) return;
          createAttempt.current = { requestId: crypto.randomUUID(), expectedVersion: draft.version, modelProfileId: profileId };
        }
        const attempt = createAttempt.current;
        const result = kind === "create" ? await agentAuthoringApi.createRuntimeCandidate(company, principal, draft.id, attempt)
          : await agentAuthoringApi.runtimeCandidateCreationReceipt(company, principal, draft.id, attempt.requestId);
        if (!current() || authority.epoch !== epoch) return;
        if (!result) { setUncertain(true); return; }
        if (result.modelProfileId !== attempt.modelProfileId) throw new Error("Runtime selector changed");
        setCreated(result); setUncertain(false);
        if (current(true)) onSelect(result.id);
      } else {
        if (kind === "test" && (!candidateId || !saved)) return;
        if (!testAttempt.current) {
          if (kind !== "test" || !consent || !visibility || !fresh(reviewKey) || !review.data?.canTest || !peer) return;
          testAttempt.current = agentRuntimeCandidateConformanceCommandSchema.parse({ requestId: crypto.randomUUID(),
            expectedVersion: draft.version, expectedReviewHash: review.data.reviewHash, acknowledgeProviderRuns: true,
            maximumCostCents: Number(ceiling), isolationPeer: { companyId: peerCompany, agentId: peer.agentId },
            confirmBoundedConformance: true, confirmCompanyVisibleProbes: true });
          testTarget.current = candidateId;
        }
        const attempt = testAttempt.current;
        const target = testTarget.current;
        if (!target) return;
        // After any unconfirmed dispatch, only the original receipt read is
        // offered. A missing receipt does not authorize a replacement test.
        const result = kind === "test" ? await agentAuthoringApi.startRuntimeCandidateConformance(company, principal, draft.id, target, attempt)
          : await agentAuthoringApi.runtimeCandidateConformanceReceipt(company, principal, draft.id, target, attempt.requestId);
        if (!current() || authority.epoch !== epoch) return;
        if (!result) { setUncertain(true); return; }
        setReceipt(result); setUncertain(result.status === "pending" || result.status === "unknown");
      }
    } catch { if (current() && authority.epoch === epoch) { setFailure(true); setUncertain(true); } }
    finally { busy.current = false; }
  } });
  if (!enabled || !current()) return null;
  return <details className="space-y-3 border-t pt-3" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="flex min-h-11 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("runtimeCandidates.advanced")}</summary>
    {expanded && <section className="space-y-3" aria-labelledby={id}>
      <h3 id={id} ref={heading} className="font-semibold">{t("runtimeCandidates.title")}</h3>
      <p>{t("runtimeCandidates.boundary")}</p>
      {failure && <p ref={alert} tabIndex={-1} role="alert" className="outline-none">{t("runtimeCandidates.unconfirmed")}</p>}
      {catalog.isFetching ? <p role="status">{t("runtimeCandidates.checking")}</p> : catalog.isError ? <div className="space-y-2">
        <p role="status">{t("runtimeCandidates.unavailable")}</p><Button variant="outline" className="min-h-11" onClick={() => { if (current(true)) void catalog.refetch(); }}>{t("tryAgain")}</Button>
      </div> : <>
        <label className="block space-y-2">{t("runtimeCandidates.profile")}<select className="min-h-11 w-full rounded-md border bg-background p-2"
          value={profileId} disabled={!!createAttempt.current || operation.isPending || !authority.writeReady} onChange={event => setProfileId(event.target.value)}>
          <option value="">{t("runtimeCandidates.choose")}</option>{catalog.data?.choices.map(choice => <option key={choice.modelProfileId} value={choice.modelProfileId}>{choice.model}</option>)}
        </select></label>
        {catalog.data?.choices.length === 0 && <p role="status">{t("runtimeCandidates.noChoices")}</p>}
        {!created && <Button variant="outline" className="min-h-11" disabled={!profileId || operation.isPending || !current(true)}
          onClick={() => operation.mutate("create")}>{t(createAttempt.current ? "runtimeCandidates.retryCreation" : "runtimeCandidates.saveProposal")}</Button>}
      </>}
      {createAttempt.current && !created && <Button variant="outline" className="min-h-11" disabled={operation.isPending}
        onClick={() => operation.mutate("check_creation")}>{t("runtimeCandidates.checkCreation")}</Button>}
      {created && !saved && <p role="status">{t("runtimeCandidates.saveSelection")}</p>}
      {(saved || testAttempt.current) && <>
        <label className="block space-y-2">{t("runtimeCandidates.peerCompany")}<select className="min-h-11 w-full rounded-md border bg-background p-2"
          value={peerCompany} disabled={!!testAttempt.current || operation.isPending} onChange={event => setPeerCompany(event.target.value)}>
          <option value="">{t("runtimeCandidates.choose")}</option>{companies.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
        </select></label>
        {!peer && peerCompany && !peers.isFetching && <p role="status">{t("runtimeCandidates.noPeer")}</p>}
        <label className="block space-y-2">{t("runtimeCandidates.ceiling")}<Input type="number" min={1} max={10000} step={1} value={ceiling}
          disabled={!!testAttempt.current || operation.isPending} onChange={event => setCeiling(event.target.value)} /></label>
        {review.data && review.data.maximumMinor !== null && !review.isFetching && <p role="status">{t("runtimeCandidates.quote", { amount: (review.data.maximumMinor / 100).toFixed(2) })}</p>}
        {review.data && !review.data.canTest && <p role="status">{t("runtimeCandidates.blocked")}</p>}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={consent} disabled={!!testAttempt.current || operation.isPending}
          onChange={event => setConsent(event.target.checked)} />{t("runtimeCandidates.consent")}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={visibility} disabled={!!testAttempt.current || operation.isPending}
          onChange={event => setVisibility(event.target.checked)} />{t("runtimeCandidates.visibility")}</label>
        {!testAttempt.current && <Button className="min-h-11" disabled={operation.isPending || !consent || !visibility || review.isFetching || !review.data?.canTest || !current(true)}
          onClick={() => operation.mutate("test")}>{t("runtimeCandidates.run")}</Button>}
        {testAttempt.current && <Button variant="outline" className="min-h-11" disabled={operation.isPending}
          onClick={() => operation.mutate("check_test")}>{t("runtimeCandidates.checkTest")}</Button>}
      </>}
      {uncertain && <p role="status">{t("runtimeCandidates.unknown")}</p>}
      {receipt && <p role="status">{t(`runtimeCandidates.outcome.${receipt.status}`)}</p>}
    </section>}
  </details>;
}
