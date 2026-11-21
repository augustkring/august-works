import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasWorkspaceRestoreFailure, requiresExecutionReconciliation, type HeartbeatRun } from "@paperclipai/shared";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@/lib/router";
import { issuesApi } from "../api/issues";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { useToastActions } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceReconstructionDescriptor } from "../api/issues";
import {
  IssueRecoveryActionCard,
  type RecoveryReissueRequest,
  type RecoveryResolveOutcome,
} from "./IssueRecoveryActionCard";
import {
  canBoardManageRuntime,
  readRecoveryReconcileWorkspaceId,
} from "../lib/recovery-reconcile";

/** The run errorCode Paperclip stamps when it declines a run over a git workspace it can't validate. */
export const WORKSPACE_VALIDATION_RUN_ERROR_CODE = "workspace_validation_failed";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads the source issue id a failed run was working when it was declined over workspace validation.
 * The run's context snapshot pins the issue the recovery action lives on.
 */
function readRunIssueId(run: HeartbeatRun): string | null {
  const context = asRecord(run.contextSnapshot);
  if (!context) return null;
  return asNonEmptyString(context.issueId);
}

function runHasWorkspaceRestoreFailure(run: HeartbeatRun): boolean {
  return hasWorkspaceRestoreFailure(asRecord(run.resultJson));
}

function WorkspaceReconstructionPanel(props: {
  descriptor: WorkspaceReconstructionDescriptor | null | undefined;
  loading?: boolean;
  runId: string;
  actionId: string;
  pending: boolean;
  canReconcileMixed: boolean;
  onSubmit: (input: { actionOutcome: "completed" | "not_performed" | "mixed"; outcomeEvidence: string; sourceIds: string[] }) => void;
}) {
  const { t } = useTranslation("experience");
  const [selected, setSelected] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<"completed" | "not_performed" | "mixed">("not_performed");
  const [evidence, setEvidence] = useState("");
  const [confirmedNext, setConfirmedNext] = useState(false);
  const [confirmedProviderStopped, setConfirmedProviderStopped] = useState(false);
  const descriptor = props.descriptor;
  if (!descriptor) return (
    <section className="space-y-2 rounded-md border bg-background/60 p-3" data-testid="workspace-reconstruction-panel">
      <h3 className="text-sm font-semibold">{t("workspaceReconstruction.title")}</h3>
      <p role="status" className="text-xs text-muted-foreground">{props.loading
        ? t("workspaceReconstruction.checking")
        : t("workspaceReconstruction.descriptorUnavailable")}</p>
      <p className="text-xs text-muted-foreground">{t("workspaceReconstruction.noActionWithoutProof")}</p>
    </section>
  );
  const provenDestroyed = descriptor.destruction.state === "confirmed" && Boolean(descriptor.destruction.receiptHash);
  const eligible = descriptor.state === "available" && descriptor.sourceRunId === props.runId && provenDestroyed
    && descriptor.continuation.available && descriptor.continuation.mode === "fresh_bounded"
    && descriptor.sources.length > 0;
  const selectedSources = descriptor.sources.filter(source => selected.includes(source.attachmentId));
  const selectedByteSize = selectedSources.reduce((total, source) => total + source.byteSize, 0);
  const selectedOverSizeLimit = selectedByteSize > 64 * 1024 * 1024;
  const selectedOverCountLimit = selectedSources.length > 32;
  const valid = eligible && selectedSources.length > 0 && evidence.trim().length >= 20
    && !selectedOverSizeLimit && !selectedOverCountLimit && confirmedNext && confirmedProviderStopped && (outcome !== "mixed" || props.canReconcileMixed);
  const reason = descriptor.reason ?? descriptor.continuation.reason;

  return (
    <section className="space-y-3 rounded-md border bg-background/60 p-3" data-testid="workspace-reconstruction-panel">
      <div>
        <h3 className="text-sm font-semibold">{t("workspaceReconstruction.title")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("workspaceReconstruction.explanation")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("workspaceReconstruction.stagingScope")}</p>
      </div>
      <div role="status" data-testid="workspace-destruction-proof" className="rounded border px-2.5 py-2 text-xs">
        {provenDestroyed
          ? t("workspaceReconstruction.destroyedConfirmed")
          : t("workspaceReconstruction.destroyedUnknown")}
      </div>
      {!provenDestroyed ? <p className="text-xs text-muted-foreground">{t("workspaceReconstruction.noActionWithoutProof")}</p> : null}
      {!eligible ? (
        <p className="text-xs text-muted-foreground" data-testid="workspace-reconstruction-unavailable">
          {reason ? t(`workspaceReconstruction.reasons.${reason}`, { defaultValue: t("workspaceReconstruction.unavailable") }) : t("workspaceReconstruction.unavailable")}
        </p>
      ) : null}
      {eligible ? (
        <>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t("workspaceReconstruction.sourceTitle")}</legend>
            {descriptor.sources.map(source => (
              <label key={source.attachmentId} className="flex items-start gap-2 rounded border p-2 text-xs">
                <Checkbox
                  checked={selected.includes(source.attachmentId)}
                  onCheckedChange={(checked) => setSelected(current => checked
                    ? [...new Set([...current, source.attachmentId])]
                    : current.filter(id => id !== source.attachmentId))}
                  aria-label={t("workspaceReconstruction.selectSource", { filename: source.filename })}
                />
                <span className="min-w-0 flex-1"><span className="block break-all font-medium">{source.filename}</span>
                  <span className="text-muted-foreground">{t("workspaceReconstruction.fileMetadata", { size: source.byteSize, type: source.contentType })}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {selectedOverSizeLimit ? <p role="alert" className="text-xs text-destructive">{t("workspaceReconstruction.aggregateLimit")}</p> : null}
          {selectedOverCountLimit ? <p role="alert" className="text-xs text-destructive">{t("workspaceReconstruction.sourceCountLimit")}</p> : null}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t("workspaceReconstruction.effectTitle")}</legend>
            {(["completed", "not_performed", "mixed"] as const).map(value => (
              <label key={value} className="flex items-start gap-2 text-xs">
                <input type="radio" name={`workspace-effect-${props.actionId}`} value={value} checked={outcome === value}
                  disabled={value === "mixed" && !props.canReconcileMixed} onChange={() => setOutcome(value)} />
                <span>{t(`workspaceReconstruction.effects.${value}`)}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-xs">
            <span className="font-medium">{t("workspaceReconstruction.evidenceLabel")}</span>
            <Textarea value={evidence} onChange={event => setEvidence(event.target.value)} maxLength={12000} rows={3}
              placeholder={t("workspaceReconstruction.evidencePlaceholder")} />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={confirmedNext} onCheckedChange={value => setConfirmedNext(value === true)} />
            <span>{t("workspaceReconstruction.nextStepConsent")}</span>
          </label>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={confirmedProviderStopped} onCheckedChange={value => setConfirmedProviderStopped(value === true)} />
            <span>{t("workspaceReconstruction.providerStoppedConsent")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t("workspaceReconstruction.noProviderCalls")}</p>
          <Button type="button" size="sm" disabled={!valid || props.pending} data-testid="workspace-reconstruction-submit"
            onClick={() => props.onSubmit({ actionOutcome: outcome, outcomeEvidence: evidence.trim(), sourceIds: selectedSources.map(source => source.attachmentId) })}>
            {props.pending ? t("workspaceReconstruction.submitting") : t("workspaceReconstruction.submit")}
          </Button>
        </>
      ) : null}
    </section>
  );
}

/**
 * Run-page recovery surface. When a run *failed* with workspace-validation evidence, this fetches
 * the source issue's active recovery action and renders the same `IssueRecoveryActionCard`
 * (compact) that `IssueDetail` shows — wired to the same reconcile-forward / repair / re-issue /
 * break-glass / resolve handlers — so the divergence can be resolved from the run view directly.
 *
 * Renders nothing unless the run is a workspace-validation failure whose source issue still carries
 * a live `workspace_validation` recovery action.
 */
export function RunWorkspaceRecoverySurface({ run }: { run: HeartbeatRun }) {
  const { t } = useTranslation("experience");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  const isWorkspaceValidationFailure =
    run.status === "failed" && run.errorCode === WORKSPACE_VALIDATION_RUN_ERROR_CODE;
  const isLostWorkspaceFailure = run.status === "failed" && runHasWorkspaceRestoreFailure(run);
  const issueId = readRunIssueId(run);

  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId ?? "__none__"),
    queryFn: () => issuesApi.get(issueId!),
    enabled: Boolean((isWorkspaceValidationFailure || isLostWorkspaceFailure) && issueId),
  });

  const recoveryActionsQuery = useQuery({
    queryKey: queryKeys.issues.recoveryActions(issueId ?? "__none__"),
    queryFn: () => issuesApi.getRecoveryActions(issueId!),
    enabled: Boolean(isLostWorkspaceFailure && issueId),
    retry: false,
  });
  const recoveryActions = recoveryActionsQuery.data;

  const { data: boardAccess } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    enabled: Boolean((isWorkspaceValidationFailure || isLostWorkspaceFailure) && issueId),
    retry: false,
  });

  const recoveryAction = issue?.activeRecoveryAction ?? null;
  // A cached success must not keep filenames, hashes, or the confirmed-destruction
  // affordance visible after a current-ACL refresh fails.
  const descriptor = recoveryActionsQuery.isError ? null : recoveryActions?.workspaceReconstruction ?? null;
  const canManageBoardRuntime = canBoardManageRuntime(run.companyId, boardAccess);
  // Prefer the workspace pinned by the recovery action's evidence (the workspace that actually
  // diverged) over the page-level id, which can drift after a re-issue rebinds the issue.
  const reconcileWorkspaceId =
    readRecoveryReconcileWorkspaceId(recoveryAction) ?? issue?.executionWorkspaceId ?? null;

  const invalidate = useCallback(() => {
    if (issueId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.runIssues(run.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.runDetail(run.id) });
  }, [issueId, queryClient, run.id]);

  const reconcile = useMutation({
    mutationFn: (
      input:
        | { workspaceId: string; mode: "forward" }
        | { workspaceId: string; mode: "override"; reason: string }
        | { workspaceId: string; mode: "quarantine_restore" },
    ) => {
      const { workspaceId, ...body } = input;
      return executionWorkspacesApi.reconcile(workspaceId, body);
    },
    onSuccess: (_result, variables) => {
      invalidate();
      pushToast(
        variables.mode === "quarantine_restore"
          ? {
              title: "Workspace repaired",
              body: "Dirty changes were quarantined onto a rescue branch and the recorded branch restored; the task will resume.",
              tone: "success",
            }
          : {
              title: "Workspace branch reconciled",
              body: "The recorded branch now matches the live branch; the task will resume.",
              tone: "success",
            },
      );
    },
    onError: (err) => {
      pushToast({
        title: "Reconcile failed",
        body: err instanceof Error ? err.message : "Unable to reconcile the workspace branch.",
        tone: "error",
      });
    },
  });

  const reissue = useMutation({
    mutationFn: async (request: RecoveryReissueRequest) => {
      if (!issue) throw new Error("Task is not loaded yet.");
      const sourceLabel = issue.identifier ?? "the stalled task";
      const descriptionLines = [
        `Re-issued from ${sourceLabel} on an isolated git worktree after a workspace branch divergence.`,
        "",
        `- Base ref (live branch): \`${request.baseRef}\``,
        ...(request.expectedBranch ? [`- Recorded branch: \`${request.expectedBranch}\``] : []),
        "",
        "---",
        "",
        issue.description ?? "",
      ];
      return issuesApi.create(issue.companyId, {
        title: `Re-issue (isolated): ${issue.title ?? sourceLabel}`,
        description: descriptionLines.join("\n"),
        priority: issue.priority,
        projectId: issue.projectId ?? null,
        parentId: issue.parentId ?? null,
        assigneeAgentId:
          recoveryAction?.returnOwnerAgentId ??
          recoveryAction?.previousOwnerAgentId ??
          issue.assigneeAgentId ??
          null,
        executionWorkspacePreference: "isolated_workspace",
        executionWorkspaceSettings: {
          mode: "isolated_workspace",
          workspaceStrategy: { type: "git_worktree", baseRef: request.baseRef },
        },
      });
    },
    onSuccess: (created) => {
      invalidate();
      pushToast({
        title: "Isolated re-issue created",
        body: created.identifier
          ? `${created.identifier} will run on a fresh isolated workspace.`
          : "A fresh isolated re-issue was created.",
        tone: "success",
      });
      if (created.identifier) {
        navigate(`/issues/${created.identifier}`);
      }
    },
    onError: (err) => {
      pushToast({
        title: "Re-issue failed",
        body: err instanceof Error ? err.message : "Unable to create an isolated re-issue.",
        tone: "error",
      });
    },
  });

  const resolve = useMutation({
    mutationFn: (data: {
      outcome: "restored" | "false_positive";
      sourceIssueStatus: "todo" | "done" | "in_review";
    }) => {
      if (!issueId || !recoveryAction) throw new Error("No recovery action to resolve.");
      return issuesApi.resolveRecoveryAction(issueId, {
        actionId: recoveryAction.id,
        outcome: data.outcome,
        sourceIssueStatus: data.sourceIssueStatus,
      });
    },
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => {
      pushToast({
        title: "Recovery resolution failed",
        body: err instanceof Error ? err.message : "Unable to resolve recovery action",
        tone: "error",
      });
    },
  });

  const reconstruct = useMutation({
    mutationFn: (input: { actionOutcome: "completed" | "not_performed" | "mixed"; outcomeEvidence: string; sourceIds: string[] }) => {
      if (!issueId || !recoveryAction || !descriptor?.destruction.receiptHash) throw new Error(t("workspaceReconstruction.unavailable"));
      return issuesApi.resolveRecoveryAction(issueId, {
        actionId: recoveryAction.id,
        outcome: "restored",
        sourceIssueStatus: "todo",
        executionReconciliation: {
          runId: descriptor.sourceRunId!,
          providerStopped: true,
          actionOutcome: input.actionOutcome,
          outcomeEvidence: input.outcomeEvidence,
          workspaceReconstruction: {
            confirmed: true,
            destructionReceiptHash: descriptor.destruction.receiptHash,
            selectedSources: descriptor.sources.filter(source => input.sourceIds.includes(source.attachmentId))
              .map(source => ({ attachmentId: source.attachmentId, sha256: source.sha256 })),
          },
        },
      });
    },
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.recoveryActions(issueId ?? "__none__") });
      pushToast({ title: t("workspaceReconstruction.successTitle"), body: t("workspaceReconstruction.successBody"), tone: "success" });
    },
    onError: error => pushToast({ title: t("workspaceReconstruction.errorTitle"), body: error instanceof Error ? error.message : t("workspaceReconstruction.errorBody"), tone: "error" }),
  });

  const handleReconcileForward = useCallback(() => {
    if (!reconcileWorkspaceId) return;
    void reconcile.mutateAsync({ workspaceId: reconcileWorkspaceId, mode: "forward" });
  }, [reconcile, reconcileWorkspaceId]);

  const handleBreakGlass = useCallback(
    (reason: string) => {
      if (!reconcileWorkspaceId) return;
      void reconcile.mutateAsync({ workspaceId: reconcileWorkspaceId, mode: "override", reason });
    },
    [reconcile, reconcileWorkspaceId],
  );

  const handleQuarantineRestore = useCallback(() => {
    if (!reconcileWorkspaceId) return;
    void reconcile.mutateAsync({ workspaceId: reconcileWorkspaceId, mode: "quarantine_restore" });
  }, [reconcile, reconcileWorkspaceId]);

  const handleReissue = useCallback(
    (request: RecoveryReissueRequest) => {
      void reissue.mutateAsync(request);
    },
    [reissue],
  );

  const handleResolve = useCallback(
    (outcome: RecoveryResolveOutcome) => {
      switch (outcome) {
        case "todo":
          void resolve.mutateAsync({ outcome: "restored", sourceIssueStatus: "todo" });
          return;
        case "done":
          void resolve.mutateAsync({ outcome: "restored", sourceIssueStatus: "done" });
          return;
        case "in_review":
          void resolve.mutateAsync({ outcome: "restored", sourceIssueStatus: "in_review" });
          return;
        case "false_positive_done":
          void resolve.mutateAsync({ outcome: "false_positive", sourceIssueStatus: "done" });
          return;
        case "false_positive_in_review":
          void resolve.mutateAsync({ outcome: "false_positive", sourceIssueStatus: "in_review" });
          return;
      }
    },
    [resolve],
  );

  if ((!isWorkspaceValidationFailure && !isLostWorkspaceFailure) || !issueId) return null;
  if (!recoveryAction) return null;
  const showLostWorkspaceReconstruction = isLostWorkspaceFailure && requiresExecutionReconciliation(recoveryAction.cause);
  if (!showLostWorkspaceReconstruction && (!isWorkspaceValidationFailure || recoveryAction.kind !== "workspace_validation")) return null;

  return (
    <div className="space-y-2" data-testid="run-workspace-recovery-surface">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Workspace recovery</span>
        {issue?.identifier ? (
          <a
            href={`/issues/${issue.identifier}`}
            className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={(event) => {
              event.preventDefault();
              navigate(`/issues/${issue.identifier}`);
            }}
          >
            {issue.identifier}
          </a>
        ) : null}
      </div>
      {showLostWorkspaceReconstruction ? (
        <WorkspaceReconstructionPanel descriptor={descriptor} runId={run.id} actionId={recoveryAction.id}
          loading={recoveryActionsQuery.isPending} pending={reconstruct.isPending} canReconcileMixed={boardAccess?.isInstanceAdmin === true}
          key={`${run.id}:${recoveryAction.id}:${descriptor?.destruction.receiptHash ?? "unknown"}:${descriptor?.sources.map(source => `${source.attachmentId}:${source.sha256}`).join(",") ?? "none"}`}
          onSubmit={input => reconstruct.mutate(input)} />
      ) : null}
      {isWorkspaceValidationFailure ? <IssueRecoveryActionCard
        action={recoveryAction}
        variant="compact"
        onResolve={handleResolve}
        onReissueIsolated={handleReissue}
        reissuePending={reissue.isPending}
        onReconcileForward={handleReconcileForward}
        onBreakGlassOverride={handleBreakGlass}
        onQuarantineRestore={handleQuarantineRestore}
        quarantineRestorePending={reconcile.isPending}
        reconcilePending={reconcile.isPending}
        canBreakGlass={canManageBoardRuntime}
      /> : null}
    </div>
  );
}

export default RunWorkspaceRecoverySurface;
