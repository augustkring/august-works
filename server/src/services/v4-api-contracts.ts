import { z } from "zod";
import { assertWorkflowOutputSchema } from "./workflows/workflow-output-schema.js";
import { parseWorkflowConditionExpression } from "./workflows/workflow-condition-expression.js";

/** Wire contracts shared by route validation, services and OpenAPI. */
export const optimizerCandidateRequestSchema = z.object({
  kind: z.enum(["expression", "transform", "typescript"]), sourceCode: z.string().min(1).max(64_000),
  inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()),
  invariants: z.array(z.object({ id: z.string().min(1).max(80), description: z.string().min(1).max(500),
    critical: z.boolean().default(true), expression: z.string().min(1).max(2_000) }).strict()).min(1).max(16),
  cases: z.array(z.object({ id: z.string().min(1).max(80), category: z.enum(["boundary", "shape_variant"]), input: z.unknown() }).strict()).min(2).max(16),
}).strict().superRefine((value, ctx) => {
  try {
    assertWorkflowOutputSchema(value.inputSchema); assertWorkflowOutputSchema(value.outputSchema);
    for (const invariant of value.invariants) parseWorkflowConditionExpression(invariant.expression);
    if (!value.invariants.some((item) => item.critical)) throw new Error("At least one critical business invariant is required");
    if (!value.cases.some((item) => item.category === "boundary") || !value.cases.some((item) => item.category === "shape_variant")) throw new Error("Boundary and shape-variant cases are required");
    if (new Set(value.invariants.map((item) => item.id)).size !== value.invariants.length || new Set(value.cases.map((item) => item.id)).size !== value.cases.length) throw new Error("Case and invariant IDs must be unique");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256_000) throw new Error("Candidate request exceeds the size limit");
  } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : "Invalid candidate contract" }); }
});

export const workflowRunReviewSchema = z.object({
  humanCorrection: z.boolean(), correctedOutputs: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().min(1).max(2_000),
}).strict().superRefine((value, ctx) => {
  if (value.humanCorrection !== (Object.keys(value.correctedOutputs).length > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Corrected reviews require explicit corrected node outputs; uncorrected reviews cannot contain corrections" });
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256_000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Review payload exceeds the size limit" });
});

export const memoryMaintenanceInputSchema = z.object({
  operationType: z.enum(["dedupe", "compaction", "reflection", "index_refresh"]),
  proposedLesson: z.object({ title: z.string().trim().min(1).max(180), content: z.string().trim().min(1).max(16_000) }).strict().optional(),
  recordIds: z.array(z.string().guid()).min(1).max(64).refine((ids) => new Set(ids).size === ids.length, "Record IDs must be unique"),
}).strict().superRefine((input, ctx) => {
  if ((input.operationType === "reflection") !== Boolean(input.proposedLesson)) ctx.addIssue({ code: "custom", message: "A reflection requires an explicit proposed lesson; other operations do not accept one" });
});
