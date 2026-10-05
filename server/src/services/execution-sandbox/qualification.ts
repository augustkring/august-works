import { SANDBOX_CONTROLS, type SandboxCapabilitySnapshot } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { SANDBOX_PROBE_CASES, type ExecutionSandboxBackend, type SandboxIdentity } from "./backend.js";

/** Positive and negative observations come from a registered backend, never
 * request-body booleans. Unsupported cases cannot earn an assurance control. */
export async function runSandboxQualification(backend: ExecutionSandboxBackend, identity: SandboxIdentity, now = new Date()) {
  const declared = await backend.capabilities();
  const results: Array<{ caseId: string; control: string; verdict: "pass" | "fail" | "unsupported"; observationHash: string | null }> = [];
  for (const test of SANDBOX_PROBE_CASES) {
    try {
      const result = await backend.probeBoundary({ ...identity, test });
      results.push({ caseId: test.caseId, control: test.control, verdict: result.verdict === "pass" && !result.observationHash?.match(/^[a-f0-9]{64}$/) ? "unsupported" : result.verdict, observationHash: result.observationHash });
    } catch { results.push({ caseId: test.caseId, control: test.control, verdict: "unsupported", observationHash: null }); }
  }
  const status = results.some(r => r.verdict === "fail") ? "failed" : !declared || results.some(r => r.verdict === "unsupported") ? "inconclusive" : "passed";
  const reportHash = nativeSha256({ suiteVersion: "aw-v7-boundary-1", identity, backend: backend.backend, backendVersion: declared?.backendVersion ?? null, kernel: declared?.hostKernelVersion ?? null, image: declared?.sandboxImageDigest ?? null, evidenceKind: backend.evidenceKind, results });
  const capabilities: SandboxCapabilitySnapshot | null = declared ? { ...declared, evidenceKind: backend.evidenceKind, testedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), qualificationHash: reportHash } : null;
  if (capabilities && declared) for (const control of SANDBOX_CONTROLS) capabilities[control] = declared[control] && results.filter(r => r.control === control).every(r => r.verdict === "pass");
  return { suiteVersion: "aw-v7-boundary-1", status: status as "passed" | "failed" | "inconclusive", capabilities, results, exceptions: results.filter(r => r.verdict !== "pass").map(r => `${r.caseId}:${r.verdict}`), reportHash };
}
