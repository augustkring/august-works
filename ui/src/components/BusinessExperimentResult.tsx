import type { BusinessExperimentDefinition,BusinessExperimentAnalysisView } from "@paperclipai/shared";
import type { ExperimentInterpretation } from "@/api/business-experiments";
import { Card,CardContent,CardHeader } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
const percent=(n:number)=>`${formatNumber(n*100)}%`;
const probability=(n:number)=>n===0?"below numerical precision":n<0.001?n.toExponential(3):formatNumber(n);
const points=(n:number)=>`${formatNumber(n*100)} percentage points`;
const resultLabel={pass:"Registered benefit and safety bounds met",fail:"Registered benefit or safety bounds not met",inconclusive:"Evidence remains inconclusive",invalid:"Evidence does not meet the registered quality gates"};
const interpretationLabel={threshold_met:"Benefit threshold met",threshold_not_met:"Benefit threshold not met",harm_excluded:"Registered harm excluded within these bounds",harm_detected:"Registered harm detected",uncertain:"Bounds remain uncertain",exploratory:"Exploratory only"};
const reasonLabel:Record<string,string>={
 experiment_preregistration_or_chronology_unavailable:"The exact preregistration or event order could not be established.",
 experiment_assignment_exposure_telemetry_or_interference_untrusted:"Assignment, exposure, telemetry, baseline balance or concurrent-change gates were not met.",
 experiment_population_budget_or_independence_invalid:"The assigned population exceeded its registered bounds or repeated a unit.",
 experiment_assignment_receipts_invalid:"Exact allocation receipts could not be established.",
 experiment_exposure_receipts_invalid:"Exposure attestation did not match the exact allocation and permitted times.",
 experiment_completion_reason_invalid:"The stopping reason or event order was not admitted.",
 experiment_safety_stop_or_cancellation_withholds_confirmatory_inference:"Safety stopping or cancellation withholds a confirmatory conclusion.",
 experiment_fixed_horizon_not_elapsed:"The registered final horizon had not elapsed.",
 experiment_registered_final_capture_deadline_missed:"The registered deadline for final capture was missed.",
 experiment_sample_ratio_mismatch_untrusted:"Allocation counts differ materially from the registered randomization probability.",
 experiment_prespecified_sample_policy_not_met:"The registered minimum population and units per arm were not reached.",
 experiment_intention_to_treat_outcomes_incomplete:"Complete outcomes for every assigned unit were not available.",
 experiment_exact_outcome_receipts_or_horizon_invalid:"Outcome identity, registered metric or common capture time could not be established.",
 registered_primary_and_all_guardrails_met:"The registered primary benefit and every guardrail met their bounds.",
 registered_primary_not_met_or_guardrail_harm_detected:"The registered primary benefit was not met or a guardrail detected harm.",
 registered_effect_or_guardrail_bounds_inconclusive:"Primary benefit or guardrail bounds remain uncertain.",
};
export function BusinessExperimentResult({analysis,definition,interpretation}:{analysis:BusinessExperimentAnalysisView;definition:BusinessExperimentDefinition;interpretation?:ExperimentInterpretation|null}){
 const result=analysis.result,diagnostics=result.diagnostics,countsAvailable=diagnostics.control+diagnostics.treatment===diagnostics.assigned;
 return <section aria-label="Experiment result" className="min-w-0 space-y-4"><Card><CardHeader><h2 className="font-semibold">{resultLabel[result.status]}</h2><p>One final capture · {new Date(analysis.analyzedAt).toLocaleString()}</p></CardHeader><CardContent className="space-y-4">
  {analysis.currentQualification==="needs_revalidation"&&<p role="status">Current source qualification changed. This is the retained original result; new reliance requires source review.</p>}
  <p>{analysis.causalAuthority==="withheld"?"Causal reliance is withheld.":"Any causal interpretation remains conditional on the registered randomization and human attestations."} Applied exposure and concurrent changes are human reports. Numerical qualification does not grant execution authority.</p>
  <div className="grid gap-3 sm:grid-cols-3"><p>Assigned units<br/><strong>{diagnostics.assigned}</strong></p><p>Control / treatment<br/><strong>{countsAvailable?`${diagnostics.control} / ${diagnostics.treatment}`:"Withheld after quality gate"}</strong></p><p>Reported applied exposure<br/><strong>{countsAvailable?diagnostics.exposed:"Withheld after quality gate"}</strong></p></div>
  <p>Every assigned unit remains in intention-to-treat, including explicit not-applied exposure. Native status was measured at a common final capture after the registered period, rather than reconstructed at period end.</p>
  <ul className="list-disc space-y-2 pl-5">{result.reasons.map(reason=><li key={reason}>{reasonLabel[reason]??"The registered analysis requires further source-owner review."}</li>)}</ul>

 </CardContent></Card>
 {result.metrics.length>0&&<section aria-label="Primary, guardrail and exploratory results" className="space-y-4">{result.metrics.map(metric=>{
  const declaration=[definition.primaryMetric,...definition.guardrailMetrics,...definition.secondaryMetrics].find(d=>d.key===metric.key);
  return <Card key={metric.key}><CardHeader><h3 className="font-medium">{declaration?.name??metric.key} · {metric.role==="primary"?"Primary metric":metric.role==="guardrail"?"Guardrail":"Exploratory metric"}</h3><p>{interpretationLabel[metric.interpretation]}</p></CardHeader><CardContent className="min-w-0 space-y-3">
   <dl className="grid gap-3 sm:grid-cols-3"><div><dt>Control</dt><dd>{metric.control.successes} / {metric.control.units} · {percent(metric.control.rate)}</dd></div><div><dt>Treatment</dt><dd>{metric.treatment.successes} / {metric.treatment.units} · {percent(metric.treatment.rate)}</dd></div><div><dt>Treatment minus control</dt><dd>{points(metric.effect)}</dd></div></dl>
   {metric.interval?<p>Conservative difference interval: {points(metric.interval.lower)} to {points(metric.interval.upper)} · family coverage at least {percent(metric.interval.familywiseCoverage)}.</p>:<p>Exploratory description; no confirmatory interval or success claim.</p>}
   {metric.role==="primary"&&<p>Registered meaningful {definition.primaryMetric.beneficialDirection==="increase"?"increase":"decrease"}: {points(definition.primaryMetric.minimumMeaningfulEffect)}.</p>}
   {metric.role==="guardrail"&&<p>Registered acceptable harm: {points(definition.guardrailMetrics.find(d=>d.key===metric.key)!.maximumAcceptableHarm)} in the {definition.guardrailMetrics.find(d=>d.key===metric.key)!.harmfulDirection==="increase"?"increasing":"decreasing"} direction.</p>}
   <p className="text-sm text-muted-foreground">{declaration?.successDefinition}</p>
  </CardContent></Card>;
 })}</section>}
 {interpretation&&<Card><CardHeader><h3 className="font-medium">Human interpretation · {{ship_candidate:"Ship candidate",do_not_ship:"Do not ship",iterate:"Iterate",abstain:"Abstain"}[interpretation.conclusion]}</h3></CardHeader><CardContent className="space-y-2"><p>{interpretation.rationale}</p><p>Recorded by {interpretation.interpretedBy} · {new Date(interpretation.interpretedAt).toLocaleString()}. Advisory only; execution requires separate native authority.</p></CardContent></Card>}
 <details className="space-y-2"><summary className="cursor-pointer">Inspect evidence quality and balance</summary><div className="space-y-3 pt-3">
  <section aria-label="Registered evidence quality gates" className="space-y-2"><h3 className="font-medium">Registered quality gates</h3><ul className="list-disc space-y-2 pl-5">{([
   ["Complete native assignment receipts",analysis.qualityGates.assignmentReceipts],["Complete human exposure reports",analysis.qualityGates.exposureReports],["Exact native identity joins",analysis.qualityGates.identityJoins],["Registered pretreatment balance",analysis.qualityGates.baselineBalance],["Admitted human concurrent-change review",analysis.qualityGates.concurrentReviewAdmitted],
  ] as const).map(([label,satisfied])=><li key={label}>{label}: {satisfied?"satisfied":"not satisfied"}.</li>)}<li>Final outcome capture: {analysis.qualityGates.finalOutcomeCapture==="not_required_nonconfirmatory_stop"?"withheld for a non-confirmatory stop":analysis.qualityGates.finalOutcomeCapture}.</li></ul></section>
  {diagnostics.srm&&<p>Allocation diagnostic: {diagnostics.srm.mismatch?"material mismatch":"no material mismatch detected"} · exact probability {probability(diagnostics.srm.pValue)} · registered threshold {probability(diagnostics.srm.threshold)}.</p>}
  <section aria-label="Pretreatment balance" className="space-y-2"><h3 className="font-medium">Pretreatment balance</h3>{analysis.invariantDiagnostics.map(item=><p key={item.key}>{definition.diagnostics.invariantMetricRefs.length===1?"Registered invariant":item.key.replaceAll("_"," ")}: {item.balanced?"no registered imbalance detected":"registered imbalance detected"} · exact probability {probability(item.pValue)} · family-adjusted threshold {probability(item.threshold)}.</p>)}<p className="text-sm text-muted-foreground">These diagnostics do not prove that all confounders or external interference were observed.</p></section>
 </div></details>
 <details className="space-y-2"><summary className="cursor-pointer">Inspect limitations and traceability</summary><ul className="list-disc space-y-2 py-3 pl-5">{result.limitations.map((limit,index)=><li key={index}>{limit}</li>)}</ul><p>Human concurrent-change review: {analysis.concurrentChangeReview.assessment==="none_identified"?"none identified":"material or unknown"} · {analysis.concurrentChangeReview.rationale}</p><p className="break-all text-sm">Definition {analysis.definitionHash} · analysis receipt {analysis.receiptHash}</p></details>
 </section>;
}
