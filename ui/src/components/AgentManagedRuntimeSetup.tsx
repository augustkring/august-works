import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AgentAuthoringDraftView, type AgentManagedRuntimeSetupCommand } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";

/** Guided request over the Original managed runtime owner. Unknown effects
 * retain one request identity and offer only Original receipt recovery. */
export function AgentManagedRuntimeSetup({ company, principal, draft, enabled, selectionEnabled = true, canUseAuthority }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean;
  selectionEnabled?: boolean;
}) {
  const { t } = useTranslation("experience"), authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), titleId = useId();
  const alive = useRef(true), latest = useRef({ company, principal, draft, enabled, selectionEnabled, canUseAuthority });
  latest.current = { company, principal, draft, enabled, selectionEnabled, canUseAuthority };
  const attempt = useRef<AgentManagedRuntimeSetupCommand | null>(null), busy = useRef(false);
  const [profile, setProfile] = useState(""), [image, setImage] = useState(""), [capacityConsent, setCapacityConsent] = useState(false), [inactiveConsent, setInactiveConsent] = useState(false);
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof agentAuthoringApi.managedRuntimeReceipt>>>(null), [uncertain, setUncertain] = useState(false);
  const alert = useRef<HTMLParagraphElement>(null), outcome = useRef<HTMLParagraphElement>(null);
  const agentId = draft.agentId ?? draft.preparation?.agentId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = (write = false) => alive.current && (write ? authority.canWrite() && latest.current.selectionEnabled : authority.canRead()) && latest.current.enabled &&
    latest.current.canUseAuthority() && latest.current.company === company && latest.current.principal === principal &&
    latest.current.draft.id === draft.id && latest.current.draft.version === draft.version && draft.createdByUserId === principal && !!agentId;
  const originalKey = ["agent-managed-runtime-original", company, principal, authority.epoch, draft.id];
  const original = useQuery({ queryKey: originalKey, enabled: enabled && authority.readReady && !!agentId, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Managed setup context changed");
      const value = await agentAuthoringApi.latestManagedRuntimeReceipt(company, principal, draft.id, signal);
      if (!current() || value && value.agentId !== agentId) throw new Error("Managed setup owner changed"); return value;
    }) });
  useEffect(() => { if (current() && original.data) setReceipt(original.data); }, [original.data, authority.epoch]);
  const catalogKey = ["agent-managed-runtime-catalog", company, principal, authority.epoch, draft.id, draft.version];
  const catalog = useQuery({ queryKey: catalogKey, enabled: enabled && selectionEnabled && authority.writeReady && !!agentId && original.isSuccess && !original.data && !receipt && !attempt.current,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true)) throw new Error("Managed setup context changed");
      const value = await agentAuthoringApi.managedRuntimeCatalog(company, principal, draft.id, signal);
      if (!current(true) || value.agentId !== agentId || value.version !== draft.version) throw new Error("Managed setup owner changed"); return value;
    }) });
  useEffect(() => {
    if (!current(true) || !catalog.data) return;
    if (!profile && catalog.data.capacity.length === 1) setProfile(catalog.data.capacity[0]!.key);
    if (!image && catalog.data.versions.length === 1) setImage(catalog.data.versions[0]!.imageDigest);
  }, [catalog.data, profile, image]);
  const reviewKey = ["agent-managed-runtime-review", company, principal, authority.epoch, draft.id, draft.version, profile, image];
  const review = useQuery({ queryKey: reviewKey, enabled: enabled && selectionEnabled && authority.writeReady && !!profile && !!image && !receipt && !attempt.current,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current(true)) throw new Error("Managed setup context changed");
      const value = await agentAuthoringApi.managedRuntimeReview(company, principal, draft.id, { capacityProfile: profile, imageDigest: image }, signal);
      if (!current(true) || value.agentId !== agentId || value.version !== draft.version) throw new Error("Managed setup owner changed"); return value;
    }) });
  useEffect(() => { setCapacityConsent(false); setInactiveConsent(false); }, [authority.epoch, enabled, selectionEnabled, review.data?.reviewHash, review.isFetching]);
  useEffect(() => { if (uncertain && current()) alert.current?.focus(); }, [uncertain]);
  function fresh(key: unknown[]) { const state = client.getQueryState(key); return state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated; }
  const operation = useMutation({ retry: false, gcTime: 0, mutationFn: async (lookup: boolean) => {
    if (!current(!lookup) || busy.current) return;
    busy.current = true; const epoch = authority.epoch;
    try {
      if (!attempt.current && !receipt) {
        if (lookup || !capacityConsent || !inactiveConsent || !fresh(originalKey) || !fresh(catalogKey) || !fresh(reviewKey) || !review.data?.canProvision) return;
        attempt.current = { capacityProfile: profile, imageDigest: image, requestId: crypto.randomUUID(), expectedVersion: draft.version,
          expectedReviewHash: review.data.reviewHash, confirmManagedCapacity: true, confirmInactiveProvisioning: true };
      }
      const requestId = attempt.current?.requestId ?? receipt?.requestId;
      if (!requestId) return;
      const value = lookup ? await agentAuthoringApi.managedRuntimeReceipt(company, principal, draft.id, requestId)
        : await agentAuthoringApi.confirmManagedRuntime(company, principal, draft.id, attempt.current!);
      if (!current() || authority.epoch !== epoch) return;
      if (!value) { setUncertain(true); return; }
      if (value.agentId !== agentId) throw new Error("Managed setup owner changed");
      setReceipt(value); setUncertain(false); queueMicrotask(() => { if (current()) outcome.current?.focus(); });
    } catch { if (current() && authority.epoch === epoch) setUncertain(true); }
    finally { busy.current = false; }
  } });
  if (!current()) return null;
  return <section className="space-y-3 rounded-md border p-4" aria-labelledby={titleId}>
    <h3 id={titleId} className="font-semibold">{t("managedAgentSetup.title")}</h3>
    <p>{t("managedAgentSetup.boundary")}</p>
    {!selectionEnabled && !receipt && !attempt.current && <p role="status">{t("managedAgentSetup.saveDraft")}</p>}
    {uncertain && <p ref={alert} tabIndex={-1} role="alert" className="outline-none">{t("managedAgentSetup.unknown")}</p>}
    {receipt ? <>
      <p ref={outcome} tabIndex={-1} role="status" className="outline-none">{t(`managedAgentSetup.status.${receipt.operationStatus}`)}</p>
      <p>{t("managedAgentSetup.next")}</p>
    </> : original.isPending || catalog.isFetching ? <p role="status">{t("managedAgentSetup.checking")}</p> : original.isError || catalog.isError ?
      <p role="status">{t("managedAgentSetup.unavailable")}</p> : !attempt.current && <>
        {catalog.data && (catalog.data.capacity.length !== 1 || catalog.data.versions.length !== 1) && <details className="space-y-3">
          <summary className="min-h-11 cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{t("managedAgentSetup.advanced")}</summary>
          <label className="block space-y-2">{t("managedAgentSetup.capacity")}<select className="min-h-11 w-full rounded-md border bg-background p-2" value={profile} disabled={!current(true)} onChange={event => setProfile(event.target.value)}>
            <option value="">{t("runtimeCandidates.choose")}</option>{catalog.data.capacity.map(value => <option key={value.key} value={value.key}>{value.key}</option>)}
          </select></label>
          <label className="block space-y-2">{t("managedAgentSetup.version")}<select className="min-h-11 w-full rounded-md border bg-background p-2" value={image} disabled={!current(true)} onChange={event => setImage(event.target.value)}>
            <option value="">{t("runtimeCandidates.choose")}</option>{catalog.data.versions.map(value => <option key={value.imageDigest} value={value.imageDigest}>{value.providerVersion}</option>)}
          </select></label>
        </details>}
        {review.data && !review.data.canProvision && <p role="status">{t("managedAgentSetup.blocked")}</p>}
        {review.data?.canProvision && !review.isFetching && <p role="status">{t("managedAgentSetup.capacityUse")}</p>}
        {review.isError && <p role="status">{t("managedAgentSetup.unavailable")}</p>}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={capacityConsent} disabled={operation.isPending || !current(true) || review.isFetching || !review.data?.canProvision} onChange={event => setCapacityConsent(event.target.checked)} />{t("managedAgentSetup.capacityConsent")}</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={inactiveConsent} disabled={operation.isPending || !current(true) || review.isFetching || !review.data?.canProvision} onChange={event => setInactiveConsent(event.target.checked)} />{t("managedAgentSetup.inactiveConsent")}</label>
        <Button className="min-h-11" disabled={!current(true) || operation.isPending || !capacityConsent || !inactiveConsent || review.isFetching || !review.data?.canProvision}
          onClick={() => operation.mutate(false)}>{t("managedAgentSetup.request")}</Button>
      </>}
    {(attempt.current || receipt) && <Button variant="outline" className="min-h-11" disabled={operation.isPending} onClick={() => operation.mutate(true)}>{t("managedAgentSetup.checkOriginal")}</Button>}
    <Link className="inline-flex min-h-11 items-center underline" to="/company/settings/runtime">{t("managedAgentSetup.openOriginal")}</Link>
  </section>;
}
