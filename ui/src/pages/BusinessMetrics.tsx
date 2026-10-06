import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessMetricDefinitionSchema, createBusinessMetricSchema, ISSUE_STATUSES, PROJECT_STATUSES, type BusinessMetricDefinition } from "@paperclipai/shared";
import { businessMetricsApi } from "@/api/business-metrics";
import { aiGovernanceApi } from "@/api/ai-governance";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { BusinessMetricTargets } from "@/components/BusinessMetricTargets";
import { BusinessMetricObservation } from "@/components/BusinessMetricObservation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/lib/router";

const selectStyle = "w-full rounded-md border border-input bg-background p-2";
export function BusinessMetrics() {
  const { selectedCompanyId } = useCompany(); const { userId, settled, failed } = useAccountIdentity();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "Business metrics" }]); }, [setBreadcrumbs]);
  if (failed) return <p role="alert">Your account could not be verified. Reload this page to try again.</p>;
  if (!settled) return <p role="status">Verifying account…</p>;
  if (!selectedCompanyId) return <p>Select a company to inspect its metrics.</p>;
  return <MetricWorkspace key={`${selectedCompanyId}:${userId ?? "local"}`} companyId={selectedCompanyId} userId={userId} />;
}
function MetricWorkspace({ companyId, userId }: { companyId: string; userId: string | null }) {
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState(""); const [versionId, setVersionId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [until, setUntil] = useState(() => new Date().toISOString().slice(0, 10));
  const [breakdown, setBreakdown] = useState<"none" | "status" | "project">("none");
  const [reason, setReason] = useState("");
  const listKey = ["business-metrics", userId, companyId];
  const list = useInfiniteQuery({ queryKey: listKey, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => businessMetricsApi.list(companyId, pageParam, userId), getNextPageParam: page => page.nextCursor ?? undefined });
  const detail = useQuery({ queryKey: [...listKey, "detail", selectedId], queryFn: () => businessMetricsApi.detail(companyId, selectedId, userId), enabled: !!selectedId });
  const metric = detail.data?.metric;
  const version = detail.data?.versions.find(v => v.id === (versionId || metric?.publishedVersionId || detail.data?.versions[0]?.id));
  const invalidate = () => { void cache.invalidateQueries({ queryKey: listKey }); };
  const save = useMutation({ mutationFn: async (input: { key: string; definition: BusinessMetricDefinition }) => metric
    ? businessMetricsApi.createVersion(companyId, metric.id, { expectedRevision: metric.revision, definition: input.definition }, userId)
    : businessMetricsApi.create(companyId, input, userId),
    onSuccess: response => { invalidate(); setShowForm(false); if ("metric" in response) { setSelectedId(response.metric.id); setVersionId(response.version.id); } else setVersionId(response.id); } });
  const publish = useMutation({ mutationFn: () => businessMetricsApi.publish(companyId, metric!.id, { expectedRevision: metric!.revision, versionId: version!.id }, userId), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: (status: "deprecated" | "revoked") => businessMetricsApi.transition(companyId, metric!.id, { expectedRevision: metric!.revision, status, reason }, userId), onSuccess: () => { invalidate(); observation.reset(); setReason(""); } });
  const queryIdentity = `${selectedId}:${version?.id}:${from}:${until}:${breakdown}`;
  const observation = useMutation({ mutationFn: async () => ({ identity: queryIdentity, definition: version!.definition,
    result: await businessMetricsApi.query(companyId, { metricId: metric!.id, versionId: version!.id, from: `${from}T00:00:00Z`, until: `${until}T00:00:00Z`, dimensions: breakdown === "none" ? [] : [breakdown], maxRows: 5000 }, userId) }) });
  const result = observation.data?.identity === queryIdentity && metric?.status === "published" ? observation.data : null;
  const busy = save.isPending || publish.isPending || stop.isPending || observation.isPending;
  const errors = [list.error, detail.error, save.error, publish.error, stop.error, observation.error].filter(Boolean);
  return <div className="space-y-6">
    <header className="space-y-2"><h1 className="text-xl font-semibold">Business metrics</h1><p className="text-muted-foreground">Inspect a defined business population with its source authority and observation time. An undefined value needs evidence before it can support a decision.</p></header>
    {errors.map((error, index) => <p key={index} role="alert">{error?.message} Refresh the definition or retry the operation.</p>)}
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => { setSelectedId(""); setVersionId(""); setShowForm(true); observation.reset(); }} disabled={busy}>Define a metric</Button><Button variant="ghost" onClick={invalidate} disabled={busy}>Refresh definitions</Button></div>
    {list.isPending ? <p role="status">Loading definitions…</p> : <label className="block space-y-2">Metric<select className={selectStyle} value={selectedId} onChange={event => { setSelectedId(event.target.value); setVersionId(""); setShowForm(false); observation.reset(); publish.reset(); stop.reset(); save.reset(); }} disabled={busy}><option value="">Select a metric</option>{list.data?.pages.flatMap(page => page.items).map(row => <option key={row.id} value={row.id}>{row.key} · {row.status}</option>)}</select></label>}
    {list.hasNextPage && <Button variant="outline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>Load more definitions</Button>}
    {detail.isFetching && selectedId && <p role="status">Loading definition…</p>}
    {metric && version && <section className="space-y-4" aria-label="Metric definition">
      <h2 className="font-semibold">{version.definition.name} · {metric.status}</h2>
      <p>{version.definition.businessQuestion}</p><p className="text-muted-foreground">{version.definition.description}</p>
      <label className="block space-y-2">Definition version<select className={selectStyle} value={version.id} onChange={event => { setVersionId(event.target.value); setShowForm(false); observation.reset(); publish.reset(); }} disabled={busy}>{detail.data?.versions.map(row => <option key={row.id} value={row.id}>Version {row.revision}{row.id === metric.publishedVersionId ? " · currently published" : ""}</option>)}</select></label>
      <p>{version.definition.populationDescription}</p><p className="text-muted-foreground">Owner: {version.definition.ownerUserId}. Review every {version.definition.reviewFrequencyDays} days. Retain observations for at most {version.definition.retentionDays} days.</p>
      <p>Goodhart risk: {version.definition.goodhartRisk}</p>
      {metric.status !== "revoked" && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => setShowForm(true)} disabled={busy || version.definition.calculation.kind === "external_metric"}>Create a revised definition</Button><Button onClick={() => publish.mutate()} disabled={busy || metric.publishedVersionId === version.id && metric.status === "published"}>{publish.isPending ? "Publishing…" : "Publish this definition"}</Button></div>}
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); observation.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2">From (UTC, inclusive)<Input type="date" value={from} onChange={event => setFrom(event.target.value)} required /></label><label className="space-y-2">Until (UTC, exclusive)<Input type="date" value={until} onChange={event => setUntil(event.target.value)} required /></label></div>
        <label className="block space-y-2">Breakdown<select className={selectStyle} value={breakdown} onChange={event => setBreakdown(event.target.value as typeof breakdown)}><option value="none">Whole population</option>{version.definition.dimensions.map(dimension => <option key={dimension} value={dimension}>{dimension === "status" ? "Current status" : "Project"}</option>)}</select></label>
        <Button type="submit" disabled={busy || metric.status !== "published" || !from || !until || from >= until}>{observation.isPending ? "Observing…" : "Observe selected population"}</Button>
      </form>
      {metric.status !== "revoked" && <details className="space-y-4"><summary className="cursor-pointer">Change metric lifecycle</summary><label className="block space-y-2">Reason<Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} /></label><div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || !reason.trim()} onClick={() => stop.mutate("deprecated")}>Deprecate metric</Button><Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => stop.mutate("revoked")}>Revoke metric</Button></div></details>}
    </section>}
    {showForm && <MetricDefinitionForm key={version?.id ?? "new"} companyId={companyId} userId={userId} initial={metric ? version?.definition : undefined} metricKey={metric?.key} busy={busy} onSave={input => save.mutate(input)} onCancel={() => setShowForm(false)} />}
    {metric && version && <BusinessMetricTargets key={`${metric.id}:${version.id}`} companyId={companyId} userId={userId} metric={metric} metricVersion={version} />}
    {result && <BusinessMetricObservation result={result.result} definition={result.definition} />}
    {!list.isPending && !list.data?.pages.some(page => page.items.length) && !showForm && <p>No metrics are registered. Record an approved analytical purpose in <Link to="/ai-governance">AI Governance</Link>, then define a business metric.</p>}
  </div>;
}
function MetricDefinitionForm({ companyId, userId, initial, metricKey, busy, onSave, onCancel }: {
  companyId: string; userId: string | null; initial?: BusinessMetricDefinition; metricKey?: string; busy: boolean;
  onSave: (input: { key: string; definition: BusinessMetricDefinition }) => void; onCancel: () => void;
}) {
  const [key, setKey] = useState(metricKey ?? ""); const [entity, setEntity] = useState<"issue" | "project">(initial?.grain === "project" ? "project" : "issue");
  const [kind, setKind] = useState<"native_count" | "native_ratio">(initial?.calculation.kind === "native_ratio" ? "native_ratio" : "native_count");
  const initialPopulation = initial?.calculation.kind === "native_count" ? initial.calculation.population : initial?.calculation.kind === "native_ratio" ? initial.calculation.denominator : null;
  const [statuses, setStatuses] = useState<string[]>(initialPopulation?.statuses ?? ["todo", "done"]);
  const [numerator, setNumerator] = useState<string[]>(initial?.calculation.kind === "native_ratio" ? initial.calculation.numerator.statuses : ["done"]);
  const [fields, setFields] = useState({ name: initial?.name ?? "", description: initial?.description ?? "", businessQuestion: initial?.businessQuestion ?? "", decisionUse: initial?.decisionUse ?? "", populationDescription: initial?.populationDescription ?? "", goodhartRisk: initial?.goodhartRisk ?? "", inclusions: initial?.inclusions.join("\n") ?? "", exclusions: initial?.exclusions.join("\n") ?? "" });
  const [policyId, setPolicyId] = useState(initial?.governanceObligationRefs[0] ?? "");
  const [retention, setRetention] = useState(initial?.retentionDays ?? 30); const [freshness, setFreshness] = useState(initial?.freshnessSeconds ?? 3600);
  const [review, setReview] = useState(initial?.reviewFrequencyDays ?? 30);
  const [sensitivity, setSensitivity] = useState<"internal" | "confidential">(initial?.sensitivity ?? "internal");
  const policies = useQuery({ queryKey: ["governance-obligations", companyId, userId], queryFn: () => aiGovernanceApi.obligations(companyId, userId ?? undefined) });
  const selectedProjectId = initialPopulation?.entity === "issue" ? initialPopulation.projectId : null;
  const population = { entity, statuses, ...(entity === "issue" ? { projectId: selectedProjectId } : {}) };
  const definition = businessMetricDefinitionSchema.safeParse({ ...fields, inclusions: fields.inclusions.split("\n").map(s => s.trim()).filter(Boolean), exclusions: fields.exclusions.split("\n").map(s => s.trim()).filter(Boolean),
    authorityMode: "aw_native", valueType: kind === "native_count" ? "count" : "ratio", unit: kind === "native_count" ? "objects" : "ratio", currency: null,
    grain: entity, timeGrain: "window", timezone: "UTC", timeSemantics: "created_in_window_current_state", dimensions: entity === "issue" ? ["status", "project"] : ["status"],
    calculation: kind === "native_count" ? { kind, population } : { kind, numerator: { ...population, statuses: numerator }, denominator: population },
    ownerUserId: initial?.ownerUserId ?? userId ?? "local-board", reviewFrequencyDays: review, freshnessSeconds: freshness, missingPolicy: "explicit_unknown",
    purpose: "management_intelligence", sensitivity, governanceObligationRefs: [policyId, ...(initial?.governanceObligationRefs.slice(1) ?? [])], retentionDays: retention });
  const valid = definition.success && createBusinessMetricSchema.safeParse({ key, definition: definition.data }).success;
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];
  const allStatuses = entity === "issue" ? ISSUE_STATUSES : PROJECT_STATUSES;
  return <form className="space-y-4" aria-label="Define business metric" onSubmit={event => { event.preventDefault(); if (definition.success && valid) onSave({ key, definition: definition.data }); }}>
    <h2 className="font-semibold">{initial ? "Revise definition" : "Define a native metric"}</h2>
    <label className="block space-y-2">Metric key<Input value={key} onChange={event => setKey(event.target.value)} disabled={!!metricKey} required pattern="[a-z][a-z0-9_-]{1,79}" /></label>
    {Object.entries({ name: "Name", description: "Description", businessQuestion: "Business question", decisionUse: "Decision use", populationDescription: "Population description", inclusions: "Inclusions (one per line)", exclusions: "Exclusions (one per line)", goodhartRisk: "Risk of optimizing the metric at the expense of the goal" }).map(([field, label]) => <label key={field} className="block space-y-2">{label}<Textarea value={fields[field as keyof typeof fields]} onChange={event => setFields(current => ({ ...current, [field]: event.target.value }))} maxLength={2000} required={field !== "exclusions"} /></label>)}
    <label className="block space-y-2">Population unit<select className={selectStyle} value={entity} onChange={event => { const next = event.target.value as typeof entity; setEntity(next); setStatuses(next === "issue" ? ["todo", "done"] : ["planned", "completed"]); setNumerator(next === "issue" ? ["done"] : ["completed"]); }}><option value="issue">Tasks</option><option value="project">Projects</option></select></label>
    <label className="block space-y-2">Calculation<select className={selectStyle} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="native_count">Count objects</option><option value="native_ratio">Ratio of a subset</option></select></label>
    <fieldset className="space-y-2"><legend>{kind === "native_count" ? "Included current states" : "Denominator current states"}</legend><div className="flex flex-wrap gap-4">{allStatuses.map(status => <label key={status} className="flex items-center gap-2"><input type="checkbox" checked={statuses.includes(status)} onChange={() => { const next = toggle(statuses, status); setStatuses(next); setNumerator(current => current.filter(s => next.includes(s))); }} />{status.replaceAll("_", " ")}</label>)}</div></fieldset>
    {kind === "native_ratio" && <fieldset className="space-y-2"><legend>Numerator states within the denominator</legend><div className="flex flex-wrap gap-4">{statuses.map(status => <label key={status} className="flex items-center gap-2"><input type="checkbox" checked={numerator.includes(status)} onChange={() => setNumerator(current => toggle(current, status))} />{status.replaceAll("_", " ")}</label>)}</div></fieldset>}
    <p className="text-muted-foreground">The population includes company objects created in the selected UTC window, using current status when observed. {selectedProjectId ? "The existing selected project restriction is preserved." : "The task population spans all company projects and unassigned tasks."}</p>
    <label className="block space-y-2">Analytical purpose evidence<select className={selectStyle} value={policyId} onChange={event => setPolicyId(event.target.value)} required><option value="">Select recorded company purpose</option>{policies.data?.filter(row => row.obligation.framework === "company_policy" && row.obligation.analyticalPurpose).map(row => <option key={row.id} value={row.id}>{row.obligation.citation} · {row.obligation.analyticalPurpose?.status} · reviewed {row.lastReviewedAt.slice(0, 10)}</option>)}</select></label>
    {policies.isError && <p role="alert">Purpose evidence could not be loaded. <Button type="button" variant="ghost" onClick={() => void policies.refetch()}>Try again</Button></p>}
    <p className="text-muted-foreground">Current approval, purpose scope and retention are checked before publication and every observation. <Link to="/ai-governance">Review company governance</Link>.</p>
    <label className="block space-y-2">Sensitivity<select className={selectStyle} value={sensitivity} onChange={event => setSensitivity(event.target.value as typeof sensitivity)}><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label>
    <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2">Review frequency (days)<Input type="number" min={1} max={365} value={review} onChange={event => setReview(Number(event.target.value))} required /></label><label className="space-y-2">Freshness (seconds)<Input type="number" min={1} max={31536000} value={freshness} onChange={event => setFreshness(Number(event.target.value))} required /></label><label className="space-y-2">Retention (days)<Input type="number" min={1} max={3650} value={retention} onChange={event => setRetention(Number(event.target.value))} required /></label></div>
    <div className="flex items-center justify-between gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !valid}>{busy ? "Saving…" : initial ? "Save revised definition" : "Register metric draft"}</Button></div>
  </form>;
}
