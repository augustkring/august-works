import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentApiKeys, agentWakeupRequests, agents, companies, companyMemberships, createDb, instanceSettings, principalPermissionGrants } from "@paperclipai/db";
import { V5_FEATURE_KEYS } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentIdentityService } from "../services/agent-identities.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 agent identity authority and lifecycle", () => {
  let db!: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v5-identities-");
    db = createDb(database.connectionString);
    await db.update(instanceSettings).set({ experimental: Object.fromEntries(V5_FEATURE_KEYS.map((k) => [k, true])) }).where(eq(instanceSettings.singletonKey, "default"));
  });
  afterAll(async () => { await database?.cleanup(); });

  async function fixture() {
    const userId = `user-${randomUUID()}`, home = randomUUID(), guest = randomUUID();
    await db.insert(companies).values([
      { id: home, name: "Home", issuePrefix: `H${home.slice(0, 7)}` },
      { id: guest, name: "Guest", issuePrefix: `G${guest.slice(0, 7)}` },
    ]);
    await db.insert(companyMemberships).values([home, guest].map((companyId) => ({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" })));
    await db.insert(principalPermissionGrants).values([home, guest].flatMap((companyId) => grantsForHumanRole("owner").map((grant) => ({ companyId, principalType: "user", principalId: userId, ...grant }))));
    const actor: AuthorizationActor = { type: "board", source: "session", userId, companyIds: [home, guest] };
    const created = await agentIdentityService(db).create(actor, { name: "Fox", homeCompanyId: home, baseProfile: { persona: "Home private persona" } });
    return { userId, home, guest, actor, ...created };
  }

  it("creates unique local presences with no inherited provider, permission or budget state", async () => {
    const f = await fixture();
    await db.update(agents).set({ budgetMonthlyCents: 9000, permissions: { canCreateAgents: true }, adapterConfig: { privateSetting: "home" } }).where(eq(agents.id, f.presence.id));
    const guest = await agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" });
    expect(guest).toMatchObject({ agentIdentityId: f.identity.id, companyId: f.guest, budgetMonthlyCents: 0, adapterConfig: {}, permissions: { canCreateAgents: false, canCreateSkills: false } });
    expect(await agentIdentityService(db).get(f.actor, f.guest, f.identity.id)).not.toHaveProperty("baseProfile");
    await expect(agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" })).rejects.toMatchObject({ status: 409 });
  });

  it("home authority and an identity cannot grant guest company access", async () => {
    const f = await fixture();
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
    await expect(agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" })).rejects.toMatchObject({ status: 403 });
    await expect(agentIdentityService(db).get(f.actor, f.guest, f.identity.id)).rejects.toMatchObject({ status: 403 });
  });

  it("serializes concurrent additions and preserves the one-presence invariant", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([1, 2].map(() => agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const rows = await db.select().from(agents).where(and(eq(agents.companyId, f.guest), eq(agents.agentIdentityId, f.identity.id)));
    expect(rows).toHaveLength(1);
  });

  it("requires rehome/archive before ending a shared home, and rehome requires both local administrations", async () => {
    const f = await fixture();
    await agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" });
    await expect(db.update(agents).set({ status: "terminated" }).where(eq(agents.id, f.presence.id))).rejects.toThrow();
    await expect(db.update(companies).set({ status: "archived" }).where(eq(companies.id, f.home))).rejects.toThrow();
    const updated = await agentIdentityService(db).rehome(f.actor, f.home, f.identity.id, f.guest);
    expect(updated.homeCompanyId).toBe(f.guest);
    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, f.presence.id));
    expect((await agentIdentityService(db).get(f.actor, f.guest, f.identity.id)).status).toBe("active");
  });

  it("does not conflate guest termination with global termination", async () => {
    const f = await fixture();
    const guest = await agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" });
    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, guest.id));
    expect((await agentIdentityService(db).get(f.actor, f.home, f.identity.id)).status).toBe("active");
    await expect(db.update(agents).set({ agentIdentityId: randomUUID() }).where(eq(agents.id, f.presence.id))).rejects.toThrow();
  });

  it("global archival revokes keys of already paused presences and cancels queued guest work", async () => {
    const f = await fixture();
    const guest = await agentIdentityService(db).addPresence(f.actor, f.home, f.identity.id, { companyId: f.guest, role: "general" });
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, guest.id));
    const [key] = await db.insert(agentApiKeys).values({ companyId: f.guest, agentId: guest.id, name: "Paused key", keyHash: randomUUID() }).returning();
    const [wake] = await db.insert(agentWakeupRequests).values({ companyId: f.guest, agentId: guest.id, source: "on_demand", status: "queued" }).returning();
    await agentIdentityService(db).update(f.actor, f.home, f.identity.id, { status: "archived" });
    expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, key!.id)))[0]!.revokedAt).not.toBeNull();
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, wake!.id)))[0]!.status).toBe("cancelled");
  });
});
