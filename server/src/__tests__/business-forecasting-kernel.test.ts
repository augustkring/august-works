import {describe,expect,it} from "vitest";
import {businessForecastDefinitionSchema,type BusinessForecastDefinition,type BusinessForecastSeriesPoint} from "@paperclipai/shared";
import {evaluateNativeBusinessForecast,nativeBusinessForecastValues} from "../services/business-forecasting/kernel.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,DAY=86_400_000,START=Date.parse("2026-01-01T00:00:00Z");
const definition=(candidate:BusinessForecastDefinition["candidate"]={kind:"naive"})=>businessForecastDefinitionSchema.parse({name:"Native created-object demand",businessQuestion:"What level might the next observed windows reach?",decisionUse:"Inform a human-owned business review without changing commitments",ownerUserId:"local-board",metricId:id(1),metricVersionId:id(2),scope:{type:"company",id:null},frequency:"daily_utc",horizon:2,provider:"aw_native",candidate,baselines:[{kind:"naive"},{kind:"drift"},{kind:"moving_average",window:3}],minimumHistory:10,captureLatencySeconds:60,
  backtest:{minimumTrainingPoints:4,minimumOrigins:3,gapPeriods:1,maximumMAE:100,minimumRelativeMAEImprovement:0.1},knownFailureModes:["Unexpected regime changes can invalidate simple native baselines"],sensitivity:"internal",purpose:"management_intelligence",governanceObligationRefs:[id(3)],retentionDays:30});
const series=(values:number[]):BusinessForecastSeriesPoint[]=>values.map((value,index)=>({observationId:id(index+10),metricId:id(1),metricVersionId:id(2),sourceHash:"a".repeat(64),from:new Date(START+index*DAY).toISOString(),until:new Date(START+(index+1)*DAY).toISOString(),asOf:new Date(START+(index+1)*DAY+300).toISOString(),value,status:"observed",unit:"count"}));
const cutoff=(points:BusinessForecastSeriesPoint[])=>points[points.length-1].asOf;
describe("Native business forecast baselines and time-safe qualification",()=>{
  it("computes explicit last-value, moving-average, drift and seasonal-naive baselines",()=>{
    expect(nativeBusinessForecastValues([1,2,3],{kind:"naive"},2)).toEqual([3,3]);
    expect(nativeBusinessForecastValues([1,2,3],{kind:"moving_average",window:2},2)).toEqual([2.5,2.5]);
    expect(nativeBusinessForecastValues([1,2,3],{kind:"drift"},2,1)).toEqual([5,6]);
    expect(nativeBusinessForecastValues([10,20,11,21],{kind:"seasonal_naive",seasonLength:2},3,1)).toEqual([21,11,21]);
  });
  it("retains rolling origins, baseline comparisons, horizon losses and explicit unavailable intervals",()=>{
    const points=series(Array.from({length:12},()=>10)),result=evaluateNativeBusinessForecast(definition(),points,cutoff(points));
    expect(result.status).toBe("qualified");expect(result.backtests).toHaveLength(3);expect(result.comparisons).toHaveLength(3);
    expect(result.points.map(point=>point.value)).toEqual([10,10]);expect(result.points.every(point=>point.interval===null&&Date.parse(point.from)>=Date.parse(cutoff(points)))).toBe(true);
    expect(result.uncertainty).toMatchObject({method:"unavailable",coverageLevel:null});
    expect(result.comparisons[0].loss).toMatchObject({mae:0,bias:0,mase:null,zeroNaiveScale:true,byHorizon:[{horizon:1,cases:3,mae:0},{horizon:2,cases:3,mae:0}]});
  });
  it("never uses future values in an earlier fold's predictions or MASE training scale",()=>{
    const points=series(Array.from({length:12},(_,index)=>index+1)),initial=evaluateNativeBusinessForecast(definition({kind:"drift"}),points,cutoff(points)),first=initial.backtests[0];
    const changed=points.map((point,index)=>({...point,value:index>=first.origin?10000+index:point.value})),later=evaluateNativeBusinessForecast(definition({kind:"drift"}),changed,cutoff(changed));
    expect(later.backtests[0].predictions.map(item=>item.values)).toEqual(first.predictions.map(item=>item.values));
    expect(later.backtests[0].trainingObservationIds).toEqual(first.trainingObservationIds);
    expect(later.backtests[0].predictions[0].loss.mase).toBe(later.backtests[0].predictions[0].loss.mae);
    for(const fold of initial.backtests) expect(Date.parse(fold.trainingCutoff)).toBeLessThanOrEqual(Date.parse(points.find(point=>point.observationId===fold.testObservationIds[0])!.from));
    expect(initial.status).toBe("qualified");expect(initial.comparisons[0].loss.mae).toBe(0);
  });
  it("abstains on missing, late, duplicate, reordered, discontinuous and mixed-unit observations",()=>{
    const points=series(Array.from({length:12},(_,index)=>index));
    const cases=[points.map((point,index)=>index===5?{...point,value:null}:point),points.map((point,index)=>index===5?{...point,asOf:new Date(Date.parse(point.until)+61000).toISOString()}:point),points.map((point,index)=>index===5?{...point,observationId:points[4].observationId}:point),[...points.slice(0,4),points[5],points[4],...points.slice(6)],points.map((point,index)=>index===5?{...point,from:new Date(Date.parse(point.from)+DAY).toISOString()}:point),points.map((point,index)=>index===5?{...point,unit:"currency"}:point)];
    for(const history of cases) {const result=evaluateNativeBusinessForecast(definition(),history,cutoff(points));expect(result.status).toBe("data_not_ready");expect(result.points).toEqual([]);expect(result.reasons.length).toBeGreaterThan(0);}
  });
  it("does not qualify a complex baseline merely because it exists or exceeds a human loss limit",()=>{
    const points=series(Array.from({length:12},()=>10));
    expect(evaluateNativeBusinessForecast(definition({kind:"moving_average",window:3}),points,cutoff(points))).toMatchObject({status:"not_qualified",reasons:["declared_naive_improvement_not_met"],points:[]});
    const tied=definition({kind:"moving_average",window:3});tied.backtest.minimumRelativeMAEImprovement=0;
    expect(evaluateNativeBusinessForecast(tied,points,cutoff(points))).toMatchObject({status:"not_qualified",reasons:["declared_naive_improvement_not_met"]});
    const trend=series(Array.from({length:12},(_,index)=>index*10));const strict=definition();strict.backtest.maximumMAE=0;
    expect(evaluateNativeBusinessForecast(strict,trend,cutoff(trend))).toMatchObject({status:"not_qualified",reasons:["declared_loss_limit_not_met"],points:[]});
  });
  it("keeps zero denominators explicit and never fabricates a WAPE or MASE score",()=>{
    const points=series(Array.from({length:12},()=>0)),result=evaluateNativeBusinessForecast(definition(),points,cutoff(points));
    expect(result.comparisons[0].loss).toMatchObject({wape:null,mase:null,zeroActualDenominator:true,zeroNaiveScale:true});
  });
  it("rejects inadequate seasonal folds, absent naive comparisons and unsupported providers",()=>{
    expect(businessForecastDefinitionSchema.safeParse({...definition(),candidate:{kind:"seasonal_naive",seasonLength:5}}).success).toBe(false);
    expect(businessForecastDefinitionSchema.safeParse({...definition(),baselines:[{kind:"drift"}]}).success).toBe(false);
    expect(businessForecastDefinitionSchema.safeParse({...definition(),provider:"statsforecast"}).success).toBe(false);
  });
  it("abstains on arithmetic overflow and on a cutoff before observed evidence is available",()=>{
    const points=series(Array.from({length:12},(_,index)=>index%2?1e308:-1e308));expect(evaluateNativeBusinessForecast(definition({kind:"drift"}),points,cutoff(points))).toMatchObject({status:"data_not_ready",points:[]});
    const ordinary=series(Array.from({length:12},()=>10));expect(evaluateNativeBusinessForecast(definition(),ordinary,ordinary[11].until)).toMatchObject({status:"data_not_ready",reasons:["unsafe_or_late_measurement_capture"]});
    expect(evaluateNativeBusinessForecast(definition(),ordinary,new Date(Date.parse(ordinary[11].until)+3*DAY).toISOString())).toMatchObject({status:"data_not_ready",reasons:["latest_history_is_stale"]});
  });
});
