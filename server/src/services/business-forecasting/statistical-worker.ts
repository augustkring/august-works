import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildLocalProcessSandboxSpawnTarget } from "@paperclipai/adapter-utils/local-process-sandbox";
import { resolveSandboxProcessLimit } from "../automation-artifacts/automation-artifact-code-runtime.js";
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
  const python = options.python ?? process.env.PAPERCLIP_STATSFORECAST_PYTHON;
  if (!python || !path.isAbsolute(python) || process.platform !== "linux") throw new StatisticalWorkerError("unavailable");
  if (options.signal?.aborted) throw new StatisticalWorkerError("cancelled");
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "aw-statistical-worker-"));
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const script = await fs.readFile(new URL("../scripts/statsforecast-worker.py", import.meta.url), "utf8"), lock = await fs.readFile(new URL("../scripts/statsforecast-dependencies.json", import.meta.url), "utf8");
    const scriptPath = path.join(workspace, "worker.py"); await fs.writeFile(scriptPath, script, { mode: 0o400 }); await fs.writeFile(path.join(workspace, "statsforecast-dependencies.json"), lock, { mode: 0o400 });
    const realPython = await fs.realpath(python), venv = path.dirname(path.dirname(python)), base = path.dirname(path.dirname(realPython));
    const target = await buildLocalProcessSandboxSpawnTarget({ executable: python, args: ["-I", scriptPath], cwd: workspace, options: { workspaceDir: workspace, filesystemScope: "workspace", networkScope: "deny", extraPaths: [{ path: venv, access: "ro" }, { path: base, access: "ro" }] } });
    cleanup = target.cleanup;
    const processLimit = await resolveSandboxProcessLimit(), timeoutMs = Math.max(100, Math.min(15000, options.timeoutMs ?? 15000));
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn("/usr/bin/prlimit", [`--nproc=${processLimit}`, "--cpu=12", "--as=2147483648", "--nofile=64", "--core=0", "--fsize=1048576", "--", target.command, ...target.args], { cwd: "/", env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", ...target.env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
      let stdout = "", size = 0, stderrSize = 0, failure: StatisticalWorkerError | undefined;
      const stop = (code: StatisticalWorkerError["code"]) => { failure ??= new StatisticalWorkerError(code); try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
      const abort = () => stop("cancelled"), timer = setTimeout(() => stop("timeout"), timeoutMs); timer.unref();
      options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 256000) stop("output_limit"); else stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderrSize += chunk.length; if (stderrSize > 4096) stop("output_limit"); });
      child.stdin.on("error", () => {});
      child.once("error", () => { finish(); reject(failure ?? new StatisticalWorkerError("unavailable")); });
      child.once("close", code => { finish(); if (failure || code !== 0) reject(failure ?? new StatisticalWorkerError("invalid_result")); else resolve(stdout); });
      child.stdin.end(JSON.stringify(input));
    });
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
    throw new StatisticalWorkerError("unavailable");
  } finally { await cleanup?.(); await fs.rm(workspace, { recursive: true, force: true }); }
}
