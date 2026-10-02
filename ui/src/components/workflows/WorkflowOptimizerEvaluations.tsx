import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkflowOptimizerCandidateRequest, WorkflowOptimizerSuggestion } from "@paperclipai/shared";
import { workflowsApi } from "@/api/workflows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "@/lib/router";

export function WorkflowOptimizerCandidateForm({ companyId, workflowId, suggestion }: {
  companyId: string; workflowId: string; suggestion: WorkflowOptimizerSuggestion;
}) {
  const client = useQueryClient();
  const [contract, setContract] = useState("");
  const capabilities = useQuery({ queryKey: ["workflow-capabilities", companyId], queryFn: () => workflowsApi.capabilities(companyId) });
  const propose = useMutation({ mutationFn: () => workflowsApi.proposeOptimizerCandidate(companyId, workflowId, suggestion.id),
    onSuccess: (value) => setContract(JSON.stringify(value, null, 2)) });
  const compile = useMutation({ mutationFn: async () => {
    const request: unknown = JSON.parse(contract);
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Enter a candidate contract as a JSON object.");
    return workflowsApi.compileOptimizerCandidate(companyId, workflowId, suggestion.id, request as WorkflowOptimizerCandidateRequest);
  }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["optimizer-evaluations", companyId, workflowId] }); } });
  if (suggestion.operationTypes.length !== 1 || suggestion.operationTypes[0] !== "core.transform" || suggestion.sideEffectRisk !== "low") {
    return <p className="mt-3 text-xs text-muted-foreground">This span requires a reviewed replacement plan. Live qualification currently supports a single pure transform.</p>;
  }
  if (!capabilities.data?.publish) return null;
  return <details className="mt-3 border-t border-border pt-3">
    <summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Qualify a replacement</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">Provide source code, input and output schemas, critical business invariants, and boundary and shape-variant fixtures. The server compares the candidate against reviewed historical runs and the original transform. Qualification does not activate it.</p>
      <Button size="sm" variant="outline" disabled={propose.isPending || compile.isPending || Boolean(compile.data)} onClick={() => propose.mutate()}>{propose.isPending ? "Generating…" : "Generate from reviewed runs"}</Button>
      {propose.error && <p role="alert" className="text-xs text-destructive">{propose.error.message}</p>}
      <p className="text-xs text-muted-foreground">Generated contracts preserve the published mapping. Review the examples and add any required business constraints before qualification.</p>
      <label className="block space-y-1 text-xs">Candidate contract JSON
        <textarea value={contract} onChange={(event) => setContract(event.target.value)} disabled={compile.isPending} rows={12}
          className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          placeholder={'{"kind":"transform","sourceCode":"…","inputSchema":{},"outputSchema":{},"invariants":[{"id":"…","description":"…","critical":true,"expression":"…"}],"cases":[{"id":"…","category":"boundary","input":{}},{"id":"…","category":"shape_variant","input":{}}]}'} />
      </label>
      {compile.error && <p role="alert" className="text-xs text-destructive">{compile.error.message}</p>}
      {compile.data && <p role="status" className="text-xs">{compile.data.gatesPassed ? "Qualification passed. Review the evaluation before starting shadow execution." : `Qualification failed: ${compile.data.replayEvaluation.reasonCode}. Review the evaluation results.`}</p>}
      <div className="flex justify-end"><Button size="sm" disabled={compile.isPending || !contract.trim() || Boolean(compile.data)} onClick={() => compile.mutate()}>{compile.isPending ? "Evaluating…" : "Compile and run replay"}</Button></div>
    </div>
  </details>;
}

export function WorkflowOptimizerEvaluations({ companyId, workflowId }: { companyId: string; workflowId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const key = ["optimizer-evaluations", companyId, workflowId];
  const query = useQuery({ queryKey: key, queryFn: () => workflowsApi.optimizerEvaluations(companyId, workflowId), refetchInterval: 5_000 });
  const capabilities = useQuery({ queryKey: ["workflow-capabilities", companyId], queryFn: () => workflowsApi.capabilities(companyId) });
  const action = useMutation({ mutationFn: ({ id, name }: { id: string; name: Parameters<typeof workflowsApi.optimizerAction>[3] }) =>
    workflowsApi.optimizerAction(companyId, workflowId, id, name), onSuccess: () => { void client.invalidateQueries({ queryKey: key }); } });
  if (query.isLoading) return <p role="status" className="text-xs text-muted-foreground">Loading candidate evaluations…</p>;
  if (query.error) return <div role="alert" className="space-y-2 text-xs"><p className="text-destructive">{query.error.message}</p><Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry evaluations</Button></div>;
  if (!query.data?.length) return null;
  return <section aria-label="Optimizer candidate evaluations" className="space-y-3">
    <h3 className="text-xs font-semibold">Candidate evaluations</h3>
    {action.error && <p role="alert" className="text-xs text-destructive">{action.error.message}</p>}
    {action.data?.decision && <p role="status" className="text-xs">{action.data.decision.reasonCode.replaceAll("_", " ")}</p>}
    {query.data.map((evaluation) => <article key={evaluation.id} className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">Replacement for {evaluation.nodeId}</p><Badge variant="outline">{evaluation.status}</Badge></div>
      <p className="text-xs text-muted-foreground">Replay: {evaluation.replayEvaluation?.status ?? "pending"} · shadow: {evaluation.shadowEvaluation.passedObservationCount} passed, {evaluation.shadowEvaluation.failedObservationCount} failed · canary: {evaluation.committedCanaryCount} accepted · fallback: {evaluation.fallbackCount}</p>
      <p className="text-xs text-muted-foreground">{evaluation.status === "shadow" ? "The original published transform supplies every result while the candidate is observed." : evaluation.status === "canary" ? `${evaluation.canaryTrafficPercent}% of runs are eligible for the candidate. Activation requires at least ten accepted candidate runs.` : evaluation.status === "active" ? "The qualified candidate is active. Candidate failure or an unknown input shape restores the original transform." : evaluation.status === "degraded" || evaluation.status === "retired" ? "The original published transform supplies results." : "Review qualification before starting shadow execution."}</p>
      {evaluation.lastErrorCode && <p className="text-xs text-destructive">Last candidate issue: {evaluation.lastErrorCode.replaceAll("_", " ")}</p>}
      <details><summary className="cursor-pointer rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Replay case results</summary>
        <ul className="mt-2 space-y-1 text-xs">{evaluation.replayEvaluation?.caseResults.map((item) => <li key={item.id}>{item.id}: {item.status} ({item.differenceSummary})</li>)}</ul>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => navigate(`/automation-artifacts?artifactId=${evaluation.artifactId}`)}>Review artifact</Button>
        {evaluation.approvalId && <Button size="sm" variant="outline" onClick={() => navigate(`/approvals/${evaluation.approvalId}`)}>Review promotion approval</Button>}
        {capabilities.data?.publish && <>
          {(evaluation.status === "testing" || evaluation.status === "failed") && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ id: evaluation.id, name: "evaluate" })}>Run qualification again</Button>}
          {evaluation.status === "testing" && <Button size="sm" disabled={action.isPending || evaluation.replayEvaluation?.status !== "passed"} onClick={() => action.mutate({ id: evaluation.id, name: "shadow" })}>Start shadow</Button>}
          {evaluation.status === "shadow" && !evaluation.approvalId && <Button size="sm" disabled={action.isPending || evaluation.shadowEvaluation.status !== "passed"} onClick={() => action.mutate({ id: evaluation.id, name: "request-approval" })}>Request promotion approval</Button>}
          {evaluation.status === "shadow" && evaluation.approvalId && <Button size="sm" disabled={action.isPending} onClick={() => action.mutate({ id: evaluation.id, name: "canary" })}>Start approved canary</Button>}
          {evaluation.status === "canary" && <Button size="sm" disabled={action.isPending || evaluation.committedCanaryCount < 10} onClick={() => action.mutate({ id: evaluation.id, name: "activate" })}>Activate qualified candidate</Button>}
          {evaluation.status !== "retired" && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate({ id: evaluation.id, name: "retire" })}>Retire and use original transform</Button>}
        </>}
      </div>
    </article>)}
  </section>;
}
