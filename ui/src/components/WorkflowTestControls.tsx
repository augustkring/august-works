import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  WorkflowExperience,
  WorkflowTestCommand,
} from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { ApiError } from "../api/client";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import { useWorkflowRequestLocator } from "../hooks/useWorkflowRequestLocator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";

/** The command freezes the reviewed immutable draft. A native admission is
 * displayed separately from execution and never claims production validity. */
export function WorkflowTestControls({
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
  const [open, setOpen] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<WorkflowTestCommand | null>(null);
  const [reviewed, setReviewed] = useState<{
    command: WorkflowTestCommand;
    version: number;
    deadline: number;
  } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const locator = useWorkflowRequestLocator(company, principal, id, "test", !!detail?.canRequestTest);
  const mutation = useMutation({
    mutationKey: ["workflow-test", company, principal, id],
    gcTime: 0,
    retry: false,
    mutationFn: (command: WorkflowTestCommand) =>
      locator.write(command.requestId, () => workflowsApi.test(company, principal, id, command)),
    onSuccess: (receipt) => {
      if (!locator.confirm(receipt)) return;
      setAttempt(null);
      setReviewed(null);
      setOpen(false);
      refresh();
    },
    onError: (error) => {
      const code =
        error instanceof ApiError
          ? (error.body as { details?: { code?: unknown } } | null)?.details
              ?.code
          : null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        ["workflow_test_conflict", "workflow_test_review_required"].includes(
          String(code),
        )
      ) {
        if (attempt) locator.refused(attempt.requestId);
        setAttempt(null);
        setReviewed(null);
        setOpen(false);
        refresh();
      }
    },
  });
  const observed = detail?.canRequestTest ? detail.testReceipt : null;
  useEffect(() => {
    if (
      observed && locator.pending === observed.requestId &&
      (!attempt || (observed.requestId === attempt.requestId &&
      observed.revisionId === attempt.expectedDraftRevisionId)) &&
      !mutation.isPending
    ) {
      if (!locator.observed(observed)) return;
      setAttempt(null);
      setReviewed(null);
      setOpen(false);
      mutation.reset();
    }
  }, [attempt, observed, mutation.isPending, locator.pending]);
  useEffect(() => {
    const active = document.activeElement?.closest('[role="dialog"]');
    if (
      (mutation.isError || mutation.isSuccess) &&
      (!active || feedback.current?.closest('[role="dialog"]') === active)
    )
      feedback.current?.focus();
  }, [mutation.isError, mutation.isSuccess, detail]);
  if (!detail || !detail.canRequestTest) return null;
  const receipt = mutation.isSuccess ? mutation.data : observed;
  const ready =
    detail.testAvailability === "internal_ready" &&
    detail.draft &&
    detail.testDeadlineSeconds !== null;
  function send() {
    if (!locator.ready || locator.failed) return;
    const command = attempt ?? reviewed?.command;
    if (mutation.isPending || !acknowledged || !command) return;
    setAttempt(command);
    mutation.mutate(command);
  }
  return (
    <section
      aria-labelledby="workflow-test-controls"
      className="mx-auto w-full max-w-3xl space-y-3 rounded-lg border border-border p-4"
    >
      <h2 id="workflow-test-controls" className="text-lg font-medium">
        {t("workflowTestTitle")}
      </h2>
      {receipt && (
        <>
          <p ref={feedback} tabIndex={-1} role="status">
            {t("workflowTestAdmitted")}
          </p>
          <Link
            className="inline-flex min-h-11 items-center underline"
            to={`/workflows/${id}/runs/${receipt.runId}`}
          >
            {t("workflowTestInspect")}
          </Link>
        </>
      )}
      {locator.failed && <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p>}
      {locator.pending && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${id}/requests/test/${locator.pending}`}>{t("workflowRequestRecovery.open")}</Link>}
      {mutation.isError && !attempt && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {t("workflowTestRefused")}
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
            {t("workflowTestRetry")}
          </Button>
        )
      ) : ready ? (
        <Button
          className="min-h-11"
          disabled={!locator.ready || locator.failed || !!locator.pending}
          onClick={() => {
            if (!locator.ready || locator.failed || locator.pending) return;
            mutation.reset();
            setAcknowledged(false);
            setReviewed({
              version: detail.draft!.version,
              deadline: detail.testDeadlineSeconds!,
              command: {
                requestId: crypto.randomUUID(),
                expectedWorkflowId: id,
                expectedUpdatedAt: detail.updatedAt,
                expectedDraftRevisionId: detail.draft!.id,
                expectedRunStatus: "succeeded",
                acknowledgeInternalTest: true,
              },
            });
            setOpen(true);
          }}
        >
          {t("workflowTestNow")}
        </Button>
      ) : (
        <p>
          {t(
            detail.testAvailability === "review_required"
              ? "workflowTestReviewRequired"
              : "workflowTestInactive",
          )}
        </p>
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
          <DialogTitle>{t("workflowTestConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("workflowTestConsequence")}</DialogDescription>
          {reviewed && (
            <p>
              {t("workflowTestExpected", {
                version: reviewed.version,
                deadline: reviewed.deadline,
              })}
            </p>
          )}
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={mutation.isPending}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {t("workflowTestAcknowledge")}
          </label>
          {mutation.isPending && (
            <p role="status">{t("workflowTestPending")}</p>
          )}
          {mutation.isError && attempt && (
            <p ref={feedback} tabIndex={-1} role="alert">
              {t("workflowTestUnknown")}
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
              disabled={mutation.isPending || !acknowledged}
              onClick={send}
            >
              {t(attempt ? "workflowTestRetry" : "workflowTestConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
