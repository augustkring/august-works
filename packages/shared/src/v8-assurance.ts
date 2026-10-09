import { z } from "zod";

export const RELEASE_STAGES = ["R0_SPECIFIED", "R1_SOURCE_VERIFIED", "R2_STAGING_QUALIFIED", "R3_PROTECTED_PILOT", "R4_LIMITED_GA", "R5_ENTERPRISE_GA"] as const;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const ref = z.string().trim().min(1).max(300);
export const analyticalReleaseIdentitySchema = z.object({
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/), artifactDigest: hash,
  configurationHash: hash, schemaVersion: ref, environmentClass: ref, profile: ref,
}).strict();
export const assuranceEvidenceSchema = z.object({
  id: ref, claimId: ref, release: analyticalReleaseIdentitySchema,
  lane: z.enum(["source", "staging", "pilot", "operations", "enterprise"]),
  kind: z.enum(["fixture", "deterministic_test", "live_observation", "independent_review", "operator_drill"]),
  status: z.enum(["pending", "passed", "failed", "accepted_risk", "expired"]),
  evidenceRefs: z.array(ref).min(1).max(64), owner: ref, reviewer: ref,
  verifiedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  revalidationTriggers: z.array(ref).min(1).max(32), limitations: z.array(ref).max(32),
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.verifiedAt), "Evidence expiry must follow verification");

export type AnalyticalReleaseIdentity = z.infer<typeof analyticalReleaseIdentitySchema>;
export type AssuranceEvidence = z.infer<typeof assuranceEvidenceSchema>;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];
export const V8_HOSTING_PREDECESSOR_GATES = [
  ...Array.from({ length: 18 }, (_, index) => `H6-${String(index + 1).padStart(2, "0")}`),
  "H7-01", "H7-02", "H7-03",
] as const;

const stageLanes = [[], ["source"], ["source", "staging"], ["source", "staging", "pilot"], ["source", "staging", "pilot", "operations"], ["source", "staging", "pilot", "operations", "enterprise"]] as const;

/** Evaluates a supplied claim manifest; does not certify its completeness, grant authority or mutate release state. */
export function evaluateReleasePromotion(input: {
  from: ReleaseStage; to: ReleaseStage; release: AnalyticalReleaseIdentity;
  claims: readonly { id: string; lane: AssuranceEvidence["lane"] }[];
  evidence: readonly AssuranceEvidence[]; predecessorGates: readonly { id: string; status: "passed" | "open" | "failed" }[];
  acceptedBy: string | null; now: Date;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const target = RELEASE_STAGES.indexOf(input.to), current = RELEASE_STAGES.indexOf(input.from);
  if (target < 0 || current < 0) reasons.push("unknown_release_stage");
  if (target !== current + 1) reasons.push("promotion_must_advance_one_stage");
  if (!Number.isFinite(input.now.getTime())) reasons.push("invalid_verification_time");
  if (!input.acceptedBy?.trim()) reasons.push("named_risk_owner_required");
  const identity = analyticalReleaseIdentitySchema.parse(input.release);
  const sameRelease = (other: AnalyticalReleaseIdentity) => Object.keys(identity).every((key) => identity[key as keyof AnalyticalReleaseIdentity] === other[key as keyof AnalyticalReleaseIdentity]);
  for (const lane of stageLanes[target] ?? []) {
    const claims = input.claims.filter((claim) => claim.lane === lane);
    if (!claims.length) reasons.push(`missing_claims:${lane}`);
    for (const claim of claims) {
      const witnesses = input.evidence.filter((raw) => {
        const parsed = assuranceEvidenceSchema.safeParse(raw);
        if (!parsed.success) return false;
        const e = parsed.data;
        return e.claimId === claim.id && e.lane === lane && e.status === "passed" && sameRelease(e.release)
          && Date.parse(e.verifiedAt) <= input.now.getTime() && Date.parse(e.expiresAt) > input.now.getTime()
          && (lane === "source" || (e.kind !== "fixture" && e.kind !== "deterministic_test"))
          && (e.kind !== "independent_review" || e.owner !== e.reviewer);
      });
      if (!witnesses.length) reasons.push(`unproven_claim:${claim.id}`);
    }
  }
  // Source development may proceed locally; hosted promotion cannot clear predecessor gaps.
  if (target >= 2) {
    for (const id of V8_HOSTING_PREDECESSOR_GATES) {
      const gates = input.predecessorGates.filter((gate) => gate.id === id);
      if (gates.length !== 1 || gates[0]!.status !== "passed") reasons.push(`predecessor_gate:${id}`);
    }
    for (const gate of input.predecessorGates) if (gate.status !== "passed" && !reasons.includes(`predecessor_gate:${gate.id}`)) reasons.push(`predecessor_gate:${gate.id}`);
  }
  return { allowed: reasons.length === 0, reasons };
}

export const analyticalProviderQualificationSchema = z.object({
  providerKey: ref, version: ref, sourceOrImageDigest: hash, license: ref,
  licenseReviewedAt: z.iso.datetime(), inputContractVersion: ref, outputContractVersion: ref,
  networkRequired: z.boolean(), allowedDataCategories: z.array(ref).max(32), regionsSupported: z.array(ref).min(1).max(32),
  resourceLimits: z.object({ timeoutSeconds: z.number().int().min(1).max(3600), memoryMiB: z.number().int().min(16).max(65536), maxInputRows: z.number().int().min(1).max(1_000_000) }).strict(),
  determinism: z.enum(["deterministic", "seeded", "nondeterministic"]),
  privacyDeletionContractRef: ref, securityScanRef: ref, sbomRef: ref, provenanceRef: ref,
  qualificationSuiteRef: ref, qualificationHash: hash, qualifiedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  revalidationTriggers: z.array(ref).min(1).max(32), knownLimitations: z.array(ref).max(32),
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.qualifiedAt), "Provider qualification must expire after qualification");
