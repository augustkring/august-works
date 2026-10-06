import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StrategyExecutionReference } from "@paperclipai/shared";
import { foundationApi } from "@/api/foundation";
import { goalsApi } from "@/api/goals";
import { projectsApi } from "@/api/projects";
import { issuesApi } from "@/api/issues";
import { decisionsApi } from "@/api/decisions";
import { businessMetricsApi } from "@/api/business-metrics";
import { businessMetricTargetsApi } from "@/api/business-metric-targets";
import { v5Api } from "@/api/v5";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
const selectStyle = "w-full min-w-0 rounded-md border border-input bg-background p-2";
const labels: Record<StrategyExecutionReference["type"], string> = { foundation_section: "Approved Foundation section", goal: "Goal", project: "Project", milestone: "Milestone", issue: "Task", decision: "Decision", metric: "Published metric", metric_target: "Approved metric commitment", metric_observation: "Current metric observation" };
function nativeId(ref: StrategyExecutionReference) { return ref.type === "foundation_section" ? ref.foundationDocumentId : ref.id; }
function label(ref: StrategyExecutionReference) { return ref.type === "foundation_section" ? ref.headingPath.join(" / ") || "Document introduction" : labels[ref.type]; }
export function StrategySourcePicker({ companyId, userId, name, value, onChange, fixed }: { companyId: string; userId: string | null; name: string; value: StrategyExecutionReference | null; onChange: (value: StrategyExecutionReference | null) => void; fixed?: StrategyExecutionReference }) {
  const [type, setType] = useState<StrategyExecutionReference["type"]>(value?.type ?? "goal");
  const [search, setSearch] = useState(value?.type === "foundation_section" ? value.headingPath.at(-1) ?? "" : "");
  const [projectId, setProjectId] = useState(value?.type === "milestone" ? value.projectId : "");
  const [metricId, setMetricId] = useState(value?.type === "metric_observation" ? value.metricId : "");
  const key = ["strategy-sources", companyId, userId];
  const foundation = useQuery({ queryKey: [...key, "foundation", search], queryFn: () => foundationApi.search(companyId, { q: search, scope: "approved", limit: 50 }), enabled: type === "foundation_section" && search.trim().length>0 });
  const goals = useQuery({ queryKey: [...key, "goals"], queryFn: () => goalsApi.list(companyId), enabled: type === "goal" });
  const projects = useQuery({ queryKey: [...key, "projects"], queryFn: () => projectsApi.list(companyId), enabled: type === "project" || type === "milestone" });
  const tasks = useQuery({ queryKey: [...key, "tasks", search], queryFn: () => issuesApi.list(companyId, { q: search || undefined, limit: 50 }), enabled: type === "issue" });
  const decisions = useQuery({ queryKey: [...key, "decisions"], queryFn: () => decisionsApi.list(companyId, { limit: 50 }), enabled: type === "decision" });
  const metrics = useQuery({ queryKey: [...key, "metrics"], queryFn: () => businessMetricsApi.list(companyId, undefined, userId), enabled: type === "metric" || type === "metric_observation" });
  const targets = useQuery({ queryKey: [...key, "targets"], queryFn: () => businessMetricTargetsApi.list(companyId, undefined, userId), enabled: type === "metric_target" });
  const milestones = useQuery({ queryKey: [...key, "milestones", projectId], queryFn: () => v5Api.roadmap(companyId, projectId), enabled: type === "milestone" && !!projectId });
  const observations = useQuery({ queryKey: [...key, "observations", metricId], queryFn: () => businessMetricsApi.observations(companyId, metricId, undefined, userId), enabled: type === "metric_observation" && !!metricId });
  const options: { ref: StrategyExecutionReference; title: string }[] = [];
  if (type === "foundation_section") for (const row of foundation.data ?? []) if (row.sectionId && row.authorityLevel === "canonical" && row.sensitivity !== "restricted") options.push({ ref: { type, foundationDocumentId: row.foundationDocumentId, approvedRevisionId: row.documentRevisionId, sectionId: row.sectionId, headingPath: row.headingPath, contentHash: row.contentHash }, title: `${row.title ?? row.foundationKey} / ${row.headingPath.join(" / ") || "Introduction"} · approved revision ${row.revisionNumber}` });
  if (type === "goal") for (const row of goals.data ?? []) options.push({ ref: { type, id: row.id }, title: row.title });
  if (type === "project") for (const row of projects.data ?? []) options.push({ ref: { type, id: row.id }, title: row.name });
  if (type === "issue") for (const row of tasks.data ?? []) options.push({ ref: { type, id: row.id }, title: `${row.identifier ?? "Task"} · ${row.title}` });
  if (type === "decision") for (const row of decisions.data ?? []) options.push({ ref: { type, id: row.id }, title: `${row.title} · ${row.status}` });
  if (type === "metric") for (const row of metrics.data?.items ?? []) if (row.status === "published" && row.publishedVersionId) options.push({ ref: { type, id: row.id, versionId: row.publishedVersionId }, title: `${row.key} · current published definition` });
  if (type === "metric_target") for (const row of targets.data?.items ?? []) if (row.status === "approved" && row.approvedVersionId) options.push({ ref: { type, id: row.id, versionId: row.approvedVersionId }, title: `${row.key} · human-approved commitment` });
  if (type === "milestone") for (const row of milestones.data?.milestones ?? []) options.push({ ref: { type, id: row.id, projectId }, title: row.name });
  if (type === "metric_observation") for (const row of observations.data?.items ?? []) if (Date.parse(row.expiresAt)>Date.now()) options.push({ ref: { type, id: row.id, metricId: row.metricId, metricVersionId: row.versionId }, title: `${row.from.slice(0,10)} to ${row.until.slice(0,10)} · observed ${new Date(row.asOf).toLocaleString()}` });
  const visible = options.filter(option => (!fixed || option.ref.type === fixed.type && nativeId(option.ref) === nativeId(fixed)) && (type === "foundation_section" || type === "issue" || !search || option.title.toLowerCase().includes(search.toLowerCase()))).slice(0,50);
  const queries = type === "foundation_section" ? search.trim() ? [foundation] : [] : type === "goal" ? [goals] : type === "project" ? [projects] : type === "issue" ? [tasks] : type === "decision" ? [decisions] : type === "metric" ? [metrics] : type === "metric_target" ? [targets] : type === "milestone" ? [projects, ...(projectId ? [milestones] : [])] : [metrics, ...(metricId ? [observations] : [])];
  const error = queries.find(query => query.isError)?.error;
  const current = value ? JSON.stringify(value) : "";
  return <fieldset className="min-w-0 space-y-3"><legend className="font-medium">{name}</legend>
    <label className="block space-y-2">Source kind<select aria-label={`${name} source kind`} className={selectStyle} value={type} disabled={!!fixed} onChange={event => { setType(event.target.value as typeof type); setSearch(""); setProjectId(""); setMetricId(""); onChange(null); }}>{Object.entries(labels).map(([id,title]) => <option key={id} value={id}>{title}</option>)}</select></label>
    {type !== "metric_observation" && type !== "milestone" && <label className="block space-y-2">Find source<Input aria-label={`${name} find source`} value={search} onChange={event => setSearch(event.target.value)} placeholder={type === "foundation_section" ? "Search an approved strategy heading or passage" : "Search by name"} /></label>}
    {type === "milestone" && <label className="block space-y-2">Project<select aria-label={`${name} milestone project`} className={selectStyle} value={projectId} onChange={event => { setProjectId(event.target.value); onChange(null); }}><option value="">Choose a project</option>{projects.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    {type === "metric_observation" && <><label className="block space-y-2">Metric<select aria-label={`${name} observation metric`} className={selectStyle} value={metricId} onChange={event => { setMetricId(event.target.value); onChange(null); }}><option value="">Choose a published metric</option>{metrics.data?.items.filter(row => row.status === "published").map(row => <option key={row.id} value={row.id}>{row.key}</option>)}</select></label><p className="text-sm text-muted-foreground">Current observations are rechecked against their native sources. Create evidence in <Link to="/business-metrics" className="underline">Business metrics</Link> if none is available.</p></>}
    <label className="block space-y-2">Native source<select aria-label={`${name} native source`} className={selectStyle} value={current} onChange={event => { const option = visible.find(item => JSON.stringify(item.ref) === event.target.value); if (option) onChange(option.ref); else onChange(null); }}><option value="">Choose a native source</option>{value && !visible.some(option => JSON.stringify(option.ref) === current) && <option value={current}>Previously pinned {label(value)} · review current source</option>}{visible.map(option => <option key={JSON.stringify(option.ref)} value={JSON.stringify(option.ref)}>{option.title}</option>)}</select></label>
    {queries.some(query => query.isFetching) && <p role="status">Loading native sources…</p>}
    {error && <p role="alert">{error.message} Refresh sources before saving.</p>}
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => queries.forEach(query => void query.refetch())}>Refresh sources</Button><span className="text-sm text-muted-foreground">Showing bounded choices; an empty list is not a completeness finding.</span></div>
  </fieldset>;
}
