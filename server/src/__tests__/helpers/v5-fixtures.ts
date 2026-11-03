import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { instanceSettings, principalPermissionGrants, type Db } from "@paperclipai/db";
import { V5_FEATURE_KEYS } from "@paperclipai/shared";
import { grantsForHumanRole } from "../../services/company-member-roles.js";
import type { AuthorizationActor } from "../../services/authorization.js";
import { agentIdentityService } from "../../services/agent-identities.js";

export async function enableV5ForTest(db: Db) {
  await db.update(instanceSettings).set({ experimental: {
    ...Object.fromEntries(V5_FEATURE_KEYS.map((key) => [key, true])),
    enableFoundationV1: true, enableContextEngineV1: true,
  } }).where(eq(instanceSettings.singletonKey, "default"));
}

export async function seedV5Companies(db: Db) {
  const userId = `user-${randomUUID()}`, home = randomUUID(), guest = randomUUID();
  const now = new Date().toISOString();
  // This fixture is also used at historical migration boundaries. Keep the
  // inserts on columns that existed there; Drizzle's current schema includes
  // later user.locale and companies.locale/timezone columns.
  await db.execute(sql`insert into "user" (id,name,email,email_verified,created_at,updated_at)
    values (${userId},'Operator',${`${userId}@test.invalid`},true,${now},${now})`);
  await db.execute(sql`insert into companies (id,name,issue_prefix,created_at,updated_at) values
    (${home},'Home',${`H${home.slice(0, 7)}`},${now},${now}),
    (${guest},'Guest',${`G${guest.slice(0, 7)}`},${now},${now})`);
  await db.execute(sql`insert into company_memberships(company_id,principal_type,principal_id,status,membership_role)
    values (${home}::uuid,'user',${userId},'active','owner'),(${guest}::uuid,'user',${userId},'active','owner')`);
  await db.insert(principalPermissionGrants).values([home, guest].flatMap((companyId) => grantsForHumanRole("owner").map((grant) => ({ companyId, principalType: "user", principalId: userId, ...grant }))));
  const actor: AuthorizationActor = { type: "board", source: "session", userId, companyIds: [home, guest] };
  return { userId, home, guest, actor };
}

export async function seedV5Presences(db: Db) {
  const fixture = await seedV5Companies(db);
  const service = agentIdentityService(db);
  const { identity, presence } = await service.create(fixture.actor, { name: "Fox", homeCompanyId: fixture.home });
  const guestPresence = await service.addPresence(fixture.actor, fixture.home, identity.id, { companyId: fixture.guest, role: "general" });
  return { ...fixture, identity, presence, guestPresence };
}
