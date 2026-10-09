import {describe,expect,it} from "vitest";
import {finishDecisionOutcomeReviewSchema} from "./decision-outcome-reviews.js";
const judgment={kind:"human_judgment",assessment:"unknown",explanation:"An explicit human assessment with limited evidence",evidenceKeys:[]};
const input=()=>({expectedRevision:2,result:"inconclusive",lessonSummary:"A separate outcome cannot prove that the choice was good",
  assessments:{decisionProcessQuality:judgment,assumptionAccuracy:judgment,executionFidelity:judgment,externalChange:judgment,observedOutcome:judgment,causalConfidence:{assessment:"not_assessed",explanation:"There is no identified native causal estimate"}},
  actualMetrics:[],metricOutcomes:[],qualitativeOutcomes:[],assumptionOutcomes:[]});
describe("Native decision outcome review epistemic contract",()=>{
  it("requires six separate assessments and rejects a caller causal claim",()=>{
    expect(finishDecisionOutcomeReviewSchema.safeParse(input()).success).toBe(true);
    const missing={...input(),assessments:{...input().assessments,externalChange:undefined}};
    expect(finishDecisionOutcomeReviewSchema.safeParse(missing).success).toBe(false);
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),causalClaimRef:"invented"}).success).toBe(false);
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),assessments:{...input().assessments,causalConfidence:{assessment:"causal_proof",explanation:"A later value increased after the choice"}}}).success).toBe(false);
  });
  it("rejects measurement copies and confidence probabilities in human judgments",()=>{
    const source={type:"metric_observation",id:"00000000-0000-4000-8000-000000000001",metricId:"00000000-0000-4000-8000-000000000002",metricVersionId:"00000000-0000-4000-8000-000000000003"};
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),actualMetrics:[{key:"actual",source}]}).success).toBe(true);
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),actualMetrics:[{key:"actual",source,value:42}]}).success).toBe(false);
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),assessments:{...input().assessments,decisionProcessQuality:{...judgment,confidence:0.95}}}).success).toBe(false);
  });
  it("requires unique declared actual pins and a single assessment per expectation",()=>{
    const qualitative={expectationIndex:0,kind:"human_judgment",assessment:"inconclusive",explanation:"Human review records explicitly incomplete evidence",evidenceKeys:[]};
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),qualitativeOutcomes:[qualitative,qualitative]}).success).toBe(false);
    expect(finishDecisionOutcomeReviewSchema.safeParse({...input(),metricOutcomes:[{expectationIndex:0,actualEvidenceKey:"absent"}]}).success).toBe(false);
  });
});
