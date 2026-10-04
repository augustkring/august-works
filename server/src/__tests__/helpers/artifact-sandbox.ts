import { existsSync } from "node:fs";
import { AutomationArtifactCodeRuntimeError, executeAutomationArtifactTypeScriptSandbox } from "../../services/automation-artifacts/automation-artifact-code-runtime.js";

/** Installing bubblewrap does not establish that nested namespaces are usable. */
export async function getArtifactSandboxTestSupport(): Promise<{ supported: boolean; reason: string | null }> {
  if (process.platform !== "linux" || !existsSync("/usr/bin/bwrap") || !existsSync("/usr/bin/prlimit")) return { supported: false, reason: "Qualified Linux sandbox tools are unavailable" };
  try {
    await executeAutomationArtifactTypeScriptSandbox({ sourceCode: "export default (input: { value: number }) => ({ value: input.value });", dependencyManifest: {}, value: { value: 7 } });
    return { supported: true, reason: null };
  } catch (error) {
    if (error instanceof AutomationArtifactCodeRuntimeError && /bubblewrap; exit=1/.test(error.message)
      && /bwrap: (?:setting up uid map: Read-only file system|No permissions to create new namespace|Creating new namespace failed: Operation not permitted)/.test(error.message)) return { supported: false, reason: error.message };
    throw error; // A runtime regression must fail; only demonstrated host limitations skip.
  }
}
