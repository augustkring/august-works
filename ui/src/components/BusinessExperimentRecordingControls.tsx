import { useState,useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import type { BusinessExperimentView,BusinessExperimentVersionView,ControlBusinessExperimentExecution } from "@paperclipai/shared";
import { businessExperimentsApi,type ExperimentReceipts } from "@/api/business-experiments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BusinessExperimentUnitPicker } from "./BusinessExperimentUnitPicker";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
type Command={kind:"review";state:"draft"|"in_review"|"ready"|"cancelled"}|{kind:"start"}|{kind:"assign"}|{kind:"exposure"}|{kind:"control";state:ControlBusinessExperimentExecution["state"]}|{kind:"analyze"}|{kind:"interpret"};
const reasonValid=(v:string)=>v.trim().length>=10&&v.trim().length<=2000;
export function BusinessExperimentRecordingControls({companyId,userId,root,version,receipts,onChanged,onAuthorityLost,onReviewingChange,now}:{companyId:string;userId:string|null;root:BusinessExperimentView;version:BusinessExperimentVersionView;receipts:ExperimentReceipts;onChanged:()=>void;onAuthorityLost:()=>void;onReviewingChange:(v:boolean)=>void;now:number}){
 const [rationale,setRationale]=useState(""),[unitId,setUnitId]=useState(""),[unitValid,setUnitValid]=useState(false),[exposureUnit,setExposureUnit]=useState(""),[exposureUnitValid,setExposureUnitValid]=useState(false);
 const [exposureStatus,setExposureStatus]=useState<"applied"|"not_applied">("not_applied"),[assertedAt,setAssertedAt]=useState("");
 const [completionReason,setCompletionReason]=useState<"fixed_horizon"|"emergency_safety_stop">("fixed_horizon"),[changeAssessment,setChangeAssessment]=useState<"none_identified"|"material_or_unknown"|"">(""),[changeReason,setChangeReason]=useState("");
 const [conclusion,setConclusion]=useState<"ship_candidate"|"do_not_ship"|"iterate"|"abstain">("abstain"),[acknowledged,setAcknowledged]=useState(false);
 useEffect(()=>onReviewingChange(!!rationale||!!unitId||!!exposureUnit||!!assertedAt||!!changeReason||acknowledged),[rationale,unitId,exposureUnit,assertedAt,changeReason,acknowledged,onReviewingChange]);
 useEffect(()=>()=>onReviewingChange(false),[onReviewingChange]);
 const account=userId??undefined,exact={expectedRevision:root.revision,versionId:version.id},current=version.currentQualification==="current"&&root.currentVersionId===version.id;
 const canRecord=current&&root.state==="running",canAttest=current&&["running","paused","completed"].includes(root.state),ended=now>=Date.parse(version.definition.sampleOrDurationPlan.until),inWindow=now>=Date.parse(version.definition.sampleOrDurationPlan.from)&&!ended;
 const clear=()=>{setRationale("");setUnitId("");setExposureUnit("");setAssertedAt("");setChangeAssessment("");setChangeReason("");setAcknowledged(false);};
 const command=useMutation({mutationFn:async(c:Command)=>{
  if(c.kind==="review")return businessExperimentsApi.transition(companyId,root.id,{...exact,state:c.state,rationale},account);
  if(c.kind==="start")return businessExperimentsApi.start(companyId,root.id,{...exact,mode:"recording_only_human_attested_native_process",rationale},account);
  if(c.kind==="assign")return businessExperimentsApi.assign(companyId,root.id,{...exact,unitId},account);
  if(c.kind==="exposure"){const assignment=receipts.assignments.find(a=>a.unitId===exposureUnit);if(!assignment)throw new Error("Select a current owned assignment");return businessExperimentsApi.exposure(companyId,root.id,{...exact,assignmentId:assignment.id,exposure:exposureStatus==="not_applied"?{status:"not_applied",rationale}:{status:"applied",assertedAppliedAt:new Date(`${assertedAt}Z`).toISOString(),rationale}},account);}
  if(c.kind==="control")return businessExperimentsApi.stop(companyId,root.id,{...exact,state:c.state,rationale,completion:c.state==="completed"?{reason:completionReason,concurrentChangeReview:{assessment:changeAssessment as "none_identified"|"material_or_unknown",rationale:changeReason}}:null},account);
  if(c.kind==="analyze")return businessExperimentsApi.analyze(companyId,root.id,exact,account);
  if(!receipts.analysis)throw new Error("The exact immutable analysis is unavailable");
  return businessExperimentsApi.interpret(companyId,root.id,{...exact,analysisId:receipts.analysis.id,conclusion,rationale,limitationsAcknowledged:true,executionAuthority:"advisory_only"},account);
 },onSuccess:()=>{clear();onChanged();},onError:()=>{clear();onAuthorityLost();}});
 const busy=command.isPending,reason=reasonValid(rationale),assignment=receipts.assignments.find(a=>a.unitId===exposureUnit),alreadyAttested=receipts.exposures.some(e=>e.assignmentId===assignment?.id);
 const asserted=Date.parse(`${assertedAt}Z`),exposureTimeValid=exposureStatus==="not_applied"||!!assignment&&Number.isFinite(asserted)&&asserted>=Date.parse(assignment.assignedAt)&&asserted<=now&&asserted<Date.parse(version.definition.sampleOrDurationPlan.until)&&(!receipts.completion||asserted<=Date.parse(receipts.completion.completedAt));
 return <section aria-label="Human experiment lifecycle controls" className="min-w-0 space-y-4"><h3 className="font-medium">Human review and recording</h3>
 {command.isError&&<p role="alert">The command could not be admitted. Recheck current account, version and source authority.</p>}
 {!current&&<p role="status">New recording and interpretation require the exact current version and current source qualification.</p>}
 {root.state!=="completed"&&<label className="block space-y-2">Human action rationale<Textarea aria-label="Human action rationale" value={rationale} onChange={e=>setRationale(e.target.value)} minLength={10} maxLength={2000} disabled={busy}/></label>}
 {root.currentVersionId===version.id&&["draft","in_review","ready"].includes(root.state)&&<div className="flex flex-wrap gap-2">
  {root.state==="draft"&&<Button disabled={busy||!current||!reason} onClick={()=>command.mutate({kind:"review",state:"in_review"})}>Submit protocol for review</Button>}
  {root.state==="in_review"&&<><Button disabled={busy||!current||!reason} onClick={()=>command.mutate({kind:"review",state:"ready"})}>Approve this preregistration</Button><Button variant="outline" disabled={busy||!current||!reason} onClick={()=>command.mutate({kind:"review",state:"draft"})}>Return protocol to draft</Button></>}
  {root.state==="ready"&&<><Button disabled={busy||!current||!reason||ended} onClick={()=>command.mutate({kind:"start"})}>Start recording this protocol</Button><Button variant="outline" disabled={busy||!current||!reason} onClick={()=>command.mutate({kind:"review",state:"in_review"})}>Return protocol to review</Button></>}
  <Button variant="outline" disabled={busy||!reason} onClick={()=>command.mutate({kind:"review",state:"cancelled"})}>Cancel unstarted protocol</Button>
 </div>}
 {canRecord&&<section aria-label="Native unit assignment" className="space-y-3"><h4 className="font-medium">Record a native allocation</h4>
  <BusinessExperimentUnitPicker companyId={companyId} userId={userId} versionId={version.id} definition={version.definition} assignments={receipts.assignments} mode="assign" value={unitId} onChange={setUnitId} onValidity={setUnitValid} onAuthorityLost={onAuthorityLost} disabled={busy}/>
  <Button variant="outline" disabled={busy||!unitValid||!inWindow||receipts.assignments.length>=version.definition.sampleOrDurationPlan.maximumAssignedUnits} onClick={()=>command.mutate({kind:"assign"})}>Record stable allocation</Button>
  <p className="text-sm text-muted-foreground">The native owner produces a stable control/treatment label. This action does not apply the described treatment or change the unit. Check its registered eligibility before allocating it.</p>
 </section>}
 {canAttest&&<section aria-label="Human exposure attestation" className="space-y-3"><h4 className="font-medium">Record what was actually applied</h4>
  <BusinessExperimentUnitPicker companyId={companyId} userId={userId} versionId={version.id} definition={version.definition} assignments={receipts.assignments} mode="exposure" value={exposureUnit} onChange={id=>{setExposureUnit(id);setAssertedAt("");}} onValidity={setExposureUnitValid} onAuthorityLost={onAuthorityLost} disabled={busy}/>
  {assignment&&<p>Owned allocation: {assignment.arm} · assigned {new Date(assignment.assignedAt).toLocaleString()}. {alreadyAttested?"Its exposure receipt is already immutable.":"A not-applied receipt still retains this unit in the analysis."}</p>}
  <label className="block space-y-2">Exposure report<select aria-label="Exposure report" className={selectStyle} value={exposureStatus} onChange={e=>setExposureStatus(e.target.value as "applied"|"not_applied")} disabled={busy}><option value="not_applied">Not applied</option><option value="applied">Human-confirmed applied</option></select></label>
  {exposureStatus==="applied"&&<label className="block space-y-2">Asserted applied time (UTC)<Input aria-label="Asserted applied time (UTC)" type="datetime-local" step="0.001" value={assertedAt} onChange={e=>setAssertedAt(e.target.value)} disabled={busy}/></label>}
  <Button variant="outline" disabled={busy||!reason||!exposureUnitValid||!exposureTimeValid||alreadyAttested} onClick={()=>command.mutate({kind:"exposure"})}>Save human exposure receipt</Button>
  <p className="text-sm text-muted-foreground">This is human attestation rather than verified workflow telemetry. An applied report must identify a real application time between assignment and the registered stop/horizon. It cannot be rewritten.</p>
 </section>}
 {root.currentVersionId===version.id&&["running","paused"].includes(root.state)&&<section aria-label="Recording stop policy" className="space-y-3"><h4 className="font-medium">Pause, complete or cancel</h4>
  <div className="flex flex-wrap gap-2">{root.state==="running"?<Button variant="outline" disabled={busy||!reason} onClick={()=>command.mutate({kind:"control",state:"paused"})}>Pause recording</Button>:<Button variant="outline" disabled={busy||!reason||!current||ended} onClick={()=>command.mutate({kind:"control",state:"running"})}>Resume recording</Button>}<Button variant="outline" disabled={busy||!reason} onClick={()=>command.mutate({kind:"control",state:"cancelled"})}>Cancel active recording</Button></div>
  <label className="block space-y-2">Completion reason<select aria-label="Completion reason" className={selectStyle} value={completionReason} onChange={e=>setCompletionReason(e.target.value as typeof completionReason)} disabled={busy}><option value="fixed_horizon">Registered fixed horizon elapsed</option><option value="emergency_safety_stop">Emergency safety stop</option></select></label>
  <label className="block space-y-2">Human concurrent-change assessment<select aria-label="Human concurrent-change assessment" className={selectStyle} value={changeAssessment} onChange={e=>setChangeAssessment(e.target.value as typeof changeAssessment)} disabled={busy}><option value="">Choose an explicit assessment</option><option value="none_identified">No material concurrent change identified</option><option value="material_or_unknown">Material change or uncertainty</option></select></label>
  <label className="block space-y-2">Concurrent-change rationale<Textarea aria-label="Concurrent-change rationale" value={changeReason} onChange={e=>setChangeReason(e.target.value)} minLength={10} maxLength={2000} disabled={busy}/></label>
  <Button variant="outline" disabled={busy||!reason||!changeAssessment||!reasonValid(changeReason)||completionReason==="fixed_horizon"&&!ended} onClick={()=>command.mutate({kind:"control",state:"completed"})}>Complete under registered stopping policy</Button>
  <p className="text-sm text-muted-foreground">Early efficacy stopping is not admitted. Emergency stopping withholds a confirmatory result. This human concurrent-change review does not prove the absence of external interference.</p>
 </section>}
 {current&&root.state==="completed"&&!receipts.analysis&&<section aria-label="Final experiment analysis" className="space-y-3"><h4 className="font-medium">One final analysis</h4><p>Capture the current state of every assigned native unit once. Missing exposure, baseline imbalance or an unadmitted concurrent-change review invalidates inference. A missed final-capture deadline also invalidates the result; the analysis cannot be repeated with a different time.</p><Button disabled={busy||receipts.completion?.reason==="fixed_horizon"&&!ended} onClick={()=>command.mutate({kind:"analyze"})}>Capture and analyze once</Button></section>}
 {current&&root.state==="analyzing"&&receipts.analysis&&!receipts.interpretation&&<section aria-label="Human result interpretation" className="space-y-3"><h4 className="font-medium">Interpret this exact result</h4>
  <label className="block space-y-2">Human conclusion<select aria-label="Human conclusion" className={selectStyle} value={conclusion} onChange={e=>setConclusion(e.target.value as typeof conclusion)} disabled={busy}><option value="abstain">Abstain</option>{receipts.analysis.result.status!=="invalid"&&<><option value="iterate">Iterate</option><option value="do_not_ship">Do not ship</option></>}{receipts.analysis.result.status==="pass"&&receipts.analysis.result.numericallyQualified&&<option value="ship_candidate">Ship candidate for separate human decision</option>}</select></label>
  <label className="flex items-start gap-2"><input aria-label="Acknowledge result limitations and advisory authority" type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} disabled={busy}/><span>I reviewed the source, exposure and causal limitations. This interpretation is advisory and grants no execution or policy authority.</span></label>
  <Button disabled={busy||!reason||!acknowledged} onClick={()=>command.mutate({kind:"interpret"})}>Save human interpretation</Button>
 </section>}
 </section>;
}
