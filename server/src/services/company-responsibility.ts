import { and, eq, sql } from "drizzle-orm";
import { companyMemberships, companies, type Db } from "@paperclipai/db";

/** Resolve only the company's explicitly configured default Human while that
 * principal remains a current active member. A stale/missing default is an
 * owner recovery condition; it never silently selects a successor. */
export async function resolveCurrentDefaultResponsibleHuman(db: Db, companyId: string): Promise<string | null> {
  const [membership] = await db.select({ userId: companyMemberships.principalId })
    .from(companies)
    .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, companies.id),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"),
      eq(companyMemberships.principalId, companies.defaultResponsibleUserId)))
    .where(and(eq(companies.id, companyId), sql`nullif(trim(${companies.defaultResponsibleUserId}), '') is not null`,
      sql`not exists(select 1 from account_deletion_operations d where d.user_id=${companyMemberships.principalId})`))
    .limit(1);
  return membership?.userId ?? null;
}
