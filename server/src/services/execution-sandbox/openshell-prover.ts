import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { OpenShellPolicyDocument } from "./openshell-policy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
const run = promisify(execFile);
const reportSchema = z.object({ schema_version: z.literal(1), prover_version: z.literal("0.1.2"), check: z.literal("boundary"), result: z.enum(["within_boundary", "exceeds_boundary", "unsupported", "inconclusive"]), exit_code: z.number().int(), coverage: z.object({ domains: z.array(z.string().max(100)).max(16) }), reason_code: z.string().max(100).nullable() });
export interface OpenShellProverResult { result: "within_boundary" | "exceeds_boundary" | "unsupported" | "inconclusive"; coveredDomains: string[]; reasonCode: string | null; candidateHash: string; boundaryHash: string; evidenceHash: string }

/** The executable and its SHA are deployment configuration, never Task/model
 * arguments. stdout counterexamples can contain paths and are not persisted. */
export async function checkOpenShellBoundary(input: { executable: string; executableSha256: string; candidate: OpenShellPolicyDocument; boundary: OpenShellPolicyDocument }): Promise<OpenShellProverResult> {
  if (!isAbsolute(input.executable) || !/^[a-f0-9]{64}$/.test(input.executableSha256)) throw new Error("openshell_prover_configuration_invalid");
  if (createHash("sha256").update(await readFile(input.executable)).digest("hex") !== input.executableSha256) throw new Error("openshell_prover_binary_changed");
  const directory = await mkdtemp(join(tmpdir(), "aw-v7-policy-check-"));
  try {
    const candidatePath = join(directory, "candidate.json"), boundaryPath = join(directory, "boundary.json");
    await writeFile(candidatePath, JSON.stringify(input.candidate), { mode: 0o600 }); await writeFile(boundaryPath, JSON.stringify(input.boundary), { mode: 0o600 });
    let stdout: string;
    try { ({ stdout } = await run(input.executable, ["check", candidatePath, "--boundary", boundaryPath, "--output", "json", "--timeout", "3s"], { timeout: 5000, maxBuffer: 65536, env: { PATH: "/usr/bin:/bin", LANG: "C", NO_COLOR: "1" }, windowsHide: true })); }
    catch (error) { const output = error as { stdout?: string; killed?: boolean }; if (!output.stdout || output.killed) throw new Error("openshell_prover_unavailable"); stdout = output.stdout; }
    const report = reportSchema.parse(JSON.parse(stdout));
    const expectedExit = { within_boundary: [0], exceeds_boundary: [1], unsupported: [3], inconclusive: [3, 130] };
    if (!expectedExit[report.result].includes(report.exit_code)) throw new Error("openshell_prover_result_contract_changed");
    const summary = { result: report.result, coveredDomains: [...new Set(report.coverage.domains)].sort(), reasonCode: report.reason_code, candidateHash: nativeSha256(input.candidate), boundaryHash: nativeSha256(input.boundary) };
    return { ...summary, evidenceHash: nativeSha256({ ...summary, proverVersion: report.prover_version, executableSha256: input.executableSha256 }) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
