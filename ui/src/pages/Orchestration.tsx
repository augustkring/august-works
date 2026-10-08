import { withV7AccountScope, useV7AccountScope } from "@/context/V7AccountScope";
import { OrchestrationVerification } from "@/components/OrchestrationVerification";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { READINESS_ACTIONS, type ReadinessAction, type CreateOrchestrationPlanInput } from "@paperclipai/shared";

function OrchestrationContent() {
  const queryClient = useQueryClient();
  const { principalId, orchestrationApi, workflowsApi, issuesApi } = useV7AccountScope();
  const { selectedCompanyId: companyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const [selected, setSelected] = useState(""), [taskId, setTaskId] = useState(""), [objective, setObjective] = useState(""), [output, setOutput] = useState("result"), [invariant, setInvariant] = useState(""), [rationale, setRationale] = useState("");
  const [workload, setWorkload] = useState<"semantic" | "decomposable" | "long_running" | "deterministic">("semantic"), [actionClass, setActionClass] = useState<ReadinessAction>("internal_draft"), [risk, setRisk] = useState<"C0" | "C1" | "C2" | "C3" | "C4">("C0"), [workflowId, setWorkflowId] = useState(""), [decompositionId, setDecompositionId] = useState(""), [runtimeOutcome, setRuntimeOutcome] = useState("");
  const [workers, setWorkers] = useState<Array<{ key: string; issueId: string; objective: string; output: string; dependsOn: string[] }>>([]);
  const [receiptTool, setReceiptTool] = useState(""), [receiptArgumentsHash, setReceiptArgumentsHash] = useState("");
  const [failureLimit,setFailureLimit] = useState(3), [checkLimit,setCheckLimit] = useState(100), [noProgressLimit,setNoProgressLimit] = useState(0);
  const [assessmentLimit,setAssessmentLimit] = useState(1);
  const [parallelism, setParallelism] = useState(1);
  const [retries, setRetries] = useState(1), [seconds, setSeconds] = useState(900), [toolActions, setToolActions] = useState(100);
  useEffect(() => setBreadcrumbs([{ label: "Orchestration" }]), [setBreadcrumbs]);
  useEffect(() => { setSelected(""); setTaskId(""); setObjective(""); setInvariant(""); setRationale(""); setRuntimeOutcome(""); setWorkers([]); setDecompositionId(""); setWorkflowId(""); setWorkload("semantic"); setActionClass("internal_draft"); setRisk("C0"); setReceiptTool(""); setReceiptArgumentsHash(""); }, [companyId]);
  const plans = useQuery({ queryKey: ["orchestration-plans", companyId, principalId], queryFn: () => orchestrationApi.list(companyId!), enabled: Boolean(companyId) });
  const tasks = useQuery({ queryKey: ["orchestration-tasks", companyId, principalId], queryFn: () => issuesApi.list(companyId!, { status: "todo,in_progress,in_review,blocked" }), enabled: Boolean(companyId) });
  const decompositions = useQuery({ queryKey: ["orchestration-decompositions", companyId, principalId, taskId], queryFn: () => issuesApi.listAcceptedPlanDecompositions(taskId), enabled: Boolean(companyId && taskId && workload === "decomposable") });
  const workflows = useQuery({ queryKey: ["orchestration-workflows", companyId, principalId], queryFn: () => workflowsApi.list(companyId!), enabled: Boolean(companyId && workload === "deterministic") });
  const detail = useQuery({ queryKey: ["orchestration-plan", companyId, principalId, selected], queryFn: () => orchestrationApi.get(companyId!, selected), enabled: Boolean(companyId && selected), refetchInterval: selected ? 10000 : false });
  useEffect(() => {
    if (detail.error || (detail.data && !detail.data.completionContract)) {
      setRationale(""); setRuntimeOutcome("");
      queryClient.removeQueries({ predicate: query => ["verification-packet", "verification-history"].includes(String(query.queryKey[0])) && query.queryKey[1] === companyId && query.queryKey[2] === principalId && query.queryKey[3] === selected });
    }
  }, [detail.data?.completionContract, detail.error, companyId, principalId, selected, queryClient]);
  const supervision = useQuery({ queryKey: ["orchestration-supervision", companyId, principalId,selected], queryFn: () => orchestrationApi.supervision(companyId!,selected), enabled: Boolean(companyId && selected), refetchInterval: selected ? 10000 : false });
  const intervention = useMutation({ mutationFn: (action: "STOP" | "RETRY" | "START_VERIFIER" | "STEER") => orchestrationApi.intervene(companyId!,selected,{ expectedPlanVersion: detail.data!.version, action, rationale }), onSuccess: () => { refresh(); setRationale(""); } });
  const refresh = () => { void plans.refetch(); void detail.refetch(); if (selected) void supervision.refetch(); };
  const create = useMutation({ mutationFn: () => {
    const task = tasks.data?.find(item => item.id === taskId); if (!task) throw new Error("Select a current canonical Task.");
    const accepted = decompositions.data?.find(row => row.id === decompositionId);
    if (workload === "decomposable" && !accepted) throw new Error("Select an already accepted Task decomposition.");
    const draft: CreateOrchestrationPlanInput = {
      issueId: task.id, expectedIssueUpdatedAt: new Date(task.updatedAt).toISOString(), riskClass: risk, actionClass, workload, workflowId: workload === "deterministic" ? workflowId : null,
      acceptedPlanRevisionId: accepted?.acceptedPlanRevisionId ?? null,
      completionContract: { objective, requiredOutputs: [{ key: output }], businessInvariants: [invariant], requiredPostconditions: actionClass === "internal_draft" ? [] : [{ kind: "tool_receipt", toolName: receiptTool, argumentsHash: receiptArgumentsHash, requireApproval: true }] },
      supervisionPolicy: { repeatedFailureThreshold: failureLimit, maxSupervisorChecks: checkLimit, noProgressSeconds: noProgressLimit || null, maxVerifierCalls: assessmentLimit },
      budgets: { maxWorkerCount: workload === "decomposable" ? workers.length : 1, maxParallelWorkers: workload === "decomposable" ? parallelism : 1, maxDelegationDepth: workload === "decomposable" ? 1 : 0, maxRetries: retries, maxWallClockSeconds: seconds, maxToolActions: toolActions },
      workers: workload === "decomposable" ? workers.map(worker => ({ key: worker.key, issueId: worker.issueId, dependsOn: worker.dependsOn, completionContract: { objective: worker.objective, requiredOutputs: [{ key: worker.output }], businessInvariants: [invariant] } })) : [{ key: "worker", issueId: task.id }],
    };
    return orchestrationApi.create(companyId!, draft);
  }, onSuccess: row => { setSelected(row.id); void plans.refetch(); } });
  const decision = useMutation({ mutationFn: (action: "start" | "pause" | "cancel") => {
    if (!detail.data) throw new Error("Select a plan.");
    return orchestrationApi.decide(companyId!, selected, { expectedVersion: detail.data.version, action, rationale });
  }, onSuccess: result => { setRuntimeOutcome(JSON.stringify(result.runtime, null, 2)); setRationale(""); refresh(); } });
  const errors = [plans.error, tasks.error, decompositions.error, workflows.error, detail.error, create.error, decision.error, supervision.error, intervention.error].filter(Boolean);
  if (!companyId) return <p>Select a company.</p>;
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Orchestration</h1><p className="text-sm text-muted-foreground">Plan bounded work on existing Tasks. Outputs, approvals and verification determine completion.</p></div>
    {errors.map((error, index) => <p key={index} role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Request failed"}</p>)}
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">New plan</h2>
      <label className="block text-sm">Task<select value={taskId} onChange={event => { setTaskId(event.target.value); setWorkers([]); setDecompositionId(""); }} className="block w-full rounded-md border border-input bg-background p-2"><option value="">Select an assigned Task</option>{tasks.data?.map(task => <option key={task.id} value={task.id}>{task.identifier}: {task.title}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Work shape<select value={workload} onChange={event => setWorkload(event.target.value as typeof workload)} className="block w-full rounded-md border border-input bg-background p-2"><option value="semantic">Single worker</option><option value="long_running">Supervised worker</option><option value="decomposable">Accepted parallel plan</option><option value="deterministic">Published Workflow</option></select></label>
        <label className="text-sm">Intended action<select value={actionClass} onChange={event => { const next = event.target.value as ReadinessAction; setActionClass(next); setRisk(next === "internal_draft" ? "C0" : ["external_communication", "data_mutation"].includes(next) ? "C2" : "C3"); }} className="block w-full rounded-md border border-input bg-background p-2">{READINESS_ACTIONS.map(action => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm">Consequence class<select value={risk} onChange={event => setRisk(event.target.value as typeof risk)} className="block w-full rounded-md border border-input bg-background p-2">{["C0", "C1", "C2", "C3", "C4"].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <label className="block text-sm">Objective<Input value={objective} onChange={event => setObjective(event.target.value)} /></label>
      <label className="block text-sm">Required coordinator Task document key<Input value={output} onChange={event => setOutput(event.target.value)} /></label>
      <label className="block text-sm">Business invariant<Input value={invariant} onChange={event => setInvariant(event.target.value)} /></label>
      {actionClass !== "internal_draft" && <div className="space-y-2 rounded-md border border-border p-3"><p className="text-sm">Completion requires the successful receipt for this exact approved action. Copy its name and arguments fingerprint from the native action review.</p><label className="block text-sm">Approved action name<Input value={receiptTool} onChange={event => setReceiptTool(event.target.value)} /></label><label className="block text-sm">Approved arguments fingerprint<Input value={receiptArgumentsHash} onChange={event => setReceiptArgumentsHash(event.target.value)} /></label></div>}
      {workload === "deterministic" && <label className="block text-sm">Workflow<select value={workflowId} onChange={event => setWorkflowId(event.target.value)} className="block w-full rounded-md border border-input bg-background p-2"><option value="">Select a published Workflow</option>{workflows.data?.filter(row => row.status === "active" && row.publishedRevisionId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
      {workload === "decomposable" && <div className="space-y-3">
        <p className="text-sm text-muted-foreground">First accept and decompose the plan on the Task. Every canonical child needs an explicit output and join.</p>
        <label className="block text-sm">Accepted decomposition<select value={decompositionId} onChange={event => { const accepted = decompositions.data?.find(row => row.id === event.target.value); setDecompositionId(event.target.value); setWorkers(accepted?.childIssues.map((child, index) => ({ key: `worker${index}`, issueId: child.id, objective: child.title, output: "result", dependsOn: [] })) ?? []); }} className="block w-full rounded-md border border-input bg-background p-2"><option value="">Select an accepted plan</option>{decompositions.data?.filter(row => row.status === "completed").map(row => <option key={row.id} value={row.id}>Plan revision {row.acceptedPlanRevisionNumber} · {row.childIssueIds.length} workers</option>)}</select></label>
        {workers.map((worker, index) => <div key={worker.issueId} className="space-y-2 rounded-md border border-border p-3"><Link to={`/issues/${worker.issueId}`}>{worker.key}: open Task</Link><label className="block text-sm">Worker objective<Input value={worker.objective} onChange={event => setWorkers(rows => rows.map((row, at) => at === index ? { ...row, objective: event.target.value } : row))} /></label><label className="block text-sm">Required output document<Input value={worker.output} onChange={event => setWorkers(rows => rows.map((row, at) => at === index ? { ...row, output: event.target.value } : row))} /></label><p className="text-sm">Start after these workers complete:</p>{workers.filter(peer => peer.key !== worker.key).map(peer => <label key={peer.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={worker.dependsOn.includes(peer.key)} onChange={event => setWorkers(rows => rows.map((row, at) => at === index ? { ...row, dependsOn: event.target.checked ? [...row.dependsOn, peer.key] : row.dependsOn.filter(key => key !== peer.key) } : row))} />{peer.key}</label>)}</div>)}
        <label className="block text-sm">Simultaneous workers<Input type="number" min={1} max={Math.min(16, workers.length || 1)} value={parallelism} onChange={event => setParallelism(Number(event.target.value))} /></label>
      </div>}
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Total retries<Input type="number" min={0} max={20} value={retries} onChange={event => setRetries(Number(event.target.value))} /></label><label className="text-sm">Time limit (seconds)<Input type="number" min={30} max={86400} value={seconds} onChange={event => setSeconds(Number(event.target.value))} /></label><label className="text-sm">Platform tool actions<Input type="number" min={0} max={10000} value={toolActions} onChange={event => setToolActions(Number(event.target.value))} /></label></div>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Repeated failure threshold<Input type="number" min={2} max={20} value={failureLimit} onChange={event => setFailureLimit(Number(event.target.value))} /></label><label className="text-sm">Supervision check limit<Input type="number" min={1} max={10000} value={checkLimit} onChange={event => setCheckLimit(Number(event.target.value))} /></label><label className="text-sm">No-progress limit (seconds, 0 disables)<Input type="number" min={0} max={86400} value={noProgressLimit} onChange={event => setNoProgressLimit(Number(event.target.value))} /></label></div>
      <label className="block text-sm">Independent assessment call limit<Input type="number" min={0} max={10} value={assessmentLimit} onChange={event => setAssessmentLimit(Number(event.target.value))} /><span className="text-muted-foreground">Shared by qualified trajectory and result assessments. Model assessments still require human review for completion.</span></label>
      <div className="flex items-center justify-between"><Button variant="outline" onClick={() => { setTaskId(""); setWorkers([]); setDecompositionId(""); }}>Cancel</Button><Button disabled={!taskId || create.isPending} onClick={() => create.mutate()}>Save plan</Button></div>
    </section>
    <section className="space-y-2"><h2 className="font-medium">Saved plans</h2>{plans.isPending ? <p role="status">Loading…</p> : plans.data?.length === 0 ? <p className="text-sm text-muted-foreground">No plans yet.</p> : plans.data?.map(plan => <Button key={plan.id} variant={selected === plan.id ? "secondary" : "outline"} onClick={() => { setSelected(plan.id); setRationale(""); setRuntimeOutcome(""); }}>{plan.mode} · {plan.riskClass} · {plan.status}</Button>)}</section>
    {detail.data && !detail.error && <section className="space-y-3 rounded-lg border border-border p-4"><div className="flex items-center gap-2"><h2 className="font-medium">{detail.data.completionContract?.objective ?? "Source content is unavailable"}</h2><Badge variant="outline">{detail.data.status}</Badge></div>
      <Link to={`/issues/${detail.data.issueId}`}>Open coordinator Task</Link>
      <p className="text-sm">Limits: {detail.data.budgets.maxParallelWorkers} simultaneous workers, {detail.data.budgets.maxRetries} total retries, {detail.data.budgets.maxWallClockSeconds} seconds from first start, {detail.data.budgets.maxToolActions} platform tool actions.</p>
      {!detail.data.completionContract && <p role="status" className="text-sm text-muted-foreground">Review current source access before continuing. You can still pause or stop this plan.</p>}
      {detail.data.completionContract?.businessInvariants.map((value, index) => <p key={index} className="text-sm">Invariant: {value}</p>)}
      {detail.data.workers.map(worker => <div key={worker.id} className="rounded-md border border-border p-3"><Link to={`/issues/${worker.issueId}`}>{worker.workerKey}</Link><p className="text-sm text-muted-foreground">{worker.status} · {worker.attemptCount} attempts · waits for {worker.dependsOn.join(", ") || "no dependencies"}</p>{detail.data!.attempts.filter(attempt => attempt.workerId === worker.id).map(attempt => <p key={attempt.id} className="text-xs">Attempt {attempt.attempt}: {attempt.status} · {attempt.runId ?? attempt.workflowRunId}</p>)}</div>)}
      <div className="space-y-2"><h3 className="font-medium">Supervision</h3><p className="text-sm text-muted-foreground">Signals reference saved outputs, execution receipts and current permissions. A successful worker run still needs verification.</p>
        {supervision.data?.sessions.map(session => <p key={session.id} className="text-sm">{session.status} · failure threshold {session.policy.repeatedFailureThreshold} · no-progress limit {session.policy.noProgressSeconds === null ? "not configured" : `${session.policy.noProgressSeconds} seconds`}</p>)}
        {supervision.data?.signals.map(signal => <p key={signal.id} className="text-sm">{signal.modelReservationId ? `Model trajectory: ${String(signal.facts.verdict ?? "uncertain").replaceAll("_"," ")} · advisory` : signal.signalType.replaceAll("_"," ")} · {signal.severity} · {new Date(signal.observedAt).toLocaleString()}</p>)}
        {supervision.data?.interventions.map(row => <p key={row.id} className="text-sm">{row.recommendation} → {row.decisionAction} · {row.status} · {row.reasonCode.replaceAll("_"," ")}</p>)}
      </div>
      <label className="block text-sm">Decision rationale<Input value={rationale} onChange={event => setRationale(event.target.value)} /></label>
      <div className="flex items-center justify-between"><div className="flex gap-2"><Button variant="outline" disabled={decision.isPending || rationale.trim().length < 20} onClick={() => decision.mutate("cancel")}>Cancel plan</Button><Button variant="outline" disabled={decision.isPending || rationale.trim().length < 20} onClick={() => decision.mutate("pause")}>Pause</Button></div><Button disabled={!detail.data.completionContract || decision.isPending || rationale.trim().length < 20 || !["draft", "ready", "paused"].includes(detail.data.status)} onClick={() => decision.mutate("start")}>Start / resume</Button></div>
      <div className="flex flex-wrap gap-2">{(["STOP","RETRY","START_VERIFIER","STEER"] as const).map(action => <Button key={action} variant="outline" disabled={intervention.isPending || rationale.trim().length < 20 || (!detail.data.completionContract && !["STOP", "STEER"].includes(action))} onClick={() => intervention.mutate(action)}>{action === "STEER" ? "Pause for guidance" : action === "START_VERIFIER" ? "Request verification" : action === "RETRY" ? "Retry within limits" : "Stop workers"}</Button>)}</div>
      {detail.data.completionContract && <OrchestrationVerification key={`${companyId}:${selected}:${detail.data.version}`} companyId={companyId} plan={detail.data} onReviewed={refresh} />}
      {runtimeOutcome && <div role="status"><p className="text-sm">Runtime dispatch / Stop result</p><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{runtimeOutcome}</pre></div>}
    </section>}
  </div>;
}

export const Orchestration = withV7AccountScope(OrchestrationContent);
