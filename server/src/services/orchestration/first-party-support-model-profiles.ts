import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import type { CompanyPurposeFunding } from "@paperclipai/shared";
import { companyPurposeFundingSchema } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import {
  assertModelQualificationMetadata,
  modelQualificationMetadataSchema,
  type ModelQualificationMetadata,
} from "./read-only-model-profiles.js";

/** Deployment-owned operator profile for the fixed Support text transport.
 * It contains qualification/accounting metadata and a credential hash only;
 * the Anthropic key is loaded from one fixed server environment variable. */
export const firstPartySupportModelProfileSchema = modelQualificationMetadataSchema
  .extend({
    companyId: z.string().uuid(),
    packageVersionId: z.string().uuid(),
    purpose: z.literal("first_party_support"),
    funder: z.literal("blentera_platform"),
    profileId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
    providerAccountId: z.string().regex(/^[a-zA-Z0-9._:-]{1,160}$/),
    credentialBindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    privacyNoticeUrl: z.url().refine(value => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }),
    periodKey: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
    periodStartsAt: z.iso.datetime(),
    periodEndsAt: z.iso.datetime(),
    maxCostMinor: z.number().int().min(1).max(1_000_000),
    maxCalls: z.number().int().min(1).max(10_000),
  })
  .strict()
  .superRefine((p, ctx) => {
    const start = Date.parse(p.periodStartsAt), end = Date.parse(p.periodEndsAt);
    const testedAt = Date.parse(p.tariff.testedAt), tariffEndsAt = Date.parse(p.tariff.expiresAt);
    if (p.tariff.provider !== "anthropic")
      ctx.addIssue({ code: "custom", path: ["tariff", "provider"], message: "First-party support uses the fixed Anthropic text transport" });
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
      end - start > 366 * 24 * 60 * 60 * 1000 || start < testedAt || end > tariffEndsAt)
      ctx.addIssue({ code: "custom", path: ["periodEndsAt"], message: "Support funding period must remain inside the qualified tariff interval" });
  });
export type FirstPartySupportModelProfile = z.infer<typeof firstPartySupportModelProfileSchema>;

export function assertFirstPartySupportModelProfileCurrent(
  raw: FirstPartySupportModelProfile,
  sourceSha: string,
  protectedEvidenceOrigin: string,
  now = new Date(),
) {
  const profile = firstPartySupportModelProfileSchema.parse(raw);
  assertModelQualificationMetadata(profile, sourceSha, protectedEvidenceOrigin, now);
  if (Date.parse(profile.periodStartsAt) > now.getTime() || Date.parse(profile.periodEndsAt) <= now.getTime())
    throw new Error("first_party_support_funding_period_unavailable");
  return profile;
}

export function firstPartySupportFunding(profile: FirstPartySupportModelProfile): CompanyPurposeFunding {
  const funding = companyPurposeFundingSchema.parse({
    companyId: profile.companyId,
    purpose: profile.purpose,
    funder: profile.funder,
    profileId: profile.profileId,
    profileHash: "0".repeat(64),
    providerAccountId: profile.providerAccountId,
    credentialBindingHash: profile.credentialBindingHash,
    periodKey: profile.periodKey,
    periodStartsAt: profile.periodStartsAt,
    periodEndsAt: profile.periodEndsAt,
    maxCostMinor: profile.maxCostMinor,
    maxCalls: profile.maxCalls,
    tariff: profile.tariff,
  });
  const { profileHash: _placeholder, ...immutable } = funding;
  return { ...funding, profileHash: nativeSha256(immutable) };
}

/** Same private-file pattern as the existing native model profile loaders.
 * The checked file stores no credential value. */
export function loadFirstPartySupportModelProfiles(path?: string, expectedSha256?: string): FirstPartySupportModelProfile[] {
  if (!path && !expectedSha256) return [];
  if (!path?.startsWith("/") || !expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error("first_party_support_model_profile_pin_required");
  const real = realpathSync(path), stat = statSync(real);
  if (!stat.isFile() || stat.size > 1_048_576 || (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()))
    throw new Error("first_party_support_model_profile_file_not_private");
  const bytes = readFileSync(real);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256)
    throw new Error("first_party_support_model_profile_digest_changed");
  let data: unknown;
  try { data = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("first_party_support_model_profile_json_invalid"); }
  const profiles = z.array(firstPartySupportModelProfileSchema).max(100).parse(data);
  if (new Set(profiles.map(p => p.companyId)).size !== profiles.length ||
    new Set(profiles.map(p => `${p.companyId}:${p.profileId}`)).size !== profiles.length)
    throw new Error("first_party_support_model_profiles_ambiguous");
  return profiles;
}

export type FirstPartySupportQualification = ModelQualificationMetadata & {
  companyId: string;
  packageVersionId: string;
  purpose: "first_party_support";
  funder: "blentera_platform";
  profileId: string;
  providerAccountId: string;
  credentialBindingHash: string;
  periodKey: string;
  periodStartsAt: string;
  periodEndsAt: string;
  maxCostMinor: number;
  maxCalls: number;
};
