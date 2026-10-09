import fs from "node:fs/promises";
import { z } from "zod";
import { NumericalWorkerError, runNumericalWorker } from "../native-runtime/numerical-worker.js";
import { nativeSha256 } from "../native-runtime/canonical.js";

export const statisticalWorkerRequestSchema = z.object({ operation: z.literal("forecast"), model: z.enum(["auto_arima", "auto_ets", "auto_theta", "native_naive_parity"]), seasonLength: z.number().int().min(1).max(365), values: z.array(z.number().finite().min(-1e12).max(1e12)).min(4).max(1000), origins: z.array(z.number().int().min(2).max(900)).min(1).max(100), horizon: z.number().int().min(1).max(60), gapPeriods: z.number().int().min(1).max(7), futureGapPeriods: z.number().int().min(0).max(2) }).strict().superRefine((value, context) => {
  if (value.origins.some((origin, index) => origin + value.horizon + value.gapPeriods > value.values.length || index > 0 && origin <= value.origins[index - 1] || value.seasonLength > 1 && origin < 2 * value.seasonLength)) context.addIssue({ code: "custom", message: "Every increasing origin needs complete later test periods and declared seasonal training history" });
});
export type StatisticalWorkerRequest = z.infer<typeof statisticalWorkerRequestSchema>;
const provenance = { provider: z.literal("statsforecast"), version: z.literal("2.1.1"), python: z.literal("3.12.14") };
const healthSchema = z.object({ ...provenance, dependencies: z.record(z.string(), z.string()), environmentNames: z.array(z.string()).max(16), networkProxyDisabled: z.literal(true) }).strict();
const values = z.array(z.number().finite()).min(1).max(60);
const resultSchema = z.object({ ...provenance, folds: z.array(z.object({ origin: z.number().int(), values }).strict()).min(1).max(100), future: z.object({ mean: values, "lo-80": values, "hi-80": values, "lo-95": values, "hi-95": values }).strict() }).strict();
export class StatisticalWorkerError extends Error {
  constructor(readonly code: "unavailable" | "cancelled" | "timeout" | "output_limit" | "invalid_result") { super(`Optional statistical worker: ${code}`); }
}
/** The original native sandbox owns filesystem/network isolation. No server
 * environment, DB credentials, tenant IDs, arbitrary code or endpoints enter it.
 * The forecast owner must admit Source before and after this numerical call. */
export async function runStatisticalWorker(raw: StatisticalWorkerRequest | { operation: "health" }, options: { python?: string; signal?: AbortSignal; timeoutMs?: number } = {}) {
  const input = raw.operation === "health" ? z.object({ operation: z.literal("health") }).strict().parse(raw) : statisticalWorkerRequestSchema.parse(raw);
  try {
    const script = await fs.readFile(new URL("../scripts/statsforecast-worker.py", import.meta.url), "utf8"), lock = await fs.readFile(new URL("../scripts/statsforecast-dependencies.json", import.meta.url), "utf8");
    const response = await runNumericalWorker(input, { ...options, python: options.python ?? process.env.PAPERCLIP_STATSFORECAST_PYTHON, workspacePrefix: "aw-statistical-worker-", assets: { "worker.py": script, "statsforecast-dependencies.json": lock } });
    let parsed: unknown; try { parsed = JSON.parse(response); } catch { throw new StatisticalWorkerError("invalid_result"); }
    const bundleHash = nativeSha256({ script, lock });
    if (input.operation === "health") {
      const result = healthSchema.safeParse(parsed), packages = (JSON.parse(lock) as { packages: Array<{ name: string; version: string }> }).packages;
      if (!result.success || packages.some(item => result.data.dependencies[item.name] !== item.version) || Object.keys(result.data.dependencies).length !== packages.length || result.data.environmentNames.some(name => !["LANG", "LC_ALL", "TZ", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NO_PROXY", "no_proxy", "PWD"].includes(name))) throw new StatisticalWorkerError("invalid_result");
      return { ...result.data, bundleHash };
    }
    const result = resultSchema.safeParse(parsed);
    if (!result.success || result.data.folds.length !== input.origins.length || result.data.folds.some((fold, index) => fold.origin !== input.origins[index] || fold.values.length !== input.horizon) || Object.values(result.data.future).some(items => items.length !== input.horizon) || result.data.future.mean.some((mean, index) => !(result.data.future["lo-95"][index] <= result.data.future["lo-80"][index] && result.data.future["lo-80"][index] <= mean && mean <= result.data.future["hi-80"][index] && result.data.future["hi-80"][index] <= result.data.future["hi-95"][index]))) throw new StatisticalWorkerError("invalid_result");
    return { ...result.data, bundleHash };
  } catch (error) {
    if (error instanceof StatisticalWorkerError || error instanceof z.ZodError) throw error;
    if (error instanceof NumericalWorkerError) throw new StatisticalWorkerError(error.code);
    throw new StatisticalWorkerError("unavailable");
  }
}
