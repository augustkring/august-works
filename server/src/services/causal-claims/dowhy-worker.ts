import fs from "node:fs/promises";
import { z } from "zod";
import { doWhyCausalDiagnosticsSchema } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { NumericalWorkerError, runNumericalWorker } from "../native-runtime/numerical-worker.js";

const arm = z.object({ units: z.number().int().min(8).max(3992), successes: z.number().int().min(0).max(3992) }).strict().refine(value => value.successes <= value.units);
export const dowhyWorkerRequestSchema = z.object({ operation: z.literal("registered_binary_itt"), control: arm, treatment: arm }).strict().refine(value => value.control.units + value.treatment.units <= 4000);
export type DoWhyWorkerRequest = z.infer<typeof dowhyWorkerRequestSchema>;
const provenance = { provider: z.literal("dowhy"), version: z.literal("0.14"), python: z.literal("3.12.14") };
const healthSchema = z.object({ ...provenance, dependencies: z.record(z.string(), z.string()), environmentNames: z.array(z.string()).max(16), networkProxyDisabled: z.literal(true) }).strict();
export class DoWhyWorkerError extends Error {
  constructor(readonly code: NumericalWorkerError["code"]) { super(`Optional causal worker: ${code}`); }
}
// The causal owner must admit registered design/graph/Source before and after
// this fixed numerical call. Provider diagnostics never confer execution power.
export async function runDoWhyWorker(raw: DoWhyWorkerRequest | { operation: "health" }, options: { python?: string; signal?: AbortSignal; timeoutMs?: number } = {}) {
  const input = raw.operation === "health" ? z.object({ operation: z.literal("health") }).strict().parse(raw) : dowhyWorkerRequestSchema.parse(raw);
  try {
    const script = await fs.readFile(new URL("../scripts/dowhy-worker.py", import.meta.url), "utf8"), lock = await fs.readFile(new URL("../scripts/dowhy-dependencies.json", import.meta.url), "utf8");
    const response = await runNumericalWorker(input, { ...options, python: options.python ?? process.env.PAPERCLIP_DOWHY_PYTHON, workspacePrefix: "aw-causal-worker-", assets: { "worker.py": script, "dowhy-dependencies.json": lock } });
    let parsed: unknown; try { parsed = JSON.parse(response); } catch { throw new DoWhyWorkerError("invalid_result"); }
    const bundleHash = nativeSha256({ script, lock });
    if (input.operation === "health") {
      const result = healthSchema.safeParse(parsed), packages = (JSON.parse(lock) as { packages: Array<{ name: string; version: string }> }).packages;
      if (!result.success || packages.some(item => result.data.dependencies[item.name] !== item.version) || Object.keys(result.data.dependencies).length !== packages.length || result.data.environmentNames.some(name => !["LANG", "LC_ALL", "TZ", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NO_PROXY", "no_proxy", "PWD"].includes(name))) throw new DoWhyWorkerError("invalid_result");
      return { ...result.data, bundleHash };
    }
    const result = doWhyCausalDiagnosticsSchema.safeParse({ ...(parsed as Record<string, unknown>), bundleHash }), nativeEffect = input.treatment.successes / input.treatment.units - input.control.successes / input.control.units;
    if (!result.success || Math.abs(result.data.effect - nativeEffect) > 1e-9) throw new DoWhyWorkerError("invalid_result");
    return { ...result.data, bundleHash };
  } catch (error) {
    if (error instanceof DoWhyWorkerError || error instanceof z.ZodError) throw error;
    if (error instanceof NumericalWorkerError) throw new DoWhyWorkerError(error.code);
    throw new DoWhyWorkerError("unavailable");
  }
}
