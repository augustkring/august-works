import { z } from "zod";
import {
  EVIDENCE_SENSITIVITIES,
  EVIDENCE_SOURCE_CLASSES,
  EVIDENCE_TRUST_LEVELS,
} from "../types/context.js";
import {
  MEMORY_BINDING_TARGET_TYPES,
  MEMORY_EVIDENCE_RELATIONS,
  MEMORY_SCOPE_TYPES,
  MEMORY_TYPES,
  MEMORY_VERIFICATION_STATES,
} from "../types/memory.js";

const nullableIso = z.string().datetime().nullable();
const nullableBounded = (max: number) => z.string().trim().min(1).max(max).nullable();

export const memoryBindingInputSchema = z
  .object({
    key: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/),
    name: z.string().trim().min(1).max(240),
    providerKey: z.string().trim().min(1).max(160),
    config: z.record(z.string(), z.unknown()).default({}),
    enabled: z.boolean().default(true),
  })
  .strict();

export const memoryBindingTargetInputSchema = z
  .object({
    targetType: z.enum(MEMORY_BINDING_TARGET_TYPES),
    targetId: z.string().trim().min(1).max(500),
  })
  .strict();

export const memoryScopeSchema = z
  .object({
    type: z.enum(MEMORY_SCOPE_TYPES),
    id: nullableBounded(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "company" && value.id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Company memory scope must not carry a separate scope id",
      });
    }
    if (value.type !== "company" && value.id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Non-company memory scope requires a scope id",
      });
    }
  });

export const memorySubjectSchema = z
  .object({
    type: z.string().trim().min(1).max(160),
    id: z.string().trim().min(1).max(500),
  })
  .strict();

export const memoryEvidenceInputSchema = z
  .object({
    sourceClass: z.enum(EVIDENCE_SOURCE_CLASSES),
    sourceProvider: z.string().trim().min(1).max(160),
    sourceType: z.string().trim().min(1).max(160),
    sourceRef: z.string().trim().min(1).max(2048),
    sourceVersion: nullableBounded(1000),
    sourceUpdatedAt: nullableIso,
    observedAt: z.string().datetime(),
    excerptHash: z.string().regex(/^[0-9a-f]{64}$/),
    citation: z
      .object({
        label: z.string().trim().min(1).max(500),
        href: z
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
          })
          .optional(),
      })
      .strict(),
    trustLevel: z.enum(EVIDENCE_TRUST_LEVELS),
    relation: z.enum(MEMORY_EVIDENCE_RELATIONS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.sourceClass === "external_untrusted" &&
      value.trustLevel !== "untrusted"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trustLevel"],
        message: "External untrusted memory evidence must remain untrusted",
      });
    }
  });

const memoryCandidateBaseSchema = z
  .object({
    bindingId: z.string().guid(),
    memoryType: z.enum(MEMORY_TYPES),
    scope: memoryScopeSchema,
    subject: memorySubjectSchema.nullable().default(null),
    ownerAgentId: z.string().guid().nullable().default(null),
    title: nullableBounded(1000),
    content: z.string().trim().min(1).max(128_000),
    summary: nullableBounded(16_000),
    sensitivity: z.enum(EVIDENCE_SENSITIVITIES),
    importance: z.number().int().min(0).max(100).default(50),
    confidenceScore: z.number().min(0).max(1).default(0.5),
    validFrom: nullableIso,
    validUntil: nullableIso,
    observedAt: z.string().datetime(),
    retentionPolicy: z.string().trim().min(1).max(160).default("standard"),
    expiresAt: nullableIso,
    createdByOperationId: nullableBounded(500),
    metadata: z.record(z.string(), z.unknown()).default({}),
    evidence: z.array(memoryEvidenceInputSchema).min(1).max(64),
  })
  .strict();

type MemoryCandidateBaseValue = z.infer<typeof memoryCandidateBaseSchema>;

function refineMemoryEvidenceAndDates(
  value: Pick<
    MemoryCandidateBaseValue,
    "evidence" | "validFrom" | "validUntil" | "observedAt" | "expiresAt"
  >,
  ctx: z.RefinementCtx,
) {
  if (!value.evidence.some((item) => item.relation === "supports")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence"],
      message: "Durable memory requires at least one supporting evidence item",
    });
  }
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
  if (
    value.expiresAt &&
    new Date(value.expiresAt).getTime() <= new Date(value.observedAt).getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be later than observedAt",
    });
  }
}

export const memoryCandidateInputSchema = memoryCandidateBaseSchema.superRefine(
  (value, ctx) => {
    refineMemoryEvidenceAndDates(value, ctx);
    if (value.scope.type === "agent") {
      if (!value.ownerAgentId || value.ownerAgentId !== value.scope.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ownerAgentId"],
          message: "Private agent memory must be owned by the scoped agent",
        });
      }
    } else if (value.ownerAgentId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerAgentId"],
        message: "Shared organizational memory must not have an owner agent",
      });
    }
  },
);

export const memoryReviewInputSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    reason: nullableBounded(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "reject" && !value.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Rejected memory requires a reason",
      });
    }
  });

export const memoryCorrectionInputSchema = memoryCandidateBaseSchema
  .omit({
    bindingId: true,
    scope: true,
    ownerAgentId: true,
  })
  .extend({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    refineMemoryEvidenceAndDates(value, ctx);
  });

export const memoryRevokeInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const memoryPrivateInputSchema = memoryCandidateBaseSchema
  .omit({
    scope: true,
    ownerAgentId: true,
    createdByOperationId: true,
  })
  .extend({
    createdByOperationId: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    refineMemoryEvidenceAndDates(value, ctx);
  });

export const sharedMemoryScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("company"), id: z.null() }).strict(),
  z.object({ type: z.literal("project"), id: z.string().guid() }).strict(),
  z
    .object({
      type: z.literal("subject"),
      id: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export const memoryShareInputSchema = z
  .object({
    targetBindingId: z.string().guid(),
    targetScope: sharedMemoryScopeSchema,
    reason: z.string().trim().min(1).max(2000),
    createdByOperationId: z.string().trim().min(1).max(500),
  })
  .strict();

export const memoryPrivateCorrectionInputSchema = memoryCandidateBaseSchema
  .omit({
    bindingId: true,
    scope: true,
    ownerAgentId: true,
    createdByOperationId: true,
  })
  .extend({
    reason: z.string().trim().min(1).max(2000),
    createdByOperationId: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    refineMemoryEvidenceAndDates(value, ctx);
  });

export type MemoryBindingInputParsed = z.infer<typeof memoryBindingInputSchema>;
export type MemoryBindingTargetInputParsed = z.infer<typeof memoryBindingTargetInputSchema>;
export type MemoryCandidateInputParsed = z.infer<typeof memoryCandidateInputSchema>;
export type MemoryReviewInputParsed = z.infer<typeof memoryReviewInputSchema>;
export type MemoryCorrectionInputParsed = z.infer<typeof memoryCorrectionInputSchema>;
export type MemoryRevokeInputParsed = z.infer<typeof memoryRevokeInputSchema>;
export type MemoryPrivateInputParsed = z.infer<typeof memoryPrivateInputSchema>;
export type MemoryShareInputParsed = z.infer<typeof memoryShareInputSchema>;
export type MemoryPrivateCorrectionInputParsed = z.infer<
  typeof memoryPrivateCorrectionInputSchema
>;

export const memoryRecordListQuerySchema = z
  .object({
    reviewState: z.enum(["pending", "accepted", "rejected"]).optional(),
    memoryType: z.enum(MEMORY_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const memoryReviewReasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type MemoryRecordListQueryParsed = z.infer<typeof memoryRecordListQuerySchema>;

const memoryAgentSubjectSchema = z
  .object({
    type: z.string().trim().min(1).max(120),
    id: z.string().trim().min(1).max(320),
  })
  .strict();

export const memoryPostRunCandidateProposalSchema = z
  .object({
    memoryType: z.enum(MEMORY_TYPES),
    title: nullableBounded(180),
    content: z.string().trim().min(1).max(4_000),
    subjectType: nullableBounded(120),
    subjectId: nullableBounded(320),
    proposedScopeType: z.enum(["org", "team", "project", "subject", "agent"]),
    proposedScopeId: nullableBounded(500),
    sensitivity: z.enum(EVIDENCE_SENSITIVITIES),
    validFrom: nullableIso,
    validUntil: nullableIso,
    evidenceRefs: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(12),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.subjectType === null) !== (value.subjectId === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subjectId"],
        message: "Memory candidate subject type and id must be supplied together",
      });
    }
    if (value.proposedScopeType === "subject" && !value.subjectType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subjectType"],
        message: "Subject-scoped memory candidate requires a subject",
      });
    }
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
  });

export const memoryPostRunCandidateProposalListSchema = z
  .array(memoryPostRunCandidateProposalSchema)
  .max(8);

export type MemoryPostRunCandidateProposalParsed = z.infer<
  typeof memoryPostRunCandidateProposalSchema
>;

export const memoryAgentRecallInputSchema = z
  .object({
    query: z.string().trim().min(1).max(4_000),
    topK: z.number().int().min(1).max(20).default(8),
    subjects: z.array(memoryAgentSubjectSchema).max(16).default([]),
    asOf: z.string().datetime().nullable().optional(),
  })
  .strict();

export const memoryAgentRememberInputSchema = z
  .object({
    scope: z.enum(["private", "company", "project", "subject"]).default("private"),
    subject: memoryAgentSubjectSchema.nullable().optional(),
    bindingKey: z.string().trim().min(1).max(160).optional(),
    memoryType: z.enum(MEMORY_TYPES),
    title: nullableBounded(1_000).optional().default(null),
    content: z.string().trim().min(1).max(128_000),
    summary: nullableBounded(16_000).optional().default(null),
    sensitivity: z.enum(EVIDENCE_SENSITIVITIES).default("internal"),
    importance: z.number().int().min(0).max(100).default(50),
    confidenceScore: z.number().min(0).max(1).default(0.5),
    validFrom: nullableIso.optional().default(null),
    validUntil: nullableIso.optional().default(null),
    observedAt: z.string().datetime().optional(),
    retentionPolicy: z.string().trim().min(1).max(160).default("standard"),
    expiresAt: nullableIso.optional().default(null),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === "subject" && !value.subject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject"],
        message: "Subject-scoped memory requires a subject",
      });
    }
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
  });

export const memoryAgentCorrectInputSchema = z
  .object({
    recordId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2_000),
    content: z.string().trim().min(1).max(128_000),
    memoryType: z.enum(MEMORY_TYPES).optional(),
    subject: memoryAgentSubjectSchema.nullable().optional(),
    title: nullableBounded(1_000).optional(),
    summary: nullableBounded(16_000).optional(),
    sensitivity: z.enum(EVIDENCE_SENSITIVITIES).optional(),
    importance: z.number().int().min(0).max(100).optional(),
    confidenceScore: z.number().min(0).max(1).optional(),
    validFrom: nullableIso.optional(),
    validUntil: nullableIso.optional(),
    observedAt: z.string().datetime().optional(),
    retentionPolicy: z.string().trim().min(1).max(160).optional(),
    expiresAt: nullableIso.optional(),
    idempotencyKey: z.string().uuid(),
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
  });

export const memoryAgentShareInputSchema = z
  .object({
    recordId: z.string().uuid(),
    targetScope: z.enum(["company", "project", "subject"]).default("company"),
    subject: memoryAgentSubjectSchema.nullable().optional(),
    bindingKey: z.string().trim().min(1).max(160).optional(),
    reason: z.string().trim().min(1).max(2_000),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.targetScope === "subject" && !value.subject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject"],
        message: "Subject-scoped sharing requires a subject",
      });
    }
  });

export const memoryAgentRecallInputJsonSchema =
  z.toJSONSchema(memoryAgentRecallInputSchema, { io: "input" }) as Record<string, unknown>;
export const memoryAgentRememberInputJsonSchema =
  z.toJSONSchema(memoryAgentRememberInputSchema, { io: "input" }) as Record<string, unknown>;
export const memoryAgentCorrectInputJsonSchema =
  z.toJSONSchema(memoryAgentCorrectInputSchema, { io: "input" }) as Record<string, unknown>;
export const memoryAgentShareInputJsonSchema =
  z.toJSONSchema(memoryAgentShareInputSchema, { io: "input" }) as Record<string, unknown>;

export type MemoryAgentRecallInputParsed = z.infer<
  typeof memoryAgentRecallInputSchema
>;
export type MemoryAgentRememberInputParsed = z.infer<
  typeof memoryAgentRememberInputSchema
>;
export type MemoryAgentCorrectInputParsed = z.infer<
  typeof memoryAgentCorrectInputSchema
>;
export type MemoryAgentShareInputParsed = z.infer<
  typeof memoryAgentShareInputSchema
>;

