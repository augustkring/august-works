import { and, asc, eq, inArray } from "drizzle-orm";
import { authUsers, companyMemberships, type Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";

/** Native source validation only. The route separately enforces current owner
 * settings permission; a contact label never grants the contact permissions. */
export function companyResponsibilityContactsService(db: Db) {
  return {
    async listEligibleUsers(companyId: string) {
      return db.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
        .from(companyMemberships).innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"), eq(authUsers.emailVerified, true)))
        .orderBy(asc(authUsers.name), asc(authUsers.id));
    },
    async assertEligible(companyId: string, contactUserIds: readonly string[]) {
      const unique = [...new Set(contactUserIds.filter(Boolean))];
      if (!unique.length) return;
      const eligible = await db.select({ userId: companyMemberships.principalId }).from(companyMemberships)
        .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"), eq(authUsers.emailVerified, true), inArray(companyMemberships.principalId, unique)));
      if (new Set(eligible.map(row => row.userId)).size !== unique.length)
        throw badRequest("Company responsibility contacts must be active verified Human members");
    },
  };
}
