import { and, eq } from "drizzle-orm";
import { companyMemberships, type Db } from "@paperclipai/db";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import type { AuthorizationActor } from "../authorization.js";
import { forbidden } from "../../errors.js";
export async function enterpriseOwner(
  db: Db,
  actor: AuthorizationActor,
  companyId: string,
) {
  const userId = v7HumanActorId(actor);
  await assertV7Authorization(db, actor, companyId, "users:manage_permissions");
  const [member] = await db
    .select()
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
        eq(companyMemberships.membershipRole, "owner"),
      ),
    )
    .for("share");
  if (!member) throw forbidden("Current company owner authority required");
  return userId;
}
