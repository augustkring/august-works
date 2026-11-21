import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authorizationDeniedDetails,
  authorizationService,
  pinCurrentBoardActor,
  type AuthorizationActor,
} from "./authorization.js";
import { logPostgresLockUnavailable } from "./postgres-lock-diagnostics.js";
import { forbidden } from "../errors.js";

/** Run a route's Task/Project SQL reads inside the original native read scope.
 * Typed run IDs are candidate hints only: the original Routine/Workflow owners
 * pin and recheck current source policy before and after the caller's SQL. */
export async function withCurrentTaskSourceRead<T>(
  db: Db,
  companyId: string,
  actor: AuthorizationActor,
  read: (queryDb: Db, hasTaskSourceReferences: boolean) => Promise<T>,
  includeTaskSources = true,
  requireCompanyScope = true,
): Promise<T> {
  if (typeof (db as { transaction?: unknown }).transaction !== "function") {
    return read(db, false);
  }

  try {
    return await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    return authorizationService(tx).withReadCompany(companyId, async (owner) => {
      const decision = await owner.decide({
        actor,
        action: "company_scope:read",
        resource: { type: "company", companyId },
      });
      if (requireCompanyScope && !decision.allowed) {
        throw forbidden(
          "Company search is outside this actor's authorization boundary",
          authorizationDeniedDetails(decision),
        );
      }

      if (
        !includeTaskSources ||
        actor.type === "none" ||
        actor.source === "local_implicit"
      ) {
        return read(tx, false);
      }

      await tx.execute(sql`set local statement_timeout='8s'`);

      // This is the existing complete-candidate enumeration used by Find.
      // The cap is deliberately fail-closed: a truncated set cannot become an
      // incomplete authorization scope for SQL-before-limit Task reads.
      const sourceRows = await tx.execute<{
        routineIds: string[];
        workflowIds: string[];
        overflow: boolean;
        hasTaskSourceReferences: boolean;
      }>(sql`
        with typed_references as materialized (
          select 'routine_run'::text as kind, case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then i.origin_run_id::uuid end as id
          from issues i where i.company_id=${companyId} and i.origin_kind='routine_execution'
          union all
          select 'workflow_run', case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then i.origin_run_id::uuid end
          from issues i where i.company_id=${companyId} and i.origin_kind='workflow_task'
          union all
          select s.source_kind, s.source_id from issue_privacy_sources s
            join issues i on i.company_id=s.company_id and i.id=s.issue_id
            where s.company_id=${companyId} and s.source_kind in ('routine_run','workflow_run')
        ), referenced as materialized (
          select distinct kind,id from typed_references where id is not null
        ), native_routine_runs as materialized (
          select distinct r.id from referenced ref
            join routine_runs r on r.id=ref.id and r.company_id=${companyId}
            join routines p on p.id=r.routine_id and p.company_id=r.company_id
            where ref.kind='routine_run' and p.origin_kind in ('conversation_draft','pipeline_automation')
        ), bounded_routines as materialized (
          select id from native_routine_runs order by id limit 257
        ), workflow_runs as materialized (
          select distinct id from referenced where kind='workflow_run'
        ), bounded_workflows as materialized (
          select id from workflow_runs order by id limit 257
        )
        select coalesce((select array_agg(id::text order by id) from bounded_routines),array[]::text[]) as "routineIds",
          coalesce((select array_agg(id::text order by id) from bounded_workflows),array[]::text[]) as "workflowIds",
          (select count(*)>256 from bounded_routines) or (select count(*)>256 from bounded_workflows) as overflow,
          exists(select 1 from typed_references) as "hasTaskSourceReferences"
      `);
      const routineRunIds = sourceRows[0]?.routineIds ?? [];
      const workflowRunIds = sourceRows[0]?.workflowIds ?? [];
      const hasTaskSourceReferences = sourceRows[0]?.hasTaskSourceReferences === true;
      if (sourceRows[0]?.overflow) {
        throw forbidden(
          "Task sources are unavailable for a complete current access review.",
        );
      }

      // Narrow agent routes retain their original task-specific admission.
      // When a Routine source candidate is present, a board actor without
      // company scope still needs the original native identity/deadline
      // fence before it can read any Task rows. This pin grants no permission.
      const boardPin = (routineRunIds.length || workflowRunIds.length) && !decision.allowed && actor.type === "board"
        ? await pinCurrentBoardActor(tx, actor)
        : null;
      if ((routineRunIds.length || workflowRunIds.length) && !decision.allowed && actor.type === "board" && !boardPin) {
        throw forbidden("Current organization access is required");
      }
      const preserveBoardDeadline = async <R>(operation: Promise<R>) => {
        const value = await operation;
        if (boardPin?.credentialExpiresAt !== null && boardPin?.credentialExpiresAt !== undefined) {
          const deadline = await tx.execute<{ current: boolean }>(sql`
            select clock_timestamp() < to_timestamp(${boardPin.credentialExpiresAt} / 1000.0) as current
          `);
          if (deadline[0]?.current !== true) throw forbidden("Current organization access is required");
        }
        return value;
      };

      const sourceReviewDeadline = performance.now() + 8_000;
      const finalReview = { deadline: null as number | null };
      const readInsideCurrentSources = async () => {
        if (performance.now() > sourceReviewDeadline) throw forbidden("Current Task source review exceeded its budget.");
        const result = await read(tx, hasTaskSourceReferences);
        finalReview.deadline = performance.now() + 8_000;
        return result;
      };
      const readWithRoutineSources = () => routineRunIds.length && decision.allowed
        ? authorizationService(tx).withReadRoutineSources(companyId, actor, routineRunIds, readInsideCurrentSources)
        : readInsideCurrentSources();
      const result = await (workflowRunIds.length
        ? authorizationService(tx).withReadWorkflowTaskCandidates(
            companyId,
            actor,
            workflowRunIds,
            readWithRoutineSources,
          )
        : readWithRoutineSources());
      if (finalReview.deadline === null || performance.now() > finalReview.deadline)
        throw forbidden("Current Task source recheck exceeded its budget.");
      return preserveBoardDeadline(Promise.resolve(result));
    });
    });
  } catch (error) {
    await logPostgresLockUnavailable(db, error, "current_task_source_read");
    throw error;
  }
}
