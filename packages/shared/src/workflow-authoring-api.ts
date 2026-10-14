import { z } from "zod";
import {
  workflowAuthoringCreateInputSchema,
  workflowAuthoringAddTriggerInputSchema,
  workflowAuthoringAddStepInputSchema,
  workflowAuthoringUpdateStepInputSchema,
  workflowAuthoringConnectStepsInputSchema,
  workflowAuthoringRemoveStepInputSchema,
  workflowAuthoringTestStepInputSchema,
  workflowAuthoringPublishInputSchema,
} from "./validators/workflow.js";

/** The Native API exposes the existing typed SDK operations. Neither a graph
 * replacement nor a caller-selected actor/run is accepted here. */
export const workflowAuthoringApiCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create_workflow"), input: workflowAuthoringCreateInputSchema }),
  z.strictObject({ operation: z.literal("add_trigger"), input: workflowAuthoringAddTriggerInputSchema }),
  z.strictObject({ operation: z.literal("add_step"), input: workflowAuthoringAddStepInputSchema }),
  z.strictObject({ operation: z.literal("update_step"), input: workflowAuthoringUpdateStepInputSchema }),
  z.strictObject({ operation: z.literal("connect_steps"), input: workflowAuthoringConnectStepsInputSchema }),
  z.strictObject({ operation: z.literal("remove_step"), input: workflowAuthoringRemoveStepInputSchema }),
  z.strictObject({ operation: z.literal("test_step"), input: workflowAuthoringTestStepInputSchema }),
  z.strictObject({ operation: z.literal("prepare_publish"), input: workflowAuthoringPublishInputSchema }),
]);
export type WorkflowAuthoringApiCommand = z.infer<typeof workflowAuthoringApiCommandSchema>;
