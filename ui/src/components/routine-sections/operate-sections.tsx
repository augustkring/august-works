import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, GitBranch } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { routineDetailHref } from "../RoutineContextualSidebar";
import { Link } from "@/lib/router";
import { StatusBadge } from "../StatusBadge";
import { createIssueDetailLocationState } from "@/lib/issueDetailBreadcrumb";
import { useToastActions } from "@/context/ToastContext";
import { IssuesList } from "../IssuesList";
import { EmptyState } from "../EmptyState";
import { RoutineHistoryTab } from "../RoutineHistoryTab";
import { RoutineActivityRow } from "../RoutineActivityRow";
import { useRoutineDetail } from "./context";

export function RunsSection() {
  const {
    routine,
    companyId,
    agents,
    projects,
    hasLiveRun,
    activeIssueId,
    routineRuns,
  } = useRoutineDetail();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const filters = { originKind: "routine_execution", originId: routine.id };
  const issueQueryKey = [...queryKeys.issues.list(companyId), "routine", routine.id];
  const { data: issues, isLoading, error } = useQuery({
    queryKey: issueQueryKey,
    queryFn: () => issuesApi.list(companyId, filters),
  });
  if (routine.executionTargetKind === "workflow") {
    const runs = [...(routineRuns ?? [])].sort(
      (left, right) =>
        new Date(right.triggeredAt).getTime() -
        new Date(left.triggeredAt).getTime(),
    );
    if (runs.length === 0) {
      return (
        <EmptyState
          icon={GitBranch}
          message="No workflow runs yet. Run the routine or wait for its next trigger."
        />
      );
    }
    return (
      <div className="divide-y divide-border border-y border-border">
        {runs.map((run) => {
          const workflowRunHref =
            run.linkedWorkflowRunId && run.linkedWorkflowId
              ? `/workflows/${run.linkedWorkflowId}/runs/${run.linkedWorkflowRunId}`
              : null;
          const content = (
            <>
              <GitBranch
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {run.trigger?.label ?? "Workflow run"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(run.triggeredAt).toLocaleString()} · {run.source}
                </p>
              </div>
              <StatusBadge
                status={run.linkedWorkflowRunStatus ?? run.status}
              />
            </>
          );
          return workflowRunHref ? (
            <Link
              key={run.id}
              to={workflowRunHref}
              className="flex items-center gap-3 px-2 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {content}
            </Link>
          ) : (
            <div key={run.id} className="flex items-center gap-3 px-2 py-3">
              {content}
            </div>
          );
        })}
      </div>
    );
  }

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => issuesApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routines.detail(routine.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routines.runs(routine.id) });
    },
    onError: (updateError) => pushToast({ title: "Failed to update task", body: updateError.message, tone: "error" }),
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error}
      agents={agents}
      projects={projects}
      liveIssueIds={new Set(hasLiveRun && activeIssueId ? [activeIssueId] : [])}
      viewStateKey={`paperclip:routine-runs:${companyId}:${routine.id}`}
      searchFilters={filters}
      issueLinkState={createIssueDetailLocationState("Runs", routineDetailHref(routine.id, "runs"))}
      rowPresentation="task"
      toolbarPresentation="collection"
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
    />
  );
}

export function ActivitySection({ isLoading = false, error }: { isLoading?: boolean; error?: Error | null } = {}) {
  const ctx = useRoutineDetail();
  const { activity } = ctx;
  const events = activity ?? [];

  const groups = useMemo(() => {
    const byDay = new Map<string, typeof events>();
    for (const event of events) {
      let label = "Earlier";
      try {
        label = new Date(event.createdAt).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
      } catch {
        /* keep fallback label */
      }
      const bucket = byDay.get(label) ?? [];
      bucket.push(event);
      byDay.set(label, bucket);
    }
    return Array.from(byDay.entries());
  }, [events]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">{error.message}</p>;

  if (events.length === 0) {
    return <EmptyState icon={ActivityIcon} message="No activity yet." />;
  }

  return (
    <div className="space-y-4">
      {groups.map(([day, dayEvents]) => (
        <div key={day}>
          <div className="sticky top-0 bg-background py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {day}
          </div>
          <div>
            {dayEvents.map((event) => (
              <RoutineActivityRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistorySection() {
  const ctx = useRoutineDetail();
  const {
    routine,
    isEditDirty,
    dirtyFields,
    routineDefaults,
    setEditDraft,
    saveRoutine,
    agentById,
    projectById,
    workflowById,
    availableSecrets,
    onHistoryRestoreSecretMaterials,
    onHistoryRestored,
  } = ctx;

  return (
    <RoutineHistoryTab
      routine={routine}
      isEditDirty={isEditDirty}
      dirtyFields={dirtyFields}
      onDiscardEdits={() => setEditDraft(routineDefaults)}
      onSaveEdits={() => {
        if (!saveRoutine.isPending && routine.title.trim()) {
          saveRoutine.mutate();
        }
      }}
      agents={agentById}
      projects={projectById}
      workflows={workflowById}
      secrets={availableSecrets}
      onRestoreSecretMaterials={onHistoryRestoreSecretMaterials}
      onRestored={onHistoryRestored}
    />
  );
}
