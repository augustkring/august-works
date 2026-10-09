import { z } from "zod";

const stepSchema = z.strictObject({
  number: z.number().int().min(1).max(100),
  name: z.string().max(160),
  operation: z.string().max(160),
  effect: z.enum([
    "pure",
    "read",
    "write",
    "destructive",
    "external_communication",
    "financial",
    "privileged",
    "unknown",
  ]),
  testMode: z.enum(["safe", "dry_run", "sandbox", "live_only", "unavailable"]),
  approval: z.enum(["checkpoint", "not_verified"]),
  retry: z.enum(["none", "declared", "unknown"]),
  next: z
    .array(
      z.strictObject({
        number: z.number().int().min(1).max(100),
        label: z.string().max(160).nullable(),
        output: z.string().max(160).nullable(),
      }),
    )
    .max(200),
});
export const workflowExperienceRevisionSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  state: z.enum(["draft", "published"]),
  coverage: z.enum(["complete", "flow_unavailable"]),
  steps: z.array(stepSchema).max(100),
});
export const workflowExperienceSchema = z.strictObject({
  companyId: z.uuid(),
  id: z.uuid(),
  name: z.string().max(160),
  description: z.string().max(600).nullable(),
  status: z.enum(["draft", "active", "paused", "archived"]),
  canEdit: z.boolean(),
  draft: workflowExperienceRevisionSchema.nullable(),
  active: workflowExperienceRevisionSchema.nullable(),
});
export type WorkflowExperience = z.infer<typeof workflowExperienceSchema>;
export type WorkflowExperienceRevision = z.infer<
  typeof workflowExperienceRevisionSchema
>;
