import { useState,useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { businessExperimentDefinitionSchema,createBusinessExperimentSchema,type BusinessExperimentDefinition,type BusinessExperimentMetricPin } from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BusinessExperimentMetricPicker } from "./BusinessExperimentMetricPicker";
import { emptyBusinessExperimentDefinition } from "./business-experiment-draft";
const selectStyle="w-full min-w-0 rounded-md border border-input bg-background p-2";
const number=(v:string)=>v.trim()?Number(v):NaN;
const utc=(v:string)=>v&&Number.isFinite(Date.parse(`${v}Z`))?new Date(`${v}Z`).toISOString():"";
type Definition=BusinessExperimentDefinition;
function Prose({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block space-y-2">{label}<Textarea aria-label={label} value={value} onChange={e=>onChange(e.target.value)} minLength={10} maxLength={2000} required/></label>;}
function Numeric({label,value,onChange,min,max,step=1}:{label:string;value:number;onChange:(v:number)=>void;min:number;max:number;step?:number|"any"}){return <label className="block space-y-2">{label}<Input aria-label={label} type="number" value={Number.isFinite(value)?value:""} onChange={e=>onChange(number(e.target.value))} min={min} max={max} step={step} required/></label>;}
/** A reasoned human preregistration, using current native definition pickers.
 * No pasted numerical data, claimed source qualification or people-impact
 * consent is accepted as a product command. */
export function BusinessExperimentDefinitionForm({companyId,userId,initial,initialPins,experimentKey,busy,onSave,onCancel,onAuthorityLost=onCancel}:{companyId:string;userId:string|null;initial?:Definition;initialPins?:BusinessExperimentMetricPin[];experimentKey?:string;busy:boolean;onSave:(input:{key:string;definition:Definition;reason:string})=>void;onCancel:()=>void;onAuthorityLost?:()=>void}){
 const [key,setKey]=useState(experimentKey??""),[draft,setDraft]=useState(()=>initial?structuredClone(initial):emptyBusinessExperimentDefinition(userId??"local-board")),[reason,setReason]=useState("");
 const [invariants,setInvariants]=useState(()=>draft.diagnostics.invariantMetricRefs.map(metricId=>({metricId,metricVersionId:initial?initialPins?.find(p=>p.role==="invariant"&&p.metricId===metricId)?.metricVersionId??"review_required":""})));
 const [validity,setValidity]=useState<Record<string,boolean>>({});
 const sourceKey=["experiment-definition-sources",companyId,userId],account=userId??undefined;
 const policies=useQuery({queryKey:[...sourceKey,"purpose"],queryFn:()=>aiGovernanceApi.obligations(companyId,account),refetchInterval:30000,retry:false});
 const projects=useQuery({queryKey:[...sourceKey,"projects"],queryFn:()=>projectsApi.list(companyId),enabled:draft.scope.type==="project",refetchInterval:30000,retry:false});
 useEffect(()=>{if(policies.isError||projects.isError)onAuthorityLost();},[policies.isError,projects.isError,onAuthorityLost]);
 const unavailable=policies.isFetching||policies.isPending||policies.isError||draft.scope.type==="project"&&(projects.isFetching||projects.isPending||projects.isError);
 const definition={...draft,diagnostics:{...draft.diagnostics,invariantMetricRefs:invariants.map(i=>i.metricId)}},parsed=businessExperimentDefinitionSchema.safeParse(definition);
 const roles=["primary",...draft.guardrailMetrics.map(m=>m.key),...draft.secondaryMetrics.map(m=>m.key),...invariants.map((_,i)=>`invariant_${i+1}`)];
 const valid=!unavailable&&roles.every(role=>validity[role]===true)&&parsed.success&&createBusinessExperimentSchema.safeParse({key,definition:parsed.data}).success&&(!initial||reason.trim().length>=10&&reason.trim().length<=2000)&&Date.parse(draft.sampleOrDurationPlan.from)>Date.now();
 const sourceValidity=(role:string,v:boolean)=>setValidity(old=>old[role]===v?old:{...old,[role]:v});
 const update=<K extends keyof Definition>(k:K,v:Definition[K])=>setDraft(old=>({...old,[k]:v}));
 const metricFields=(metric:Definition["primaryMetric"]|Definition["guardrailMetrics"][number]|Definition["secondaryMetrics"][number],label:string,set:(m:typeof metric)=>void)=><div className="min-w-0 space-y-3 rounded-md border border-border p-4">
  <h3 className="font-medium">{label}</h3><BusinessExperimentMetricPicker companyId={companyId} userId={userId} label={`${label} measure`} value={metric} population={draft.population.randomizationUnit} scope={draft.scope} onChange={pin=>set({...metric,...pin,name:metric.name||pin.name||""})} onValidity={v=>sourceValidity(metric.key,v)} onAuthorityLost={onAuthorityLost}/>
  <label className="block space-y-2">{label} name<Input aria-label={`${label} name`} value={metric.name} onChange={e=>set({...metric,name:e.target.value})} minLength={3} maxLength={160} required/></label>
  <Prose label={`${label} success definition`} value={metric.successDefinition} onChange={successDefinition=>set({...metric,successDefinition})}/>
 </div>;
 return <form aria-label="Experiment preregistration proposal" className="min-w-0 space-y-6" onSubmit={e=>{e.preventDefault();if(valid&&parsed.success)onSave({key,definition:parsed.data,reason});}}>
  <h2 className="font-semibold">{initial?"Amend the unstarted protocol":"Preregister a business process experiment"}</h2>
  <p>Define the question, primary benefit and every safety limit before recording begins. This mode supports native business objects with human-reported exposure and no personal impact or material AI deployment change.</p>
  <fieldset disabled={busy} className="min-w-0 space-y-6"><legend className="sr-only">Experiment preregistration fields</legend>
  <section aria-label="Question and population" className="space-y-3"><h3 className="font-medium">Question and population</h3>
   <label className="block space-y-2">Experiment reference<Input aria-label="Experiment reference" value={key} onChange={e=>setKey(e.target.value)} disabled={!!experimentKey} pattern="[a-z][a-z0-9_]{1,79}" required/></label>
   <label className="block space-y-2">Experiment name<Input aria-label="Experiment name" value={draft.name} onChange={e=>update("name",e.target.value)} minLength={3} maxLength={160} required/></label>
   <Prose label="Hypothesis" value={draft.hypothesis} onChange={v=>update("hypothesis",v)}/><Prose label="Decision question" value={draft.decisionQuestion} onChange={v=>update("decisionQuestion",v)}/>
   <label className="block space-y-2">Accountable human owner<Input aria-label="Accountable human owner" value={draft.ownerUserId} onChange={e=>update("ownerUserId",e.target.value)} maxLength={200} required/></label>
   <label className="block space-y-2">Randomization unit<select aria-label="Randomization unit" className={selectStyle} value={draft.population.randomizationUnit} onChange={e=>update("population",{...draft.population,randomizationUnit:e.target.value as "issue"|"project"})}><option value="issue">Native issue</option><option value="project">Native project</option></select></label>
   <label className="block space-y-2">Population scope<select aria-label="Population scope" className={selectStyle} value={draft.scope.type} onChange={e=>update("scope",e.target.value==="project"?{type:"project",id:""}:{type:"company",id:null})}><option value="company">Company</option>{draft.population.randomizationUnit==="issue"&&<option value="project">Project</option>}</select></label>
   {draft.scope.type==="project"&&<label className="block space-y-2">Population project<select aria-label="Population project" className={selectStyle} value={draft.scope.id} onChange={e=>update("scope",{type:"project",id:e.target.value})} required><option value="">Choose current project</option>{!unavailable&&projects.data?.filter(p=>p.companyId===companyId&&!p.archivedAt).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
   {(["eligibility","trigger","externalValidityLimits"] as const).map((field,i)=><Prose key={field} label={["Eligible population and exclusions","When a unit becomes eligible","Limits on applying results elsewhere"][i]} value={draft.population[field]} onChange={v=>update("population",{...draft.population,[field]:v})}/>)}
   <Prose label="Treatment" value={draft.treatment} onChange={v=>update("treatment",v)}/><Prose label="Control" value={draft.control} onChange={v=>update("control",v)}/>
   <p className="text-sm text-muted-foreground">Native units must be created during the registered period. Described eligibility and exposure remain human responsibilities; recording labels does not apply the treatment.</p>
  </section>
  <section aria-label="Benefit and safety measures" className="space-y-4"><h3 className="font-medium">Benefit and safety measures</h3>
   {metricFields(draft.primaryMetric,"Primary metric",m=>update("primaryMetric",m as Definition["primaryMetric"]))}
   <label className="block space-y-2">Beneficial direction<select aria-label="Beneficial direction" className={selectStyle} value={draft.primaryMetric.beneficialDirection} onChange={e=>update("primaryMetric",{...draft.primaryMetric,beneficialDirection:e.target.value as "increase"|"decrease"})}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>
   <Numeric label="Meaningful primary difference (fraction, 0–1)" value={draft.primaryMetric.minimumMeaningfulEffect} onChange={v=>update("primaryMetric",{...draft.primaryMetric,minimumMeaningfulEffect:v})} min={0.000001} max={1} step="any"/>
   {draft.guardrailMetrics.map((metric,i)=><div key={metric.key} className="space-y-3">{metricFields(metric,`Guardrail ${i+1}`,m=>update("guardrailMetrics",draft.guardrailMetrics.map((old,j)=>j===i?m as typeof metric:old)))}
    <label className="block space-y-2">Guardrail {i+1} harmful direction<select aria-label={`Guardrail ${i+1} harmful direction`} className={selectStyle} value={metric.harmfulDirection} onChange={e=>update("guardrailMetrics",draft.guardrailMetrics.map((m,j)=>j===i?{...m,harmfulDirection:e.target.value as "increase"|"decrease"}:m))}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>
    <Numeric label={`Guardrail ${i+1} acceptable harm (fraction, 0–1)`} value={metric.maximumAcceptableHarm} onChange={v=>update("guardrailMetrics",draft.guardrailMetrics.map((m,j)=>j===i?{...m,maximumAcceptableHarm:v}:m))} min={0} max={1} step="any"/>
   </div>)}
   <p className="text-sm text-muted-foreground">All registered guardrails must exclude unacceptable harm. A positive primary result alone cannot qualify success.</p>
   {draft.guardrailMetrics.length<8&&<Button type="button" variant="outline" onClick={()=>update("guardrailMetrics",[...draft.guardrailMetrics,{key:`guardrail_${draft.guardrailMetrics.length+1}`,name:"",metricId:"",metricVersionId:"",outcome:"binary",successDefinition:"",harmfulDirection:"increase",maximumAcceptableHarm:0.1}])}>Add guardrail</Button>}
   {draft.guardrailMetrics.length>1&&<Button type="button" variant="ghost" onClick={()=>update("guardrailMetrics",draft.guardrailMetrics.slice(0,-1))}>Remove last guardrail</Button>}
   {draft.secondaryMetrics.map((metric,i)=><div key={metric.key}>{metricFields(metric,`Exploratory metric ${i+1}`,m=>update("secondaryMetrics",draft.secondaryMetrics.map((old,j)=>j===i?m:old)))}</div>)}
   {draft.secondaryMetrics.length<8&&<Button type="button" variant="outline" onClick={()=>update("secondaryMetrics",[...draft.secondaryMetrics,{key:`exploratory_${draft.secondaryMetrics.length+1}`,name:"",metricId:"",metricVersionId:"",outcome:"binary",successDefinition:""}])}>Add exploratory metric</Button>}
   {draft.secondaryMetrics.length>0&&<Button type="button" variant="ghost" onClick={()=>update("secondaryMetrics",draft.secondaryMetrics.slice(0,-1))}>Remove last exploratory metric</Button>}
   <p className="text-sm text-muted-foreground">Exploratory measures do not establish confirmatory success.</p>
   {invariants.map((pin,i)=><BusinessExperimentMetricPicker key={`invariant_${i+1}`} companyId={companyId} userId={userId} label={`Pretreatment invariant ${i+1}`} value={pin} population={draft.population.randomizationUnit} scope={draft.scope} onChange={v=>setInvariants(old=>old.map((p,j)=>j===i?v:p))} onValidity={v=>sourceValidity(`invariant_${i+1}`,v)} onAuthorityLost={onAuthorityLost}/>)}
   {invariants.length<8&&<Button type="button" variant="outline" onClick={()=>setInvariants([...invariants,{metricId:"",metricVersionId:""}])}>Add pretreatment invariant</Button>}
   {invariants.length>1&&<Button type="button" variant="ghost" onClick={()=>setInvariants(invariants.slice(0,-1))}>Remove last invariant</Button>}
  </section>
  <section aria-label="Timing and analysis quality" className="space-y-3"><h3 className="font-medium">Timing and analysis quality</h3>
   {(["from","until"] as const).map((field,i)=><label key={field} className="block space-y-2">{i===0?"Recording start (UTC)":"Fixed horizon end (UTC)"}<Input aria-label={i===0?"Recording start (UTC)":"Fixed horizon end (UTC)"} type="datetime-local" step="0.001" value={draft.sampleOrDurationPlan[field].replace(/Z$/,"")} onChange={e=>update("sampleOrDurationPlan",{...draft.sampleOrDurationPlan,[field]:utc(e.target.value)})} required/></label>)}
   <div className="grid gap-4 sm:grid-cols-2">
    <Numeric label="Treatment allocation probability" value={draft.assignment.treatmentProbability} onChange={v=>update("assignment",{...draft.assignment,treatmentProbability:v})} min={0.1} max={0.9} step="any"/>
    {(["minimumAssignedUnits","maximumAssignedUnits","minimumUnitsPerArm","minimumDetectableEffect"] as const).map((field,i)=><Numeric key={field} label={["Minimum assigned units","Maximum assigned units","Minimum units per arm","Minimum detectable effect (fraction)"][i]} value={draft.sampleOrDurationPlan[field]} onChange={v=>update("sampleOrDurationPlan",{...draft.sampleOrDurationPlan,[field]:v})} min={i===3?0.000001:i===2?2:4} max={i===3?1:i===2?2000:4000} step={i===3?"any":1}/>)}
    <Numeric label="Final capture deadline after horizon (seconds)" value={draft.analysisPlan.finalCaptureMaxDelaySeconds} onChange={v=>update("analysisPlan",{...draft.analysisPlan,finalCaptureMaxDelaySeconds:v})} min={1} max={86400}/>
    <Numeric label="Primary and guardrail family error allowance" value={draft.analysisPlan.familywiseAlpha} onChange={v=>update("analysisPlan",{...draft.analysisPlan,familywiseAlpha:v})} min={0.001} max={0.2} step="any"/>
    <Numeric label="Allocation mismatch threshold" value={draft.diagnostics.srmAlpha} onChange={v=>update("diagnostics",{...draft.diagnostics,srmAlpha:v})} min={0.0001} max={0.05} step="any"/>
    <Numeric label="Pretreatment balance family error allowance" value={draft.diagnostics.invariantBalance.familywiseAlpha} onChange={v=>update("diagnostics",{...draft.diagnostics,invariantBalance:{...draft.diagnostics.invariantBalance,familywiseAlpha:v}})} min={0.0001} max={0.05} step="any"/>
   </div>
   <Prose label="Sample size and power rationale" value={draft.sampleOrDurationPlan.powerRationale} onChange={v=>update("sampleOrDurationPlan",{...draft.sampleOrDurationPlan,powerRationale:v})}/>
   <p className="text-sm text-muted-foreground">This rationale is human-declared; the app does not validate statistical power. One final intention-to-treat analysis uses conservative familywise bounds. Missing outcomes invalidate the result.</p>
   <Prose label="Concurrent experiments and interference plan" value={draft.diagnostics.concurrentExperimentAndInterferencePlan} onChange={v=>update("diagnostics",{...draft.diagnostics,concurrentExperimentAndInterferencePlan:v})}/>
   <Prose label="Exposure, telemetry and identity plan" value={draft.diagnostics.telemetryAndJoinPlan} onChange={v=>update("diagnostics",{...draft.diagnostics,telemetryAndJoinPlan:v})}/>
   <Prose label="Novelty, seasonality and carryover limits" value={draft.analysisPlan.noveltySeasonalityCarryoverLimits} onChange={v=>update("analysisPlan",{...draft.analysisPlan,noveltySeasonalityCarryoverLimits:v})}/>
   {(["emergencySafetyStop","shipPolicy","rollbackPolicy"] as const).map((field,i)=><Prose key={field} label={["Emergency safety stop rule","Human ship decision policy","Rollback policy"][i]} value={draft.stopRules[field]} onChange={v=>update("stopRules",{...draft.stopRules,[field]:v})}/>)}
  </section>
  <section aria-label="Governance and retention" className="space-y-3"><h3 className="font-medium">Governance and retention</h3>
   <label className="block space-y-2">Approved experiment purpose<select aria-label="Approved experiment purpose" className={selectStyle} value={draft.governanceObligationRefs[0]??""} onChange={e=>update("governanceObligationRefs",[e.target.value,...draft.governanceObligationRefs.slice(1)])} required><option value="">Choose current company policy</option>{!unavailable&&policies.data?.filter(p=>p.companyId===companyId&&p.obligation.framework==="company_policy"&&p.obligation.analyticalPurpose?.status==="approved"&&p.obligation.analyticalPurpose.purpose==="management_intelligence"&&p.obligation.analyticalPurpose.capabilities.includes("experiment")).map(p=><option key={p.id} value={p.id}>{p.obligation.citation}</option>)}</select></label>
   {(["affectedPopulation","legalBasisRationale","fairnessConstraints"] as const).map((field,i)=><Prose key={field} label={["Affected population and no-personal-impact rationale","Legal basis rationale","Fairness constraints"][i]} value={draft.ethics[field]} onChange={v=>update("ethics",{...draft.ethics,[field]:v})}/>)}
   <label className="block space-y-2">Sensitivity<select aria-label="Sensitivity" className={selectStyle} value={draft.sensitivity} onChange={e=>update("sensitivity",e.target.value as "internal"|"confidential")}><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label>
   <Numeric label="Retention (days)" value={draft.retentionDays} onChange={v=>update("retentionDays",v)} min={1} max={3650}/>
   {initial&&<Prose label="Amendment rationale" value={reason} onChange={setReason}/>}
   <p className="text-sm text-muted-foreground">Source and governance expiry may shorten retention. Customer exposure, consent-dependent intervention, employment manipulation and material AI deployment changes require separately qualified authority.</p>
  </section></fieldset>
  {unavailable&&<p role="status">Rechecking current purpose and population authority…</p>}{(policies.isError||projects.isError)&&<p role="alert">Current preregistration sources could not be established.</p>}
  {!valid&&<p className="text-sm text-muted-foreground">Complete every required rationale, select distinct current native measures and register a future period with consistent sample bounds. Hypothesis and safety criteria must be reviewed before recording starts.</p>}
  <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy||!valid}>{busy?"Saving…":"Save experiment proposal"}</Button></div>
 </form>;
}
