import type { EvidenceItem } from "@paperclipai/shared";

/** Policy projection shared by the original cross-company selector and the
 * persisted Context owner. Unknown and personal sources remain non-exportable. */
export function crossCompanyEvidencePolicy(evidence: EvidenceItem): "allow" | "no_export" | "aggregate_only" {
  if (evidence.sourceClass === "private_memory" || evidence.sensitivity === "restricted"
    || evidence.metadata.scope === "user" || evidence.metadata.personal === true) return "no_export";
  const policy = evidence.metadata.crossCompanyUsePolicy;
  if (policy === "no_export" || policy === "aggregate_only") return policy;
  if (policy === "allow") return "allow";
  return evidence.sensitivity === "confidential" ? "no_export" : "allow";
}
