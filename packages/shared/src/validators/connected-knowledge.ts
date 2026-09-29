import { z } from "zod";
import {
  CONNECTED_KNOWLEDGE_ACCESS_MODES,
  CONNECTED_KNOWLEDGE_DENIAL_CODES,
  CONNECTED_KNOWLEDGE_SOURCE_CLASSES,
  type ConnectedKnowledgeAccessDecision,
  type ConnectedKnowledgeAuthorizedScope,
  type ConnectedKnowledgeProviderDescriptor,
  type ConnectedKnowledgeRequest,
} from "../types/connected-knowledge.js";

const providerKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/, "Provider key must be stable lowercase identifier text");

const boundedNullableIdSchema = z.string().trim().min(1).max(500).nullable();

export const connectedKnowledgeProviderDescriptorSchema: z.ZodType<ConnectedKnowledgeProviderDescriptor> =
  z
    .object({
      key: providerKeySchema,
      displayName: z.string().trim().min(1).max(240),
      sourceProvider: z.string().trim().min(1).max(160),
      accessMode: z.enum(CONNECTED_KNOWLEDGE_ACCESS_MODES),
      sourceClasses: z.array(z.enum(CONNECTED_KNOWLEDGE_SOURCE_CLASSES)).min(1).max(3),
    })
    .strict()
    .superRefine((value, ctx) => {
      const unique = new Set(value.sourceClasses);
      if (unique.size !== value.sourceClasses.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceClasses"],
          message: "Connected Knowledge source classes must be unique",
        });
      }
    });

export const connectedKnowledgeRequestSchema: z.ZodType<ConnectedKnowledgeRequest> =
  z
    .object({
      companyId: z.string().guid(),
      agentId: z.string().guid(),
      responsibleUserId: boundedNullableIdSchema,
      runId: z.string().guid().nullable(),
      issueId: z.string().guid().nullable(),
      projectId: z.string().guid().nullable(),
      query: z.string().trim().min(1).max(4_000),
      intent: z.string().trim().min(1).max(2_000).nullable(),
      subjectRefs: z.array(z.string().trim().min(1).max(2_048)).max(64),
      limit: z.number().int().min(1).max(100),
      asOf: z.string().datetime(),
    })
    .strict();

export const connectedKnowledgeAuthorizedScopeSchema: z.ZodType<ConnectedKnowledgeAuthorizedScope> =
  z
    .object({
      providerKey: providerKeySchema,
      companyId: z.string().guid(),
      agentId: z.string().guid(),
      responsibleUserId: boundedNullableIdSchema,
      runId: z.string().guid().nullable(),
      requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      aclVersion: z.string().trim().min(1).max(1_000).nullable(),
      authorizedAt: z.string().datetime(),
      expiresAt: z.string().datetime().nullable(),
      constraints: z.record(z.string(), z.unknown()),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (
        value.expiresAt &&
        new Date(value.expiresAt).getTime() <= new Date(value.authorizedAt).getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expiresAt"],
          message: "expiresAt must be later than authorizedAt",
        });
      }
    });

export const connectedKnowledgeAccessDecisionSchema: z.ZodType<ConnectedKnowledgeAccessDecision> =
  z.discriminatedUnion("allowed", [
    z
      .object({
        allowed: z.literal(true),
        scope: connectedKnowledgeAuthorizedScopeSchema,
      })
      .strict(),
    z
      .object({
        allowed: z.literal(false),
        code: z.enum(CONNECTED_KNOWLEDGE_DENIAL_CODES),
        reason: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  ]);

export type ConnectedKnowledgeRequestInput = z.input<
  typeof connectedKnowledgeRequestSchema
>;
