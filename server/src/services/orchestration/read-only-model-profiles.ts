import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import {
  aiConnectionBindingSchema,
  modelTariffCeilingSchema,
} from "@paperclipai/shared";

/** Operator-owned qualification, never a plan, worker or provider declaration.
 * The token ceiling must qualify the entire text-only wire envelope for this
 * exact model and byte limit. The report also needs independent judge
 * calibration; a vendor's advertised context window is insufficient. */
export const modelQualificationProfileSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    binding: aiConnectionBindingSchema,
    contract: z.literal("anthropic-text-messages-2023-06-01"),
    tariff: modelTariffCeilingSchema,
    maximumEnvelopeBytes: z.number().int().min(1024).max(262144),
    inputTokensUpperBound: z.number().int().min(1).max(2000000),
    maxOutputTokens: z.number().int().min(256).max(8192),
    qualificationEvidenceRef: z.string().url(),
    qualificationArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
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
  .superRefine(checkModelQualificationProvider);
export type ReadOnlyModelProfile = z.input<typeof readOnlyModelProfileSchema>;

export function assertReadOnlyModelProfileCurrent(
  profile: ReadOnlyModelProfile,
  sourceSha: string,
  protectedOrigin: string,
  now = new Date(),
) {
  const p = readOnlyModelProfileSchema.parse(profile);
  assertModelQualificationMetadata(p, sourceSha, protectedOrigin, now);
  return p;
}

export function assertModelQualificationMetadata(
  p: z.infer<typeof modelQualificationProfileSchema>,
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
