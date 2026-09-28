import { z } from "zod";
import {
  EVIDENCE_SENSITIVITIES,
  EVIDENCE_SOURCE_CLASSES,
  EVIDENCE_TRUST_LEVELS,
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
