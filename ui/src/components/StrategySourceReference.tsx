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
import { Link } from "@/lib/router";
export function StrategySourceReference({ companyId, userId, reference }: { companyId: string; userId: string | null; reference: StrategyExecutionReference }) {
  const name = useQuery({ queryKey: ["strategy-source-name", companyId, userId, reference], queryFn: async () => {
    switch (reference.type) {
      case "foundation_section": { const row = await foundationApi.get(companyId, reference.foundationDocumentId); return row.companyId === companyId ? row.canonicalRevision?.title ?? row.foundationKey : null; }
      case "goal": { const rows = await goalsApi.list(companyId); return rows.find(row => row.companyId === companyId && row.id === reference.id)?.title ?? null; }
      case "project": { const rows = await projectsApi.list(companyId); return rows.find(row => row.companyId === companyId && row.id === reference.id)?.name ?? null; }
      case "issue": { const row = await issuesApi.get(reference.id); return row.companyId === companyId ? row.title : null; }
      case "decision": { const row = await decisionsApi.get(reference.id); return row.companyId === companyId ? row.title : null; }
      case "metric": { const row = await businessMetricsApi.detail(companyId, reference.id, userId); return row.versions.find(version => version.id === reference.versionId)?.definition.name ?? null; }
      case "metric_target": { const row = await businessMetricTargetsApi.detail(companyId, reference.id, userId); return row.target.key; }
      case "metric_observation": { const row = await businessMetricsApi.detail(companyId, reference.metricId, userId); return row.versions.find(version => version.id === reference.metricVersionId)?.definition.name ?? null; }
      case "milestone": { const row = await v5Api.roadmap(companyId, reference.projectId); return row.milestones.find(milestone => milestone.id === reference.id)?.name ?? null; }
    }
  } });
  const href = reference.type === "foundation_section" ? `/foundation/${reference.foundationDocumentId}` : reference.type === "goal" ? `/goals/${reference.id}` : reference.type === "project" ? `/projects/${reference.id}` : reference.type === "milestone" ? `/projects/${reference.projectId}` : reference.type === "issue" ? `/issues/${reference.id}` : reference.type === "decision" ? `/decisions/${reference.id}` : "/business-metrics";
  return <div className="min-w-0 space-y-1"><p className="text-sm text-muted-foreground">{reference.type.replaceAll("_", " ")}</p><Link to={href} className="break-words underline">{name.isError ? "Source unavailable" : name.data ?? (name.isFetching ? "Loading source…" : "Open native source")}</Link>{reference.type === "foundation_section" && <p className="break-words text-sm">{reference.headingPath.join(" / ") || "Document introduction"}</p>}</div>;
}
