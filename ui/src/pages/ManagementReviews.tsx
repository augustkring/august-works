import { useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery, useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v7FeatureEnabled, v8FeatureEnabled, type ManagementReviewDefinition } from "@paperclipai/shared";
import { managementReviewsApi } from "@/api/management-reviews";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { queryKeys } from "@/lib/queryKeys";
import { ManagementReviewDefinitionForm } from "@/components/ManagementReviewDefinitionForm";
import { ManagementReviewTaskForm } from "@/components/ManagementReviewTaskForm";
import { ManagementReviewResult } from "@/components/ManagementReviewResult";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
export function ManagementReviews() {
  const [search]=useSearchParams();
  const { selectedCompanyId } = useCompany(), { userId, settled, failed } = useAccountIdentity(), { setBreadcrumbs } = useBreadcrumbs(), verifying = useIsFetching({ queryKey: queryKeys.auth.session }) > 0;
  const flags = useQuery({ queryKey: [...queryKeys.instance.experimentalSettings, "management-reviews", userId], queryFn: () => instanceSettingsApi.getExperimental(), enabled: !!selectedCompanyId && settled && !failed && !verifying, retry: false, refetchOnWindowFocus: false });
  useEffect(() => setBreadcrumbs([{ label: "Management reviews" }]), [setBreadcrumbs]);
  if (failed) return <p role="alert">Your account could not be verified. Reload this page.</p>;
  if (!settled || verifying) return <p role="status">Verifying current account…</p>;
  if (!selectedCompanyId) return <p>Select a company to review management evidence.</p>;
  if (flags.isFetching) return <p role="status">Rechecking review availability…</p>;
  const enabled = !!flags.data && !flags.isError && v8FeatureEnabled(flags.data, "management_reviews_v8") && v7FeatureEnabled(flags.data, "governance_evidence_v7");
  const initialReviewId=search.get("reviewCompanyId")===selectedCompanyId&&/^[a-f0-9-]{36}$/i.test(search.get("reviewId")??"")?search.get("reviewId")!:"";
  return <ManagementReviewWorkspace initialReviewId={initialReviewId} key={`${selectedCompanyId}:${userId}:${enabled}`} companyId={selectedCompanyId} userId={userId} enabled={enabled} />;
}
export function ManagementReviewWorkspace({ companyId, userId, enabled = true, initialReviewId = "" }: { companyId: string; userId: string | null; enabled?: boolean; initialReviewId?: string }) {
  const cache = useQueryClient(), key = ["management-reviews", companyId, userId], controlsKey = ["management-review-controls", companyId, userId];
  const [id, setId] = useState(initialReviewId), [editing, setEditing] = useState(false), [lost, setLost] = useState(false), [rationale, setRationale] = useState(""), [ack, setAck] = useState(false), [supersedesId, setSupersedesId] = useState(""), [eventItem, setEventItem] = useState(""), [event, setEvent] = useState<"opened" | "ignored" | "acted_on" | "false_alarm" | "correction">("opened"), [eventRationale, setEventRationale] = useState(""), [now, setNow] = useState(Date.now());
  const controls = useInfiniteQuery({ queryKey: controlsKey, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => managementReviewsApi.controls(companyId, pageParam, userId), getNextPageParam: page => page.nextCursor ?? undefined, retry: false, refetchInterval: editing || rationale || eventRationale ? false : 30000 });
  const rows = !controls.isFetching && !controls.isError ? controls.data?.pages.flatMap(page => page.items) ?? [] : [], row = rows.find(row => row.id === id);
  const detail = useQuery({ queryKey: [...key, "detail", id], queryFn: () => managementReviewsApi.detail(companyId, id, userId), enabled: enabled && !lost && !!id && (row ? Date.parse(row.expiresAt) > now : id === initialReviewId), retry: false, refetchInterval: editing || rationale || eventRationale ? false : 30000 });
  const review = !lost && enabled && !controls.isFetching && !controls.isError && !detail.isFetching && !detail.isError && detail.data?.companyId === companyId && detail.data.id === id && Date.parse(detail.data.expiresAt) > Math.max(now, Date.now()) ? detail.data : undefined;
  useEffect(()=>{setId(initialReviewId);setRationale("");setAck(false);},[initialReviewId]);
  const clearAcknowledgement = () => { setRationale(""); setAck(false); setSupersedesId(""); setEventItem(""); setEventRationale(""); };
  const loseAuthority = useCallback(() => {
    setLost(true); setEditing(false); setId(""); setRationale(""); setAck(false); setSupersedesId(""); setEventItem(""); setEventRationale("");
    for (const prefix of ["management-reviews", "management-definition-sources", "strategy-sources", "decision-evidence"]) { void cache.cancelQueries({ queryKey: [prefix, companyId, userId] }); cache.removeQueries({ queryKey: [prefix, companyId, userId] }); }
  }, [cache, companyId, userId]);
  const refresh = () => { setLost(false); setEditing(false); clearAcknowledgement(); void cache.invalidateQueries({ queryKey: controlsKey }); void cache.invalidateQueries({ queryKey: key }); };
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); window.addEventListener("memory-access-changed", loseAuthority); return () => { window.clearInterval(timer); window.removeEventListener("memory-access-changed", loseAuthority); }; }, [loseAuthority]);
  useEffect(() => { if (controls.isError || detail.isError) loseAuthority(); }, [controls.isError, detail.isError, loseAuthority]);
  useEffect(() => { setRationale(""); setAck(false); setSupersedesId(""); setEventItem(""); setEventRationale(""); }, [id, detail.data?.packet.contentHash, detail.data?.currentQualification, detail.data?.status]);
  const create = useMutation({ mutationFn: (definition: ManagementReviewDefinition) => managementReviewsApi.create(companyId, definition, userId), onSuccess: response => { refresh(); setId(response.id); }, onError: loseAuthority });
  const publish = useMutation({ mutationFn: () => managementReviewsApi.publish(companyId, review!.id, { expectedContentHash: review!.packet.contentHash, rationale, evidenceAndUncertaintyAcknowledged: true, supersedesId: supersedesId || null }, userId), onSuccess: refresh, onError: loseAuthority });
  const record = useMutation({ mutationFn: () => managementReviewsApi.event(companyId, review!.id, { expectedContentHash: review!.packet.contentHash, itemKey: eventItem, event, rationale: eventRationale }, userId), onSuccess: refresh, onError: loseAuthority });
  const busy = create.isPending || publish.isPending || record.isPending, canEdit = enabled && !lost && !controls.isFetching && !controls.isError;
  return <section aria-label="Management review workspace" className="min-w-0 space-y-6"><header className="space-y-2"><h1 className="text-xl font-semibold">Management reviews</h1><p className="text-muted-foreground">A concise cited agenda from governed evidence, with separate human publication and retained historical facts.</p></header>
    {!enabled && <p role="status">Governed management reviews are disabled. Only bounded review identity, status and retention metadata are available.</p>}
    {lost && <p role="alert">Current source authority or revision could not be established. Sensitive reviews and human drafts have been withheld. Refresh before continuing.</p>}
    <div className="flex flex-wrap gap-2">{enabled && <Button variant="outline" disabled={!canEdit || busy} onClick={() => { setId(""); clearAcknowledgement(); setEditing(true); }}>Prepare a cited management review</Button>}<Button variant="ghost" disabled={busy} onClick={refresh}>Refresh review authority</Button></div>
    {controls.isFetching && <p role="status">Rechecking current review controls…</p>}{controls.isError && <p role="alert">Review metadata authority could not be established.</p>}
    <label className="block space-y-2">Review reference<select aria-label="Review reference" className={selectStyle} value={id} disabled={busy || editing || controls.isFetching} onChange={event => { setId(event.target.value); clearAcknowledgement(); }}><option value="">Choose an exact retained review</option>{id && !row && <option value={id}>Requested review · {id}</option>}{rows.map((row, index) => <option key={row.id} value={row.id}>Review {index + 1} · {row.status} · {row.id}</option>)}</select></label>
    {row && <p>Created {new Date(row.createdAt).toLocaleString()}; retention until {new Date(row.expiresAt).toLocaleString()}.</p>}{controls.hasNextPage && <Button variant="outline" disabled={busy || controls.isFetching} onClick={() => void controls.fetchNextPage()}>Load more review references</Button>}
    {editing && canEdit && <ManagementReviewDefinitionForm companyId={companyId} userId={userId} busy={busy} onSave={definition => create.mutate(definition)} onCancel={() => setEditing(false)} onAuthorityLost={loseAuthority} />}
    {enabled && id && detail.isFetching && <p role="status">Rechecking exact review and source authority…</p>}{row && Date.parse(row.expiresAt) <= now && <p role="status">Review retention expired. Source content is unavailable.</p>}
    {review && !editing && <><ManagementReviewResult review={review} /><ManagementReviewTaskForm review={review} userId={userId} onAuthorityLost={loseAuthority} />
      {review.status === "draft" && <section aria-label="Separate human review publication" className="space-y-3 rounded-md border p-4"><h2 className="font-semibold">Separate human publication</h2><p>Review the exact evidence, uncertainty and human agenda. Publication records this review and applies no Task, Goal, Project or Decision change.</p>
        <label className="block space-y-2">Publication rationale<Textarea aria-label="Publication rationale" value={rationale} minLength={10} maxLength={2000} onChange={event => setRationale(event.target.value)} /></label>
        <label className="block space-y-2">Explicit previous review to supersede<select className={selectStyle} aria-label="Explicit previous review to supersede" value={supersedesId} onChange={event => { setSupersedesId(event.target.value); setAck(false); }}><option value="">Publish without superseding a previous review</option>{rows.filter(row => row.status === "published" && row.id !== review.id && Date.parse(row.expiresAt) > now).map(row => <option key={row.id} value={row.id}>{row.id} · published</option>)}</select></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />I reviewed this exact cited content, uncertainty, human agenda and any explicitly selected supersession.</label><Button disabled={busy || !ack || rationale.trim().length < 10 || rationale.trim().length > 2000 || review.currentQualification !== "current"} onClick={() => publish.mutate()}>Publish this reviewed packet</Button>
      </section>}
      {review.status !== "draft" && <section aria-label="Record a human review event" className="space-y-3 rounded-md border p-4"><h2 className="font-semibold">Report a review event</h2><p>Record a human report against the original agenda. “Acted on” does not verify an action or its outcome.</p>
        <label className="block space-y-2">Original agenda item<select aria-label="Original agenda item" className={selectStyle} value={eventItem} onChange={event => setEventItem(event.target.value)}><option value="">Choose a cited agenda item</option>{review.packet.agenda.map(item => <option key={item.key} value={item.key}>{item.key} · {item.category.replaceAll("_", " ")}</option>)}</select></label>
        <label className="block space-y-2">Reported event<select aria-label="Reported event" className={selectStyle} value={event} onChange={change => setEvent(change.target.value as typeof event)}>{["opened", "ignored", "acted_on", "false_alarm", "correction"].map(event => <option key={event} value={event}>{event.replaceAll("_", " ")}</option>)}</select></label><label className="block space-y-2">Human event rationale<Textarea aria-label="Human event rationale" value={eventRationale} minLength={10} maxLength={2000} onChange={event => setEventRationale(event.target.value)} /></label><Button disabled={busy || !eventItem || eventRationale.trim().length < 10 || eventRationale.trim().length > 2000 || review.events.length >= 100} onClick={() => record.mutate()}>Record human event report</Button>
      </section>}
    </>}
    {!controls.isFetching && !controls.isError && !rows.length && <p>No review references were returned on this bounded page. Prepare a review using a current approved analytical review purpose.</p>}
  </section>;
}
