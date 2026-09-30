import { z } from "zod";
import {
  AUTOMATION_ARTIFACT_GATE_KINDS,
  AUTOMATION_ARTIFACT_GATE_REPORT_SCHEMA,
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
      bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
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

export const automationArtifactGateReportSchema = z
  .object({
    schema: z.literal(AUTOMATION_ARTIFACT_GATE_REPORT_SCHEMA),
    kind: z.enum(AUTOMATION_ARTIFACT_GATE_KINDS),
    status: z.enum(["passed", "failed"]),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    checkedAt: z.string().datetime(),
    checks: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(160),
            status: z.enum(["passed", "failed"]),
            detail: z.string().trim().max(2_000).nullable().default(null),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const automationArtifactJsonSchema = boundedJsonObject(
  "Automation Artifact schema",
);

const artifactDefinitionFields = {
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
} as const;

function refineArtifactDefinition(
  value: {
    kind: (typeof AUTOMATION_ARTIFACT_KINDS)[number];
    language: (typeof AUTOMATION_ARTIFACT_LANGUAGES)[number] | null;
    originWorkflowId: string | null;
    originNodeId: string | null;
  },
  ctx: z.RefinementCtx,
) {
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
}

export const automationArtifactDefinitionSchema = z
  .object(artifactDefinitionFields)
  .strict()
  .superRefine(refineArtifactDefinition);

const artifactVersionFields = {
  sourceCode: z.string().min(1).max(MAX_SOURCE_CODE_CHARS),
  inputSchema: automationArtifactJsonSchema,
  outputSchema: automationArtifactJsonSchema,
  dependencyManifest: boundedJsonObject(
    "Automation Artifact dependency manifest",
  ).default({}),
  testSpec: boundedJsonObject("Automation Artifact test spec").default({}),
} as const;

export const automationArtifactVersionPayloadSchema = z
  .object(artifactVersionFields)
  .strict();

export const createAutomationArtifactSchema = z
  .object({
    ...artifactDefinitionFields,
    ...artifactVersionFields,
  })
  .strict()
  .superRefine(refineArtifactDefinition);

export const appendAutomationArtifactVersionSchema = z
  .object({
    expectedLatestVersionId: z.string().guid(),
    ...artifactVersionFields,
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
