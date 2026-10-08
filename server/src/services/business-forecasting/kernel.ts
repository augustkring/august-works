import {businessForecastDefinitionSchema,nativeBusinessForecastModelSchema,type BusinessForecastDefinition,type NativeBusinessForecastModel,type BusinessForecastSeriesPoint,type BusinessForecastLoss,type BusinessForecastFold,type NativeBusinessForecastResult} from "@paperclipai/shared";
import {nativeSha256} from "../native-runtime/canonical.js";
const DAY=86_400_000,VERSION="aw-native-business-forecast-v1" as const;
const period=(definition:BusinessForecastDefinition)=>definition.frequency==="daily_utc"?DAY:7*DAY;
function finite(value:number) {if(!Number.isFinite(value)) throw new Error("non_finite_forecast_arithmetic");return value;}
export function nativeBusinessForecastValues(history:number[],model:NativeBusinessForecastModel,horizon:number,gapPeriods=0) {
  model=nativeBusinessForecastModelSchema.parse(model);
  if(!history.length || history.length>1000 || history.some(value=>!Number.isFinite(value)) || !Number.isInteger(horizon) || horizon<1 || horizon>60 || !Number.isInteger(gapPeriods) || gapPeriods<0 || gapPeriods>1000) throw new Error("invalid_native_forecast_input");
  const n=history.length,last=history[n-1];
  if(model.kind==="seasonal_naive" && n<model.seasonLength || model.kind==="moving_average" && n<model.window || model.kind==="drift"&&n<2) throw new Error("insufficient_model_history");
  const average=model.kind==="moving_average"?finite(history.slice(-model.window).reduce((sum,value)=>finite(sum+value),0)/model.window):last;
  const slope=model.kind==="drift"?finite((last-history[0])/(n-1)):0;
  return Array.from({length:horizon},(_,index)=>finite(model.kind==="naive"?last:model.kind==="moving_average"?average:model.kind==="drift"?last+slope*(gapPeriods+index+1):history[n-model.seasonLength+(gapPeriods+index)%model.seasonLength]));
}
export function loss(predicted:number[],actual:number[],scale:number,horizon:number):BusinessForecastLoss {
  const error=predicted.map((value,index)=>finite(value-actual[index])),absolute=error.map(Math.abs),denominator=finite(actual.reduce((sum,value)=>finite(sum+Math.abs(value)),0));
  const mae=finite(absolute.reduce((sum,value)=>finite(sum+value),0)/error.length),bias=finite(error.reduce((sum,value)=>finite(sum+value),0)/error.length);
  return {mae,bias,wape:denominator===0?null:finite(absolute.reduce((sum,value)=>finite(sum+value),0)/denominator),mase:scale===0?null:finite(mae/scale),zeroActualDenominator:denominator===0,zeroNaiveScale:scale===0,
    byHorizon:Array.from({length:horizon},(_,index)=>{const errors=error.filter((_,position)=>position%horizon===index);return {horizon:index+1,cases:errors.length,mae:finite(errors.reduce((sum,value)=>finite(sum+Math.abs(value)),0)/errors.length),bias:finite(errors.reduce((sum,value)=>finite(sum+value),0)/errors.length)};})};
}
/** Deterministic arithmetic only. The native owner must admit every observation,
 * purpose, retention, unit and current source before invoking this kernel. */
export function evaluateNativeBusinessForecast(raw:BusinessForecastDefinition,series:BusinessForecastSeriesPoint[],cutoff:string):NativeBusinessForecastResult {
  const definition=businessForecastDefinitionSchema.parse(raw);
  if(definition.provider!=="aw_native") throw new Error("unsupported_native_forecast_provider");
  const candidate=nativeBusinessForecastModelSchema.parse(definition.candidate),inputHash=nativeSha256(series),definitionHash=nativeSha256(definition),ms=period(definition),cutoffMs=Date.parse(cutoff);
  const result:NativeBusinessForecastResult={engineVersion:VERSION,status:"data_not_ready",reasons:[],inputHash,definitionHash,unit:series[0]?.unit??null,trainingObservationIds:series.map(point=>point.observationId),backtests:[],comparisons:[],selectedReason:null,points:[],
    uncertainty:{method:"unavailable",coverageLevel:null,reason:"These native point baselines have no qualified prediction intervals."},
    limitations:["Forecasts do not change a target, committed budget, roadmap or native Decision.","Observed status at capture is not a reconstructed historical period-boundary state.","Missing/late observations are not imputed; exact native metric semantics and capture latency must hold.",...definition.knownFailureModes]};
  const reject=(reason:string)=>{result.reasons.push(reason);return result;};
  if(series.length<definition.minimumHistory || series.length>1000) return reject("history_policy_not_met");
  if(!Number.isFinite(cutoffMs)) return reject("invalid_forecast_cutoff");
  if(new Set(series.map(point=>point.observationId)).size!==series.length) return reject("duplicate_observation_pin");
  for(let index=0;index<series.length;index++) {
    const point=series[index],from=Date.parse(point.from),until=Date.parse(point.until),asOf=Date.parse(point.asOf);
    if(point.metricId!==definition.metricId || point.metricVersionId!==definition.metricVersionId || point.unit!==result.unit || !/^[0-9a-f]{64}$/.test(point.sourceHash)) return reject("inconsistent_native_measurement_pins");
    if(point.status!=="observed" || point.value===null || !Number.isFinite(point.value)) return reject("missing_native_measurement");
    if(![from,until,asOf].every(Number.isFinite) || until-from!==ms || from%DAY!==0 || asOf<until || asOf>until+definition.captureLatencySeconds*1000 || asOf>cutoffMs || until>cutoffMs) return reject("unsafe_or_late_measurement_capture");
    if(index>0 && (from!==Date.parse(series[index-1].until) || asOf<Date.parse(series[index-1].asOf))) return reject("nonconsecutive_or_reordered_history");
  }
  const latest=series[series.length-1];if(cutoffMs-Date.parse(latest.until)>2*ms) return reject("latest_history_is_stale");
  const models=[candidate,...definition.baselines.filter(model=>nativeSha256(model)!==nativeSha256(candidate))];
  const n=series.length,h=definition.horizon,gap=definition.backtest.gapPeriods,first=definition.backtest.minimumTrainingPoints,last=n-gap-h;
  const origins=Array.from({length:Math.max(0,last-first+1)},(_,index)=>first+index).slice(-definition.backtest.minimumOrigins);
  if(origins.length<definition.backtest.minimumOrigins) return reject("insufficient_rolling_origins");
  try {
    for(const origin of origins) {
      const train=series.slice(0,origin),test=series.slice(origin+gap,origin+gap+h),availableAt=Math.max(...train.map(point=>Date.parse(point.asOf)));
      if(availableAt>Date.parse(test[0].from)) return reject("training_evidence_unavailable_at_origin");
      const history=train.map(point=>point.value!),actual=test.map(point=>point.value!),scale=history.slice(1).reduce((sum,value,index)=>finite(sum+Math.abs(value-history[index])),0)/(history.length-1);
      const fold:BusinessForecastFold={origin,trainingObservationIds:train.map(point=>point.observationId),trainingCutoff:new Date(availableAt).toISOString(),testObservationIds:test.map(point=>point.observationId),gapPeriods:gap,
        predictions:models.map(model=>{const values=nativeBusinessForecastValues(history,model,h,gap);return {model,values,actual,loss:loss(values,actual,scale,h)};})};result.backtests.push(fold);
    }
    // Fold-specific MASE denominators use training data only. Aggregate MASE is
    // the mean of those fold values; no future actual value defines the scale.
    result.comparisons=models.map((model,index)=>{
      const folds=result.backtests.map(fold=>fold.predictions[index]),values=folds.flatMap(fold=>fold.values),actual=folds.flatMap(fold=>fold.actual),summary=loss(values,actual,0,h),scales=folds.map(fold=>fold.loss.mase);
      summary.mase=scales.some(value=>value===null)?null:finite(scales.reduce<number>((sum,value)=>finite(sum+value!),0)/scales.length);summary.zeroNaiveScale=scales.some(value=>value===null);return {model,loss:summary};
    });
    const candidateLoss=result.comparisons[0].loss,naive=result.comparisons.find(item=>item.model.kind==="naive")!.loss;
    const improvement=naive.mae===0?candidateLoss.mae===0?0:-1:finite((naive.mae-candidateLoss.mae)/naive.mae);
    if(candidateLoss.mae>definition.backtest.maximumMAE || candidate.kind!=="naive"&&(improvement<=0 || improvement<definition.backtest.minimumRelativeMAEImprovement)) {
      result.status="not_qualified";result.reasons=[candidateLoss.mae>definition.backtest.maximumMAE?"declared_loss_limit_not_met":"declared_naive_improvement_not_met"];return result;
    }
    const futureGap=Math.max(0,Math.ceil((cutoffMs-Date.parse(latest.until))/ms)),from=Date.parse(latest.until)+futureGap*ms;
    const predictions=nativeBusinessForecastValues(series.map(point=>point.value!),candidate,h,futureGap);
    result.points=predictions.map((value,index)=>({from:new Date(from+index*ms).toISOString(),until:new Date(from+(index+1)*ms).toISOString(),value,interval:null}));
    result.status="qualified";result.selectedReason=candidate.kind==="naive"?"Declared last-value baseline meets the human loss limit; uncertainty intervals remain unavailable.":"Declared native candidate meets the human loss limit and retained time-safe naive comparison; no causal claim or automatic commitment follows.";return result;
  } catch(error) {if(error instanceof Error && ["non_finite_forecast_arithmetic","insufficient_model_history","invalid_native_forecast_input"].includes(error.message)) return reject(error.message);throw error;}
}
