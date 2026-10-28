import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import {
  aiConnectionBindingSchema,
  modelLifecycleMetadataSchema,
  modelTariffCeilingSchema,
} from "@paperclipai/shared";

/** Operator-owned qualification, never a plan, worker or provider declaration.
 * The token ceiling must qualify the entire text-only wire envelope for this
 * exact model and byte limit. The report also needs independent judge
 * calibration; a vendor's advertised context window is insufficient. */
export const modelQualificationMetadataSchema = z
  .object({
    contract: z.enum([
      "anthropic-text-messages-2023-06-01",
      "anthropic-messages-tools-2023-06-01",
    ]),
    tariff: modelTariffCeilingSchema,
    maximumEnvelopeBytes: z.number().int().min(1024).max(262144),
    inputTokensUpperBound: z.number().int().min(1).max(2000000),
    maxOutputTokens: z.number().int().min(256).max(8192),
    qualificationEvidenceRef: z.string().url(),
    qualificationArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    lifecycle: modelLifecycleMetadataSchema.optional(),
  })
  .strict();
export type ModelQualificationMetadata = z.infer<typeof modelQualificationMetadataSchema>;

export const modelQualificationProfileSchema = modelQualificationMetadataSchema
  .extend({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    binding: aiConnectionBindingSchema,
  })
  .strict();

export function checkModelQualificationProvider(
  p: z.infer<typeof modelQualificationProfileSchema>,
  ctx: z.RefinementCtx,
) {
  if (
    p.tariff.provider !== "anthropic" ||
    p.binding.provider !== "anthropic" ||
    p.binding.method !== "api_key" ||
    p.binding.mode === "responsible_user"
  )
    ctx.addIssue({
      code: "custom",
      message: "An explicit installed Anthropic API-key grant is required",
    });
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(p.tariff.model))
    ctx.addIssue({
      code: "custom",
      message: "An exact Anthropic model revision is required",
    });
}

export const readOnlyModelProfileSchema = modelQualificationProfileSchema
  .extend({
    reviewerAgentId: z.string().uuid(),
    purposes: z
      .array(z.enum(["read_only_verification", "read_only_trajectory"]))
      .min(1)
      .max(2)
      .default(["read_only_verification"]),
    calibrationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((profile, context) => {
    checkModelQualificationProvider(profile, context);
    if (profile.contract !== "anthropic-text-messages-2023-06-01")
      context.addIssue({ code: "custom", message: "Read-only verification requires the text-only contract" });
  });
export type ReadOnlyModelProfile = z.input<typeof readOnlyModelProfileSchema>;

export function assertReadOnlyModelProfileCurrent(
  profile: ReadOnlyModelProfile,
  sourceSha: string,
  protectedOrigin: string,
  now = new Date(),
) {
  const p = readOnlyModelProfileSchema.parse(profile);
  assertModelQualificationMetadata(p, sourceSha, protectedOrigin, now);
  assertModelLifecycleAdmission(p.lifecycle, "runtime", now);
  return p;
}

export function assertModelQualificationMetadata(
  p: ModelQualificationMetadata,
  sourceSha: string,
  protectedOrigin: string,
  now = new Date(),
) {
  const evidence = new URL(p.qualificationEvidenceRef);
  const tested = Date.parse(p.tariff.testedAt),
    expires = Date.parse(p.tariff.expiresAt);
  if (
    p.tariff.sourceSha !== sourceSha ||
    tested > now.getTime() ||
    expires <= now.getTime() ||
    expires <= tested ||
    expires - tested > 86400000 ||
    evidence.protocol !== "https:" ||
    evidence.origin !== new URL(protectedOrigin).origin ||
    !evidence.pathname.includes("/qualification/") ||
    evidence.search ||
    evidence.hash ||
    evidence.username ||
    evidence.password
  )
    throw new Error("read_only_model_qualification_unavailable");
}

export function assertModelLifecycleAdmission(
  lifecycle: z.infer<typeof modelLifecycleMetadataSchema> | undefined,
  purpose: "runtime" | "candidate_evaluation" = "runtime",
  now = new Date(),
) {
  // Legacy pinned profiles remain exact-profile qualified, but their lifecycle
  // inventory is explicitly unknown until an operator supplies this metadata.
  if (!lifecycle) return { status: "untracked" as const, retirementAt: null };
  const retired = lifecycle.status === "blocked" || lifecycle.status === "retired" || lifecycle.status === "migration_required" ||
    (lifecycle.retirementAt !== null && Date.parse(lifecycle.retirementAt) <= now.getTime());
  if (retired) throw new Error("model_lifecycle_profile_unavailable");
  if (purpose === "runtime" && ["candidate", "qualifying"].includes(lifecycle.status))
    throw new Error("model_lifecycle_candidate_not_runtime_qualified");
  return { status: lifecycle.status, retirementAt: lifecycle.retirementAt };
}

/** Migration is available only when both exact profiles declare comparable
 * data/region/capability facts and the candidate preserves the incumbent
 * envelope. Unknown compatibility never becomes an implicit fallback. */
export function assertModelMigrationCompatible(
  incumbent: ModelQualificationMetadata & { transport?: string; contract?: string },
  candidate: ModelQualificationMetadata & { transport?: string; contract?: string },
) {
  const from = incumbent.lifecycle, to = candidate.lifecycle;
  if (!from || !to) throw new Error("model_lifecycle_compatibility_unavailable");
  const supports = (candidateValues: readonly string[], incumbentValues: readonly string[]) => incumbentValues.every(value => candidateValues.includes(value));
  const sameLimit = (candidateValue: number | null, incumbentValue: number | null) => candidateValue !== null && incumbentValue !== null && candidateValue >= incumbentValue;
  const candidateCost = candidate.tariff.inputMinorPerMillion <= incumbent.tariff.inputMinorPerMillion &&
    candidate.tariff.outputMinorPerMillion <= incumbent.tariff.outputMinorPerMillion && candidate.tariff.fixedMinor <= incumbent.tariff.fixedMinor;
  if (from.regionOrRoutingProfile !== to.regionOrRoutingProfile || from.dataUseProfile !== to.dataUseProfile ||
    !supports(to.supportedInputOutput, from.supportedInputOutput) || (from.toolUseCapability && !to.toolUseCapability) ||
    !sameLimit(to.rateLimits.requestsPerMinute, from.rateLimits.requestsPerMinute) ||
    !sameLimit(to.rateLimits.tokensPerMinute, from.rateLimits.tokensPerMinute) ||
    incumbent.transport !== candidate.transport || incumbent.contract !== candidate.contract ||
    candidate.inputTokensUpperBound < incumbent.inputTokensUpperBound || candidate.maxOutputTokens < incumbent.maxOutputTokens ||
    candidate.maximumEnvelopeBytes < incumbent.maximumEnvelopeBytes || !candidateCost)
    throw new Error("model_lifecycle_candidate_incompatible");
}

/** Deployment-pinned private file. Missing configuration does not activate a
 * provider. Artifact references remain operator-attested evidence metadata:
 * loading this file does not perform or claim live calibration/price tests. */
export function loadReadOnlyModelProfiles(
  path: string | undefined,
  expectedSha256: string | undefined,
): ReadOnlyModelProfile[] {
  if (!path && !expectedSha256) return [];
  if (
    !path?.startsWith("/") ||
    !expectedSha256 ||
    !/^[a-f0-9]{64}$/.test(expectedSha256)
  )
    throw new Error("read_only_model_profile_pin_required");
  const real = realpathSync(path),
    stat = statSync(real);
  if (
    !stat.isFile() ||
    stat.size > 1048576 ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    throw new Error("read_only_model_profile_file_not_private");
  const bytes = readFileSync(real);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new Error("read_only_model_profile_digest_changed");
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("read_only_model_profile_json_invalid");
  }
  const profiles = z.array(readOnlyModelProfileSchema).max(20).parse(data);
  if (
    new Set(profiles.map((p) => p.companyId)).size !== profiles.length ||
    new Set(profiles.map((p) => p.id)).size !== profiles.length
  )
    throw new Error("read_only_model_profiles_ambiguous");
  return profiles;
}
