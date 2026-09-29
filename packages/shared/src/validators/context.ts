import { z } from "zod";
import {
  EVIDENCE_SENSITIVITIES,
  EVIDENCE_SOURCE_CLASSES,
  EVIDENCE_TRUST_LEVELS,
  CONTEXT_EVIDENCE_BUCKETS,
  type EvidenceItem,
} from "../types/context.js";

export const EVIDENCE_EXCERPT_MAX_CHARS = 64_000;

const evidenceTimestampSchema = z.string().datetime();

const citationHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "Citation href must be an http(s) URL or an app-relative path");

export const evidenceCitationSchema = z
  .object({
    label: z.string().trim().min(1).max(500),
    href: citationHrefSchema.optional(),
  })
  .strict();

export const evidenceItemSchema: z.ZodType<EvidenceItem> = z
  .object({
    id: z.string().trim().min(1).max(500),
    companyId: z.string().guid(),

    sourceClass: z.enum(EVIDENCE_SOURCE_CLASSES),
    sourceProvider: z.string().trim().min(1).max(160),
    sourceType: z.string().trim().min(1).max(160),
    sourceRef: z.string().trim().min(1).max(2048),

    title: z.string().trim().max(1000).nullable(),
    excerpt: z.string().min(1).max(EVIDENCE_EXCERPT_MAX_CHARS),

    sourceVersion: z.string().trim().min(1).max(1000).nullable(),
    sourceUpdatedAt: evidenceTimestampSchema.nullable(),
    observedAt: evidenceTimestampSchema,

    validFrom: evidenceTimestampSchema.nullable(),
    validUntil: evidenceTimestampSchema.nullable(),

    authorityDomain: z.string().trim().min(1).max(240).nullable(),
    trustLevel: z.enum(EVIDENCE_TRUST_LEVELS),
    sensitivity: z.enum(EVIDENCE_SENSITIVITIES),

    citation: evidenceCitationSchema,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.validFrom &&
      value.validUntil &&
      new Date(value.validUntil).getTime() <= new Date(value.validFrom).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must be later than validFrom",
      });
    }

    if (value.sourceClass === "external_untrusted" && value.trustLevel !== "untrusted") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustLevel"],
        message: "external_untrusted evidence must use the untrusted trust level",
      });
    }
  });

export const evidenceItemsSchema = z.array(evidenceItemSchema).max(500);

export type EvidenceItemInput = z.input<typeof evidenceItemSchema>;

export const contextAuthoritySelectorSchema = z
  .object({
    sourceClass: z.enum(EVIDENCE_SOURCE_CLASSES),
    sourceProvider: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const contextAuthorityRuleSchema = z
  .object({
    authorityDomain: z.string().trim().min(1).max(240),
    preferredSources: z.array(contextAuthoritySelectorSchema).min(1).max(16),
  })
  .strict();

export const contextAuthorityPolicySchema = z
  .object({
    rules: z.array(contextAuthorityRuleSchema).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.rules.forEach((rule, index) => {
      if (seen.has(rule.authorityDomain)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "authorityDomain"],
          message: "Authority domains must be unique within one policy",
        });
      }
      seen.add(rule.authorityDomain);
    });
  });

const contextBudgetBucketSchema = z
  .object({
    maxItems: z.number().int().min(0).max(500),
  })
  .strict();

export const contextBudgetSchema = z
  .object({
    maxItems: z.number().int().min(1).max(500),
    maxEstimatedTokens: z.number().int().min(1).max(2_000_000),
    buckets: z.object(
      Object.fromEntries(
        CONTEXT_EVIDENCE_BUCKETS.map((bucket) => [bucket, contextBudgetBucketSchema]),
      ) as Record<
        (typeof CONTEXT_EVIDENCE_BUCKETS)[number],
        typeof contextBudgetBucketSchema
      >,
    ).strict(),
  })
  .strict();

export type ContextAuthorityPolicyInput = z.input<typeof contextAuthorityPolicySchema>;
export type ContextBudgetInput = z.input<typeof contextBudgetSchema>;
