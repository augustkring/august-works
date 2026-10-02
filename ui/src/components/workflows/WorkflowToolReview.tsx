import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowsApi } from "@/api/workflows";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";

export function WorkflowToolReview({ companyId, runId, nodeId }: { companyId: string; runId: string; nodeId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const key = ["workflow-tool-reviews", companyId, runId];
  const query = useQuery({ queryKey: key, queryFn: () => workflowsApi.toolReviews(companyId, runId), refetchInterval: 1_500 });
  const mutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      workflowsApi.resolveToolReview(companyId, runId, id, decision),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.workflows.run(companyId, runId), detail);
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading action review…</p>;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">Action review could not be loaded.</p>;
  return <div className="space-y-3">{query.data?.reviews.filter((review) => review.nodeId === nodeId).map((review) => (
    <div key={review.id} className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">Review {review.toolName}</p>
      <p className="whitespace-pre-wrap text-sm">{review.preview ?? "Review this connected action before allowing execution."}</p>
      {review.argumentsSummary?.summary && <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{review.argumentsSummary.summary}</pre>}
      <p className="text-xs text-muted-foreground">Approval executes the reviewed arguments once. Rejecting stops this workflow.</p>
      {review.approvalId && <Button size="sm" variant="outline" onClick={() => navigate(`/approvals/${review.approvalId}`)}>Open board approval</Button>}
      {query.data?.canReview && review.status === "pending" && <div className="flex gap-2">
        <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: review.id, decision: "approve" })}>Approve action</Button>
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: review.id, decision: "reject" })}>Reject action</Button>
      </div>}
      {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    </div>
  ))}</div>;
}
