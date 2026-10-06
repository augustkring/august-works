import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusinessMetricTargetSchema, type BusinessMetricView, type BusinessMetricVersionView, type BusinessMetricTargetDefinition } from "@paperclipai/shared";
import { businessMetricTargetsApi } from "@/api/business-metric-targets";
import { goalsApi } from "@/api/goals";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BusinessMetricTargetComparison } from "./BusinessMetricTargetComparison";
const selectStyle = "w-full rounded-md border border-input bg-background p-2";
export function BusinessMetricTargets({ companyId, userId, metric, metricVersion }: { companyId: string; userId: string | null; metric: BusinessMetricView; metricVersion: BusinessMetricVersionView }) {
  const cache = useQueryClient(); const [targetId, setTargetId] = useState(""); const [versionId, setVersionId] = useState("");
  const [editing, setEditing] = useState(false); const [reason, setReason] = useState("");
  const key = ["business-metric-targets", companyId, userId];
  const list = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => businessMetricTargetsApi.list(companyId, pageParam, userId), getNextPageParam: page => page.nextCursor ?? undefined });
  const detail = useQuery({ queryKey: [...key, "detail", targetId], queryFn: () => businessMetricTargetsApi.detail(companyId, targetId, userId), enabled: !!targetId });
  const target = detail.data?.target; const pin = detail.data?.versions.find(version => version.id === (versionId || target?.approvedVersionId || detail.data?.versions[0]?.id));
  const invalidate = () => { void cache.invalidateQueries({ queryKey: key }); };
  const save = useMutation({ mutationFn: async (input: { key: string; definition: BusinessMetricTargetDefinition }) => target ? businessMetricTargetsApi.revise(companyId, target.id, { expectedRevision: target.revision, definition: input.definition }, userId) : businessMetricTargetsApi.create(companyId, input, userId),
    onSuccess: response => { invalidate(); setEditing(false); if ("target" in response) { setTargetId(response.target.id); setVersionId(response.version.id); } else setVersionId(response.id); } });
  const approval = useMutation({ mutationFn: () => businessMetricTargetsApi.approve(companyId, target!.id, { expectedRevision: target!.revision, versionId: pin!.id, approvalRationale: reason }, userId), onSuccess: () => { invalidate(); compare.reset(); setReason(""); } });
  const retire = useMutation({ mutationFn: () => businessMetricTargetsApi.retire(companyId, target!.id, { expectedRevision: target!.revision, reason }, userId), onSuccess: () => { invalidate(); compare.reset(); setReason(""); } });
  const identity = `${target?.id}:${target?.revision}:${target?.approvedVersionId}`;
  const compare = useMutation({ mutationFn: async () => ({ identity, data: await businessMetricTargetsApi.compare(companyId, target!.id, userId) }) });
  const busy = save.isPending || approval.isPending || retire.isPending || compare.isPending;
  const errors = [list.error, detail.error, save.error, approval.error, retire.error, compare.error].filter(Boolean);
  const visibleTargets = list.data?.pages.flatMap(page => page.items).filter(row => row.metricId === metric.id) ?? [];
  return <section className="space-y-4" aria-label="Metric commitments">
    <h2 className="font-semibold">Metric commitments</h2>
    <p className="text-muted-foreground">A target records an approved commitment for a fixed period. Goals and Projects identify its owner and context; the metric definition determines what is measured.</p>
    {errors.map((error, index) => <p key={index} role="alert" className="text-destructive">{error instanceof Error ? error.message : "The target request failed"}</p>)}
    {list.isPending && <p role="status">Loading commitments…</p>}
    {list.isError && <Button variant="outline" onClick={() => void list.refetch()}>Retry commitments</Button>}
    <label className="block space-y-2">Company commitment<select aria-label="Company commitment" className={selectStyle} value={targetId} disabled={busy} onChange={event => { setTargetId(event.target.value); setVersionId(""); setEditing(false); setReason(""); compare.reset(); save.reset(); approval.reset(); retire.reset(); }}><option value="">Select a commitment</option>{visibleTargets.map(row => <option key={row.id} value={row.id}>{row.key} · {row.status}</option>)}</select></label>
    {list.hasNextPage && <Button variant="outline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>Load more commitments</Button>}
    <Button variant="outline" disabled={busy || metric.status !== "published" || metric.publishedVersionId !== metricVersion.id} onClick={() => { setTargetId(""); setVersionId(""); setEditing(true); compare.reset(); save.reset(); }}>Create a commitment for this metric</Button>
    {detail.isPending && targetId && <p role="status">Loading commitment history…</p>}
    {detail.isError && <Button variant="outline" onClick={() => void detail.refetch()}>Retry commitment</Button>}
    {target && pin && <div className="space-y-4">
      <h3 className="font-medium">{target.key} · {target.status.replaceAll("_", " ")}</h3>
      {detail.data?.reviewReason && <p role="status">{detail.data.reviewReason}. Create and approve a revised commitment before comparing.</p>}
      <label className="block space-y-2">Commitment version<select aria-label="Commitment version" className={selectStyle} value={pin.id} disabled={busy} onChange={event => { setVersionId(event.target.value); setEditing(false); compare.reset(); }} >{detail.data?.versions.map(version => <option key={version.id} value={version.id}>Version {version.revision}{version.id === target.approvedVersionId ? " · approved commitment" : " · draft/history"}</option>)}</select></label>
      <p>{pin.definition.rationale}</p><p>Period (UTC, start inclusive, end exclusive): <span className="font-mono break-all">{pin.definition.periodStart} – {pin.definition.periodEnd}</span></p>
      <p>Scope: {pin.definition.scope.type === "portfolio" ? "Portfolio · this company unit only" : pin.definition.scope.type}. Owner: {pin.definition.ownerUserId}.</p>
      <p>Criterion: {pin.definition.criterion.kind === "between" ? `${pin.definition.criterion.lower} to ${pin.definition.criterion.upper}` : `${pin.definition.criterion.kind.replaceAll("_", " ")} ${pin.definition.criterion.value}`}. The pinned metric defines the unit.</p>
      <ul className="list-disc space-y-2 pl-4" aria-label="Commitment assumptions">{pin.definition.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
      {pin.definition.metricId !== metric.id && <p role="status">This commitment belongs to another metric. Select that metric before revising it.</p>}
      {target.status !== "retired" && <>
        <Button variant="outline" disabled={busy || pin.definition.metricId !== metric.id || metric.status !== "published" || metric.publishedVersionId !== metricVersion.id} onClick={() => setEditing(true)}>Create a revised commitment</Button>
        <label className="block space-y-2">Human approval or retirement rationale<Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} /></label>
        <div className="flex flex-wrap items-center gap-2"><Button disabled={busy || reason.trim().length < 10 || pin.id === target.approvedVersionId || pin.definition.metricId !== metric.id || pin.definition.metricVersionId !== metric.publishedVersionId} onClick={() => approval.mutate()}>Approve this commitment version</Button><Button variant="destructive" disabled={busy || reason.trim().length < 10} onClick={() => retire.mutate()}>Retire commitment</Button></div>
        <Button disabled={busy || target.status !== "approved" || pin.id !== target.approvedVersionId} onClick={() => compare.mutate()}>{compare.isPending ? "Observing pinned population…" : "Observe and compare approved commitment"}</Button>
      </>}
      <details className="space-y-2"><summary className="cursor-pointer">Inspect pinned references</summary><p className="font-mono text-sm break-all">Metric version: {pin.definition.metricVersionId}</p><p className="font-mono text-sm break-all">Commitment hash: {pin.contentHash}</p></details>
    </div>}
    {editing && <TargetDefinitionForm key={pin?.id ?? "new"} companyId={companyId} userId={userId} metric={metric} metricVersion={metricVersion} initial={target ? pin?.definition : undefined} targetKey={target?.key} busy={busy} onSave={input => save.mutate(input)} onCancel={() => setEditing(false)} />}
    {compare.data?.identity === identity && target?.status === "approved" && <BusinessMetricTargetComparison comparison={compare.data.data.comparison} observation={compare.data.data.observation} />}
  </section>;
}
function TargetDefinitionForm({ companyId, userId, metric, metricVersion, initial, targetKey, busy, onSave, onCancel }: { companyId: string; userId: string | null; metric: BusinessMetricView; metricVersion: BusinessMetricVersionView; initial?: BusinessMetricTargetDefinition; targetKey?: string; busy: boolean; onSave: (input: { key: string; definition: BusinessMetricTargetDefinition }) => void; onCancel: () => void }) {
  const [key, setKey] = useState(targetKey ?? ""); const [scopeType, setScopeType] = useState<BusinessMetricTargetDefinition["scope"]["type"]>(initial?.scope.type ?? "company");
  const [scopeId, setScopeId] = useState(initial?.scope.type === "goal" ? initial.scope.goalId : initial?.scope.type === "project" ? initial.scope.projectId : "");
  const [from, setFrom] = useState(initial?.periodStart.slice(0, -1) ?? ""); const [until, setUntil] = useState(initial?.periodEnd.slice(0, -1) ?? "");
  const [kind, setKind] = useState<BusinessMetricTargetDefinition["criterion"]["kind"]>(initial?.criterion.kind ?? (metricVersion.definition.valueType === "boolean" ? "equals_boolean" : "at_least"));
  const [lower, setLower] = useState(initial?.criterion.kind === "between" ? String(initial.criterion.lower) : initial?.criterion.kind === "at_least" || initial?.criterion.kind === "at_most" ? String(initial.criterion.value) : "");
  const [upper, setUpper] = useState(initial?.criterion.kind === "between" ? String(initial.criterion.upper) : ""); const [boolean, setBoolean] = useState(initial?.criterion.kind === "equals_boolean" ? initial.criterion.value : false);
  const [rationale, setRationale] = useState(initial?.rationale ?? ""); const [assumptions, setAssumptions] = useState(initial?.assumptions.join("\n") ?? ""); const [owner, setOwner] = useState(initial?.ownerUserId ?? userId ?? "local-board");
  const goals = useQuery({ queryKey: ["target-scope-goals", companyId, userId], queryFn: () => goalsApi.list(companyId), enabled: scopeType === "goal" });
  const projects = useQuery({ queryKey: ["target-scope-projects", companyId, userId], queryFn: () => projectsApi.list(companyId), enabled: scopeType === "project" });
  const parsed = createBusinessMetricTargetSchema.safeParse({ key, definition: { metricId: metric.id, metricVersionId: metricVersion.id, scope: scopeType === "goal" ? { type: scopeType, goalId: scopeId } : scopeType === "project" ? { type: scopeType, projectId: scopeId } : scopeType === "portfolio" ? { type: scopeType, mode: "company_unit" } : { type: scopeType }, periodStart: `${from}Z`, periodEnd: `${until}Z`, criterion: kind === "between" ? { kind, lower: Number(lower), upper: Number(upper) } : kind === "equals_boolean" ? { kind, value: boolean } : { kind, value: Number(lower) }, rationale, assumptions: assumptions.split("\n").map(line => line.trim()).filter(Boolean), ownerUserId: owner } });
  const numericEntered = kind === "equals_boolean" || lower.trim() !== "" && (kind !== "between" || upper.trim() !== "");
  const errors = [goals.error, projects.error].filter(Boolean);
  return <form className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); if (parsed.success && numericEntered) onSave(parsed.data); }}>
    <h3 className="font-medium">{initial ? "Revised commitment draft" : "New commitment draft"}</h3>
    <p>Metric: {metricVersion.definition.name}. Unit: {metricVersion.definition.unit}. {metricVersion.definition.calculation.kind === "native_ratio" && "Use a fraction between 0 and 1, such as 0.8 for 80%."}</p>
    {errors.map((error, index) => <p key={index} role="alert">{error instanceof Error ? error.message : "The native scope could not be loaded"}</p>)}
    <label className="block space-y-2">Commitment key<Input value={key} onChange={event => setKey(event.target.value)} disabled={!!targetKey} required /></label>
    <label className="block space-y-2">Accountability scope<select aria-label="Accountability scope" className={selectStyle} value={scopeType} disabled={!!initial} onChange={event => { setScopeType(event.target.value as typeof scopeType); setScopeId(""); }}><option value="company">Company</option><option value="goal">Existing Goal</option><option value="project">Existing Project</option><option value="portfolio">Portfolio · this company unit</option></select></label>
    {(scopeType === "goal" || scopeType === "project") && <label className="block space-y-2">{scopeType === "goal" ? "Goal" : "Project"}<select aria-label={scopeType === "goal" ? "Goal" : "Project"} className={selectStyle} value={scopeId} disabled={!!initial} onChange={event => setScopeId(event.target.value)} required><option value="">Select a native scope</option>{scopeType === "goal" ? goals.data?.map(row => <option key={row.id} value={row.id}>{row.title}</option>) : projects.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2">Start (UTC, inclusive)<Input type="datetime-local" step="0.001" value={from} onChange={event => setFrom(event.target.value)} required /></label><label className="space-y-2">End (UTC, exclusive)<Input type="datetime-local" step="0.001" value={until} onChange={event => setUntil(event.target.value)} required /></label></div>
    <label className="block space-y-2">Criterion<select aria-label="Criterion" className={selectStyle} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>{metricVersion.definition.valueType === "boolean" ? <option value="equals_boolean">Equals boolean</option> : <><option value="at_least">At least</option><option value="at_most">At most</option><option value="between">Within inclusive interval</option></>}</select></label>
    {kind === "equals_boolean" ? <label className="flex items-center gap-2"><input type="checkbox" checked={boolean} onChange={event => setBoolean(event.target.checked)} />Committed boolean value: {String(boolean)}</label> : <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2">{kind === "between" ? "Lower bound" : "Committed value"}<Input type="number" step="any" value={lower} onChange={event => setLower(event.target.value)} required /></label>{kind === "between" && <label className="space-y-2">Upper bound<Input type="number" step="any" value={upper} onChange={event => setUpper(event.target.value)} required /></label>}</div>}
    <label className="block space-y-2">Human owner<Input value={owner} onChange={event => setOwner(event.target.value)} required /></label>
    <label className="block space-y-2">Rationale<Textarea value={rationale} onChange={event => setRationale(event.target.value)} minLength={10} maxLength={2000} required /></label>
    <label className="block space-y-2">Assumptions (one per line)<Textarea value={assumptions} onChange={event => setAssumptions(event.target.value)} required /></label>
    <p className="text-muted-foreground">Saving creates a draft. A human must approve the exact version before comparing it. An open period remains provisional and does not establish an outcome forecast.</p>
    <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !parsed.success || !numericEntered || metric.status !== "published" || metric.publishedVersionId !== metricVersion.id}>Save commitment draft</Button></div>
  </form>;
}
