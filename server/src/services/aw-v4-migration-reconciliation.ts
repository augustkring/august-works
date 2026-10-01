import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "@paperclipai/db";
import {
  agents,
  pipelineAutomationExecutions,
  routines,
  workflows,
} from "@paperclipai/db";

export interface AwV4MigrationReconciliationSnapshot {
  routines: {
    legacyTargets: number;
    repairableLegacyTargets: number;
    unsafeLegacyTargets: number;
    activeWithoutTarget: number;
    agentTargetLegacyMismatch: number;
    workflowTargetCarriesLegacyAssignee: number;
    invalidAgentTargetReference: number;
    invalidWorkflowTargetReference: number;
  };
  pipelines: {
    legacyRoutineTargets: number;
    repairableLegacyRoutineTargets: number;
    unsafeLegacyRoutineTargets: number;
    invalidRoutineTargetReference: number;
    invalidWorkflowTargetReference: number;
  };
  repairableCount: number;
  blockerCount: number;
  cutoverReady: boolean;
}

export interface AwV4MigrationRepairBatchResult {
  routinesRepaired: number;
  pipelineExecutionsRepaired: number;
  repaired: number;
}

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 2_000;

function boundedBatchSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw new Error(
      `AW V4 migration reconciliation batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`,
    );
  }
  return value;
}

async function scalarCount(
  query: PromiseLike<Array<{ count: number }>>,
): Promise<number> {
  const rows = await query;
  const value = rows[0]?.count;
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function awV4MigrationReconciliationService(db: Db) {
  async function inspect(): Promise<AwV4MigrationReconciliationSnapshot> {
    const legacyRoutinePredicate = and(
      isNotNull(routines.assigneeAgentId),
      isNull(routines.executionTargetKind),
      isNull(routines.executionTargetRef),
    );

    const [
      legacyTargets,
      repairableLegacyTargets,
      activeWithoutTarget,
      agentTargetLegacyMismatch,
      workflowTargetCarriesLegacyAssignee,
      invalidAgentTargetReference,
      invalidWorkflowTargetReference,
      legacyRoutineTargets,
      repairableLegacyRoutineTargets,
      invalidRoutineTargetReference,
      invalidWorkflowTargetReference,
    ] = await Promise.all([
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(routines)
          .where(legacyRoutinePredicate),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(routines)
          .innerJoin(
            agents,
            and(
              eq(agents.id, routines.assigneeAgentId),
              eq(agents.companyId, routines.companyId),
            ),
          )
          .where(legacyRoutinePredicate),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(routines)
          .where(
            and(
              eq(routines.status, "active"),
              isNull(routines.assigneeAgentId),
              isNull(routines.executionTargetKind),
              isNull(routines.executionTargetRef),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(routines)
          .where(
            and(
              eq(routines.executionTargetKind, "agent_task"),
              isNotNull(routines.executionTargetRef),
              or(
                isNull(routines.assigneeAgentId),
                ne(routines.assigneeAgentId, routines.executionTargetRef),
              ),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(routines)
          .where(
            and(
              eq(routines.executionTargetKind, "workflow"),
              isNotNull(routines.executionTargetRef),
              isNotNull(routines.assigneeAgentId),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count(routines.id) })
          .from(routines)
          .leftJoin(
            agents,
            and(
              eq(agents.id, routines.executionTargetRef),
              eq(agents.companyId, routines.companyId),
            ),
          )
          .where(
            and(
              eq(routines.executionTargetKind, "agent_task"),
              isNotNull(routines.executionTargetRef),
              isNull(agents.id),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count(routines.id) })
          .from(routines)
          .leftJoin(
            workflows,
            and(
              eq(workflows.id, routines.executionTargetRef),
              eq(workflows.companyId, routines.companyId),
            ),
          )
          .where(
            and(
              eq(routines.executionTargetKind, "workflow"),
              isNotNull(routines.executionTargetRef),
              isNull(workflows.id),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(pipelineAutomationExecutions)
          .where(
            and(
              isNull(pipelineAutomationExecutions.targetKind),
              isNull(pipelineAutomationExecutions.targetRef),
              isNotNull(pipelineAutomationExecutions.routineId),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count() })
          .from(pipelineAutomationExecutions)
          .innerJoin(
            routines,
            and(
              eq(routines.id, pipelineAutomationExecutions.routineId),
              eq(routines.companyId, pipelineAutomationExecutions.companyId),
            ),
          )
          .where(
            and(
              isNull(pipelineAutomationExecutions.targetKind),
              isNull(pipelineAutomationExecutions.targetRef),
              isNotNull(pipelineAutomationExecutions.routineId),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count(pipelineAutomationExecutions.id) })
          .from(pipelineAutomationExecutions)
          .leftJoin(
            routines,
            and(
              eq(routines.id, pipelineAutomationExecutions.targetRef),
              eq(routines.companyId, pipelineAutomationExecutions.companyId),
            ),
          )
          .where(
            and(
              eq(pipelineAutomationExecutions.targetKind, "routine"),
              isNotNull(pipelineAutomationExecutions.targetRef),
              isNull(routines.id),
            ),
          ),
      ),
      scalarCount(
        db,
        db
          .select({ count: count(pipelineAutomationExecutions.id) })
          .from(pipelineAutomationExecutions)
          .leftJoin(
            workflows,
            and(
              eq(workflows.id, pipelineAutomationExecutions.targetRef),
              eq(workflows.companyId, pipelineAutomationExecutions.companyId),
            ),
          )
          .where(
            and(
              eq(pipelineAutomationExecutions.targetKind, "workflow"),
              isNotNull(pipelineAutomationExecutions.targetRef),
              isNull(workflows.id),
            ),
          ),
      ),
    ]);

    const unsafeLegacyTargets = Math.max(
      0,
      legacyTargets - repairableLegacyTargets,
    );
    const unsafeLegacyRoutineTargets = Math.max(
      0,
      legacyRoutineTargets - repairableLegacyRoutineTargets,
    );
    const repairableCount =
      repairableLegacyTargets + repairableLegacyRoutineTargets;
    const blockerCount =
      unsafeLegacyTargets +
      activeWithoutTarget +
      agentTargetLegacyMismatch +
      workflowTargetCarriesLegacyAssignee +
      invalidAgentTargetReference +
      invalidWorkflowTargetReference +
      unsafeLegacyRoutineTargets +
      invalidRoutineTargetReference +
      invalidWorkflowTargetReference;

    return {
      routines: {
        legacyTargets,
        repairableLegacyTargets,
        unsafeLegacyTargets,
        activeWithoutTarget,
        agentTargetLegacyMismatch,
        workflowTargetCarriesLegacyAssignee,
        invalidAgentTargetReference,
        invalidWorkflowTargetReference,
      },
      pipelines: {
        legacyRoutineTargets,
        repairableLegacyRoutineTargets,
        unsafeLegacyRoutineTargets,
        invalidRoutineTargetReference,
        invalidWorkflowTargetReference,
      },
      repairableCount,
      blockerCount,
      cutoverReady: repairableCount === 0 && blockerCount === 0,
    };
  }

  async function repairBatch(
    options: { batchSize?: number } = {},
  ): Promise<AwV4MigrationRepairBatchResult> {
    const batchSize = boundedBatchSize(options.batchSize);

    const safeLegacyRoutineRows = await db
      .select({
        id: routines.id,
      })
      .from(routines)
      .innerJoin(
        agents,
        and(
          eq(agents.id, routines.assigneeAgentId),
          eq(agents.companyId, routines.companyId),
        ),
      )
      .where(
        and(
          isNotNull(routines.assigneeAgentId),
          isNull(routines.executionTargetKind),
          isNull(routines.executionTargetRef),
        ),
      )
      .limit(batchSize);

    const routineIds = safeLegacyRoutineRows.map((row) => row.id);
    const repairedRoutineRows =
      routineIds.length === 0
        ? []
        : await db
            .update(routines)
            .set({
              executionTargetKind: "agent_task",
              executionTargetRef: sql`${routines.assigneeAgentId}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(routines.id, routineIds),
                isNotNull(routines.assigneeAgentId),
                isNull(routines.executionTargetKind),
                isNull(routines.executionTargetRef),
              ),
            )
            .returning({ id: routines.id });

    const safeLegacyPipelineRows = await db
      .select({
        id: pipelineAutomationExecutions.id,
      })
      .from(pipelineAutomationExecutions)
      .innerJoin(
        routines,
        and(
          eq(routines.id, pipelineAutomationExecutions.routineId),
          eq(routines.companyId, pipelineAutomationExecutions.companyId),
        ),
      )
      .where(
        and(
          isNull(pipelineAutomationExecutions.targetKind),
          isNull(pipelineAutomationExecutions.targetRef),
          isNotNull(pipelineAutomationExecutions.routineId),
        ),
      )
      .limit(batchSize);

    const pipelineExecutionIds = safeLegacyPipelineRows.map((row) => row.id);
    const repairedPipelineRows =
      pipelineExecutionIds.length === 0
        ? []
        : await db
            .update(pipelineAutomationExecutions)
            .set({
              targetKind: "routine",
              targetRef: sql`${pipelineAutomationExecutions.routineId}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(
                  pipelineAutomationExecutions.id,
                  pipelineExecutionIds,
                ),
                isNull(pipelineAutomationExecutions.targetKind),
                isNull(pipelineAutomationExecutions.targetRef),
                isNotNull(pipelineAutomationExecutions.routineId),
              ),
            )
            .returning({ id: pipelineAutomationExecutions.id });

    return {
      routinesRepaired: repairedRoutineRows.length,
      pipelineExecutionsRepaired: repairedPipelineRows.length,
      repaired: repairedRoutineRows.length + repairedPipelineRows.length,
    };
  }

  return {
    inspect,
    repairBatch,
  };
}
