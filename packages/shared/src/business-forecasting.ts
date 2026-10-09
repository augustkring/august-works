import {z} from "zod";
const id=z.string().uuid(),prose=z.string().trim().min(10).max(2000);
export const nativeBusinessForecastModelSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("naive")}).strict(),
  z.object({kind:z.literal("seasonal_naive"),seasonLength:z.number().int().min(2).max(365)}).strict(),
  z.object({kind:z.literal("moving_average"),window:z.number().int().min(2).max(60)}).strict(),
  z.object({kind:z.literal("drift")}).strict(),
]);
/** Optional fixed models and a server-verified immutable numerical profile.
 * A profile is software provenance, never evidence of customer forecasting skill. */
export const statisticalBusinessForecastModelSchema=z.object({kind:z.enum(["auto_ets","auto_arima"]),seasonLength:z.number().int().min(1).max(365)}).strict();
export const statisticalForecastProfileSchema=z.object({provider:z.literal("statsforecast"),version:z.literal("2.1.1"),python:z.literal("3.12.14"),bundleHash:z.string().regex(/^[a-f0-9]{64}$/),conformanceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type StatisticalBusinessForecastModel=z.infer<typeof statisticalBusinessForecastModelSchema>;
export type StatisticalForecastProfile=z.infer<typeof statisticalForecastProfileSchema>;
export type BusinessForecastModel=NativeBusinessForecastModel|StatisticalBusinessForecastModel;
export const businessForecastDefinitionSchema=z.object({
  name:z.string().trim().min(3).max(160),businessQuestion:prose,decisionUse:prose,ownerUserId:z.string().trim().min(1).max(200),
  metricId:id,metricVersionId:id,scope:z.discriminatedUnion("type",[z.object({type:z.literal("company"),id:z.null()}).strict(),z.object({type:z.literal("project"),id}).strict()]),
  frequency:z.enum(["daily_utc","weekly_utc"]),horizon:z.number().int().min(1).max(60),provider:z.enum(["aw_native","statsforecast"]),providerProfile:statisticalForecastProfileSchema.optional(),
  candidate:z.union([nativeBusinessForecastModelSchema,statisticalBusinessForecastModelSchema]),baselines:z.array(nativeBusinessForecastModelSchema).min(1).max(4),
  minimumHistory:z.number().int().min(4).max(1000),captureLatencySeconds:z.number().int().min(0).max(86400),
  backtest:z.object({minimumTrainingPoints:z.number().int().min(2).max(900),minimumOrigins:z.number().int().min(3).max(100),gapPeriods:z.number().int().min(1).max(7),
    maximumMAE:z.number().finite().nonnegative(),minimumRelativeMAEImprovement:z.number().finite().min(0).max(1)}).strict(),
  knownFailureModes:z.array(prose).min(1).max(16),sensitivity:z.enum(["internal","confidential"]),purpose:z.literal("management_intelligence"),
  governanceObligationRefs:z.array(id).min(1).max(16),retentionDays:z.number().int().min(1).max(3650),
}).strict().superRefine((value,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:"custom",message});
  const statistical=statisticalBusinessForecastModelSchema.safeParse(value.candidate).success;
  if(value.provider==="statsforecast"&&(!statistical||!value.providerProfile)||value.provider==="aw_native"&&(statistical||value.providerProfile)) reject("The declared model requires its exact native or verified statistical profile");
  if(statistical&&"seasonLength" in value.candidate&&value.candidate.seasonLength>1&&value.backtest.minimumTrainingPoints<2*value.candidate.seasonLength) reject("Statistical seasonal models require two complete training seasons");
  if(!value.baselines.some(model=>model.kind==="naive")) reject("Last-value baseline comparison is required");
  if(new Set(value.baselines.map(model=>model.kind)).size!==value.baselines.length) reject("Baseline kinds cannot repeat");
  if(new Set(value.governanceObligationRefs).size!==value.governanceObligationRefs.length) reject("Purpose references cannot repeat");
  if(value.minimumHistory<value.backtest.minimumTrainingPoints+value.backtest.gapPeriods+value.horizon+value.backtest.minimumOrigins-1) reject("History policy must support all declared rolling origins and horizon");
  for(const model of [value.candidate,...value.baselines]) if(model.kind==="seasonal_naive"&&model.seasonLength>value.backtest.minimumTrainingPoints || model.kind==="moving_average"&&model.window>value.backtest.minimumTrainingPoints) reject("Every declared model requires enough history in the earliest training fold");
});
export type NativeBusinessForecastModel=z.infer<typeof nativeBusinessForecastModelSchema>;
export type BusinessForecastDefinition=z.infer<typeof businessForecastDefinitionSchema>;
export const createBusinessForecastSpecSchema=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),definition:businessForecastDefinitionSchema}).strict();
export const reviseBusinessForecastSpecSchema=z.object({expectedRevision:z.number().int().positive(),definition:businessForecastDefinitionSchema}).strict();
export const backtestBusinessForecastSchema=z.object({expectedRevision:z.number().int().positive(),versionId:id,observationIds:z.array(id).min(4).max(1000).refine(ids=>new Set(ids).size===ids.length,"Unique native observation pins are required"),cutoff:z.iso.datetime()}).strict();
export const publishBusinessForecastSpecSchema=z.object({expectedRevision:z.number().int().positive(),versionId:id,backtestId:id,rationale:prose}).strict();
export const retireBusinessForecastSpecSchema=z.object({expectedRevision:z.number().int().positive(),rationale:prose}).strict();
export type CreateBusinessForecastSpec=z.infer<typeof createBusinessForecastSpecSchema>;
export type ReviseBusinessForecastSpec=z.infer<typeof reviseBusinessForecastSpecSchema>;
export type BacktestBusinessForecast=z.infer<typeof backtestBusinessForecastSchema>;
export type PublishBusinessForecastSpec=z.infer<typeof publishBusinessForecastSpecSchema>;
export type RetireBusinessForecastSpec=z.infer<typeof retireBusinessForecastSpecSchema>;
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
  predictions:{model:BusinessForecastModel;values:number[];actual:number[];loss:BusinessForecastLoss}[];
}
export interface NativeBusinessForecastResult {
  engineVersion:"aw-native-business-forecast-v1"|"aw-statsforecast-business-forecast-v1";status:"qualified"|"not_qualified"|"data_not_ready";reasons:string[];
  inputHash:string;definitionHash:string;unit:string|null;trainingObservationIds:string[];backtests:BusinessForecastFold[];
  comparisons:{model:BusinessForecastModel;loss:BusinessForecastLoss}[];selectedReason:string|null;
  points:{from:string;until:string;value:number;interval:null|{method:"statsforecast_model";level:0.95;lower:number;upper:number;level80:{lower:number;upper:number}}}[];
  providerProvenance?:StatisticalForecastProfile;
  uncertainty:{method:"unavailable"|"statsforecast_model";coverageLevel:null|0.95;reason:string};limitations:string[];
}
export interface BusinessForecastSpecView {
  id:string;companyId:string;key:string;revision:number;status:"draft"|"published"|"retired";publishedVersionId:string|null;
  createdAt:string;updatedAt:string;
}
export interface BusinessForecastVersionView {
  id:string;companyId:string;specId:string;revision:number;definition:BusinessForecastDefinition;contentHash:string;
  createdAt:string;expiresAt:string;
}
export interface BusinessForecastArtifactView {
  id:string;companyId:string;specId:string;versionId:string;kind:"backtest"|"run";result:NativeBusinessForecastResult;
  series:BusinessForecastSeriesPoint[];contentHash:string;cutoff:string;createdAt:string;expiresAt:string;
  currentQualification:"qualified"|"needs_revalidation"|"inconclusive";reviewReason:string|null;
}

export interface StatisticalForecastProviderInfo { companyId:string;profile:StatisticalForecastProfile;models:StatisticalBusinessForecastModel["kind"][];qualification:"synthetic_software_conformance";limitations:string[]; }
