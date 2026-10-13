import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  WorkflowExperience,
  WorkflowPublicationCommand,
  WorkflowPublicationReview,
} from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { ApiError } from "../api/client";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { Button } from "./ui/button";
import { useWorkflowRequestLocator } from "../hooks/useWorkflowRequestLocator";
import { Link } from "../lib/router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./ui/dialog";
/** A frozen current native draft/test review. Publication does not claim material readiness. */
export function WorkflowPublicationControls({
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
  const client = useQueryClient();
  const [epoch, setEpoch] = useState(0),
    [open, setOpen] = useState(false),
    [ack, setAck] = useState(false);
  const [reviewed, setReviewed] = useState<WorkflowPublicationReview | null>(
    null,
  );
  const [attempt, setAttempt] = useState<WorkflowPublicationCommand | null>(
    null,
  );
  const prefix = ["workflow-publication", company, principal, id];
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: ({ signal }) =>
      workflowsApi.publicationReview(company, principal, id, signal),
    enabled: !!detail?.canOperate,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    setEpoch((old) => old + 1);
  });
  const feedback = useRef<HTMLParagraphElement>(null);
  const locator = useWorkflowRequestLocator(company, principal, id, "publication", !!detail?.canOperate && query.isSuccess && !query.isFetching);
  const mutation = useMutation({
    mutationKey: ["workflow-publication-command", company, principal, id],
    gcTime: 0,
    retry: false,
    mutationFn: (command: WorkflowPublicationCommand) =>
      locator.write(command.requestId, () => workflowsApi.publishReviewed(company, principal, id, command)),
    onSuccess: (receipt) => {
      if (!locator.confirm(receipt)) return;
      setAttempt(null);
      setReviewed(null);
      setOpen(false);
      refresh();
      void query.refetch();
    },
    onError: (error) => {
      const code =
        error instanceof ApiError
          ? (error.body as { details?: { code?: unknown } })?.details?.code
          : null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        code === "workflow_publication_conflict"
      ) {
        if (attempt) locator.refused(attempt.requestId);
        setAttempt(null);
        setReviewed(null);
        setOpen(false);
        refresh();
        void query.refetch();
      }
    },
  });
  const current = !!detail?.canOperate && query.isSuccess && !query.isFetching;
  const observed = current ? query.data?.receipt : null;
  useEffect(() => {
    if (
      observed && locator.pending === observed.requestId &&
      (!attempt || (observed.requestId === attempt.requestId &&
      observed.revisionId === attempt.expectedDraftRevisionId &&
      observed.testRunId === attempt.expectedTestRunId)) &&
      !mutation.isPending
    ) {
      if (!locator.observed(observed)) return;
      setAttempt(null);
      setReviewed(null);
      setOpen(false);
      mutation.reset();
      refresh();
    }
  }, [attempt, observed, mutation.isPending, locator.pending]);
  useEffect(() => {
    const dialog = document.activeElement?.closest('[role="dialog"]');
    if (
      mutation.isError &&
      (!dialog || feedback.current?.closest('[role="dialog"]') === dialog)
    )
      feedback.current?.focus();
  }, [mutation.isError, current]);
  if (!current) return null;
  const view = query.data!;
  const receipt = mutation.isSuccess ? mutation.data : observed;
  function begin() {
    if (locator.failed || !locator.ready || (locator.pending && !attempt)) return;
    if (attempt) {
      setOpen(true);
      return;
    }
    if (view.availability !== "internal_ready") return;
    setReviewed(view);
    setAck(false);
    setOpen(true);
    mutation.reset();
  }
  function confirm() {
    if (locator.failed || !locator.ready || mutation.isPending) return;
    if (attempt) {
      mutation.mutate(attempt);
      return;
    }
    if (!ack || !reviewed?.draftRevisionId || !reviewed.testedRunId) return;
    const command: WorkflowPublicationCommand = {
      requestId: crypto.randomUUID(),
      expectedWorkflowId: id,
      expectedUpdatedAt: reviewed.updatedAt,
      expectedDraftRevisionId: reviewed.draftRevisionId,
      expectedPublishedRevisionId: reviewed.publishedRevisionId,
      expectedTestRunId: reviewed.testedRunId,
      acknowledgeInternalPublication: true,
    };
    setAttempt(command);
    mutation.mutate(command);
  }
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label={t("workflowPublicationTitle")}
    >
      <h2 className="text-lg font-medium">{t("workflowPublicationTitle")}</h2>
      {receipt && <p role="status">{t("workflowPublicationRecorded")}</p>}
      <p className="text-muted-foreground">
        {t("workflowPublicationBoundary")}
      </p>
      {locator.failed && <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p>}
      {locator.pending && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${id}/requests/publication/${locator.pending}`}>{t("workflowRequestRecovery.open")}</Link>}
      {view.availability !== "internal_ready" && !attempt && (
        <p>{t(`workflowPublicationAvailability.${view.availability}`)}</p>
      )}
      {(view.availability === "internal_ready" || attempt) && (
        <Button
          className="min-h-11"
          onClick={begin}
          disabled={mutation.isPending || !locator.ready || locator.failed || (!!locator.pending && !attempt)}
        >
          {attempt
            ? t("workflowPublicationRetry")
            : t("workflowPublicationAction")}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {t("workflowPublicationConfirm", {
              version: reviewed?.draftVersion,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("workflowPublicationConsequence")}
          </DialogDescription>
          <p>{t("workflowPublicationBoundary")}</p>
          {!attempt && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              {t("workflowPublicationAcknowledge")}
            </label>
          )}
          {mutation.isError && (
            <p ref={feedback} tabIndex={-1} role="alert">
              {t("workflowPublicationUnknown")}
            </p>
          )}
          <DialogFooter className="flex flex-row justify-between gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              className="min-h-11 min-w-0 flex-1 whitespace-normal"
              disabled={mutation.isPending || (!attempt && !ack)}
              onClick={confirm}
            >
              {mutation.isPending
                ? t("saving")
                : attempt
                  ? t("workflowPublicationRetry")
                  : t("workflowPublicationAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
