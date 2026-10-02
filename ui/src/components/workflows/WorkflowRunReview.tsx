import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowsApi } from "@/api/workflows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkflowRunReview({ companyId, runId }: { companyId: string; runId: string }) {
  const client = useQueryClient();
  const [corrected, setCorrected] = useState(false);
  const [outputs, setOutputs] = useState("{}");
  const [reason, setReason] = useState("");
  const key = ["workflow-run-review", companyId, runId];
  const review = useQuery({ queryKey: key, queryFn: () => workflowsApi.runReview(companyId, runId) });
  const access = useQuery({ queryKey: ["workflow-capabilities", companyId], queryFn: () => workflowsApi.capabilities(companyId) });
  const save = useMutation({ mutationFn: async () => {
    const correctedOutputs: unknown = corrected ? JSON.parse(outputs) : {};
    if (!correctedOutputs || typeof correctedOutputs !== "object" || Array.isArray(correctedOutputs)) throw new Error("Corrections must be a JSON object keyed by node ID.");
    return workflowsApi.reviewRun(companyId, runId, { humanCorrection: corrected, correctedOutputs: correctedOutputs as Record<string, unknown>, reason });
  }, onSuccess: (data) => { client.setQueryData(key, data); } });
  const error = review.error ?? access.error ?? save.error;
  return <section aria-label="Workflow result review" className="space-y-3 rounded-lg border border-border p-4">
    <h2 className="text-sm font-semibold">Result review</h2>
    <p className="text-xs text-muted-foreground">Confirm whether this run required a human correction. Optimizer evidence uses this recorded review; an unreviewed run has an unknown correction rate.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Review unavailable."}</p>}
    {review.data ? <div className="space-y-2"><p className="text-sm">{review.data.humanCorrection ? "Reviewed with corrections" : "Reviewed without corrections"}</p>
      <p className="text-xs text-muted-foreground">{review.data.reason}</p>
      {review.data.humanCorrection && <details><summary className="cursor-pointer text-xs font-medium">Corrected node outputs</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(review.data.correctedOutputs, null, 2)}</pre></details>}
    </div> : access.data?.publish ? <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={corrected} disabled={save.isPending} onChange={(event) => setCorrected(event.target.checked)} />Human correction required</label>
      {corrected && <label className="block space-y-1 text-sm">Corrected outputs by node ID<textarea aria-label="Corrected node outputs JSON" className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs" rows={5} disabled={save.isPending} value={outputs} onChange={(event) => setOutputs(event.target.value)} /></label>}
      <label className="block space-y-1 text-sm">Review reason<Input value={reason} disabled={save.isPending} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">The accepted review is immutable and records your identity. It does not replace the original execution history.</p>
      <Button disabled={save.isPending || !reason.trim()} onClick={() => save.mutate()}>Confirm result review</Button>
    </div> : review.isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading review…</p> : <p className="text-xs text-muted-foreground">A workflow publisher can record this review.</p>}
  </section>;
}
