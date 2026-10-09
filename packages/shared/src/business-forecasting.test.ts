import {describe,expect,it} from "vitest";
import {businessForecastDefinitionSchema,backtestBusinessForecastSchema,publishBusinessForecastSpecSchema} from "./business-forecasting.js";
const uuid="11111111-1111-4111-8111-111111111111";
const definition=()=>({name:"Native forecast",businessQuestion:"What demand should humans review?",decisionUse:"Advisory capacity review by a human",ownerUserId:"board-user",metricId:uuid,metricVersionId:uuid,scope:{type:"company",id:null},frequency:"daily_utc",horizon:1,provider:"aw_native",candidate:{kind:"naive"},baselines:[{kind:"naive"}],minimumHistory:8,captureLatencySeconds:60,backtest:{minimumTrainingPoints:3,minimumOrigins:3,gapPeriods:1,maximumMAE:1,minimumRelativeMAEImprovement:0},knownFailureModes:["Operational counts do not establish causal impact"],purpose:"management_intelligence",sensitivity:"internal",governanceObligationRefs:[uuid],retentionDays:30});
describe("Native business forecasting public contracts",()=>{
 it("admits exact observation identities while rejecting caller-supplied copied facts and hashes",()=>{
  const input={expectedRevision:1,versionId:uuid,observationIds:[uuid,"22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444"],cutoff:"2026-10-07T00:00:00Z"};
  expect(backtestBusinessForecastSchema.safeParse(input).success).toBe(true);
  for(const field of ["series","result","inputHash","sourceHash","values","engineVersion"]) expect(backtestBusinessForecastSchema.safeParse({...input,[field]:[]}).success).toBe(false);
  expect(backtestBusinessForecastSchema.safeParse({...input,observationIds:Array(4).fill(uuid)}).success).toBe(false);
 });
 it("requires an actual pinned backtest and separate human rationale for publication",()=>{
  expect(publishBusinessForecastSpecSchema.safeParse({expectedRevision:1,versionId:uuid,backtestId:uuid,rationale:"Human approval of a retained native backtest"}).success).toBe(true);
  expect(publishBusinessForecastSpecSchema.safeParse({expectedRevision:1,versionId:uuid,rationale:"Attempt to publish without a pinned backtest"}).success).toBe(false);
  expect(publishBusinessForecastSpecSchema.safeParse({expectedRevision:1,versionId:uuid,backtestId:uuid,rationale:"auto"}).success).toBe(false);
 });
 it("admits only an exact statistical model/profile pair with sufficient seasonal training",()=>{
  const profile={provider:"statsforecast",version:"2.1.1",python:"3.12.14",bundleHash:"a".repeat(64),conformanceHash:"b".repeat(64)},input={...definition(),provider:"statsforecast",providerProfile:profile,candidate:{kind:"auto_ets",seasonLength:1}};
  expect(businessForecastDefinitionSchema.safeParse(input).success).toBe(true);
  for(const invalid of [{...input,providerProfile:undefined},{...input,provider:"aw_native"},{...input,candidate:{kind:"naive"}},{...input,candidate:{kind:"auto_theta",seasonLength:1}},{...input,providerProfile:{...profile,version:"latest"}},{...input,providerProfile:{...profile,endpoint:"https://example.test"}},{...input,candidate:{kind:"auto_arima",seasonLength:7}}]) expect(businessForecastDefinitionSchema.safeParse(invalid).success).toBe(false);
  expect(businessForecastDefinitionSchema.safeParse({...input,candidate:{kind:"auto_arima",seasonLength:7},minimumHistory:20,backtest:{...input.backtest,minimumTrainingPoints:14}}).success).toBe(true);
 });
 it("does not admit external providers, fabricated intervals, weak baselines or insufficient chronological folds",()=>{
  expect(businessForecastDefinitionSchema.safeParse(definition()).success).toBe(true);
  for(const provider of ["statsforecast","darts","python","llm"]) expect(businessForecastDefinitionSchema.safeParse({...definition(),provider}).success).toBe(false);
  expect(businessForecastDefinitionSchema.safeParse({...definition(),confidence:0.95}).success).toBe(false);
  expect(businessForecastDefinitionSchema.safeParse({...definition(),baselines:[{kind:"drift"}]}).success).toBe(false);
  expect(businessForecastDefinitionSchema.safeParse({...definition(),minimumHistory:4}).success).toBe(false);
 });
});
