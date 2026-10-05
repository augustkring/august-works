import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { OrchestrationPlanDetail, VerificationReviewInput } from "@paperclipai/shared";
import { orchestrationApi } from "@/api/orchestration";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function OrchestrationVerification({ companyId,plan,onReviewed }: { companyId: string;plan: OrchestrationPlanDetail;onReviewed: () => void }) {
  const [workerId,setWorkerId] = useState<string|null>(null), [objective,setObjective] = useState(false), [approval,setApproval] = useState(false), [rationale,setRationale] = useState(""), [uncertainty,setUncertainty] = useState(""), [verdict,setVerdict] = useState<VerificationReviewInput["result"]>("needs_human");
  const [judgements,setJudgements] = useState<Record<string,{ satisfied: boolean;ref: string }>>({});
  const packet = useQuery({ queryKey: ["verification-packet",companyId,plan.id,plan.version,workerId],queryFn: () => orchestrationApi.verificationPacket(companyId,plan.id,workerId) });
  const history = useQuery({ queryKey: ["verification-history",companyId,plan.id,plan.version],queryFn: () => orchestrationApi.verifications(companyId,plan.id) });
  const review = useMutation({ mutationFn: () => {
    const current = packet.data!;
    const collect = (prefix: string,values: string[]) => values.map((_,index) => ({ index,satisfied: judgements[`${prefix}:${index}`]?.satisfied ?? false,evidenceRefs: judgements[`${prefix}:${index}`]?.ref ? [judgements[`${prefix}:${index}`]!.ref] : [] }));
    return orchestrationApi.verify(companyId,plan.id,{ expectedPlanVersion: current.planVersion,workerId,expectedResultHash: current.resultHash,result: verdict,rationale,objectiveSatisfied: objective,businessInvariants: collect("invariant",current.contract.businessInvariants),evidenceRequirements: collect("evidence",current.contract.evidenceRequirements),prohibitedOutcomes: collect("prohibited",current.contract.prohibitedOutcomes),uncertainties: uncertainty.trim() ? [uncertainty.trim()] : [],explicitHighImpactApproval: approval });
  },onSuccess: () => { onReviewed(); void packet.refetch(); void history.refetch(); } });
  const trajectory = useMutation({ mutationFn: (offTrack: boolean) => { const current = packet.data!; return orchestrationApi.trajectory(companyId,plan.id,{ expectedPlanVersion: current.planVersion,workerId,expectedResultHash: current.resultHash,verdict: offTrack ? "off_track" : "possible_completion",reasonCode: offTrack ? "wrong_objective" : "result_ready_for_review",evidenceRefs: current.evidence.map(e => e.ref).slice(0,32),rationale }); },onSuccess: onReviewed });
  const group = (prefix: string,label: string,values: string[]) => values.map((value,index) => {
    const key = `${prefix}:${index}`, state = judgements[key] ?? { satisfied: false,ref: "" };
    return <div key={key} className="space-y-1 rounded-md border border-border p-2"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={state.satisfied} onChange={event => setJudgements(rows => ({ ...rows,[key]: { ...state,satisfied: event.target.checked } }))} />{label}: {value}</label><label className="block text-sm">Supporting evidence<select value={state.ref} onChange={event => setJudgements(rows => ({ ...rows,[key]: { ...state,ref: event.target.value } }))} className="block w-full rounded-md border border-input bg-background p-2"><option value="">Select reviewed evidence</option>{packet.data?.evidence.map((ref,at) => <option key={ref.ref} value={ref.ref}>{ref.type.replaceAll("_"," ")} {at+1} · {ref.sourceId.slice(0,8)}</option>)}</select></label></div>;
  });
  const active = ["running","paused","verifying"].includes(plan.status);
  return <section className="space-y-3 border-t border-border pt-4"><h3 className="font-medium">Independent review</h3><p className="text-sm text-muted-foreground">Review current Task outputs and their sources. Each conclusion needs evidence. Worker messages cannot approve completion.</p>
    <label className="block text-sm">Review target<select value={workerId ?? ""} onChange={event => { setWorkerId(event.target.value || null); setJudgements({}); setObjective(false); setApproval(false); setVerdict("needs_human"); }} className="block w-full rounded-md border border-input bg-background p-2"><option value="">Final coordinator result</option>{plan.workers.filter(w => w.issueId !== plan.issueId).map(w => <option key={w.id} value={w.id}>{w.workerKey}</option>)}</select></label>
    {[packet.error,history.error,review.error,trajectory.error].filter(Boolean).map((error,index) => <p key={index} role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Review could not be loaded"}</p>)}
    {packet.data && <><Link to={`/issues/${packet.data.issueId}`}>Open the Task outputs and sources</Link>
      {packet.data.deterministicFailures.map(reason => <p key={reason} className="text-sm text-muted-foreground">Unresolved: {reason.replaceAll("_"," ")}</p>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={objective} onChange={event => setObjective(event.target.checked)} />The saved result satisfies the objective</label>
      {group("invariant","Satisfied invariant",packet.data.contract.businessInvariants)}{group("evidence","Evidence requirement met",packet.data.contract.evidenceRequirements)}{group("prohibited","Confirmed absent",packet.data.contract.prohibitedOutcomes)}
      <label className="block text-sm">Material uncertainty<Input value={uncertainty} onChange={event => setUncertainty(event.target.value)} /></label><label className="block text-sm">Review rationale<Input value={rationale} onChange={event => setRationale(event.target.value)} /></label>
      {packet.data.policy.humanRequired && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approval} onChange={event => setApproval(event.target.checked)} />I explicitly approve this high-impact result and its declared action</label>}
      <label className="block text-sm">Verdict<select value={verdict} onChange={event => setVerdict(event.target.value as typeof verdict)} className="block w-full rounded-md border border-input bg-background p-2"><option value="needs_human">Needs human resolution</option><option value="inconclusive">Inconclusive</option><option value="fail">Fail</option><option value="pass">Pass</option></select></label>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!active || trajectory.isPending || rationale.trim().length<20 || !packet.data.evidence.length} onClick={() => trajectory.mutate(true)}>Off track: pause for guidance</Button><Button variant="outline" disabled={!active || trajectory.isPending || rationale.trim().length<20 || !packet.data.evidence.length} onClick={() => trajectory.mutate(false)}>Mark possible completion</Button><Button disabled={!active || review.isPending || rationale.trim().length<20} onClick={() => review.mutate()}>Record independent review</Button></div>
    </>}
    {history.data?.map(row => <p key={row.id} className="text-sm">{row.reviewerType === "model" ? `Model assessment: ${row.result.replaceAll("_", " ")} · human review required` : `${row.result} · ${row.reviewerType} reviewer`} · {row.erasedAt ? "source erased" : new Date(row.createdAt).toLocaleString()}</p>)}
  </section>;
}
