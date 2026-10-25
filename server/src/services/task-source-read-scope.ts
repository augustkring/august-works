import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authorizationDeniedDetails,
  authorizationService,
  pinCurrentBoardActor,
  type AuthorizationActor,
} from "./authorization.js";
import { forbidden } from "../errors.js";

/** Run a route's Task/Project SQL reads inside the original native read scope.
 * Private Routine IDs are only candidate hints: withReadRoutineSources pins
 * and rechecks the current Routine, revision, authoring conversation and
 * Human credential before and after the caller's SQL executes. */
export async function withCurrentTaskSourceRead<T>(
  db: Db,
  companyId: string,
  actor: AuthorizationActor,
  read: (queryDb: Db, hasRoutineCandidates: boolean) => Promise<T>,
  includeTaskSources = true,
  requireCompanyScope = true,
): Promise<T> {
  if (typeof (db as { transaction?: unknown }).transaction !== "function") {
    return read(db, false);
  }

  return db.transaction(async (rawTx) => {
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

      // This is the existing complete-candidate enumeration used by Find.
      // The cap is deliberately fail-closed: a truncated set cannot become an
      // incomplete authorization scope for SQL-before-limit Task reads.
      const sourceRows = await tx.execute<{
        ids: string[];
        overflow: boolean;
        hasRoutineReferences: boolean;
      }>(sql`
        with referenced as materialized (
          select case when i.origin_run_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
            then i.origin_run_id::uuid end as id
          from issues i where i.company_id=${companyId} and i.origin_kind='routine_execution'
          union
          select s.source_id as id from issue_privacy_sources s
            join issues i on i.company_id=s.company_id and i.id=s.issue_id
            where s.company_id=${companyId} and s.source_kind='routine_run'
        ), conversation_runs as materialized (
          select distinct r.id from referenced ref
            join routine_runs r on r.id=ref.id and r.company_id=${companyId}
            join routines p on p.id=r.routine_id and p.company_id=r.company_id
            where p.origin_kind='conversation_draft'
        ), bounded as materialized (
          select id from conversation_runs order by id limit 257
        )
        select coalesce(array_agg(id::text order by id),array[]::text[]) as ids,
          count(*)>256 as overflow,
          exists(select 1 from referenced) as "hasRoutineReferences"
        from bounded
      `);
      const routineRunIds = sourceRows[0]?.ids ?? [];
      const hasRoutineReferences = sourceRows[0]?.hasRoutineReferences === true;
      if (sourceRows[0]?.overflow) {
        throw forbidden(
          "Task sources are unavailable for a complete current access review.",
        );
      }

      // Narrow agent routes retain their original task-specific admission.
      // When a Routine source candidate is present, a board actor without
      // company scope still needs the original native identity/deadline
      // fence before it can read any Task rows. This pin grants no permission.
      const boardPin = routineRunIds.length && !decision.allowed && actor.type === "board"
        ? await pinCurrentBoardActor(tx, actor)
        : null;
      if (routineRunIds.length && !decision.allowed && actor.type === "board" && !boardPin) {
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

      const readInsideCurrentSources = () => read(tx, hasRoutineReferences);
      const result = routineRunIds.length && decision.allowed
        ? authorizationService(tx).withReadRoutineSources(
            companyId,
            actor,
            routineRunIds,
            readInsideCurrentSources,
          )
        : readInsideCurrentSources();
      return preserveBoardDeadline(result);
    });
  });
}
