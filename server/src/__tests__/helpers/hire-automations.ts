import { sql, type Db } from "@paperclipai/db";
import { createRoutineSchema } from "@paperclipai/shared";
import { workflowService } from "../../services/workflows/workflow-service.js";
import { routineService } from "../../services/routines.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import type { seedV5Presences } from "./v5-fixtures.js";

/** Actual company automation owners, with no schedule or execution request. */
export async function seedHireAutomationComponents(db: Db, f: Awaited<ReturnType<typeof seedV5Presences>>) {
  await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true });
  const service = workflowService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
  const created = await service.create(f.home, { name: "Existing manual welcome workflow" }, actor);
  const draft = await service.updateDraft(f.home, created.id, { expectedRevisionId: created.draftRevisionId!,
    graph: { version: 1, nodes: [{ id: "start", type: "core.manual_trigger", name: "Manual start",
      position: { x: 0, y: 0 }, config: {} }], edges: [], variables: [], settings: {} } }, actor);
  const workflow = await service.publish(f.home, created.id, { expectedDraftRevisionId: draft.draftRevisionId!,
    expectedPublishedRevisionId: null, approvalId: null }, actor);
  const routine = await routineService(db).create(f.home, createRoutineSchema.parse({ title: "Existing manual welcome routine",
    executionTarget: { kind: "workflow", workflowId: workflow.id }, status: "active" }), { userId: f.userId });
  const [workflowHash] = await db.execute<{ hash: string }>(sql`select aw_v7_package_component_hash(${f.home}::uuid,
    'workflow_template',${workflow.id}::uuid,${workflow.publishedRevisionId}::uuid) as hash`);
  const [routineHash] = await db.execute<{ hash: string }>(sql`select aw_v7_package_component_hash(${f.home}::uuid,
    'routine_template',${routine.id}::uuid,${routine.latestRevisionId}::uuid) as hash`);
  return { workflow, routine, workflowHash: workflowHash!.hash, routineHash: routineHash!.hash };
}
