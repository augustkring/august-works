import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v7FeatureEnabled, v8FeatureEnabled, type ProjectPlanningProfile } from "@paperclipai/shared";
import { adaptivePlanningApi, type ProjectPlanningPreview } from "@/api/adaptive-planning";
import { useAccountIdentity } from "@/api/companies-query";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ProjectPlanningForm } from "./ProjectPlanningForm";
import { ProjectPlanningResult } from "./ProjectPlanningResult";
import { ProjectPlanningOutcome } from "./ProjectPlanningOutcome";
import { ProjectPlanningBasis } from "./ProjectPlanningBasis";

const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
export function ProjectAdaptivePlanning({ companyId, projectId }: { companyId: string; projectId: string }) {
  const { userId, settled, failed } = useAccountIdentity();
  const verifying = useIsFetching({ queryKey: queryKeys.auth.session }) > 0;
  if (failed) return <p role="alert">Your account could not be verified for planning.</p>;
  if (!settled || verifying) return <p role="status">Verifying planning account…</p>;
  return <ProjectPlanningWorkspace key={`${companyId}:${projectId}:${userId}`} companyId={companyId} projectId={projectId} userId={userId} />;
}
export function ProjectPlanningWorkspace({ companyId, projectId, userId }: { companyId: string; projectId: string; userId: string | null }) {
  const cache = useQueryClient(), key = ["project-adaptive-planning", companyId, projectId, userId], controlKey = ["project-planning-controls", companyId, projectId, userId];
  const [authorityLost, setAuthorityLost] = useState(false), [editing, setEditing] = useState(false), [epoch, setEpoch] = useState(0), [id, setId] = useState(""), [reason, setReason] = useState(""), [rationale, setRationale] = useState(""), [ack, setAck] = useState(false), [now, setNow] = useState(Date.now());
  const [preview, setPreview] = useState<{ profile: ProjectPlanningProfile; response: ProjectPlanningPreview; sourceKey: string } | null>(null);
  const flags = useQuery({ queryKey: [...queryKeys.instance.experimentalSettings, "project-planning", userId], queryFn: () => instanceSettingsApi.getExperimental(), refetchInterval: editing || rationale || ack ? false : 30000, refetchOnWindowFocus: false, retry: false });
  const enabled = !authorityLost && !flags.isFetching && !flags.isError && !!flags.data && v8FeatureEnabled(flags.data, "planning_optimizer_v8") && v7FeatureEnabled(flags.data, "governance_evidence_v7");
  const source = useQuery({ queryKey: [...key, "source"], queryFn: () => adaptivePlanningApi.source(companyId, projectId, userId), enabled, refetchInterval: editing ? false : 30000, refetchOnWindowFocus: !editing, retry: false });
  const controls = useInfiniteQuery({ queryKey: controlKey, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => adaptivePlanningApi.controls(companyId, projectId, pageParam, userId), getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: rationale ? false : 30000, retry: false });
  const detail = useQuery({ queryKey: [...key, "detail", id], queryFn: () => adaptivePlanningApi.detail(companyId, projectId, id, userId), enabled: enabled && !!id, refetchInterval: rationale || ack ? false : 30000, refetchOnWindowFocus: !rationale && !ack, retry: false });
  const roadmap = enabled && !source.isFetching && !source.isError && source.data?.companyId === companyId && source.data.projectId === projectId ? source.data : undefined;
  const sourceKey = roadmap ? JSON.stringify([roadmap.projectUpdatedAt, roadmap.policy, roadmap.tasks.map((task) => [task.id, task.updatedAt]), roadmap.dependencies]) : "";
  const previousSourceKey = useRef("");
  useEffect(() => { if (sourceKey) { if (previousSourceKey.current && previousSourceKey.current !== sourceKey) { setPreview(null); setReason(""); setRationale(""); setAck(false); void cache.invalidateQueries({ queryKey: [...key, "detail"] }); } previousSourceKey.current = sourceKey; } }, [sourceKey, cache, companyId, projectId, userId]);
  const retained = enabled && roadmap && !detail.isFetching && !detail.isError && detail.data?.companyId === companyId && detail.data.projectId === projectId && detail.data.id === id && Date.parse(detail.data.context.expiresAt) > Math.max(now, Date.now()) ? detail.data : undefined;
  const rows = !controls.isFetching && !controls.isError ? controls.data?.pages.flatMap((page) => page.proposals) ?? [] : [], selected = rows.find((row) => row.id === id);
  const dirty = useCallback(() => { setPreview(null); setReason(""); }, []);
  const clear = useCallback(() => { setEditing(false); setEpoch((old) => old + 1); setPreview(null); setReason(""); setId(""); setRationale(""); setAck(false); cache.removeQueries({ queryKey: ["project-adaptive-planning", companyId, projectId, userId] }); cache.removeQueries({ queryKey: ["planning-definition-sources", companyId, userId] }); cache.removeQueries({ queryKey: ["decision-evidence", companyId, userId] }); }, [cache, companyId, projectId, userId]);
  const lost = useCallback(() => { setAuthorityLost(true); clear(); }, [clear]);
  const refresh = () => { clear(); setAuthorityLost(false); void cache.invalidateQueries({ queryKey: controlKey }); void flags.refetch(); };
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); window.addEventListener("memory-access-changed", lost); return () => { window.clearInterval(timer); window.removeEventListener("memory-access-changed", lost); }; }, [lost]);
  useEffect(() => { if (source.isError || detail.isError) lost(); }, [source.isError, detail.isError, lost]);
  useEffect(() => { if (!enabled) { setPreview(null); setReason(""); setEditing(false); setAck(false); } }, [enabled]);
  const inspect = useMutation({ mutationFn: (profile: ProjectPlanningProfile) => adaptivePlanningApi.preview(companyId, projectId, profile, userId), onSuccess: (response, profile) => { setPreview({ profile, response, sourceKey }); setReason(""); }, onError: lost });
  const propose = useMutation({ mutationFn: () => adaptivePlanningApi.propose(companyId, projectId, { profile: preview!.profile, expectedSnapshotHash: preview!.response.snapshotHash, reason }, userId), onSuccess: (proposal) => { setEditing(false); dirty(); setId(proposal.id); setRationale(""); setAck(false); void cache.invalidateQueries({ queryKey: controlKey }); void cache.invalidateQueries({ queryKey: [...key, "detail"] }); }, onError: lost });
  const review = useMutation({ mutationFn: (accept: boolean) => adaptivePlanningApi.review(companyId, projectId, id, accept, rationale, userId), onSuccess: () => { clear(); void cache.invalidateQueries({ queryKey: controlKey }); void cache.invalidateQueries({ queryKey: ["v5-roadmap", companyId, projectId] }); }, onError: lost });
  const busy = inspect.isPending || propose.isPending || review.isPending;
  const shownPreview = roadmap && preview?.sourceKey === sourceKey && Date.parse(preview.response.expiresAt) > Math.max(now, Date.now()) ? preview : null;
  const labels = Object.fromEntries(roadmap?.tasks.map((task) => [task.id, task.title]) ?? []);
  const reviewValid = rationale.trim().length >= 10 && rationale.trim().length <= 2000;
  const canAccept = !!retained && retained.status === "pending" && retained.currentQualification === "current" && Date.parse(retained.context.expiresAt) > Math.max(now, Date.now()) && ack && reviewValid;
  return <section aria-label="Adaptive project planning" className="min-w-0 space-y-5 rounded-lg border p-4">
    <header className="space-y-2"><h2 className="text-lg font-semibold">Adaptive project planning</h2><p>Inspect all active task constraints, then create a pending proposal for a separate human Roadmap review. This calculation does not dispatch work.</p></header>
    {authorityLost && <p role="alert">Current planning source authority or revision could not be established. Assumptions and inherited results have been withheld. Refresh authority before continuing.</p>}
    {!enabled && !authorityLost && <p role="status">Governed planning is unavailable or its availability is being checked.</p>}
    {enabled && source.isFetching && <p role="status">Rechecking the authorized Roadmap source…</p>}
    <div className="flex flex-wrap gap-2">{roadmap && !editing && <Button variant="outline" disabled={busy || roadmap.policy.fieldOwnership.plannedDates !== "internal"} onClick={() => { setEpoch((old) => old + 1); dirty(); setId(""); setRationale(""); setAck(false); setEditing(true); }}>Declare a project planning problem</Button>}<Button variant="ghost" disabled={busy} onClick={refresh}>Refresh planning authority</Button></div>
    {editing && roadmap && <ProjectPlanningForm key={`${sourceKey}:${epoch}`} roadmap={roadmap} userId={userId} busy={busy} onPreview={(profile) => inspect.mutate(profile)} onDirty={dirty} onCancel={() => { setEditing(false); dirty(); }} onAuthorityLost={lost} />}
    {shownPreview && <div className="space-y-4"><ProjectPlanningResult result={shownPreview.response.result} horizonStart={shownPreview.profile.horizon.start} taskLabels={labels} />{shownPreview.response.result.status === "feasible_best_known" && <><label className="block space-y-2">Reason for this pending Roadmap proposal<Textarea aria-label="Reason for this pending Roadmap proposal" minLength={20} maxLength={4000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><Button disabled={busy || reason.trim().length < 20 || reason.trim().length > 4000} onClick={() => propose.mutate()}>Create pending planning proposal</Button></>}</div>}
    <section aria-label="Native planning proposal controls" className="space-y-3"><h3 className="font-semibold">Native planning proposal controls</h3><p>Only references and status are listed here. A pending proposal can be rejected while planning is disabled; source disclosure and approval require current admission.</p>{controls.isError && <p role="alert">Current proposal control authority could not be established.</p>}{controls.isFetching && <p role="status">Rechecking proposal controls…</p>}<label className="block space-y-2">Planning proposal reference<select aria-label="Planning proposal reference" className={selectStyle} value={id} disabled={busy || controls.isFetching} onChange={(event) => { setId(event.target.value); setEditing(false); dirty(); setRationale(""); setAck(false); }}>{rows.map((row) => <option key={row.id} value={row.id}>{row.status} · {row.id}</option>)}<option value="">Choose exact native proposal</option></select></label>{controls.hasNextPage && <Button variant="outline" disabled={busy || controls.isFetching} onClick={() => void controls.fetchNextPage()}>Load more planning controls</Button>}
    {id && enabled && detail.isFetching && <p role="status">Rechecking retained planning source…</p>}
    {retained && <div className="space-y-4"><p>{retained.reason}</p><ProjectPlanningResult result={retained.context.result} horizonStart={retained.context.profile.horizon.start} taskLabels={labels} current={retained.currentQualification === "current"} /><ProjectPlanningBasis detail={retained} taskLabels={labels} />{retained.status === "accepted" && <ProjectPlanningOutcome key={`${retained.id}:${sourceKey}`} companyId={companyId} projectId={projectId} proposalId={retained.id} userId={userId} taskLabels={labels} now={now} onAuthorityLost={lost} />}</div>}
    {selected?.status === "pending" && <div className="space-y-3"><label className="block space-y-2">Separate human planning review rationale<Textarea aria-label="Separate human planning review rationale" minLength={10} maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label>{retained && <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />I reviewed these exact declarations, source and proposed UTC dates before committing this plan.</label>}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !reviewValid} onClick={() => review.mutate(false)}>Reject this planning proposal</Button>{retained && <Button disabled={busy || !canAccept} onClick={() => review.mutate(true)}>Approve committed planning dates</Button>}</div></div>}
    </section>
  </section>;
}
