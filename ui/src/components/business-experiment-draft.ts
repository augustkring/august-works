import type { BusinessExperimentDefinition } from "@paperclipai/shared";
/** Empty reasoned proposal: no fabricated hypothesis, consent, evidence or
 * human approval. The strict shared contract blocks saving until completed. */
export function emptyBusinessExperimentDefinition(ownerUserId:string):BusinessExperimentDefinition{
 const metric=(key:string)=>({key,name:"",metricId:"",metricVersionId:"",outcome:"binary" as const,successDefinition:""});
 return {name:"",hypothesis:"",decisionQuestion:"",decisionId:null,ownerUserId,scope:{type:"company",id:null},design:"individual_randomized_two_arm_binary",population:{randomizationUnit:"issue",eligibility:"",trigger:"",externalValidityLimits:""},treatment:"",control:"",
 executionPlan:{mode:"recording_only_human_attested_native_process",exposureProvenance:"human_attestation",exposureTimeSemantics:"human_asserted_event_time",outcomeTimeSemantics:"created_in_window_current_state_at_common_final_capture"},assignment:{method:"hmac_sha256_48_v1",treatmentProbability:0.5},
 primaryMetric:{...metric("primary"),beneficialDirection:"increase",minimumMeaningfulEffect:0.1},secondaryMetrics:[],guardrailMetrics:[{...metric("guardrail_1"),harmfulDirection:"increase",maximumAcceptableHarm:0.1}],
 diagnostics:{srmAlpha:0.001,invariantMetricRefs:[""],invariantBalance:{method:"exact_fisher_probability_ordering_v1",familywiseAlpha:0.001},concurrentExperimentAndInterferencePlan:"",telemetryAndJoinPlan:""},
 analysisPlan:{finalCaptureMaxDelaySeconds:3600,method:"bonferroni_clopper_pearson_difference_v1",familywiseAlpha:0.05,estimand:"intention_to_treat",missingOutcomes:"invalidate",multipleComparisonPolicy:"primary_and_guardrails_familywise_secondary_exploratory",noveltySeasonalityCarryoverLimits:""},
 sampleOrDurationPlan:{kind:"fixed_horizon",from:"",until:"",minimumAssignedUnits:20,maximumAssignedUnits:100,minimumUnitsPerArm:2,minimumDetectableEffect:0.1,powerRationale:""},stopRules:{efficacyLooks:"one_after_fixed_horizon",emergencySafetyStop:"",shipPolicy:"",rollbackPolicy:""},
 ethics:{affectedPopulation:"",personImpact:"none",legalBasisRationale:"",requiresConsent:false,consentGovernanceObligationRef:null,darkPatterns:false,hiddenEmploymentManipulation:false,changesMaterialAiDecisions:false,aiUseCaseId:null,fairnessConstraints:""},sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[],retentionDays:30};
}
