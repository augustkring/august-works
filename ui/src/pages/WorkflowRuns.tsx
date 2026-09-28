import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History, RefreshCw } from "lucide-react";
import type { WorkflowRun, WorkflowRunStatus } from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useNavigate, useParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";

const ACTIVE_RUN_STATUSES = new Set<WorkflowRunStatus>([
  "queued",
  "running",
  "waiting",
  "recovering",
  "cancelling",
]);

function statusLabel(status: WorkflowRunStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting on system";
    case "recovering":
      return "Recovering";
    case "cancelling":
      return "Cancelling";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function formatDuration(run: WorkflowRun) {
  if (!run.startedAt) return "Not started";
  const started = new Date(run.startedAt).getTime();
  const ended = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return "—";
  const milliseconds = ended - started;
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 100) / 10;
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function WorkflowRuns() {
  const { selectedCompanyId } = useCompany();
  const { workflowId } = useParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  const workflowQuery = useQuery({
    queryKey: queryKeys.workflows.detail(selectedCompanyId!, workflowId ?? ""),
    queryFn: () => workflowsApi.get(selectedCompanyId!, workflowId!),
    enabled: !!selectedCompanyId && !!workflowId,
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.workflows.runs(selectedCompanyId!, workflowId ?? ""),
    queryFn: () => workflowsApi.listRuns(selectedCompanyId!, workflowId!, 50),
    enabled: !!selectedCompanyId && !!workflowId,
    refetchInterval: (query) => {
      const runs = query.state.data;
      return Array.isArray(runs) && runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))
        ? 1_500
        : false;
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Workflows", href: "/workflows" },
      ...(workflowId
        ? [{ label: workflowQuery.data?.name ?? "Workflow", href: `/workflows/${workflowId}` }]
        : []),
      { label: "Runs" },
    ]);
  }, [setBreadcrumbs, workflowId, workflowQuery.data?.name]);

  if (!selectedCompanyId || !workflowId) {
    return <EmptyState icon={History} message="Select a workflow to inspect its runs." />;
  }
  if (workflowQuery.isLoading || runsQuery.isLoading) return <PageSkeleton />;

  const workflowName = workflowQuery.data?.name ?? "Workflow";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/workflows/${workflowId}`)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Workflow
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">Runs</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">{workflowName}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runsQuery.refetch()}
            disabled={runsQuery.isFetching}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {runsQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </header>

        {workflowQuery.error || runsQuery.error ? (
          <div role="alert" className="mt-6 border-l-2 border-destructive pl-4">
            <p className="font-medium">Run history could not be loaded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The workflow is unchanged. Retry to load its execution history.
            </p>
            <Button className="mt-3" variant="outline" onClick={() => runsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (runsQuery.data?.length ?? 0) === 0 ? (
          <div className="mt-6 border-y border-border py-14">
            <EmptyState
              icon={History}
              message="No runs yet. Run the published workflow from the builder when it is ready."
            />
          </div>
        ) : (
          <div className="mt-6 divide-y divide-border border-y border-border">
            {(runsQuery.data ?? []).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => navigate(`/workflows/${workflowId}/runs/${run.id}`)}
                className="grid w-full gap-3 px-2 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{statusLabel(run.status)}</span>
                    <Badge variant="outline">{run.source.replaceAll("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Run {run.id.slice(0, 8)} · revision {run.workflowRevisionId.slice(0, 8)}
                  </p>
                  {run.failureMessage ? (
                    <p className="mt-2 line-clamp-2 text-xs text-destructive">
                      {run.failureMessage}
                    </p>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground sm:text-right">
                  <p>{formatDateTime(run.startedAt ?? run.createdAt)}</p>
                  <p className="mt-1">{formatDuration(run)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
