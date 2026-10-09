import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  WorkflowExperience,
  WorkflowLifecycleCommand,
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

export function WorkflowLifecycleControls({
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
  const [action, setAction] = useState<
    WorkflowLifecycleCommand["action"] | null
  >(null);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<WorkflowLifecycleCommand | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const mutation = useMutation({
    mutationKey: ["workflow-lifecycle", company, principal, id],
    retry: false,
    gcTime: 0,
    mutationFn: (command: WorkflowLifecycleCommand) =>
      workflowsApi.lifecycle(company, principal, id, command),
    onSuccess: () => {
      setAttempt(null);
      setAction(null);
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      // Only explicit native pre-effect refusals release the original tuple.
      const code =
        error instanceof ApiError
          ? (error.body as { details?: unknown } | null)?.details
          : null;
      const reason =
        code && typeof code === "object" && "code" in code ? code.code : null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        [
          "workflow_lifecycle_conflict",
          "workflow_invalid_transition",
          "workflow_work_pending",
          "workflow_bindings_present",
          "workflow_request_conflict",
        ].includes(String(reason))
      ) {
        setAttempt(null);
        setAction(null);
        setOpen(false);
        refresh();
      }
    },
  });
  useEffect(() => {
    const activeDialog = document.activeElement?.closest('[role="dialog"]');
    if (
      (mutation.isError || mutation.isSuccess) &&
      (!activeDialog ||
        feedback.current?.closest('[role="dialog"]') === activeDialog)
    )
      feedback.current?.focus();
  }, [mutation.isError, mutation.isSuccess, detail]);
  // Keep the component mounted across private read rechecks, but omit all private
  // controls until the current principal's admission is known again.
  if (!detail || !detail.canOperate) return null;
  function send() {
    if (
      !detail ||
      mutation.isPending ||
      !action ||
      (!attempt && detail.status === "archived")
    )
      return;
    const command = attempt ?? {
      requestId: crypto.randomUUID(),
      action,
      expectedStatus:
        detail.status === "draft"
          ? "active"
          : (detail.status as "active" | "paused"),
      expectedUpdatedAt: detail.updatedAt,
      expectedPublishedRevisionId: detail.active?.id ?? null,
      expectedDraftRevisionId: detail.draft?.id ?? null,
      workPolicy: "finish_existing" as const,
    };
    setAttempt(command);
    mutation.mutate(command);
  }
  return (
    <section
      aria-labelledby="workflow-operation"
      className="mx-auto w-full max-w-3xl space-y-3 rounded-lg border border-border p-4"
    >
      <h2 id="workflow-operation" className="text-lg font-medium">
        {t("workflowOperationControls")}
      </h2>
      <p>{t("workflowFinishExisting")}</p>
      {mutation.isSuccess && (
        <p ref={feedback} tabIndex={-1} role="status">
          {t(`workflowLifecycleConfirmed.${mutation.data.action}`)}
        </p>
      )}
      {mutation.isError && !action && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {t("workflowLifecycleRefused")}
        </p>
      )}
      {!attempt && detail.canOperate && (
        <div className="flex flex-wrap gap-3">
          {(detail.status === "active" || detail.status === "draft") && (
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => {
                mutation.reset();
                setAction("pause");
                setOpen(true);
              }}
            >
              {t("workflowPause")}
            </Button>
          )}
          {detail.status === "paused" && (
            <>
              {detail.active && (
                <Button
                  className="min-h-11"
                  onClick={() => {
                    mutation.reset();
                    setAction("resume");
                    setOpen(true);
                  }}
                >
                  {t("workflowResume")}
                </Button>
              )}
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => {
                  mutation.reset();
                  setAction("retire");
                  setOpen(true);
                }}
              >
                {t("workflowRetire")}
              </Button>
            </>
          )}
        </div>
      )}
      {attempt && !open && (
        <Button
          className="min-h-11"
          variant="outline"
          onClick={() => setOpen(true)}
        >
          {t("workflowLifecycleRetry")}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
          showCloseButton={!mutation.isPending}
        >
          <DialogTitle>
            {t(`workflowLifecycleTitle.${action ?? "pause"}`)}
          </DialogTitle>
          <DialogDescription>
            {t(`workflowLifecycleConsequence.${action ?? "pause"}`)}
          </DialogDescription>
          {mutation.isPending && (
            <p role="status">{t("workflowLifecyclePending")}</p>
          )}
          {mutation.isError && (
            <p ref={feedback} tabIndex={-1} role="alert">
              {t("workflowLifecycleUnknown")}
            </p>
          )}
          <DialogFooter className="flex flex-row justify-between gap-3">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setOpen(false);
                if (!attempt) setAction(null);
              }}
            >
              {t(
                attempt ? "workflowLifecycleClose" : "workflowLifecycleCancel",
              )}
            </Button>
            <Button
              className="min-h-11"
              disabled={mutation.isPending}
              onClick={send}
            >
              {t(
                attempt
                  ? "workflowLifecycleRetry"
                  : `workflowLifecycleConfirm.${action ?? "pause"}`,
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
