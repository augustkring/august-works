import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runStatisticalWorker, type StatisticalWorkerRequest } from "../services/business-forecasting/statistical-worker.js";
import { nativeBusinessForecastValues } from "../services/business-forecasting/kernel.js";

const request = (model: StatisticalWorkerRequest["model"] = "auto_ets"): StatisticalWorkerRequest => ({ operation: "forecast", model, seasonLength: 1, values: Array.from({ length: 30 }, (_, index) => 10 + index), origins: [20, 21, 22], horizon: 3, gapPeriods: 1, futureGapPeriods: 1 });
const workspaces = async () => (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("aw-statistical-worker-")).sort();
async function numeric(input: StatisticalWorkerRequest) { const result = await runStatisticalWorker(input); if (!("future" in result)) throw new Error("Expected numerical worker response"); return result; }
afterEach(() => vi.unstubAllEnvs());
// Optional engine qualification is explicit: run with the installed locked
// interpreter. Missing configuration is tested as a closed feature, not a
// successful provider. CI may opt into the numerical lane with that prerequisite.
describe("Optional statistical worker admission", () => {
  it("stays unavailable without an explicitly configured interpreter", async () => {
    vi.stubEnv("PAPERCLIP_STATSFORECAST_PYTHON", "");
    await expect(runStatisticalWorker({ operation: "health" })).rejects.toMatchObject({ code: "unavailable" });
  });
  it("rejects arbitrary identities/code/endpoints and unsafe folds before worker access", async () => {
    for (const input of [{ ...request(), endpoint: "https://example.com" }, { ...request(), code: "arbitrary Python" }, { ...request(), companyId: "private" }, { ...request(), values: [1, 2, Number.NaN, 4] }, { ...request(), origins: [22, 20] }, { ...request(), origins: [29] }, { ...request(), seasonLength: 365 }]) await expect(runStatisticalWorker(input)).rejects.toThrow();
  });
});
describe.runIf(!!process.env.PAPERCLIP_STATSFORECAST_PYTHON)("Actual pinned numeric provider in original Linux sandbox", () => {
  it("attests exact provider/dependencies and receives no server credential environment", async () => {
    vi.stubEnv("DATABASE_URL", "fixture_database_credential_must_never_cross_boundary");
    vi.stubEnv("PAPERCLIP_SIGNING_SECRET", "fixture_signing_material_must_never_cross_boundary");
    const before = await workspaces(), health = await runStatisticalWorker({ operation: "health" });
    expect(health).toMatchObject({ provider: "statsforecast", version: "2.1.1", python: "3.12.14", dependencies: { numpy: "2.5.3", coreforecast: "0.0.18" } });
    if (!("environmentNames" in health)) throw new Error("Expected runtime attestation");
    expect(health.environmentNames).not.toContain("DATABASE_URL"); expect(health.environmentNames).not.toContain("PAPERCLIP_SIGNING_SECRET");
    expect(health.bundleHash).toMatch(/^[a-f0-9]{64}$/); expect(await workspaces()).toEqual(before);
  });
  it("matches native last-value fold and future-gap values exactly through the actual third-party provider", async () => {
    const input = request("native_naive_parity"), result = await numeric(input);
    for (const fold of result.folds) expect(fold.values).toEqual(nativeBusinessForecastValues(input.values.slice(0, fold.origin), { kind: "naive" }, input.horizon, input.gapPeriods));
    expect(result.future.mean).toEqual(nativeBusinessForecastValues(input.values, { kind: "naive" }, input.horizon, input.futureGapPeriods));
    expect(result.future["lo-95"].every((low, index) => low <= result.future["lo-80"][index] && result.future["lo-80"][index] <= result.future.mean[index] && result.future.mean[index] <= result.future["hi-80"][index] && result.future["hi-80"][index] <= result.future["hi-95"][index])).toBe(true);
  });
  it("improves over native naive on a declared synthetic trend and preserves interval provenance", async () => {
    const input = request(), result = await numeric(input);
    for (const fold of result.folds) {
      const actual = input.values.slice(fold.origin + input.gapPeriods, fold.origin + input.gapPeriods + input.horizon), naive = nativeBusinessForecastValues(input.values.slice(0, fold.origin), { kind: "naive" }, input.horizon, input.gapPeriods);
      const loss = (values: number[]) => values.reduce((sum, value, index) => sum + Math.abs(value - actual[index]), 0) / values.length;
      expect(loss(fold.values)).toBeLessThan(0.001); expect(loss(fold.values)).toBeLessThan(loss(naive));
    }
    expect(result.future.mean).toEqual([41, 42, 43]); expect(result.provider).toBe("statsforecast");
  });
  it.each(["auto_arima"] as const)("executes the advertised %s model in the actual bounded runtime", async model => {
    const result = await numeric(request(model));
    expect(result.folds).toHaveLength(3); expect(result.future.mean).toHaveLength(3);
    expect(result.future.mean.every(Number.isFinite)).toBe(true);
  });
  it("withholds the actual AutoTheta result whose reported interval excludes its point estimate", async () => {
    // Pinned 2.1.1 returns a systematic point/interval mismatch on this explicit
    // trend fixture. Keep the native contract closed; do not round, widen or
    // silently replace the third-party interval to manufacture conformance.
    await expect(numeric(request("auto_theta"))).rejects.toMatchObject({ code: "invalid_result" });
  });
  it("retains a tied constant-series candidate without inventing baseline improvement", async () => {
    const input = { ...request(), values: Array.from({ length: 30 }, () => 10) }, result = await numeric(input);
    for (const fold of result.folds) expect(fold.values).toEqual(nativeBusinessForecastValues(input.values.slice(0, fold.origin), { kind: "naive" }, input.horizon, input.gapPeriods));
    expect(result.future.mean).toEqual([10, 10, 10]);
  });
  it("cannot use changed future actuals in an earlier training fold", async () => {
    const input = request(), initial = await numeric(input), origin = input.origins[0];
    const changed = await numeric({ ...input, values: input.values.map((value, index) => index >= origin ? 1000 + 2 * index : value) });
    expect(changed.folds[0]).toEqual(initial.folds[0]);
  });
  it("supports the advertised maximum numeric history/horizon envelope without tenant Source material", async () => {
    const started = performance.now(), input = { ...request("native_naive_parity"), values: Array.from({ length: 1000 }, (_, index) => index % 7), origins: Array.from({ length: 100 }, (_, index) => 801 + index), horizon: 60, gapPeriods: 7, futureGapPeriods: 2 };
    const result = await numeric(input);
    expect(result.folds).toHaveLength(100); expect(result.folds.every(fold => fold.values.length === 60)).toBe(true); expect(result.future.mean).toHaveLength(60); expect(performance.now() - started).toBeLessThan(15000);
  });
  it("closes the actual process and removes its private workspace on cancellation and timeout", async () => {
    const before = await workspaces(), controller = new AbortController();
    const pending = runStatisticalWorker(request("auto_arima"), { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" }); expect(await workspaces()).toEqual(before);
    await expect(runStatisticalWorker(request(), { timeoutMs: 100 })).rejects.toMatchObject({ code: "timeout" }); expect(await workspaces()).toEqual(before);
  });
});
