import { withV7AccountScope, useV7AccountScope } from "@/context/V7AccountScope";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningEvaluationInput, LearningChange, ManagementReviewSource, AnalyticalContextAuthorityPin } from "@paperclipai/shared";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { CognitivePurposeSelector } from "@/components/CognitivePurposeSelector";
import { LearningPolicyReview } from "@/components/LearningPolicyReview";
import {ManagementReviewSourcePicker} from "@/components/ManagementReviewSourcePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import {useSearchParams} from "react-router-dom";
import {analyticalContextAuthorityPinSchema} from "@paperclipai/shared";
import {adaptivePlanningApi} from "@/api/adaptive-planning";
import {decisionOutcomeReviewsApi} from "@/api/decision-outcome-reviews";
import {ApiError,isAnalyticalSourceAccessLost} from "@/api/client";
type Case = LearningEvaluationInput["cases"][number];
const unreviewed = () => ({ correctness: false, safety: false, policy: false, businessOutcome: 0, reliability: 0, latencyMs: null, costCents: null });
const emptyCase = (): Case => ({ baselineTaskId: "", challengerTaskId: "", baseline: unreviewed(), challenger: unreviewed(), invariantResults: [false], rationale: "" });
type Signal={id:number;source:ManagementReviewSource|null;valid:boolean};
function signalPin(source:ManagementReviewSource|null):AnalyticalContextAuthorityPin {
  if(source?.kind==="analytical")return {kind:"analytical_evidence",source:source.reference};
  if(source?.kind==="decision_outcome")return {kind:"outcome_review",decisionId:source.decisionId,revision:source.revision};
  throw new Error("Select a current analytical source or Decision outcome review.");
}
function OrganizationalLearningContent() {
  const cache=useQueryClient();
  const { principalId, learningApi, memoryApi, foundationApi, issuesApi } = useV7AccountScope();
  const { selectedCompanyId: companyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs();
  const [cycleId, setCycleId] = useState(""), [selected, setSelected] = useState<string[]>([]), [purpose, setPurpose] = useState("native_task_execution"), [trigger, setTrigger] = useState("");
  const [signals,setSignals]=useState<Signal[]>([]);
  const [searchParams,setSearchParams]=useSearchParams();
  const reviewRequested=["reviewDecisionId","reviewRevision","reviewCompanyId"].some(key=>searchParams.has(key)),reviewPin=analyticalContextAuthorityPinSchema.safeParse({kind:"outcome_review",decisionId:searchParams.get("reviewDecisionId"),revision:Number(searchParams.get("reviewRevision"))});
  const seededReview=reviewRequested&&searchParams.get("reviewCompanyId")===companyId&&reviewPin.success&&reviewPin.data.kind==="outcome_review"?reviewPin.data:null;
  const planningRequested=["planningCompanyId","planningProjectId","planningProposalId","planningManifestId"].some(key=>searchParams.has(key));
  const planningPin=analyticalContextAuthorityPinSchema.safeParse({kind:"planning_outcome",projectId:searchParams.get("planningProjectId"),proposalId:searchParams.get("planningProposalId"),manifestId:searchParams.get("planningManifestId")});
  const seededPlanning=planningRequested&&!reviewRequested&&searchParams.get("planningCompanyId")===companyId&&planningPin.success&&planningPin.data.kind==="planning_outcome"?planningPin.data:null;
  const account=principalId.startsWith("user:")?principalId.slice(5):undefined;
  const reviewSource=useQuery({queryKey:["learning-review-source",companyId,principalId,seededReview?.decisionId,seededReview?.revision],queryFn:()=>decisionOutcomeReviewsApi.detail(companyId!,seededReview!.decisionId,account),enabled:Boolean(companyId&&seededReview),retry:false,refetchInterval:30000});
  const planningSource=useQuery({queryKey:["learning-planning-source",companyId,principalId,seededPlanning?.projectId,seededPlanning?.proposalId,seededPlanning?.manifestId],queryFn:()=>adaptivePlanningApi.outcome(companyId!,seededPlanning!.projectId,seededPlanning!.proposalId,seededPlanning!.manifestId,account),enabled:Boolean(companyId&&seededPlanning),retry:false,refetchInterval:30000});
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  const validReview=seededReview&&reviewSource.data?.companyId===companyId&&reviewSource.data.decisionId===seededReview.decisionId&&reviewSource.data.revision===seededReview.revision&&["completed","inconclusive"].includes(reviewSource.data.status)&&reviewSource.data.receipts.length&&reviewSource.data.receipts.every(receipt=>Date.parse(receipt.expiresAt)>Math.max(now,Date.now()))?reviewSource.data:null;
  const currentReview=!reviewSource.isError&&!reviewSource.isFetching?validReview:null;
  const reviewAuthorityLost=reviewRequested&&(!seededReview||reviewSource.isError||Boolean(reviewSource.data&&!validReview));
  const validPlanning=seededPlanning&&planningSource.data?.manifestId===seededPlanning.manifestId&&planningSource.data.outcome.companyId===companyId&&planningSource.data.outcome.projectId===seededPlanning.projectId&&planningSource.data.outcome.proposalId===seededPlanning.proposalId&&Date.parse(planningSource.data.outcome.expiresAt)>Math.max(now,Date.now())?planningSource.data:null;
  const currentPlanning=!planningSource.isError&&!planningSource.isFetching?validPlanning:null;
  const planningAuthorityLost=planningRequested&&(!seededPlanning||planningSource.isError||Boolean(planningSource.data&&!validPlanning));
  const cycleFromUrl=searchParams.get("cycleCompanyId")===companyId&&/^[a-f0-9-]{36}$/i.test(searchParams.get("cycleId")??"")?searchParams.get("cycleId"):null;

  const updateSignal=(id:number,patch:Partial<Signal>)=>setSignals(rows=>rows.some(row=>row.id===id&&Object.entries(patch).some(([key,value])=>row[key as keyof Signal]!==value))?rows.map(row=>row.id===id?{...row,...patch}:row):rows);
  const [targetId, setTargetId] = useState(""), [body, setBody] = useState(""), [claim, setClaim] = useState(""), [effect, setEffect] = useState(""), [invariant, setInvariant] = useState(""), [rollback, setRollback] = useState(""), [reason, setReason] = useState("");
  const [hypothesisId, setHypothesisId] = useState(""), [prepared, setPrepared] = useState<LearningChange | null>(null), [cases, setCases] = useState<Case[]>([emptyCase(), emptyCase()]), [limitations, setLimitations] = useState(""), [closeRationale, setCloseRationale] = useState("");
  useEffect(() => setBreadcrumbs([{ label: "Memory", href: "/memory" }, { label: "Organizational Learning" }]), [setBreadcrumbs]);
  useEffect(() => { setCycleId(""); setSelected([]); setTargetId(""); setBody(""); setClaim(""); setEffect(""); setReason(""); setInvariant(""); setRollback(""); setTrigger(""); setPrepared(null); setHypothesisId(""); setCases([emptyCase(), emptyCase()]); setLimitations(""); setCloseRationale(""); }, [companyId]);
  useEffect(()=>setSignals([]),[companyId]);
  useEffect(()=>{if(cycleFromUrl)setCycleId(cycleFromUrl);},[companyId,cycleFromUrl]);
  useEffect(()=>{if(reviewAuthorityLost||planningAuthorityLost){setSelected([]);setTrigger("");}},[reviewAuthorityLost,planningAuthorityLost]);
  useEffect(()=>{
    const revoked=()=>{
      setSelected([]);setTrigger("");setSignals([]);setPrepared(null);setHypothesisId("");setBody("");setClaim("");setEffect("");setReason("");setCases([emptyCase(),emptyCase()]);setLimitations("");setCloseRationale("");
      for(const owner of ["learning-review-source","learning-planning-source","learning-cycles","learning-cycle","learning-roots","learning-foundation","learning-outcomes"])void cache.resetQueries({queryKey:[owner,companyId,principalId]});
    };
    window.addEventListener("memory-access-changed",revoked);return()=>window.removeEventListener("memory-access-changed",revoked);
  },[cache,companyId,principalId]);
  const cycles = useQuery({ queryKey: ["learning-cycles", companyId, principalId], queryFn: () => learningApi.list(companyId!), enabled: Boolean(companyId),refetchInterval:30000 });
  const detail = useQuery({ queryKey: ["learning-cycle", companyId, principalId, cycleId], queryFn: () => learningApi.get(companyId!, cycleId), enabled: Boolean(companyId && cycleId),refetchInterval:30000,retry:(count,error)=>!isAnalyticalSourceAccessLost(error)&&!(error instanceof ApiError&&[403,404,409].includes(error.status))&&count<3 });
  const currentDetail=detail.isError||detail.isFetching?undefined:detail.data;
  useEffect(()=>{if(isAnalyticalSourceAccessLost(detail.error)||detail.error instanceof ApiError&&[403,404,409].includes(detail.error.status)){setTrigger("");setSelected([]);setSignals([]);setPrepared(null);setHypothesisId("");setBody("");setClaim("");setEffect("");setReason("");setCases([emptyCase(),emptyCase()]);setLimitations("");}},[detail.error]);
  const sources = useQuery({ queryKey: ["learning-roots", companyId, principalId], queryFn: () => memoryApi.listRecords(companyId!, { reviewState: "accepted", limit: 100 }), enabled: Boolean(companyId) });
  const foundation = useQuery({ queryKey: ["learning-foundation", companyId, principalId], queryFn: () => foundationApi.list(companyId!), enabled: Boolean(companyId) });
  const tasks = useQuery({ queryKey: ["learning-outcomes", companyId, principalId], queryFn: () => issuesApi.list(companyId!, { status: "done" }), enabled: Boolean(companyId) });
  const refresh = () => { void cycles.refetch(); void detail.refetch(); };
  const create = useMutation({ mutationFn: () => {
    if(signals.some(row=>!row.valid))throw new Error("Recheck every selected analytical source before starting the cycle.");
    if(planningRequested){
      if(!currentPlanning||!seededPlanning)throw new Error("Recheck the current native planning outcome before starting Learning.");
      return adaptivePlanningApi.startOutcomeLearning(companyId!,seededPlanning.projectId,seededPlanning.proposalId,{manifestId:seededPlanning.manifestId,purpose,trigger,memoryRecordIds:selected},account).then(result=>({id:result.cycleId}));
    }
    if(reviewRequested){
      if(!currentReview)throw new Error("Recheck the current outcome review before starting Learning.");
      return decisionOutcomeReviewsApi.startLearning(companyId!,currentReview.decisionId,{expectedRevision:currentReview.revision,purpose,trigger,memoryRecordIds:selected},account).then(result=>({id:result.cycleId}));
    }
    return learningApi.create(companyId!, { scope: { type: "company", id: null }, purpose, trigger, memoryRecordIds: selected,...(signals.length?{analyticalSources:signals.map(row=>signalPin(row.source))}:{}) });
  }, onSuccess: (row) => { setSignals([]);setCycleId(row.id);if(reviewRequested||planningRequested)setSearchParams({cycleId:row.id,cycleCompanyId:companyId!}); refresh(); } });
  const hypothesis = useMutation({ mutationFn: async () => {
    const target = foundation.data?.find((row) => row.id === targetId); if (!target?.latestRevisionId || !currentDetail) throw new Error("Select a current Foundation document and cycle.");
    const proposal = await learningApi.prepare(companyId!, { targetDomain: "foundation", baseRevisionId: target.latestRevisionId, proposedBody: body, reason });
    const row = await learningApi.hypothesis(companyId!, cycleId, { expectedCycleVersion: currentDetail.version, claim, predictedEffect: effect, targetDomain: "foundation", targetId, riskClass: "material",
      evaluationContract: { expectedImprovement: effect, protectedInvariants: [invariant], baselineRef: `foundation://${targetId}/${target.latestRevisionId}`, challengerHash: proposal.hash, minimumCases: 2, minimumQuality: 0.8, minimumImprovement: 0.05, rollbackPath: rollback } });
    setPrepared(proposal.change); return row;
  }, onSuccess: (row) => { setHypothesisId(row.id); refresh(); } });
  const chosen = currentDetail?.hypotheses.find((row) => row.id === hypothesisId);
  const restoreDraft = useMutation({ mutationFn: async () => {
    const target = foundation.data?.find((row) => row.id === chosen?.targetId);
    if (!chosen || chosen.targetDomain !== "foundation" || !target?.latestRevisionId) throw new Error("Select a Foundation hypothesis and re-enter its pinned draft and reason.");
    const proposal = await learningApi.prepare(companyId!, { targetDomain: "foundation", baseRevisionId: target.latestRevisionId, proposedBody: body, reason });
    if (proposal.hash !== chosen.evaluationContract.challengerHash) throw new Error("The entered draft differs from the evaluated change. Restore the original draft or evaluate a new hypothesis.");
    return proposal.change;
  }, onSuccess: setPrepared });
  const evaluate = useMutation({ mutationFn: () => {
    if (!chosen) throw new Error("Select a hypothesis first.");
    return learningApi.evaluate(companyId!, chosen.id, { expectedHypothesisVersion: chosen.version, method: "manual_review", cases, limitations: [limitations] });
  }, onSuccess: refresh });
  const propose = useMutation({ mutationFn: () => {
    const passed = currentDetail?.evaluations.find((row) => row.hypothesisId === hypothesisId && row.result === "passed");
    if (!chosen || !passed || !prepared) throw new Error("A retained passing review of this prepared change is required.");
    return learningApi.propose(companyId!, chosen.id, { expectedHypothesisVersion: chosen.version, evaluationId: passed.id, change: prepared });
  }, onSuccess: refresh });
  const finish = useMutation({ mutationFn: (decision: "complete" | "cancel") => {
    if (!currentDetail) throw new Error("Select a current cycle.");
    return learningApi.finish(companyId!, cycleId, { expectedVersion: currentDetail.version, decision, rationale: closeRationale });
  }, onSuccess: () => { setCloseRationale(""); refresh(); } });
  const setCase = (index: number, patch: Partial<Case>) => setCases((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const eligible = (sources.isError||sources.isFetching?undefined:sources.data)?.filter((row) => row.scopeType === "company" && row.retentionState === "active" && ["human_verified","system_verified","corroborated"].includes(row.verificationState) && !row.revokedAt && !row.deletedAt && !row.supersededByRecordId) ?? [];
  const errors = [cycles, detail, sources, foundation, tasks, create, hypothesis, restoreDraft, evaluate, propose, finish].filter((state) => state.isError);
  return <div className="space-y-6"><h1 className="text-xl font-semibold">Organizational Learning</h1><p className="text-muted-foreground">Use reviewed work outcomes to test a hypothesis. Safety, correctness and policy come before cost. Passing a comparison prepares a domain proposal for its normal human review.</p>
    {!companyId ? <p>Select a company first.</p> : <><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><h2 className="font-medium">Start from real outcomes</h2><CognitivePurposeSelector id="learning-purpose" value={purpose} onChange={setPurpose} /><label className="block space-y-2">Observed problem<Input value={trigger} onChange={(event) => setTrigger(event.target.value)} minLength={10} maxLength={1000} required /></label>
      <fieldset className="space-y-2"><legend>Accepted company Memory with verified completed Task evidence</legend>{eligible.map((row) => <label key={row.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id].slice(0, 32) : selected.filter((id) => id !== row.id))} /><span>{row.title ?? row.summary ?? row.content.slice(0, 100)} · <Link to={`/memory/${row.id}`}>Inspect evidence</Link></span></label>)}</fieldset>{planningRequested?<section aria-label="Planning outcome source" className="space-y-2"><h3 className="font-medium">Observed planning outcome</h3><p className="text-sm text-muted-foreground">This native completion signal supplements the independently verified Task outcomes you select. It establishes no causal effect.</p>{currentPlanning?<p>{currentPlanning.outcome.rationale}</p>:<p role="status">{planningSource.error?.message??(seededPlanning?"Rechecking current planning outcome authority…":"Open this planning outcome in its original company before starting Learning.")}</p>}<Button type="button" variant="outline" disabled={!seededPlanning||planningSource.isFetching} onClick={()=>void planningSource.refetch()}>Recheck planning outcome</Button></section>:reviewRequested?<section aria-label="Outcome review source" className="space-y-2"><h3 className="font-medium">Reviewed Decision lesson</h3><p className="text-sm text-muted-foreground">This exact review supplements the independently verified Task outcomes you select.</p>{currentReview?<p>{currentReview.receipts[0]?.assessment?.lessonSummary}</p>:<p role="status">{reviewSource.error?.message??(seededReview?"Rechecking current review authority…":"Open this review in its original company before starting Learning.")}</p>}<Button type="button" variant="outline" disabled={!seededReview||reviewSource.isFetching} onClick={()=>void reviewSource.refetch()}>Recheck outcome review</Button></section>:<fieldset className="space-y-3"><legend>Optional analytical signals</legend><p className="text-sm text-muted-foreground">Current metric, process, experiment, causal and Decision evidence can inform a hypothesis. Verified Task outcomes and independent human evaluation remain required.</p>{signals.map(row=><div key={row.id} className="space-y-2"><ManagementReviewSourcePicker companyId={companyId} userId={principalId.startsWith("user:")?principalId.slice(5):null} name={`Learning signal ${row.id}`} allowedKinds={["analytical","decision_outcome"]} value={row.source} onChange={source=>updateSignal(row.id,{source,valid:false})} onValidity={valid=>updateSignal(row.id,{valid})} onAuthorityLost={()=>updateSignal(row.id,{valid:false})}/><Button type="button" variant="ghost" onClick={()=>setSignals(rows=>rows.filter(item=>item.id!==row.id))}>Remove signal</Button></div>)}<Button type="button" variant="outline" disabled={signals.length>=8} onClick={()=>setSignals(rows=>[...rows,{id:Math.max(0,...rows.map(row=>row.id))+1,source:null,valid:false}])}>Add analytical signal</Button></fieldset>}<div className="flex items-center justify-between"><Link to="/memory">Back to Memory</Link><Button disabled={!selected.length || create.isPending || (reviewRequested&&!currentReview) || (planningRequested&&!currentPlanning) || signals.some(row=>!row.valid)}>Start bounded cycle</Button></div></form>
      <label className="block space-y-2">Learning cycle<select className="rounded-md border border-input bg-background p-2" value={cycleId} onChange={(event) => { setCycleId(event.target.value); setPrepared(null); setHypothesisId(""); }}><option value="">Select a cycle</option>{(cycles.isError?[]:cycles.data)?.map((row) => <option key={row.id} value={row.id}>{row.trigger} · {row.status}</option>)}</select></label>
      {currentDetail ? <><p>Hypothesis budget: {currentDetail.hypotheses.length}/{currentDetail.maxHypotheses} · Evaluation budget: {currentDetail.evaluations.length}/{currentDetail.maxEvaluations}</p>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); hypothesis.mutate(); }}><h2 className="font-medium">Prepare a Foundation hypothesis</h2><label className="block space-y-2">Target document<select className="rounded-md border border-input bg-background p-2" value={targetId} onChange={(event) => setTargetId(event.target.value)} required><option value="">Select a current document</option>{foundation.data?.filter((row) => row.latestRevisionId).map((row) => <option value={row.id} key={row.id}>{row.title ?? row.foundationKey} · {row.sensitivity}</option>)}</select></label>
          {[{ label: "Hypothesis", value: claim, set: setClaim }, { label: "Expected improvement", value: effect, set: setEffect }, { label: "Protected invariant", value: invariant, set: setInvariant }, { label: "Rollback path", value: rollback, set: setRollback }, { label: "Reason for changing the document", value: reason, set: setReason }].map((field) => <label key={field.label} className="block space-y-2">{field.label}<Input value={field.value} onChange={(event) => field.set(event.target.value)} required minLength={20} maxLength={2000} /></label>)}<label className="block space-y-2">Proposed document body<textarea className="w-full rounded-md border border-input bg-background p-2" value={body} onChange={(event) => setBody(event.target.value)} required maxLength={100000} /></label><div className="flex items-center justify-between"><span>Minimum two comparisons · Quality floor 80% · Improvement 5 percentage points</span><Button disabled={hypothesis.isPending || !targetId}>Pin hypothesis and challenger</Button></div></form>
        {currentDetail.hypotheses.map((row) => <section key={row.id} className="space-y-2"><h3 className="font-medium">{row.claim}</h3><Badge variant="outline">{row.status.replaceAll("_", " ")}</Badge><p>{row.predictedEffect}</p><p className="text-muted-foreground">{row.targetDomain} · {row.riskClass} · {row.evaluationContract.protectedInvariants.join("; ")}</p><Button variant="outline" onClick={() => { if (hypothesisId !== row.id) setPrepared(null); setHypothesisId(row.id); setCases([emptyCase(), emptyCase()].map((item) => ({ ...item, invariantResults: row.evaluationContract.protectedInvariants.map(() => false) }))); }}>Review paired outcomes</Button></section>)}
        {chosen ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); evaluate.mutate(); }}><h2 className="font-medium">Human review: {chosen.claim}</h2><p>This comparison records your judgement. It does not establish causation.</p>{cases.map((item, index) => <fieldset key={index} className="space-y-3 rounded-md border border-border p-4"><legend>Comparison {index + 1}</legend>{(["baseline", "challenger"] as const).map((arm) => <div key={arm} className="space-y-2"><label className="block">{arm === "baseline" ? "Baseline outcome" : "Challenger outcome"}<select className="rounded-md border border-input bg-background p-2" value={arm === "baseline" ? item.baselineTaskId : item.challengerTaskId} onChange={(event) => setCase(index, arm === "baseline" ? { baselineTaskId: event.target.value } : { challengerTaskId: event.target.value })} required><option value="">Select a completed Task</option>{tasks.data?.filter((row) => row.completedAt).map((row) => <option key={row.id} value={row.id}>{row.identifier} · {row.title}</option>)}</select></label>
          <div className="flex flex-wrap gap-4">{(["correctness", "safety", "policy"] as const).map((key) => <label key={key}><input type="checkbox" checked={item[arm][key]} onChange={(event) => setCase(index, { [arm]: { ...item[arm], [key]: event.target.checked } })} /> {key}</label>)}</div>{(["businessOutcome", "reliability"] as const).map((key) => <label key={key} className="block">{key === "businessOutcome" ? "Business outcome quality (0–1)" : "Reliability (0–1)"}<Input type="number" min={0} max={1} step={0.01} value={item[arm][key]} onChange={(event) => setCase(index, { [arm]: { ...item[arm], [key]: Number(event.target.value) } })} /></label>)}</div>)}
          {chosen.evaluationContract.protectedInvariants.map((text, i) => <label className="block" key={i}><input type="checkbox" checked={item.invariantResults[i] ?? false} onChange={(event) => setCase(index, { invariantResults: item.invariantResults.map((value, n) => n === i ? event.target.checked : value) })} /> Preserved: {text}</label>)}<label className="block space-y-2">Evidence and rationale<Input value={item.rationale} onChange={(event) => setCase(index, { rationale: event.target.value })} required minLength={20} maxLength={2000} /></label></fieldset>)}<label className="block space-y-2">Limitations<Input value={limitations} onChange={(event) => setLimitations(event.target.value)} required minLength={10} maxLength={1000} /></label><div className="flex items-center justify-between"><Button type="button" variant="outline" disabled={cases.length >= 32} onClick={() => setCases([...cases, { ...emptyCase(), invariantResults: chosen.evaluationContract.protectedInvariants.map(() => false) }])}>Add comparison</Button><Button disabled={evaluate.isPending || chosen.status === "proposal_created"}>Record human evaluation</Button></div></form> : null}
        {currentDetail.evaluations.map((row) => <section className="space-y-2" key={row.id}><Badge variant="outline">{row.result}</Badge><p>Reviewed by {row.reviewedBy} · {new Date(row.createdAt).toLocaleString()}</p>{row.limitations.map((text, index) => <p className="text-muted-foreground" key={index}>{text}</p>)}</section>)}
        {chosen?.status === "supported" && prepared ? <Button disabled={propose.isPending} onClick={() => propose.mutate()}>Create reviewed domain proposal</Button> : null}
        {chosen?.status === "supported" && chosen.targetDomain === "foundation" && !prepared ? <div className="space-y-2"><p>Re-enter the evaluated document body and change reason above to restore the pinned draft.</p><Button disabled={!body.trim() || reason.trim().length < 20 || restoreDraft.isPending} onClick={() => restoreDraft.mutate()}>Restore evaluated draft</Button></div> : null}
        {currentDetail.candidates.map((row) => <p key={row.id}>{row.erasedAt || row.invalidatedAt ? "Evidence requires revalidation" : row.promotionReceipt ? "Native domain promotion observed" : "Proposal created; separate domain approval remains required"} · <Link to={row.targetDomain === "foundation" ? `/foundation/${row.targetId}` : row.targetDomain === "skill" ? `/skills/${row.targetId}/governance` : row.targetDomain === "project" ? `/projects/${row.targetId}` : ["workflow", "automation_artifact"].includes(row.targetDomain) ? `/workflows/${row.targetId}` : row.targetDomain === "role_pack" ? "/role-packs" : "/memory"}>Open {row.targetDomain.replaceAll("_", " ")}</Link></p>)}
        {!["completed", "cancelled", "failed"].includes(currentDetail.status) ? <section className="space-y-3"><h2 className="font-medium">Close the cycle</h2><p className="text-muted-foreground">Completion checks the native domain's current promotion receipt for every proposal. Cancellation is available before a domain candidate is created.</p><label className="block space-y-2">Closure rationale<Input value={closeRationale} onChange={event => setCloseRationale(event.target.value)} minLength={20} maxLength={2000} /></label><div className="flex items-center justify-between"><Button variant="outline" disabled={currentDetail.candidates.length > 0 || closeRationale.trim().length < 20 || finish.isPending} onClick={() => finish.mutate("cancel")}>Cancel unpromoted cycle</Button><Button disabled={closeRationale.trim().length < 20 || finish.isPending} onClick={() => finish.mutate("complete")}>Check promotion and complete</Button></div></section> : null}
      </> : null}<LearningPolicyReview key={companyId} companyId={companyId} /></>}{errors.map((state, index) => <p role="alert" key={index}>{state.error instanceof Error ? state.error.message : "Learning operation failed"}</p>)}
  </div>;
}

export const OrganizationalLearning = withV7AccountScope(OrganizationalLearningContent);
