import {z} from "zod";
const id=z.string().uuid(),prose=z.string().trim().min(10).max(2000);
export const nativeBusinessForecastModelSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("naive")}).strict(),
  z.object({kind:z.literal("seasonal_naive"),seasonLength:z.number().int().min(2).max(365)}).strict(),
  z.object({kind:z.literal("moving_average"),window:z.number().int().min(2).max(60)}).strict(),
  z.object({kind:z.literal("drift")}).strict(),
]);
export const businessForecastDefinitionSchema=z.object({
  name:z.string().trim().min(3).max(160),businessQuestion:prose,decisionUse:prose,ownerUserId:z.string().trim().min(1).max(200),
  metricId:id,metricVersionId:id,scope:z.discriminatedUnion("type",[z.object({type:z.literal("company"),id:z.null()}).strict(),z.object({type:z.literal("project"),id}).strict()]),
  frequency:z.enum(["daily_utc","weekly_utc"]),horizon:z.number().int().min(1).max(60),provider:z.literal("aw_native"),
  candidate:nativeBusinessForecastModelSchema,baselines:z.array(nativeBusinessForecastModelSchema).min(1).max(4),
  minimumHistory:z.number().int().min(4).max(1000),captureLatencySeconds:z.number().int().min(0).max(86400),
  backtest:z.object({minimumTrainingPoints:z.number().int().min(2).max(900),minimumOrigins:z.number().int().min(3).max(100),gapPeriods:z.number().int().min(1).max(7),
    maximumMAE:z.number().finite().nonnegative(),minimumRelativeMAEImprovement:z.number().finite().min(0).max(1)}).strict(),
  knownFailureModes:z.array(prose).min(1).max(16),sensitivity:z.enum(["internal","confidential"]),purpose:z.literal("management_intelligence"),
  governanceObligationRefs:z.array(id).min(1).max(16),retentionDays:z.number().int().min(1).max(3650),
}).strict().superRefine((value,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:"custom",message});
  if(!value.baselines.some(model=>model.kind==="naive")) reject("Last-value baseline comparison is required");
  if(new Set(value.baselines.map(model=>model.kind)).size!==value.baselines.length) reject("Baseline kinds cannot repeat");
  if(new Set(value.governanceObligationRefs).size!==value.governanceObligationRefs.length) reject("Purpose references cannot repeat");
  if(value.minimumHistory<value.backtest.minimumTrainingPoints+value.backtest.gapPeriods+value.horizon+value.backtest.minimumOrigins-1) reject("History policy must support all declared rolling origins and horizon");
  for(const model of [value.candidate,...value.baselines]) if(model.kind==="seasonal_naive"&&model.seasonLength>value.backtest.minimumTrainingPoints || model.kind==="moving_average"&&model.window>value.backtest.minimumTrainingPoints) reject("Every declared model requires enough history in the earliest training fold");
});
export type NativeBusinessForecastModel=z.infer<typeof nativeBusinessForecastModelSchema>;
export type BusinessForecastDefinition=z.infer<typeof businessForecastDefinitionSchema>;
/** Internal metric-owner capture only; never a public forecast run input. */
export interface BusinessForecastSeriesPoint {
  observationId:string;metricId:string;metricVersionId:string;sourceHash:string;
  from:string;until:string;asOf:string;value:number|null;status:string;unit:string;
}
export interface BusinessForecastLoss {
  mae:number;bias:number;wape:number|null;mase:number|null;zeroActualDenominator:boolean;zeroNaiveScale:boolean;
  byHorizon:{horizon:number;cases:number;mae:number;bias:number}[];
}
export interface BusinessForecastFold {
  origin:number;trainingObservationIds:string[];trainingCutoff:string;testObservationIds:string[];gapPeriods:number;
  predictions:{model:NativeBusinessForecastModel;values:number[];actual:number[];loss:BusinessForecastLoss}[];
}
export interface NativeBusinessForecastResult {
  engineVersion:"aw-native-business-forecast-v1";status:"qualified"|"not_qualified"|"data_not_ready";reasons:string[];
  inputHash:string;definitionHash:string;unit:string|null;trainingObservationIds:string[];backtests:BusinessForecastFold[];
  comparisons:{model:NativeBusinessForecastModel;loss:BusinessForecastLoss}[];selectedReason:string|null;
  points:{from:string;until:string;value:number;interval:null}[];
  uncertainty:{method:"unavailable";coverageLevel:null;reason:string};limitations:string[];
}
