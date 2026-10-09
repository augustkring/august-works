import {useEffect,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {v7FeatureEnabled} from "@paperclipai/shared";
import {instanceSettingsApi} from "@/api/instanceSettings";
import {queryKeys} from "@/lib/queryKeys";
import {Link} from "@/lib/router";
import type {DecisionContextVersionView,DecisionOutcomeReviewView,FinishDecisionOutcomeReview} from "@paperclipai/shared";
import {decisionOutcomeReviewsApi} from "@/api/decision-outcome-reviews";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {DecisionOutcomeReviewForm} from "./DecisionOutcomeReviewForm";
export function DecisionOutcomeReviewDetails({review}:{review:Omit<DecisionOutcomeReviewView,"authorizationCheckedAt">}) {
  const receipt=review.receipts[0],assessment=receipt?.assessment;
  const labels={decisionProcessQuality:"Decision process quality",assumptionAccuracy:"Assumption accuracy",executionFidelity:"Execution fidelity",externalChange:"External change",observedOutcome:"Observed outcome",causalConfidence:"Causal confidence"};
  return <div className="min-w-0 space-y-4"><p className="font-medium">{review.status.replaceAll("_"," ")} · due {new Date(review.reviewDueAt).toLocaleString()}</p>
    {assessment&&<><p>{assessment.lessonSummary}</p><dl className="space-y-4">{Object.entries(assessment.assessments).map(([key,value])=><div key={key}><dt className="font-medium">{labels[key as keyof typeof labels]}</dt><dd className="space-y-1"><p>{value.assessment.replaceAll("_"," ")} · {key==="causalConfidence"?"no identified causal claim":"human judgment"}</p><p className="text-sm">{value.explanation}</p></dd></div>)}</dl>
      {!!receipt.comparisons.length&&<section aria-label="Recorded metric comparisons" className="space-y-3"><h4 className="font-medium">Expected and observed measurements</h4>{receipt.comparisons.map(item=><div key={item.expectationIndex} className="min-w-0 space-y-2 rounded-md border border-border p-3"><p>Baseline {item.baselineValue??"unknown"} · actual {item.actualValue??"unknown"} {item.unit}</p><p>Human expected range {item.expectedRange.lower} to {item.expectedRange.upper} · {item.rangePosition} · observed {item.observedDirection}</p><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{item.limitations.map(text=><li key={text}>{text}</li>)}</ul></div>)}</section>}
      {!!assessment.qualitativeOutcomes.length&&<section aria-label="Recorded qualitative outcomes" className="space-y-3"><h4 className="font-medium">Qualitative outcome judgments</h4>{assessment.qualitativeOutcomes.map(item=><div key={item.expectationIndex}><p>Expectation {item.expectationIndex+1} · {item.assessment.replaceAll("_"," ")} · human judgment</p><p className="text-sm">{item.explanation}</p></div>)}</section>}
      {!!assessment.assumptionOutcomes.length&&<section aria-label="Reviewed assumptions" className="space-y-3"><h4 className="font-medium">Assumption outcomes</h4>{assessment.assumptionOutcomes.map(item=><div key={item.key}><p>{item.key.replaceAll("_"," ")} · {item.assessment} · human judgment</p><p className="text-sm">{item.explanation}</p></div>)}</section>}
      <p className="text-sm">Native effects: {receipt.nativeExecution?.status??"not established"}. Execution status does not establish business success.</p>
      <p className="text-sm text-muted-foreground">A good or bad outcome does not automatically determine decision quality. This review changes neither the original choice nor its frozen context.</p>
    </>}
    <details><summary className="cursor-pointer text-sm">Inspect outcome review provenance</summary><div className="space-y-3 pt-3 text-sm"><p className="break-all">Frozen context hash {review.contextHash}</p>{review.receipts.map(item=><section key={item.revision} className="space-y-2"><p>Review revision {item.revision} · {item.action} · {new Date(item.recordedAt).toLocaleString()} · retained until {new Date(item.expiresAt).toLocaleString()}</p><p>{item.rationale}</p><p className="break-all">Receipt hash {item.contentHash}</p>{item.actualEvidence.map(pin=><div key={pin.key} className="space-y-1"><p>{pin.key.replaceAll("_"," ")} · captured {new Date(pin.capturedAt).toLocaleString()}</p><p className="break-all">Native observation {pin.source.id} · {pin.sourceHash}</p></div>)}</section>)}</div></details>
  </div>;
}
export function DecisionOutcomeReviewPanel({companyId,userId,decisionId,version,optionId,chosenAt,onEditingChange}:{companyId:string;userId:string|null;decisionId:string;version:DecisionContextVersionView;optionId:string;chosenAt:string;onEditingChange:(editing:boolean)=>void}) {
  const cache=useQueryClient(),key=["decision-outcome-review",companyId,userId,decisionId],account=userId??undefined;
  const [editing,setEditing]=useState(false),[rationale,setRationale]=useState(""),[now,setNow]=useState(Date.now());
  const detail=useQuery({queryKey:key,queryFn:()=>decisionOutcomeReviewsApi.detail(companyId,decisionId,account),refetchInterval:editing?false:30000,refetchOnWindowFocus:!editing,retry:false});
  const features=useQuery({queryKey:queryKeys.instance.experimentalSettings,queryFn:()=>instanceSettingsApi.getExperimental()});
  const refresh=()=>{setEditing(false);setRationale("");void cache.invalidateQueries({queryKey:key});};
  const revoked=()=>{setEditing(false);setRationale("");void cache.resetQueries({queryKey:key});};
  const schedule=useMutation({mutationFn:()=>decisionOutcomeReviewsApi.schedule(companyId,decisionId,{contextVersionId:version.id,rationale},account),onSuccess:refresh,onError:revoked});
  const transition=useMutation({mutationFn:(action:"begin"|"cancel")=>decisionOutcomeReviewsApi.transition(companyId,decisionId,{expectedRevision:detail.data!.revision,action,rationale},account),onSuccess:refresh,onError:revoked});
  const finish=useMutation({mutationFn:(input:FinishDecisionOutcomeReview)=>decisionOutcomeReviewsApi.finish(companyId,decisionId,input,account),onSuccess:refresh,onError:revoked});
  useEffect(()=>{onEditingChange(editing);},[editing,onEditingChange]);
  useEffect(()=>()=>onEditingChange(false),[onEditingChange]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);window.addEventListener("memory-access-changed",revoked);return()=>{window.clearInterval(timer);window.removeEventListener("memory-access-changed",revoked);};},[cache,companyId,userId,decisionId]);
  const data=!detail.isFetching&&!detail.isError?detail.data:undefined;
  const review=data&&data.companyId===companyId&&data.decisionId===decisionId&&data.contextVersionId===version.id&&data.contextHash===version.contentHash&&data.optionId===optionId&&data.receipts.length&&data.receipts.every(item=>Date.parse(item.expiresAt)>Math.max(now,Date.now()))?data:undefined;
  const unavailable=data!==undefined&&data!==null&&!review;
  const busy=schedule.isPending||transition.isPending||finish.isPending,error=detail.error??schedule.error??transition.error??finish.error;
  const reasonValid=rationale.trim().length>=10&&rationale.trim().length<=2000;
  const expectations=version.definition.expectedOutcomes.filter(item=>item.optionId===optionId),hasBaseline=Date.parse(version.expiresAt)>Math.max(now,Date.now());
  return <section aria-label="Decision outcome review" className="min-w-0 space-y-4 border-t border-border pt-5"><h3 className="font-semibold">Outcome review</h3><p className="text-sm text-muted-foreground">Review what happened separately from what was known before choosing.</p>
    {detail.isFetching&&<p role="status">Rechecking current outcome review authority…</p>}{error&&<div role="alert" className="space-y-2"><p>{error.message}</p><Button variant="outline" onClick={()=>void detail.refetch()}>Recheck outcome review</Button></div>}
    {unavailable&&<p role="status">Retained review evidence is unavailable. Recheck current authority before using it.</p>}
    {review&&<DecisionOutcomeReviewDetails review={review}/>}
    {review&&["completed","inconclusive"].includes(review.status)&&features.data&&v7FeatureEnabled(features.data,"learning_engine_v7")&&<div className="space-y-2"><p className="text-sm text-muted-foreground">Test this lesson against independently verified Task outcomes. Hypotheses and changes keep their human review gates.</p><Button variant="outline" asChild><Link to={review.learningCycleId?`/memory/learning?${new URLSearchParams({cycleId:review.learningCycleId,cycleCompanyId:companyId})}`:`/memory/learning?${new URLSearchParams({reviewDecisionId:decisionId,reviewRevision:String(review.revision),reviewCompanyId:companyId})}`}>{review.learningCycleId?"Open Learning cycle":"Start Learning from this review"}</Link></Button></div>}

    {data===null&&hasBaseline&&<p>No outcome review has been recorded. The review date comes from the frozen expectations.</p>}
    {!error&&!detail.isFetching&&!unavailable&&hasBaseline&&(data===null&&expectations.length>0||review&&["scheduled","due","in_review"].includes(review.status))&&<>
      {editing&&review?.status==="in_review"?<DecisionOutcomeReviewForm key={`${review.id}:${review.revision}`} companyId={companyId} userId={userId} version={version} optionId={optionId} chosenAt={chosenAt} revision={review.revision} busy={busy} onSave={input=>finish.mutate(input)} onCancel={()=>setEditing(false)}/>:<>
        <label className="block space-y-2">Outcome review rationale<Textarea value={rationale} onChange={event=>setRationale(event.target.value)} minLength={10} maxLength={2000} disabled={busy}/></label>
        <div className="flex flex-wrap gap-2">{data===null?<Button variant="outline" disabled={!reasonValid||busy} onClick={()=>schedule.mutate()}>Schedule outcome review</Button>:review?.status==="in_review"?<Button disabled={busy} onClick={()=>setEditing(true)}>Assess decision outcomes</Button>:<Button disabled={!reasonValid||busy} onClick={()=>transition.mutate("begin")}>Begin outcome review</Button>}{review&&<Button variant="outline" disabled={!reasonValid||busy} onClick={()=>transition.mutate("cancel")}>Cancel outcome review</Button>}</div>
      </>}
    </>}
  </section>;
}
