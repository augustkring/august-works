import { useEffect, useRef, useState } from "react";
import { TOOL_ACTION_REQUEST_STATUSES } from "@paperclipai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowsApi } from "@/api/workflows";
import { ApiError } from "@/api/client";
import { approvalsApi } from "@/api/approvals";
import { queryKeys } from "@/lib/queryKeys";
import { workflowReadSourceChanged } from "@/lib/workflow-source-invalidation";
import { Link } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { Button } from "@/components/ui/button";

type Scope = { companyId: string; runId: string; nodeId: string; attemptId: string; checkpoint?: { approvalId: string; nodeId: string; workflowId: string; revisionId: string } };
type Decision = { id: string; decision: "approve" | "reject" };
const requestStatuses = new Set<string>([...TOOL_ACTION_REQUEST_STATUSES, "revision_requested"]);
type ReviewData = { canReview: boolean; reviews: Array<Awaited<ReturnType<typeof workflowsApi.toolReviews>>["reviews"][number] & { reviewHash?: string }> };
// An opaque Original request locator, not a grant or private action payload.
function retainedDecision(key: string): Decision | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200 &&
      ["approve", "reject"].includes(value.decision) && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now())
      return { id: value.id, decision: value.decision };
    sessionStorage.removeItem(key);
  } catch { /* Malformed local state is never interpreted as an approval. */ }
  return null;
}

export function WorkflowToolReview(props: Scope) {
  const identity = useV9CurrentAccount(), { t } = useTranslation("experience");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  if (!principal) return <p role="status">{t("loading")}</p>;
  return <CurrentToolReview key={`${props.companyId}:${principal}:${props.runId}:${props.attemptId}:${props.nodeId}:${props.checkpoint?.revisionId ?? "tool"}`} {...props} principal={principal} />;
}

/** The Native action request remains the sole approval identity. A lost reply
 * admits only a fresh read; it never replays or reverses that decision. */
function CurrentToolReview({ companyId, principal, runId, nodeId, attemptId, checkpoint }: Scope & { principal: string }) {
  const client = useQueryClient(), { t } = useTranslation("experience");
  const { selectedCompanyId } = useCompany();
  const authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0), generation = useRef(0);
  const storageKey = `aw.v9.workflow-tool-decision:${companyId}:${principal}:${runId}:${checkpoint ? "approval" : "tool"}:${attemptId}`;
  const [retained] = useState(() => retainedDecision(storageKey));
  const attempt = useRef<Decision | null>(retained);
  const [unconfirmed, setUnconfirmed] = useState(Boolean(retained));
  const [reviewChanged, setReviewChanged] = useState(false);
  const statusButton = useRef<HTMLButtonElement>(null), restoreStatusFocus = useRef(false);
  const scope = useRef({ companyId, selectedCompanyId, authority });
  scope.current = { companyId, selectedCompanyId, authority };
  const current = () => scope.current.companyId === companyId && scope.current.selectedCompanyId === companyId &&
    scope.current.authority.canRead() && generation.current === epoch;
  const prefix = ["workflow-tool-reviews", companyId, principal, runId];
  const key = [...prefix, nodeId, attemptId, authority.epoch, epoch];
  const query = useQuery<ReviewData>({ queryKey: key, enabled: authority.readReady && selectedCompanyId === companyId,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Review access changed");
      const value = checkpoint ? await (async () => {
        const approval = await approvalsApi.get(checkpoint.approvalId, principal, signal), payload = approval.payload;
        if (approval.id !== checkpoint.approvalId || approval.companyId !== companyId || approval.type !== "workflow_step_approval" ||
          !approval.reviewHash || !/^[a-f0-9]{64}$/.test(approval.reviewHash) || payload.workflowNodeId !== checkpoint.nodeId || payload.workflowId !== checkpoint.workflowId || payload.workflowRunId !== runId || payload.workflowRevisionId !== checkpoint.revisionId ||
          typeof payload.summary !== "string" || payload.summary.length > 2000 || typeof payload.consequence !== "string" || payload.consequence.length > 4000)
          throw new Error("Current checkpoint changed scope");
        return { canReview: approval.status === "pending", reviews: [{ id: approval.id, nodeId, toolName: t("workflowToolReview.checkpointTitle"),
          preview: `${payload.summary}\n\n${payload.consequence}`, reviewHash: approval.reviewHash, status: approval.status, risk: null, argumentsSummary: null, approvalId: null, expiresAt: null }] };
      })() : await workflowsApi.toolReviews(companyId, runId, principal, signal);
      if (!current()) throw new Error("Review access changed");
      return value;
    }), retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: true });
  useCompanyLiveEvent(event => {
    if (event.companyId !== companyId || !workflowReadSourceChanged(event)) return;
    setEpoch(++generation.current);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  const fresh = () => {
    const state = client.getQueryState(key);
    return current() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  };
  const mutation = useMutation({ retry: false, gcTime: 0,
    mutationFn: (command: Decision) => {
      const data = client.getQueryData<ReviewData>(key);
      const reviewed = data?.reviews.find(row => row.id === command.id && row.nodeId === nodeId && row.status === "pending");
      const previous = attempt.current;
      const locked = previous && data?.reviews.some(row => row.id === previous.id && row.status === "pending");
      if (locked || !fresh() || !data?.canReview || !reviewed || checkpoint && !reviewed.reviewHash)
        throw new Error("Review access changed");
      // If storage is unavailable, refuse before dispatch rather than lose the
      // only local unknown-outcome fence across session checks and reloads.
      sessionStorage.setItem(storageKey, JSON.stringify({ ...command, expiresAt: Date.now() + 86400000 }));
      attempt.current = command; setReviewChanged(false);
      return authority.write(async () => {
        if (checkpoint) {
          const value = await approvalsApi[command.decision === "approve" ? "approve" : "reject"](command.id, undefined, principal, reviewed.reviewHash);
          if (value.id !== checkpoint.approvalId || value.companyId !== companyId || value.type !== "workflow_step_approval" ||
            value.payload.workflowNodeId !== checkpoint.nodeId || value.payload.workflowId !== checkpoint.workflowId || value.payload.workflowRunId !== runId || value.payload.workflowRevisionId !== checkpoint.revisionId)
            throw new Error("Checkpoint acknowledgement changed scope");
        } else await workflowsApi.resolveToolReview(companyId, runId, command.id, command.decision, principal);
        // Do not retain the Original run's private inputs/outputs in this control.
        return { companyId, runId, requestId: command.id };
      });
    },
    onSuccess: value => {
      if (!current() || !authority.confirmed(value)) return;
      try { sessionStorage.removeItem(storageKey); } catch { /* A stale locator grants no effect. */ }
      attempt.current = null;
      setUnconfirmed(false);
      void client.invalidateQueries({ queryKey: key, exact: true });
      void client.invalidateQueries({ queryKey: queryKeys.workflows.run(companyId, runId) });
      void client.invalidateQueries({ queryKey: ["workflow-run-experience", companyId, principal], predicate: row => row.queryKey[4] === runId });
    },
    onError: error => {
      const details = error instanceof ApiError ? error.body as { details?: { code?: unknown } } | null : null;
      if (checkpoint && error instanceof ApiError && error.status === 409 && details?.details?.code === "approval_review_changed") {
        try { sessionStorage.removeItem(storageKey); } catch { /* No effect was admitted. */ }
        attempt.current = null;
        if (current()) { setUnconfirmed(false); setReviewChanged(true); void client.resetQueries({ queryKey: key, exact: true }); }
      } else if (current()) setUnconfirmed(Boolean(attempt.current));
    },
  });
  useEffect(() => {
    if (!fresh()) return;
    if (restoreStatusFocus.current && statusButton.current) { statusButton.current.focus(); restoreStatusFocus.current = false; }
    const previous = attempt.current;
    const observed = previous && query.data?.reviews.find(row => row.id === previous.id && row.nodeId === nodeId);
    if (!observed || observed.status === "pending" || !requestStatuses.has(observed.status)) return;
    // A current Original state is evidence about the request, not proof of the
    // acting Human or of a verified business outcome. Never infer from absence.
    try { sessionStorage.removeItem(storageKey); } catch { /* A stale locator grants no effect. */ }
    attempt.current = null; setUnconfirmed(false); mutation.reset();
  }, [query.data, query.isFetching, authority.epoch, epoch]);
  if (!current() || query.isPending || query.isFetching) return <p role="status">{t("loading")}</p>;
  if (query.isError || !fresh()) return <div role="alert" className="space-y-3">
    <p>{t("workflowToolReview.unavailable")}</p>
    <Button className="min-h-11" onClick={() => void query.refetch()}>{t("tryAgain")}</Button>
  </div>;
  const reviews = query.data!.reviews.filter(review => review.nodeId === nodeId);
  const unknown = unconfirmed || (!!attempt.current && !mutation.isPending);
  const decisionLocked = !!attempt.current && reviews.some(row => row.id === attempt.current!.id && row.status === "pending");
  return <section aria-label={t(checkpoint ? "workflowToolReview.checkpointHeading" : "workflowToolReview.heading")} className="space-y-3">
    {(reviewChanged || unknown || mutation.isError) && <p role="alert">{t(reviewChanged ? "workflowToolReview.changed" : unknown ? "workflowToolReview.unconfirmed" : "workflowToolReview.unavailable")}</p>}
    <Button ref={statusButton} className="min-h-11" variant="outline" disabled={mutation.isPending} onClick={() => { restoreStatusFocus.current = true; void query.refetch(); }}>{t("workflowToolReview.check")}</Button>
    {reviews.length === 0 && <p role="status">{t("workflowToolReview.noPending")}</p>}
    {reviews.map(review => <div key={review.id} className="space-y-3 rounded-md border border-border p-3">
      <h3 className="break-words font-medium">{review.toolName}</h3>
      <p>{t("workflowToolReview.statusLabel")}: {t(`workflowToolReview.statuses.${requestStatuses.has(review.status) ? review.status : "unknown"}`)}</p>
      <p className="whitespace-pre-wrap break-words">{review.preview ?? t("workflowToolReview.preview")}</p>
      {review.argumentsSummary?.summary && <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{review.argumentsSummary.summary}</pre>}
      <p>{t(checkpoint ? "workflowToolReview.checkpointBoundary" : "workflowToolReview.boundary")}</p>
      {review.approvalId && <Link className="inline-flex min-h-11 items-center underline" to={`/approvals/${review.approvalId}`}>{t("workflowToolReview.board")}</Link>}
      {query.data!.canReview && review.status === "pending" && <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" disabled={mutation.isPending || decisionLocked} onClick={() => mutation.mutate({ id: review.id, decision: "approve" })}>{t(checkpoint ? "workflowToolReview.approveCheckpoint" : "workflowToolReview.approve")}</Button>
        <Button className="min-h-11" variant="outline" disabled={mutation.isPending || decisionLocked} onClick={() => mutation.mutate({ id: review.id, decision: "reject" })}>{t(checkpoint ? "workflowToolReview.rejectCheckpoint" : "workflowToolReview.reject")}</Button>
      </div>}
    </div>)}
  </section>;
}
