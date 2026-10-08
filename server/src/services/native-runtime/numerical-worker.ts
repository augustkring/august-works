import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLocalProcessSandboxSpawnTarget } from "@paperclipai/adapter-utils/local-process-sandbox";
import { resolveSandboxProcessLimit } from "../automation-artifacts/automation-artifact-code-runtime.js";

export class NumericalWorkerError extends Error {
  constructor(readonly code: "unavailable" | "cancelled" | "timeout" | "output_limit" | "invalid_result") { super(`Optional numerical worker: ${code}`); }
}
// Trusted fixed-worker callers own assets/DTOs. The original native sandbox owns
// filesystem/network isolation; this transport admits no inherited server env.
export async function runNumericalWorker(input: unknown, options: { python?: string; signal?: AbortSignal; timeoutMs?: number; workspacePrefix: string; assets: Record<string, string> }): Promise<string> {
  const python = options.python;
  if (!python || !path.isAbsolute(python) || process.platform !== "linux") throw new NumericalWorkerError("unavailable");
  if (options.signal?.aborted) throw new NumericalWorkerError("cancelled");
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), options.workspacePrefix));
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const scriptPath = path.join(workspace, "worker.py");
    for (const [name, content] of Object.entries(options.assets)) await fs.writeFile(path.join(workspace, name), content, { mode: 0o400 });
    const realPython = await fs.realpath(python), venv = path.dirname(path.dirname(python)), base = path.dirname(path.dirname(realPython));
    const target = await buildLocalProcessSandboxSpawnTarget({ executable: python, args: ["-I", scriptPath], cwd: workspace, options: { workspaceDir: workspace, filesystemScope: "workspace", networkScope: "deny", extraPaths: [{ path: venv, access: "ro" }, { path: base, access: "ro" }] } });
    cleanup = target.cleanup;
    const processLimit = await resolveSandboxProcessLimit(), timeoutMs = Math.max(100, Math.min(15000, options.timeoutMs ?? 15000));
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn("/usr/bin/prlimit", [`--nproc=${processLimit}`, "--cpu=12", "--as=2147483648", "--nofile=64", "--core=0", "--fsize=1048576", "--", target.command, ...target.args], { cwd: "/", env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", ...target.env }, stdio: ["pipe", "pipe", "pipe"], detached: true });
      let stdout = "", size = 0, stderrSize = 0, failure: NumericalWorkerError | undefined;
      const stop = (code: NumericalWorkerError["code"]) => { failure ??= new NumericalWorkerError(code); try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
      const abort = () => stop("cancelled"), timer = setTimeout(() => stop("timeout"), timeoutMs); timer.unref();
      options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 256000) stop("output_limit"); else stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderrSize += chunk.length; if (stderrSize > 4096) stop("output_limit"); });
      child.stdin.on("error", () => {});
      child.once("error", () => { finish(); reject(failure ?? new NumericalWorkerError("unavailable")); });
      child.once("close", code => { finish(); if (failure || code !== 0) reject(failure ?? new NumericalWorkerError("invalid_result")); else resolve(stdout); });
      child.stdin.end(JSON.stringify(input));
    });
    return response;
  } catch (error) {
    if (error instanceof NumericalWorkerError) throw error;
    throw new NumericalWorkerError("unavailable");
  } finally { await cleanup?.(); await fs.rm(workspace, { recursive: true, force: true }); }
}
