import { and, eq, sql } from "drizzle-orm";
import { companyMemberships, companies, type Db } from "@paperclipai/db";

/** Resolve only the company's explicitly configured default Human while that
 * principal remains a current active member. A stale/missing default is an
 * owner recovery condition; it never silently selects a successor. */
export async function resolveCurrentDefaultResponsibleHuman(db: Db, companyId: string): Promise<string | null> {
  const [company] = await db.select({ userId: companies.defaultResponsibleUserId })
    .from(companies).where(eq(companies.id, companyId));
  const userId = company?.userId?.trim();
  if (!userId) return null;
  const [membership] = await db.select({ userId: companyMemberships.principalId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
      sql`not exists(select 1 from account_deletion_operations d where d.user_id=${companyMemberships.principalId})`))
    .limit(1);
  return membership?.userId ?? null;
}
