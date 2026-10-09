import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  WorkflowExperience,
  WorkflowLaunchCommand,
} from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { ApiError } from "../api/client";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";

export function WorkflowRunControls({
  company,
  principal,
  id,
  detail,
  refresh,
}: {
  company: string;
  principal: string;
  id: string;
  detail: WorkflowExperience | null;
  refresh: () => void;
}) {
  const { t } = useTranslation("experience");
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<WorkflowLaunchCommand | null>(null);
  const [reviewed, setReviewed] = useState<{
    command: WorkflowLaunchCommand;
    version: number;
  } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const mutation = useMutation({
    mutationKey: ["workflow-launch", company, principal, id],
    gcTime: 0,
    retry: false,
    mutationFn: (command: WorkflowLaunchCommand) =>
      workflowsApi.launch(company, principal, id, command),
    onSuccess: () => {
      setAttempt(null);
      setReviewed(null);
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      const details =
        error instanceof ApiError
          ? (error.body as { details?: { code?: unknown } } | null)?.details
          : null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        [
          "workflow_launch_conflict",
          "workflow_launch_review_required",
          "workflow_launch_request_conflict",
        ].includes(String(details?.code))
      ) {
        setAttempt(null);
        setReviewed(null);
        setOpen(false);
        refresh();
      }
    },
  });
  useEffect(() => {
    const active = document.activeElement?.closest('[role="dialog"]');
    if (
      (mutation.isError || mutation.isSuccess) &&
      (!active || feedback.current?.closest('[role="dialog"]') === active)
    )
      feedback.current?.focus();
  }, [mutation.isError, mutation.isSuccess, detail]);
  if (!detail || !detail.canRequestRun) return null;
  const ready =
    detail.status === "active" &&
    detail.runAvailability === "internal_ready" &&
    Boolean(detail.active);
  function send() {
    const command = attempt ?? reviewed?.command;
    if (mutation.isPending || !command) return;
    setAttempt(command);
    mutation.mutate(command);
  }
  return (
    <section
      aria-labelledby="workflow-run-controls"
      className="mx-auto w-full max-w-3xl space-y-3 rounded-lg border border-border p-4"
    >
      <h2 id="workflow-run-controls" className="text-lg font-medium">
        {t("workflowStartTitle")}
      </h2>
      {mutation.isSuccess && (
        <>
          <p ref={feedback} tabIndex={-1} role="status">
            {t("workflowStartAdmitted")}
          </p>
          <Link
            className="inline-flex min-h-11 items-center underline"
            to={`/workflows/${id}/runs/${mutation.data.runId}`}
          >
            {t("workflowStartInspect")}
          </Link>
        </>
      )}
      {mutation.isError && !attempt && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {t("workflowStartRefused")}
        </p>
      )}
      {attempt ? (
        !open && (
          <Button
            className="min-h-11"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setOpen(true)}
          >
            {t("workflowStartRetry")}
          </Button>
        )
      ) : ready ? (
        <Button
          className="min-h-11"
          onClick={() => {
            mutation.reset();
            setReviewed({
              version: detail.active!.version,
              command: {
                requestId: crypto.randomUUID(),
                expectedUpdatedAt: detail.updatedAt,
                expectedPublishedRevisionId: detail.active!.id,
                expectedDraftRevisionId: detail.draft?.id ?? null,
                acknowledgeInternalExecution: true,
              },
            });
            setOpen(true);
          }}
        >
          {t("workflowStartNow")}
        </Button>
      ) : detail.runAvailability === "review_required" ? (
        <>
          <p>{t("workflowStartReviewRequired")}</p>
          <Link
            className="inline-flex min-h-11 items-center underline"
            to={`/workflows/${id}/advanced`}
          >
            {t("workflowStartAdvanced")}
          </Link>
        </>
      ) : (
        <p>{t("workflowStartInactive")}</p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent
          showCloseButton={!mutation.isPending}
          onEscapeKeyDown={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
        >
          <DialogTitle>{t("workflowStartConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("workflowStartConsequence")}</DialogDescription>
          {reviewed && (
            <p>{t("workflowStartVersion", { version: reviewed.version })}</p>
          )}
          {mutation.isPending && (
            <p role="status">{t("workflowStartPending")}</p>
          )}
          {mutation.isError && attempt && (
            <p ref={feedback} tabIndex={-1} role="alert">
              {t("workflowStartUnknown")}
            </p>
          )}
          <DialogFooter className="flex flex-row justify-between gap-3">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t("workflowLifecycleClose")}
            </Button>
            <Button
              className="min-h-11"
              disabled={mutation.isPending}
              onClick={send}
            >
              {t(attempt ? "workflowStartRetry" : "workflowStartConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
