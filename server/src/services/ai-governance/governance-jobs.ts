import { and, eq, sql } from "drizzle-orm";
import {
  aiUseCaseChangeEvents,
  governanceStopActions,
  type Db,
} from "@paperclipai/db";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";

export async function reconcileGovernanceDeployments(db: Db, limit = 20) {
  return withV7ActivityTransaction(db, async (tx, publications) => {
    const rows = await tx.execute(sql`with stale as (
      select d.id from ai_use_case_deployments d where d.status='active' and not aw_v7_governance_deployment_current(d)
      order by d.updated_at,d.id for update skip locked limit ${Math.max(1, Math.min(100, limit))}
    ) update ai_use_case_deployments d set status='review_required',updated_at=now() from stale where d.id=stale.id returning d.company_id,d.use_case_id,d.purpose_version,d.authority_hash`);
    for (const row of rows) {
      if (
        typeof row.company_id !== "string" ||
        typeof row.use_case_id !== "string"
      )
        continue;
      await tx.insert(aiUseCaseChangeEvents).values({
        companyId: row.company_id,
        useCaseId: row.use_case_id,
        purposeVersion: Number(row.purpose_version),
        classification: "review_required",
        reasonCode: "deployment_authority_or_review_changed",
        sourceRefHash:
          typeof row.authority_hash === "string" ? row.authority_hash : null,
      });
      await logActivity(
        tx,
        {
          companyId: row.company_id,
          actorType: "system",
          actorId: "governance-reconciliation",
          action: "governance.deployment_review_required",
          entityType: "ai_use_case",
          entityId: row.use_case_id,
          details: {
            reasonCode: "deployment_authority_or_review_changed",
            purposeVersion: row.purpose_version,
          },
        },
        publications,
      );
    }
    return { invalidated: rows.length };
  });
}

/** Delivery means the canonical cancellation controller accepted the request.
 * Only canonical runtime state can say the workload has physically stopped. */
export async function deliverGovernanceStops(
  db: Db,
  cancelRun: (runId: string, reason: string) => Promise<unknown>,
  limit = 20,
) {
  const seen: string[] = [];
  for (let index = 0; index < Math.max(1, Math.min(100, limit)); index++) {
    const [claim] = await db.execute(sql`with next as (
      select id from governance_stop_actions where status<>'delivered' and attempts<5
      and (lease_until is null or lease_until<=now()) and id::text<>all(select jsonb_array_elements_text(${JSON.stringify(seen)}::jsonb))
      order by created_at,id for update skip locked limit 1
    ) update governance_stop_actions a set status='delivering',attempts=attempts+1,lease_until=now()+interval '90 seconds',updated_at=now()
    from next where a.id=next.id returning a.id,a.run_id,a.company_id,a.attempts`);
    if (
      !claim ||
      typeof claim.id !== "string" ||
      typeof claim.run_id !== "string" ||
      typeof claim.company_id !== "string" ||
      typeof claim.attempts !== "number"
    )
      break;
    seen.push(claim.id);
    try {
      await cancelRun(
        claim.run_id,
        "Intended-purpose governance revoked execution authority",
      );
      await db
        .update(governanceStopActions)
        .set({
          status: "delivered",
          errorCode: null,
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(governanceStopActions.id, claim.id),
            eq(governanceStopActions.attempts, claim.attempts),
            eq(governanceStopActions.status, "delivering"),
          ),
        );
    } catch {
      await db
        .update(governanceStopActions)
        .set({
          status: "queued",
          errorCode: "native_stop_delivery_failed",
          leaseUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(governanceStopActions.id, claim.id),
            eq(governanceStopActions.attempts, claim.attempts),
            eq(governanceStopActions.status, "delivering"),
          ),
        );
    }
  }
  return { attempted: seen.length };
}
