import { z } from "zod";

/** A saved description of intent, without a runnable target or schedule.
 * The Original editor owns those choices and the explicit enable action. */
export const routineAuthoringCreateInputSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(120).regex(/^[^\u0000\uD800-\uDFFF]*$/u),
  title: z.string().trim().min(1).max(200).regex(/^[^\u0000\uD800-\uDFFF]*$/u),
  description: z.string().max(8000).regex(/^[^\u0000\uD800-\uDFFF]*$/u).default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});
export const routineAuthoringCreateInputJsonSchema = z.toJSONSchema(routineAuthoringCreateInputSchema);
export type RoutineAuthoringCreateInput = z.infer<typeof routineAuthoringCreateInputSchema>;
