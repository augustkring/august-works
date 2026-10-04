import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { authUsers, companies, companyMemberships, instanceSettings, principalPermissionGrants, type Db } from "@paperclipai/db";
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
  const now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Operator", email: `${userId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now });
  await db.insert(companies).values([
    { id: home, name: "Home", issuePrefix: `H${home.slice(0, 7)}` },
    { id: guest, name: "Guest", issuePrefix: `G${guest.slice(0, 7)}` },
  ]);
  await db.insert(companyMemberships).values([home, guest].map((companyId) => ({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" })));
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
