import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
export async function reconcileAgentPackages(db: Db, limit = 20) {
  return withV7ActivityTransaction(db, async (tx, p) => {
    const rows = await tx.execute(
      sql`with stale as(select id from company_agent_package_installations i where status='active' and not aw_v7_package_installation_current(i) order by updated_at,id for update skip locked limit ${Math.max(1, Math.min(100, limit))}) update company_agent_package_installations i set status='degraded',version=version+1,updated_at=now() from stale where i.id=stale.id returning i.id,i.company_id`,
    );
    for (const row of rows)
      await logActivity(
        tx,
        {
          companyId: String(row.company_id),
          actorType: "system",
          actorId: "package-reconciliation",
          action: "agent_package.revalidation_required",
          entityType: "agent_package_installation",
          entityId: String(row.id),
        },
        p,
      );
    return { invalidated: rows.length };
  });
}
/** An acknowledgement is cancellation delivery, never physical Stop proof. */
export async function deliverAgentPackageStops(
  db: Db,
  cancelRun: (runId: string, reason: string) => Promise<unknown>,
  limit = 20,
) {
  const seen: string[] = [];
  for (let n = 0; n < Math.max(1, Math.min(100, limit)); n++) {
    const [claim] = await db.execute(
      sql`with next as(select id from agent_package_stop_actions where status<>'delivered' and attempts<5 and (lease_until is null or lease_until<=now()) and id::text<>all(select jsonb_array_elements_text(${JSON.stringify(seen)}::jsonb)) order by created_at,id for update skip locked limit 1) update agent_package_stop_actions a set status='delivering',attempts=attempts+1,lease_until=now()+interval '90 seconds',updated_at=now() from next where a.id=next.id returning a.id,a.run_id,a.attempts`,
    );
    if (!claim) break;
    seen.push(String(claim.id));
    let status = "delivered";
    try {
      await cancelRun(
        String(claim.run_id),
        "Agent package activation or authority changed",
      );
    } catch {
      status = "queued";
    }
    await db.execute(
      sql`update agent_package_stop_actions set status=${status},lease_until=null,updated_at=now() where id=${String(claim.id)}::uuid and attempts=${Number(claim.attempts)} and status='delivering'`,
    );
  }
  return { attempted: seen.length };
}
