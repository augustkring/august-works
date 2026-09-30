import { z } from "zod";
import {
  AUTOMATION_ARTIFACT_KINDS,
  AUTOMATION_ARTIFACT_LANGUAGES,
  AUTOMATION_ARTIFACT_STATUSES,
} from "../types/automation-artifact.js";
import {
  WORKFLOW_RISK_CLASSES,
  WORKFLOW_SIDE_EFFECT_CLASSES,
} from "../types/workflow.js";

const MAX_SOURCE_CODE_CHARS = 1_000_000;
const MAX_JSON_METADATA_BYTES = 128 * 1024;

const jsonObjectSchema = z.record(z.string(), z.unknown());

function boundedJsonObject(label: string) {
  return jsonObjectSchema.superRefine((value, ctx) => {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be JSON-serializable`,
      });
      return;
    }
    if (bytes > MAX_JSON_METADATA_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be at most ${MAX_JSON_METADATA_BYTES} bytes`,
      });
    }
  });
}

export const automationArtifactKindSchema = z.enum(AUTOMATION_ARTIFACT_KINDS);
export const automationArtifactLanguageSchema = z.enum(
  AUTOMATION_ARTIFACT_LANGUAGES,
);
export const automationArtifactStatusSchema = z.enum(
  AUTOMATION_ARTIFACT_STATUSES,
);

export const automationArtifactJsonSchema = boundedJsonObject(
  "Automation Artifact schema",
);

const automationArtifactDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().default(null),
    kind: automationArtifactKindSchema,
    language: automationArtifactLanguageSchema.nullable().default(null),
    inputSchema: automationArtifactJsonSchema,
    outputSchema: automationArtifactJsonSchema,
    riskClass: z.enum(WORKFLOW_RISK_CLASSES),
    sideEffectClass: z.enum(WORKFLOW_SIDE_EFFECT_CLASSES),
    createdByOptimizerSuggestionId: z.string().guid().nullable().default(null),
    originWorkflowId: z.string().guid().nullable().default(null),
    originNodeId: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "typescript" && value.language !== "typescript") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message: "TypeScript artifacts require language=typescript",
      });
    } else if (value.kind === "python" && value.language !== "python") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message: "Python artifacts require language=python",
      });
    } else if (
      value.kind !== "typescript" &&
      value.kind !== "python" &&
      value.language !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["language"],
        message: "Declarative artifact kinds must not declare a code language",
      });
    }
    if (value.originNodeId !== null && value.originWorkflowId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originNodeId"],
        message: "originNodeId requires originWorkflowId",
      });
    }
  });

export const automationArtifactVersionPayloadSchema = z
  .object({
    sourceCode: z.string().min(1).max(MAX_SOURCE_CODE_CHARS),
    inputSchema: automationArtifactJsonSchema,
    outputSchema: automationArtifactJsonSchema,
    dependencyManifest: boundedJsonObject(
      "Automation Artifact dependency manifest",
    ).default({}),
    testSpec: boundedJsonObject("Automation Artifact test spec").default({}),
  })
  .strict();

export const createAutomationArtifactSchema =
  automationArtifactDefinitionSchema.and(automationArtifactVersionPayloadSchema);

export const appendAutomationArtifactVersionSchema =
  automationArtifactVersionPayloadSchema
    .extend({
      expectedLatestVersionId: z.string().guid(),
    })
    .strict();

export const transitionAutomationArtifactStatusSchema = z
  .object({
    expectedStatus: automationArtifactStatusSchema,
    expectedLatestVersionId: z.string().guid(),
    status: automationArtifactStatusSchema,
  })
  .strict();

export const archiveAutomationArtifactSchema = z
  .object({
    expectedLatestVersionId: z.string().guid(),
  })
  .strict();

export type CreateAutomationArtifact = z.infer<
  typeof createAutomationArtifactSchema
>;
export type AppendAutomationArtifactVersion = z.infer<
  typeof appendAutomationArtifactVersionSchema
>;
export type TransitionAutomationArtifactStatus = z.infer<
  typeof transitionAutomationArtifactStatusSchema
>;
export type ArchiveAutomationArtifact = z.infer<
  typeof archiveAutomationArtifactSchema
>;
