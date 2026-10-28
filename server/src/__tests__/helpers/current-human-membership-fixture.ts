import { authUsers, companyMemberships, principalPermissionGrants, type Db } from "@paperclipai/db";
import { grantsForHumanRole } from "../../services/company-member-roles.js";

/** Seed the persistent Human authority used by runtime fixtures. This is
 * intentionally separate from creating a browser session: background work
 * needs a real active company member, while HTTP tests should also create and
 * carry their own authenticated session. */
export async function seedCurrentHumanMembership(
  db: Db,
  companyId: string,
  userId: string,
  role: "owner" | "admin" | "operator" | "viewer" = "owner",
) {
  const now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Current Human fixture", email: `${userId}@fixture.invalid`, emailVerified: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: role, status: "active" }).onConflictDoNothing();
  await db.insert(principalPermissionGrants).values(grantsForHumanRole(role).map(grant => ({ companyId, principalType: "user", principalId: userId, ...grant }))).onConflictDoNothing();
}
