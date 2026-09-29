import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleStop, RefreshCw, Workflow as WorkflowIcon } from "lucide-react";
import type {
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowWait,
} from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useNavigate, useParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";

const TERMINAL_RUN_STATUSES = new Set<WorkflowRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

function runStatusLabel(status: WorkflowRunStatus) {
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

function stepStatusLabel(status: WorkflowStepRunStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting on system";
    case "retry_scheduled":
      return "Retrying";
    case "retried":
      return "Retried";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "cancelling":
      return "Cancelling";
    case "cancelled":
      return "Cancelled";
  }
}

function waitingLabel(
  wait: WorkflowWait | null,
  retryScheduled: boolean,
) {
  if (retryScheduled) return "Retrying";
  if (wait?.kind === "human_interaction") return "Waiting on you";
  if (wait) return "Waiting on system";
  return "Waiting";
}

function waitDescription(wait: WorkflowWait) {
  switch (wait.kind) {
    case "delay":
      return wait.wakeAt
        ? `Resumes automatically after ${formatDateTime(wait.wakeAt)}.`
        : "Waiting for the configured delay.";
    case "human_interaction":
      return "Waiting for a human response before execution can continue.";
    case "external_callback":
      return "Waiting for an authenticated external callback.";
    case "task_completion":
      return "Waiting for the linked task to reach its completion state.";
    case "external_agent_run":
      return "Waiting for the external OpenClaw agent run to finish.";
  }
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "medium",
      });
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 100) / 10;
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function executorLabel(step: WorkflowStepRun) {
  if (step.agentId) return "Agent";
  if (step.toolInvocationId) return "Connected tool";
  if (step.automationArtifactVersionId) return "Automation artifact";
  if (step.heartbeatRunId) return "Agent runtime";
  return "Workflow engine";
}

function issueIdFromStepOutput(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const issueId = Reflect.get(value, "issueId");
  return typeof issueId === "string" && issueId.length > 0 ? issueId : null;
}

function jsonPreview(value: unknown) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[Value could not be displayed]";
  }
}

export function WorkflowRun() {
  const { selectedCompanyId } = useCompany();
  const { workflowId, runId } = useParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const runQuery = useQuery({
    queryKey: queryKeys.workflows.run(selectedCompanyId!, runId ?? ""),
    queryFn: () => workflowsApi.getRun(selectedCompanyId!, runId!),
    enabled: !!selectedCompanyId && !!runId,
    refetchInterval: (query) => {
      const detail = query.state.data;
      return detail && !TERMINAL_RUN_STATUSES.has(detail.run.status) ? 1_500 : false;
    },
  });
  const workflowQuery = useQuery({
    queryKey: queryKeys.workflows.detail(selectedCompanyId!, workflowId ?? ""),
    queryFn: () => workflowsApi.get(selectedCompanyId!, workflowId!),
    enabled: !!selectedCompanyId && !!workflowId,
  });
  const revisionsQuery = useQuery({
    queryKey: queryKeys.workflows.revisions(selectedCompanyId!, workflowId ?? ""),
    queryFn: () => workflowsApi.revisions(selectedCompanyId!, workflowId!),
    enabled: !!selectedCompanyId && !!workflowId,
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      workflowsApi.cancelRun(selectedCompanyId!, runId!, {
        reason: "Cancelled by operator from workflow run view",
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(
        queryKeys.workflows.run(selectedCompanyId!, runId!),
        detail,
      );
      if (workflowId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.workflows.runs(selectedCompanyId!, workflowId),
        });
      }
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Workflows", href: "/workflows" },
      ...(workflowId
        ? [{ label: workflowQuery.data?.name ?? "Workflow", href: `/workflows/${workflowId}` }]
        : []),
      ...(workflowId ? [{ label: "Runs", href: `/workflows/${workflowId}/runs` }] : []),
      { label: runId ? `Run ${runId.slice(0, 8)}` : "Run" },
    ]);
  }, [runId, setBreadcrumbs, workflowId, workflowQuery.data?.name]);

  const revision = useMemo(() => {
    const revisionId = runQuery.data?.run.workflowRevisionId;
    if (!revisionId) return null;
    return revisionsQuery.data?.find((candidate) => candidate.id === revisionId) ?? null;
  }, [revisionsQuery.data, runQuery.data?.run.workflowRevisionId]);

  const nodeNames = useMemo(
    () => new Map((revision?.graph.nodes ?? []).map((node) => [node.id, node.name])),
    [revision?.graph.nodes],
  );

  if (!selectedCompanyId || !runId) {
    return <EmptyState icon={WorkflowIcon} message="Select a workflow run to inspect it." />;
  }
  if (runQuery.isLoading) return <PageSkeleton />;
  if (runQuery.error || !runQuery.data) {
    return (
      <div className="p-6">
        <div role="alert" className="border-l-2 border-destructive pl-4">
          <p className="font-medium">Workflow run could not be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No workflow state was changed by this read failure.
          </p>
          <Button className="mt-3" variant="outline" onClick={() => runQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { run, steps, waits } = runQuery.data;
  const routeMismatch = workflowId && run.workflowId !== workflowId;
  const completedSteps = steps.filter((step) => step.status === "succeeded").length;
  const activeStep =
    steps.find((step) =>
      ["running", "waiting", "retry_scheduled", "cancelling"].includes(step.status),
    ) ?? null;
  const activeWait = waits.find((wait) => wait.status === "active") ?? null;
  const runStatusText =
    run.status === "waiting"
      ? waitingLabel(activeWait, activeStep?.status === "retry_scheduled")
      : runStatusLabel(run.status);
  const live = !TERMINAL_RUN_STATUSES.has(run.status);

  if (routeMismatch) {
    return (
      <div className="p-6">
        <div role="alert" className="border-l-2 border-destructive pl-4">
          <p className="font-medium">Run does not belong to this workflow</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => navigate(`/workflows/${run.workflowId}/runs/${run.id}`)}
          >
            Open the correct workflow
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/workflows/${run.workflowId}/runs`)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Runs
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">
                  Run {run.id.slice(0, 8)}
                </h1>
                <Badge variant="outline">{runStatusText}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {workflowQuery.data?.name ?? "Workflow"} · {run.source.replaceAll("_", " ")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {live && run.status !== "cancelling" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cancelMutation.isPending}
                  >
                    <CircleStop className="mr-1.5 h-3.5 w-3.5" />
                    {cancelMutation.isPending ? "Cancelling…" : "Cancel run"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this workflow run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      New workflow steps will stop. Active waits are cancelled, and
                      bounded Agent/OpenClaw child work is asked to stop. Completed
                      side effects are preserved rather than rolled back.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep running</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => cancelMutation.mutate()}
                    >
                      Cancel run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : run.status === "cancelling" ? (
              <Button variant="outline" size="sm" disabled>
                <CircleStop className="mr-1.5 h-3.5 w-3.5" />
                Cancelling…
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => runQuery.refetch()}
              disabled={runQuery.isFetching}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {runQuery.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </header>

        <section aria-labelledby="run-summary" className="grid gap-4 border-b border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 id="run-summary" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Outcome
            </h2>
            <p className="mt-1 text-sm font-medium">{runStatusText}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Started</p>
            <p className="mt-1 text-sm">{formatDateTime(run.startedAt ?? run.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress</p>
            <p className="mt-1 text-sm">{completedSteps} / {steps.length} steps completed</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revision</p>
            <p className="mt-1 text-sm">
              {revision ? `Revision ${revision.revisionNumber}` : run.workflowRevisionId.slice(0, 8)}
            </p>
          </div>
        </section>

        <div aria-live="polite" className="sr-only">
          {live ? `Run status: ${runStatusText}` : `Final run status: ${runStatusText}`}
        </div>

        {cancelMutation.isError ? (
          <div role="alert" className="mt-5 border-l-2 border-destructive pl-4">
            <p className="font-medium">Run cancellation could not be requested</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The current run state is unchanged. Refresh the run before trying again.
            </p>
          </div>
        ) : null}

        {activeStep ? (
          <section className="border-b border-border py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current work
            </p>
            <p className="mt-1 text-sm font-medium">
              {nodeNames.get(activeStep.nodeId) ?? activeStep.nodeId}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeStep.status === "waiting"
                ? waitingLabel(activeWait, false)
                : stepStatusLabel(activeStep.status)} · attempt {activeStep.attempt}
            </p>
            {activeWait && activeWait.nodeId === activeStep.nodeId ? (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {waitDescription(activeWait)}
                </p>
                {activeWait.kind === "human_interaction" &&
                activeWait.referenceType === "approval" &&
                activeWait.referenceId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/approvals/${activeWait.referenceId}`)}
                  >
                    Open approval
                  </Button>
                ) : null}
                {activeWait.kind === "task_completion" &&
                activeWait.referenceType === "issue" &&
                activeWait.referenceId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/issues/${activeWait.referenceId}`)}
                  >
                    Open task
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {run.status === "failed" ? (
          <div role="alert" className="mt-5 border-l-2 border-destructive pl-4">
            <p className="font-medium">This run stopped before completion</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {run.failureMessage ?? "The executor reported a terminal failure."}
            </p>
            {run.failureCode ? (
              <p className="mt-1 text-xs text-muted-foreground">Code: {run.failureCode}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Review the failed attempt history and published workflow before starting a new run. Configured automatic retries are preserved as separate attempts in this log.
            </p>
          </div>
        ) : null}

        {run.status === "cancelled" ? (
          <div className="mt-5 border-l-2 border-border pl-4 text-sm text-muted-foreground">
            The run is cancelled. Completed step history remains visible for audit and recovery.
          </div>
        ) : null}

        <section className="py-6" aria-labelledby="execution-log-title">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 id="execution-log-title" className="text-base font-semibold">Execution log</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Linear, attempt-level history for this immutable workflow revision.
              </p>
            </div>
            {live ? <span className="text-xs text-muted-foreground">Live updates</span> : null}
          </div>

          {steps.length === 0 ? (
            <div className="mt-5 border-y border-border py-10 text-sm text-muted-foreground">
              No step attempts have been recorded yet.
            </div>
          ) : (
            <ol className="mt-5 divide-y divide-border border-y border-border">
              {steps.map((step) => {
                const input = jsonPreview(step.inputJson);
                const output = jsonPreview(step.outputJson);
                const linkedIssueId = issueIdFromStepOutput(step.outputJson);
                const stepWait =
                  waits.find(
                    (wait) =>
                      wait.nodeId === step.nodeId &&
                      wait.status === "active",
                  ) ?? null;
                return (
                  <li key={step.id} className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">
                            {nodeNames.get(step.nodeId) ?? step.nodeId}
                          </h3>
                          <Badge variant="outline">
                            {step.status === "waiting"
                              ? waitingLabel(stepWait, false)
                              : stepStatusLabel(step.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Attempt {step.attempt} · {executorLabel(step)}
                        </p>
                        {step.agentId ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {linkedIssueId ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/issues/${linkedIssueId}`)}
                              >
                                Open delegated task
                              </Button>
                            ) : null}
                            {step.heartbeatRunId ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  navigate(
                                    `/agents/${step.agentId}/runs/${step.heartbeatRunId}`,
                                  )
                                }
                              >
                                Open agent run
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground sm:text-right">
                        <p>{formatDateTime(step.startedAt)}</p>
                        <p className="mt-1">{formatDuration(step.durationMs)}</p>
                      </div>
                    </div>

                    {step.status === "waiting" ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {stepWait
                          ? waitDescription(stepWait)
                          : "Waiting for a durable workflow signal."}
                      </p>
                    ) : null}
                    {step.status === "retry_scheduled" || step.status === "retried" ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Retry state recorded as a separate attempt; prior attempt history is preserved.
                      </p>
                    ) : null}
                    {step.errorMessage || step.errorCode ? (
                      <div role="alert" className="mt-3 border-l-2 border-destructive pl-3">
                        <p className="text-xs font-medium">Step failed</p>
                        {step.errorMessage ? (
                          <p className="mt-1 text-xs text-muted-foreground">{step.errorMessage}</p>
                        ) : null}
                        {step.errorCode ? (
                          <p className="mt-1 text-xs text-muted-foreground">Code: {step.errorCode}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {input || output ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {input ? (
                          <details className="rounded-md border border-border p-3">
                            <summary className="cursor-pointer text-xs font-medium">Input</summary>
                            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                              {input}
                            </pre>
                          </details>
                        ) : null}
                        {output ? (
                          <details className="rounded-md border border-border p-3">
                            <summary className="cursor-pointer text-xs font-medium">Output</summary>
                            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                              {output}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
