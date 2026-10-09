import { describe,expect,it } from "vitest";
import { causalClaimDefinitionSchema,createCausalClaimSchema } from "@paperclipai/shared";
import { evaluateNativeCausalClaim } from "../services/causal-claims/kernel.js";
import { causalClaimFixture } from "./helpers/causal-claim-fixture.js";
describe("Native causal interpretation of synthetic prequalified receipts",()=>{
 it("preserves registered estimate and safety boundaries with explicit conditional authority and unknown sensitivity",()=>{
  const f=causalClaimFixture(),result=evaluateNativeCausalClaim(f.definition,f.source);
  expect(result).toMatchObject({status:"supported",evidenceGrade:"randomized_experiment",identification:{status:"conditional_identified"},estimate:{effect:0.6,interval:f.source.analysis.result.metrics[0].interval},robustness:{providerRefutations:"not_run",sensitivity:"unknown",assumptions:"human_assumed"},executionAuthority:"advisory_only",language:"conditional_assignment_effect_on_native_proxy"});
  expect(result.limitations.join(" ")).toContain("not a reconstructed period-end state or verified business/task outcome");expect(evaluateNativeCausalClaim(f.definition,f.source)).toEqual(result);
 });
 it.each(["backdoor_adjustment","instrumental_variables","regression_discontinuity","difference_in_differences","association_only"] as const)("withholds estimation for unsupported identification %s",strategy=>{
  const f=causalClaimFixture();f.definition.identificationStrategy=strategy;expect(evaluateNativeCausalClaim(f.definition,f.source)).toMatchObject({status:"inconclusive",identification:{status:"unsupported"},estimate:null,language:"causal_reliance_withheld"});
 });
 it("abstains without evidence, for unknown/violated assumptions and for unqualified/changed source admission",()=>{
  const f=causalClaimFixture();expect(evaluateNativeCausalClaim(f.definition,null)).toMatchObject({evidenceGrade:"descriptive_only",estimate:null});
  for(const status of ["unknown","violated"] as const){const d=structuredClone(f.definition);d.assumptions.noInterference.status=status;expect(evaluateNativeCausalClaim(d,f.source)).toMatchObject({status:"inconclusive",identification:{status:"assumptions_not_admitted"},estimate:null});}
  for(const change of [(s:typeof f.source)=>{s.analysis.currentQualification="needs_revalidation";},(s:typeof f.source)=>{s.analysis.qualityGates.baselineBalance=false;},(s:typeof f.source)=>{s.analysis.qualityGates.exposureReports=false;},(s:typeof f.source)=>{s.analysis.result.diagnostics.srm!.mismatch=true;},(s:typeof f.source)=>{s.analysis.result.numericallyQualified=false;}]){const source=structuredClone(f.source);change(source);expect(evaluateNativeCausalClaim(f.definition,source)).toMatchObject({identification:{status:"source_not_qualified"},estimate:null});}
 });
 it("does not substitute a post-hoc threshold, different endpoint, horizon, population or interpretation",()=>{
  const f=causalClaimFixture();for(const change of [(d:typeof f.definition)=>{d.estimand.minimumMeaningfulEffect=0.05;},(d:typeof f.definition)=>{d.outcomeMetricId=d.outcomeMetricVersionId;},(d:typeof f.definition)=>{d.horizon.until=new Date(Date.parse(d.horizon.until)+1000).toISOString();},(d:typeof f.definition)=>{d.population.unit="project";},(d:typeof f.definition)=>{d.experimentEvidence!.interpretationId=d.outcomeMetricId;}]){const d=structuredClone(f.definition);change(d);expect(evaluateNativeCausalClaim(d,f.source)).toMatchObject({identification:{status:"unsupported"},estimate:null});}
 });
 it("does not turn detected harm into a supported winner and distinguishes refuted minimum benefit",()=>{
  const f=causalClaimFixture();f.source.analysis.result.status="fail";f.source.analysis.result.metrics[1].interpretation="harm_detected";
  expect(evaluateNativeCausalClaim(f.definition,f.source)).toMatchObject({status:"inconclusive",robustness:{guardrails:"harm_detected"}});
  f.source.analysis.result.metrics[0].interpretation="threshold_not_met";expect(evaluateNativeCausalClaim(f.definition,f.source).status).toBe("refuted");
 });
 it("rejects cycles/repeated edges and graph facts promoted from human assumptions",()=>{
  const f=causalClaimFixture(),reverse={...f.definition.graph.edges[0],from:"outcome",to:"assignment"};expect(causalClaimDefinitionSchema.safeParse({...f.definition,graph:{...f.definition.graph,edges:[...f.definition.graph.edges,reverse]}}).success).toBe(false);
  expect(causalClaimDefinitionSchema.safeParse({...f.definition,graph:{...f.definition.graph,edges:[...f.definition.graph.edges,...f.definition.graph.edges]}}).success).toBe(false);
  expect(createCausalClaimSchema.safeParse({key:"claim",definition:{...f.definition,confidence:0.99}}).success).toBe(false);
  expect(causalClaimDefinitionSchema.safeParse({...f.definition,graph:{...f.definition.graph,edges:[{...f.definition.graph.edges[0],authority:"established_truth"}]}}).success).toBe(false);
 });
 it("retains unsupported identification for a graph that makes assignment confounded",()=>{
  const f=causalClaimFixture();f.definition.graph.nodes.push({key:"factor",role:"unobserved",label:"Unobserved selection factor"});f.definition.graph.edges.push({from:"factor",to:"assignment",authority:"human_assumption",rationale:"Synthetic confounding graph assumption for qualification"});expect(evaluateNativeCausalClaim(f.definition,f.source)).toMatchObject({status:"inconclusive",identification:{status:"unsupported"},estimate:null});
 });
});
