import {lockAnalyticalCompany} from "../analytical-privacy.js";
import {assertAnalyticalContextPayloadAccess} from "../analytical-context-authority.js";
import {assertLearningAssetCurrent} from "../learning/learning-assets.js";
import type {AuthorizationActor} from "../authorization.js";
import { and, desc, eq } from "drizzle-orm";
import { workflowOptimizerSuggestions, workflows, workflowRevisions, workflowRuns, workflowStepRuns, workflowRunReviews, type Db } from "@paperclipai/db";
import type { WorkflowOptimizerCandidateRequest } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { instanceSettingsService } from "../instance-settings.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { evaluateWorkflowTransformMapping } from "../workflows/workflow-transform-expression.js";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const primitive = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value);
function schemaFor(samples: Record<string, unknown>[], open: boolean) {
  const keys = Object.keys(samples[0]!).filter((key) => samples.every((sample) => Object.hasOwn(sample, key)));
  return { type: "object", required: keys, properties: Object.fromEntries(keys.map((key) => {
    const types = [...new Set(samples.map((sample) => sample[key] === null ? "null" : typeof sample[key]))];
    if (!types.every((type) => ["string", "number", "boolean", "null"].includes(type))) throw unprocessable("This contract requires an explicit reviewed schema");
    return [key, { type: types.length === 1 ? types[0] : types }];
  })), additionalProperties: open };
}

/** Deterministic V1 generator: exact published scalar mappings, never invented semantics. */
export async function proposeOptimizerCandidate(db: Db, companyId: string, workflowId: string, suggestionId: string,sourceActor?:AuthorizationActor): Promise<WorkflowOptimizerCandidateRequest> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await lockAnalyticalCompany(scoped,companyId);
    await lockMemoryPrivacy(scoped, companyId);
    return proposeRetainedCandidate(scoped, companyId, workflowId, suggestionId,sourceActor);
  });
}
async function proposeRetainedCandidate(db: Db, companyId: string, workflowId: string, suggestionId: string,sourceActor?:AuthorizationActor): Promise<WorkflowOptimizerCandidateRequest> {
  const flags = await instanceSettingsService(db).getExperimental();
  if (!flags.enableWorkflowOptimizerSuggestions) throw conflict("Optimizer suggestions are disabled");
  const [suggestion] = await db.select().from(workflowOptimizerSuggestions).where(and(eq(workflowOptimizerSuggestions.companyId, companyId), eq(workflowOptimizerSuggestions.workflowId, workflowId), eq(workflowOptimizerSuggestions.id, suggestionId)));
  const [workflow] = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)));
  if (!suggestion || !workflow) throw notFound("Optimizer suggestion not found");
  if (suggestion.stepOrdinals.length !== 1 || suggestion.operationTypes[0] !== "core.transform" || suggestion.sideEffectRisk !== "low") throw unprocessable("This span requires an explicit replacement plan");
  if (workflow.publishedRevisionId !== suggestion.workflowRevisionId) throw conflict("Suggestion targets a stale published revision");
  const [revision] = await db.select().from(workflowRevisions).where(and(eq(workflowRevisions.companyId, companyId), eq(workflowRevisions.id, suggestion.workflowRevisionId)));
  if (!revision) throw notFound("Published revision not found");
  await assertLearningAssetCurrent(db,companyId,"workflow_revision",revision.id,sourceActor);
  const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.companyId, companyId), eq(workflowRuns.workflowRevisionId, revision.id), eq(workflowRuns.status, "succeeded"))).orderBy(desc(workflowRuns.finishedAt)).limit(50);
  const samples: { input: Record<string, unknown>; output: Record<string, unknown> }[] = [];
  let nodeId: string | null = null;
  for (const run of runs) {
    await assertAnalyticalContextPayloadAccess(db,companyId,sourceActor,{runId:run.id});
    const [review] = await db.select().from(workflowRunReviews).where(and(eq(workflowRunReviews.companyId, companyId), eq(workflowRunReviews.workflowRunId, run.id)));
    if (!review) continue;
    const steps = await db.select().from(workflowStepRuns).where(and(eq(workflowStepRuns.companyId, companyId), eq(workflowStepRuns.workflowRunId, run.id)));
    const ordered = steps.sort((left, right) => (left.startedAt?.getTime() ?? left.createdAt.getTime()) - (right.startedAt?.getTime() ?? right.createdAt.getTime()) || left.nodeId.localeCompare(right.nodeId) || left.attempt - right.attempt);
    const step = ordered[suggestion.stepOrdinals[0]! - 1];
    if (!step || step.status !== "succeeded" || nodeId && step.nodeId !== nodeId) continue;
    const input = (step.inputJson as { input?: unknown } | null)?.input;
    const output = Object.hasOwn(review.correctedOutputs, step.nodeId) ? review.correctedOutputs[step.nodeId] : step.outputJson;
    if (!object(input) || !object(output) || !Object.values(input).every(primitive) || !Object.values(output).every(primitive)) throw unprocessable("Automatic generation requires a reviewed scalar contract");
    await assertMemoryRecordsRetained(db, companyId, [...run.memoryRecordIds, ...step.memoryRecordIds, ...review.memoryRecordIds]);
    nodeId = step.nodeId;
    samples.push({ input, output });
    if (samples.length === 10) break;
  }
  if (samples.length < 3 || !nodeId) throw conflict("Three reviewed source runs are required");
  const node = revision.graph.nodes.find((item) => item.id === nodeId);
  if (node?.type !== "core.transform") throw conflict("Published target is not a transform");
  const mapping = (node.config as { mapping: Record<string, string> }).mapping;
  if (Object.keys(mapping).length > 16) throw unprocessable("This mapping requires an explicit reviewed invariant set");
  const invariants = Object.entries(mapping).map(([key, expression], index) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) throw unprocessable("This output key requires an explicit invariant");
    const reference = /^\{\{\s*input\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}$/.exec(expression);
    if (!reference && expression.includes("{{")) throw unprocessable("Only declared scalar copies and literals can be generated automatically");
    return { id: `preserve-${index}`, description: reference ? `Preserve the declared ${reference[1]} to ${key} mapping` : `Preserve the declared ${key} constant`, critical: true,
      expression: `{{trigger.output.${key}}} === ${reference ? `{{trigger.input.${reference[1]}}}` : JSON.stringify(expression)}` };
  });
  const boundary = Object.fromEntries(Object.entries(samples[0]!.input).map(([key, value]) => [key, typeof value === "number" ? 0 : typeof value === "string" ? "" : typeof value === "boolean" ? false : null]));
  const variant = { ...samples[0]!.input, _optimizerShapeVariant: true };
  const fixtureOutputs = [boundary, variant].map((input) => evaluateWorkflowTransformMapping(mapping, { input, trigger: {}, variables: {}, steps: {} }));
  return { kind: "transform", sourceCode: JSON.stringify(mapping), inputSchema: schemaFor(samples.map((sample) => sample.input), true),
    outputSchema: schemaFor([...samples.map((sample) => sample.output), ...fixtureOutputs as Record<string, unknown>[]], false), invariants,
    cases: [{ id: "generated-boundary", category: "boundary", input: boundary }, { id: "generated-shape-variant", category: "shape_variant", input: variant }] };
}
