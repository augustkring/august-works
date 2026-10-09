import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  WorkflowRunExperience,
  WorkflowStopCommand,
} from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { ApiError } from "../api/client";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";

export function WorkflowStopControls({
  company,
  principal,
  workflow,
  id,
  detail,
  refresh,
}: {
  company: string;
  principal: string;
  workflow: string;
  id: string;
  detail: WorkflowRunExperience | null;
  refresh: () => void;
}) {
  const { t } = useTranslation("experience");
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [reviewed, setReviewed] = useState<WorkflowStopCommand | null>(null);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<WorkflowStopCommand | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const mutation = useMutation({
    mutationKey: ["workflow-stop", company, principal, workflow, id],
    retry: false,
    gcTime: 0,
    mutationFn: (command: WorkflowStopCommand) =>
      workflowsApi.stop(company, principal, workflow, id, command),
    onSuccess: () => {
      setAttempt(null);
      setReviewed(null);
      setReviewedVersion(null);
      setChecked(false);
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      const code =
        error instanceof ApiError
          ? (error.body as { details?: { code?: unknown } } | null)?.details
              ?.code
          : null;
      // Only this canonical pre-effect version/state refusal permits a fresh
      // review. Access loss, malformed replies and transport loss may follow
      // durable admission, so they retain the identical original command.
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        code === "workflow_stop_conflict"
      ) {
        setAttempt(null);
        setReviewed(null);
        setReviewedVersion(null);
        setChecked(false);
        setOpen(false);
        refresh();
      }
    },
  });
  useEffect(() => {
    if (mutation.isSuccess || mutation.isError) feedback.current?.focus();
  }, [mutation.isSuccess, mutation.isError, detail]);
  const allowed =
    detail?.companyId === company &&
    detail.workflowId === workflow &&
    detail.id === id &&
    detail.canRequestStop;
  if (!allowed) return null;
  const live = ["queued", "running", "waiting", "recovering"].includes(
    detail.status,
  );
  if (
    !live &&
    !attempt &&
    !mutation.isSuccess &&
    !mutation.isError &&
    !mutation.isPending
  )
    return null;
  const command = attempt ?? reviewed;
  return (
    <section
      aria-labelledby="workflow-stop-heading"
      className="mx-auto w-full max-w-3xl space-y-3 rounded-lg border border-border p-4"
    >
      <h2 id="workflow-stop-heading" className="text-lg font-medium">
        {t("workflowStopTitle")}
      </h2>
      {mutation.isSuccess && (
        <p ref={feedback} tabIndex={-1} role="status">
          {t("workflowStopAccepted")}
        </p>
      )}
      {mutation.isError && !open && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {t(attempt ? "workflowStopUnknown" : "workflowStopChanged")}
        </p>
      )}
      {mutation.isPending && <p role="status">{t("workflowStopPending")}</p>}
      {attempt
        ? !open && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setChecked(false);
                setOpen(true);
              }}
            >
              {t("workflowStopRetry")}
            </Button>
          )
        : live && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => {
                mutation.reset();
                setChecked(false);
                setReviewedVersion(detail.revisionNumber);
                setReviewed({
                  requestId: crypto.randomUUID(),
                  expectedWorkflowId: workflow,
                  expectedRevisionId: detail.revisionId,
                  expectedUpdatedAt: detail.updatedAt,
                  acknowledgeCompletedEffectsRemain: true,
                });
                setOpen(true);
              }}
            >
              {t("workflowStopAction")}
            </Button>
          )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          setChecked(false);
          if (!value && !attempt) {
            setReviewed(null);
            setReviewedVersion(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{t("workflowStopConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("workflowStopConsequences")}</DialogDescription>
          {reviewedVersion !== null && (
            <p>{t("workflowStopVersion", { version: reviewedVersion })}</p>
          )}
          {mutation.isPending && (
            <p role="status">{t("workflowStopPending")}</p>
          )}
          {mutation.isError && attempt && (
            <p ref={feedback} tabIndex={-1} role="alert">
              {t("workflowStopUnknown")}
            </p>
          )}
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={checked}
              disabled={mutation.isPending}
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span>{t("workflowStopAcknowledge")}</span>
          </label>
          <DialogFooter className="flex-row justify-between">
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t(
                attempt ? "workflowLifecycleClose" : "workflowLifecycleCancel",
              )}
            </Button>
            <Button
              className="min-h-11"
              disabled={!checked || !command || mutation.isPending}
              onClick={() => {
                if (command) {
                  setAttempt(command);
                  mutation.mutate(command);
                }
              }}
            >
              {t(
                mutation.isPending
                  ? "workflowStopPending"
                  : attempt
                    ? "workflowStopRetry"
                    : "workflowStopAction",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
