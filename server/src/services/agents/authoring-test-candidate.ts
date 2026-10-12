import type { AgentAuthoringContent } from "@paperclipai/shared";
import { orchestrationCompletionSchema } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";

export function representativeCompletionContract(scenario: string) {
  return orchestrationCompletionSchema.parse({ objective: scenario, requiredOutputs: [{ key: "representative-draft" }],
    businessInvariants: ["The output meets the saved representative scenario and candidate responsibility"],
    evidenceRequirements: ["Compare the actual draft output with the expected scenario before approving it"],
    prohibitedOutcomes: ["External actions, tool use, delegation, activation or a claim of independent self-verification"] });
}

export function authoringCandidateHash(draft: {
  id: string; companyId: string; version: number; content: AgentAuthoringContent | null;
  packageVersionId: string | null; packageContentHash: string | null;
}) {
  return nativeSha256({ id: draft.id, companyId: draft.companyId, version: draft.version,
    content: draft.content, packageVersionId: draft.packageVersionId, packageContentHash: draft.packageContentHash });
}

/** The candidate is server-owned saved content, never an HTTP model override. */
export function authoringCandidateInstructions(content: AgentAuthoringContent) {
  return [
    ["Responsibility", content.outcome],
    ["Purpose", content.instructions.purpose],
    ["Responsibilities", content.instructions.responsibilities],
    ["Limits", content.instructions.prohibited],
    ["Missing information", content.instructions.missingInformation],
    ["Escalation", content.instructions.escalation],
    ["Communication", content.instructions.communication],
  ].map(([label, value]) => `${label}\n${value}`).join("\n\n");
}
