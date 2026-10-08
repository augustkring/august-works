import { businessForecastDefinitionSchema, nativeBusinessForecastModelSchema, statisticalBusinessForecastModelSchema, type BusinessForecastDefinition, type BusinessForecastSeriesPoint, type NativeBusinessForecastResult, type StatisticalForecastProfile } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { evaluateNativeBusinessForecast, loss, nativeBusinessForecastValues } from "./kernel.js";
import { runStatisticalWorker, StatisticalWorkerError, type StatisticalWorkerRequest } from "./statistical-worker.js";
const DAY = 86400000;
// Only fixed public synthetic software proofs are cached, never tenant inputs/results.
const profiles = new Map<string, StatisticalForecastProfile>();
const numeric = async (request: StatisticalWorkerRequest, options: Parameters<typeof runStatisticalWorker>[1]) => { const result = await runStatisticalWorker(request, options); if (!("future" in result)) throw new StatisticalWorkerError("invalid_result"); return result; };
export async function currentStatisticalForecastProfile(options: Parameters<typeof runStatisticalWorker>[1] = {}): Promise<StatisticalForecastProfile> {
  const health = await runStatisticalWorker({ operation: "health" }, options);
  if (!("dependencies" in health)) throw new StatisticalWorkerError("invalid_result");
  const cached = profiles.get(health.bundleHash); if (cached) return cached;
  const input: StatisticalWorkerRequest = { operation: "forecast", model: "native_naive_parity", seasonLength: 1, values: Array.from({ length: 30 }, (_, index) => 10 + index), origins: [20, 21, 22], horizon: 3, gapPeriods: 1, futureGapPeriods: 1 };
  const parity = await numeric(input, options), trend = await numeric({ ...input, model: "auto_ets" }, options), arima = await numeric({ ...input, model: "auto_arima" }, options);
  if (parity.bundleHash !== health.bundleHash || trend.bundleHash !== health.bundleHash || arima.bundleHash !== health.bundleHash || parity.folds.some(fold => nativeSha256(fold.values) !== nativeSha256(nativeBusinessForecastValues(input.values.slice(0, fold.origin), { kind: "naive" }, input.horizon, input.gapPeriods))) || nativeSha256(parity.future.mean) !== nativeSha256([39, 39, 39]) || [trend, arima].some(output => output.folds.some(fold => fold.values.some((value, index) => Math.abs(value - input.values[fold.origin + input.gapPeriods + index]) > 0.001)) || output.future.mean.some((value, index) => Math.abs(value - (41 + index)) > 0.001))) throw new StatisticalWorkerError("invalid_result");
  const profile: StatisticalForecastProfile = { provider: "statsforecast", version: "2.1.1", python: "3.12.14", bundleHash: health.bundleHash, conformanceHash: nativeSha256({ contract: "aw-statsforecast-conformance-v1", health, input, parity, trend, arima, theta: "not_qualified_point_interval_mismatch" }) };
  if (profiles.size >= 4) profiles.clear(); profiles.set(profile.bundleHash, profile); return profile;
}
/** Current admitted native observations only. The original owner owns Source,
 * value domains, retention, the final recheck and separate Human publication. */
export async function evaluateStatisticalBusinessForecast(raw: BusinessForecastDefinition, series: BusinessForecastSeriesPoint[], cutoff: string, options: Parameters<typeof runStatisticalWorker>[1] = {}): Promise<NativeBusinessForecastResult> {
  const definition = businessForecastDefinitionSchema.parse(raw), candidate = statisticalBusinessForecastModelSchema.parse(definition.candidate);
  if (definition.provider !== "statsforecast" || !definition.providerProfile) throw new StatisticalWorkerError("invalid_result");
  const { providerProfile: _profile, ...rest } = definition;
  const baseline = evaluateNativeBusinessForecast({ ...rest, provider: "aw_native", candidate: { kind: "naive" } }, series, cutoff);
  const result: NativeBusinessForecastResult = { ...baseline, engineVersion: "aw-statsforecast-business-forecast-v1", definitionHash: nativeSha256(definition), providerProvenance: definition.providerProfile, selectedReason: null, points: [], status: "data_not_ready", uncertainty: { method: "unavailable", coverageLevel: null, reason: "No currently admitted statistical output is available." }, limitations: [...baseline.limitations, "Statistical intervals are model outputs; empirical coverage on this company history remains unestablished.", "Fixed software conformance is not evidence of customer forecasting skill; each exact series requires its own time-safe baseline comparison."] };
  if (baseline.status === "data_not_ready") return result;
  const profile = await currentStatisticalForecastProfile(options);
  if (nativeSha256(profile) !== nativeSha256(definition.providerProfile)) { result.reasons = ["statistical_profile_needs_revalidation"]; return result; }
  const ms = definition.frequency === "daily_utc" ? DAY : 7 * DAY, latest = series[series.length - 1], futureGap = Math.max(0, Math.ceil((Date.parse(cutoff) - Date.parse(latest.until)) / ms));
  const computed = await numeric({ operation: "forecast", model: candidate.kind, seasonLength: candidate.seasonLength, values: series.map(point => point.value!), origins: baseline.backtests.map(fold => fold.origin), horizon: definition.horizon, gapPeriods: definition.backtest.gapPeriods, futureGapPeriods: futureGap }, options);
  if (computed.bundleHash !== profile.bundleHash) throw new StatisticalWorkerError("invalid_result");
  result.backtests = baseline.backtests.map((fold, index) => {
    const training = series.slice(0, fold.origin).map(point => point.value!), scale = training.slice(1).reduce((sum, value, at) => sum + Math.abs(value - training[at]), 0) / (training.length - 1), actual = series.slice(fold.origin + fold.gapPeriods, fold.origin + fold.gapPeriods + definition.horizon).map(point => point.value!), values = computed.folds[index].values;
    return { ...fold, predictions: [{ model: candidate, values, actual, loss: loss(values, actual, scale, definition.horizon) }, ...fold.predictions] };
  });
  const folds = result.backtests.map(fold => fold.predictions[0]), summary = loss(folds.flatMap(fold => fold.values), folds.flatMap(fold => fold.actual), 0, definition.horizon), scales = folds.map(fold => fold.loss.mase);
  summary.mase = scales.some(value => value === null) ? null : scales.reduce<number>((sum, value) => sum + value!, 0) / scales.length; summary.zeroNaiveScale = scales.some(value => value === null);
  result.comparisons = [{ model: candidate, loss: summary }, ...baseline.comparisons];
  const naive = baseline.comparisons.find(item => nativeBusinessForecastModelSchema.safeParse(item.model).success && item.model.kind === "naive")!.loss, improvement = naive.mae === 0 ? summary.mae === 0 ? 0 : -1 : (naive.mae - summary.mae) / naive.mae;
  if (summary.mae > definition.backtest.maximumMAE || improvement <= 0 || improvement < definition.backtest.minimumRelativeMAEImprovement) { result.status = "not_qualified"; result.reasons = [summary.mae > definition.backtest.maximumMAE ? "declared_loss_limit_not_met" : "declared_naive_improvement_not_met"]; return result; }
  const from = Date.parse(latest.until) + futureGap * ms;
  result.points = computed.future.mean.map((value, index) => ({ from: new Date(from + index * ms).toISOString(), until: new Date(from + (index + 1) * ms).toISOString(), value, interval: { method: "statsforecast_model", level: 0.95, lower: computed.future["lo-95"][index], upper: computed.future["hi-95"][index], level80: { lower: computed.future["lo-80"][index], upper: computed.future["hi-80"][index] } } }));
  result.status = "qualified"; result.reasons = []; result.uncertainty = { method: "statsforecast_model", coverageLevel: 0.95, reason: "Model-specified 80%/95% intervals; empirical calibration on this company history is not established." };
  result.selectedReason = "The exact statistical candidate meets the declared loss limit and strictly improves the retained time-safe native last-value baseline; separate Human publication is required.";
  return result;
}
