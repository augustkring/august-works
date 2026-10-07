import {describe,expect,it} from "vitest";
import {decisionContextDefinitionSchema,decisionEvidenceReferenceSchema,proposeDecisionContextSchema} from "./decision-intelligence.js";
const uuid="11111111-1111-4111-8111-111111111111";
const definition=()=>({question:"Should we pursue this option?",objective:"Review useful business outcomes",ownerUserId:"human",scope:{type:"company",id:null},
  timeHorizon:{from:"2026-10-07T00:00:00Z",until:"2027-01-01T00:00:00Z"},uncertaintySummary:"External conditions remain uncertain",revisitAt:null,
  sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[uuid],retentionDays:30,evidence:[],assumptions:[],
  criteria:[{key:"delivery",name:"Delivery",description:"Capacity to deliver the option",type:"qualitative",priority:"high",evidenceKey:null}],
  expectedOutcomes:[{kind:"qualitative",optionId:"proceed",statement:"Observe delivery within the horizon",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Capacity may change during delivery"}]});
describe("Prospective native decision context contract",()=>{
  it("admits qualitative judgment without a fabricated score or calibrated probability",()=>{
    expect(decisionContextDefinitionSchema.parse(definition()).criteria[0].type).toBe("qualitative");
    expect(proposeDecisionContextSchema.safeParse({expectedRevision:0,definition:{...definition(),confidence:0.97}}).success).toBe(false);
  });
  it("requires ordered explicit horizons and final review after their end",()=>{
    const input=definition();input.timeHorizon.until=input.timeHorizon.from;expect(decisionContextDefinitionSchema.safeParse(input).success).toBe(false);
    const early=definition();early.expectedOutcomes[0].reviewAt="2026-10-08T00:00:00Z";expect(decisionContextDefinitionSchema.safeParse(early).success).toBe(false);
  });
  it("rejects undeclared measurement and criterion pins and duplicated material keys",()=>{
    const input=definition();input.criteria.push({...input.criteria[0]});expect(decisionContextDefinitionSchema.safeParse(input).success).toBe(false);
    expect(decisionContextDefinitionSchema.safeParse({...definition(),criteria:[{...definition().criteria[0],type:"measured",evidenceKey:"missing"}]}).success).toBe(false);
    expect(decisionContextDefinitionSchema.safeParse({...definition(),expectedOutcomes:[{kind:"metric",optionId:"proceed",evidenceKey:"missing",expectedRange:{lower:1,upper:3},expectedDirection:"increase",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Uncertainty is a human interval judgment"}]}).success).toBe(false);
  });
  it("keeps human intervals ordered and refuses caller-owned copied facts",()=>{
    const link={key:"baseline",source:{type:"metric_observation",id:uuid,metricId:uuid,metricVersionId:uuid},relationship:"metric_observation",optionId:null,criterionKey:null,rationale:"Baseline from a pinned native observation"};
    const input={...definition(),evidence:[link],expectedOutcomes:[{kind:"metric",optionId:"proceed",evidenceKey:"baseline",expectedRange:{lower:10,upper:20},expectedDirection:"increase",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"Uncalibrated human expected outcome range"}]};
    expect(decisionContextDefinitionSchema.safeParse(input).success).toBe(true);
    expect(decisionContextDefinitionSchema.safeParse({...input,evidence:[{...link,facts:{value:10}}]}).success).toBe(false);
    expect(decisionContextDefinitionSchema.safeParse({...input,expectedOutcomes:[{...input.expectedOutcomes[0],expectedRange:{lower:20,upper:10}}]}).success).toBe(false);
    expect(decisionContextDefinitionSchema.safeParse({...input,evidence:[{...link,relationship:"supports_option"}]}).success).toBe(false);
  });
  it("admits exact calculation pins as advisory evidence without relabeling them measured baselines",()=>{
    const sources=[{type:"forecast_run",id:uuid,specId:uuid,versionId:uuid,pointIndex:0},{type:"scenario_run",id:uuid,scenarioId:uuid,versionId:uuid,caseKey:"option",outputKey:"capacity"}];
    for(const source of sources) {
      const link={key:"calculation",source,relationship:"supports_option",optionId:"proceed",criterionKey:null,rationale:"Human interpretation of exact conditional evidence"};
      expect(decisionContextDefinitionSchema.safeParse({...definition(),evidence:[link]}).success).toBe(true);
      expect(decisionEvidenceReferenceSchema.safeParse({...source,value:123}).success).toBe(false);
      expect(decisionEvidenceReferenceSchema.safeParse({...source,contentHash:"f".repeat(64)}).success).toBe(false);
      expect(decisionContextDefinitionSchema.safeParse({...definition(),evidence:[link],criteria:[{...definition().criteria[0],type:"measured",evidenceKey:"calculation"}]}).success).toBe(false);
      expect(decisionContextDefinitionSchema.safeParse({...definition(),evidence:[link],expectedOutcomes:[{kind:"metric",optionId:"proceed",evidenceKey:"calculation",expectedRange:{lower:1,upper:3},expectedDirection:"increase",reviewAt:"2027-01-02T00:00:00Z",uncertaintySummary:"A conditional calculation is not a measured baseline"}]}).success).toBe(false);
    }
    expect(decisionEvidenceReferenceSchema.safeParse({...sources[0],pointIndex:60}).success).toBe(false);
  });
});
