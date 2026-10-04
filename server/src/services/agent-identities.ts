import { withV5ActivityTransaction } from "./v5-mutations.js";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { agentApiKeys, agentIdentities, agents, approvals, companies, type Db } from "@paperclipai/db";
import { type z } from "zod";
import type { addAgentPresenceSchema, createAgentIdentitySchema, updateAgentIdentitySchema } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { agentService } from "./agents.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";

export function agentIdentityService(db: Db) {
  async function audit(tx: Db, actor: AuthorizationActor, companyId: string, action: string, identityId: string, publications: ActivityPublication[]) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action, entityType: "agent_identity", entityId: identityId }, publications);
  }

  async function identityForCompany(companyId: string, identityId: string, tx: Db = db, lock = false) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identityId)) throw notFound("Agent identity not found");
    const query = tx.select({ identity: agentIdentities }).from(agentIdentities)
      .where(and(eq(agentIdentities.id, identityId), or(
        eq(agentIdentities.homeCompanyId, companyId),
        sql`exists (select 1 from ${agents} where ${agents.agentIdentityId} = ${agentIdentities.id} and ${agents.companyId} = ${companyId} and ${agents.status} <> 'terminated')`,
      ))).limit(1);
    const row = (await (lock ? query.for("update", { of: agentIdentities }) : query))[0];
    if (!row) throw notFound("Agent identity not found");
    return row.identity;
  }

  async function activeCompany(companyId: string, tx: Db = db) {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1).for("share");
    if (!company || company.status !== "active") throw conflict("An active company is required");
    return company;
  }

  async function createPresence(tx: Db, actor: AuthorizationActor, identity: typeof agentIdentities.$inferSelect, input: z.infer<typeof addAgentPresenceSchema>, publications: ActivityPublication[]) {
    const company = await activeCompany(input.companyId, tx);
    const presence = await agentService(tx).create(company.id, {
      agentIdentityId: identity.id, name: input.name ?? identity.name, role: input.role,
      status: company.requireBoardApprovalForNewAgents ? "pending_approval" : "idle",
      // Authority and provider configuration are deliberately local. None is
      // copied from home, a sibling presence, the persona or a Role Pack.
      permissions: { canCreateAgents: false, canCreateSkills: false }, adapterType: "process", adapterConfig: {}, runtimeConfig: {},
    });
    if (company.requireBoardApprovalForNewAgents) {
      await tx.insert(approvals).values({ companyId: company.id, type: "hire_agent", requestedByUserId: v5HumanActorId(actor), status: "pending", payload: {
        agentId: presence.id, name: presence.name, role: presence.role,
        adapterType: presence.adapterType, adapterConfig: {}, runtimeConfig: {},
        requestedConfigurationSnapshot: { adapterType: presence.adapterType, adapterConfig: {}, runtimeConfig: {}, desiredSkills: [] },
      } });
    }
    await audit(tx, actor, company.id, "agent_identity.presence_created", identity.id, publications);
    return presence;
  }

  return {
    identityForCompany,
    list: async (actor: AuthorizationActor, companyId: string) => {
      await assertV5Enabled(db, "agent_identities_v5");
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      const rows = await db.select({ id: agentIdentities.id, name: agentIdentities.name, status: agentIdentities.status, homeCompanyId: agentIdentities.homeCompanyId, agentId: agents.id })
        .from(agents).innerJoin(agentIdentities, eq(agents.agentIdentityId, agentIdentities.id))
        .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"))).orderBy(agentIdentities.id).limit(501);
      if (rows.length > 500) throw conflict("Identity catalog exceeds 500 local presences; narrow the company workspace");
      return rows;
    },
    get: async (actor: AuthorizationActor, companyId: string, identityId: string) => {
      await assertV5Enabled(db, "agent_identities_v5");
      await assertV5Authorization(db, actor, companyId, "company_scope:read");
      const identity = await identityForCompany(companyId, identityId);
      // Guest access reveals the stable persona's public identity, never home
      // instructions or provider settings. Those require home configuration access.
      if (identity.homeCompanyId !== companyId) return { id: identity.id, name: identity.name, status: identity.status, homeCompanyId: identity.homeCompanyId };
      await assertV5Authorization(db, actor, companyId, "agents:configure");
      return identity;
    },
    create: async (actor: AuthorizationActor, input: z.infer<typeof createAgentIdentitySchema>) => {
      await assertV5Enabled(db, "agent_identities_v5");
      v5HumanActorId(actor);
      await assertV5Authorization(db, actor, input.homeCompanyId, "agents:create");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await activeCompany(input.homeCompanyId, tx);
        const [identity] = await tx.insert(agentIdentities).values({ ...input, createdByUserId: v5HumanActorId(actor) }).returning();
        const presence = await createPresence(tx, actor, identity!, { companyId: input.homeCompanyId, role: "general" }, publications);
        await audit(tx, actor, input.homeCompanyId, "agent_identity.created", identity!.id, publications);
        return { identity: identity!, presence };
      });
    },
    update: async (actor: AuthorizationActor, companyId: string, identityId: string, input: z.infer<typeof updateAgentIdentitySchema>) => {
      await assertV5Enabled(db, "agent_identities_v5");
      v5HumanActorId(actor);
      await assertV5Authorization(db, actor, companyId, "agents:configure");
      const stoppedPresenceIds: string[] = [];
      const result = await withV5ActivityTransaction(db, async (tx, publications) => {
        const existing = await identityForCompany(companyId, identityId, tx, true);
        if (existing.homeCompanyId !== companyId) throw conflict("Configure identity from its home company");
        if (input.status === "active") {
          await activeCompany(companyId, tx);
          const [home] = await tx.select({ status: agents.status }).from(agents).where(and(eq(agents.agentIdentityId, identityId), eq(agents.companyId, companyId))).limit(1);
          if (!home || !["idle", "running", "error", "paused"].includes(home.status)) throw conflict("A valid home presence is required");
        }
        if (input.status === "paused" || input.status === "archived") {
          await tx.update(agents).set({ status: "paused", pauseReason: "operator", pausedAt: new Date(), updatedAt: new Date() }).where(and(eq(agents.agentIdentityId, identityId), inArray(agents.status, ["idle", "running", "error"])));
          const allPresences = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.agentIdentityId, identityId), ne(agents.status, "terminated")));
          stoppedPresenceIds.push(...allPresences.map((presence) => presence.id));
          if (input.status === "archived" && allPresences.length) await tx.update(agentApiKeys).set({ revokedAt: new Date() }).where(inArray(agentApiKeys.agentId, stoppedPresenceIds));
        }
        const [identity] = await tx.update(agentIdentities).set({ ...input, updatedAt: new Date() }).where(eq(agentIdentities.id, identityId)).returning();
        await audit(tx, actor, companyId, "agent_identity.updated", identityId, publications);
        return identity!;
      });
      if (stoppedPresenceIds.length) {
        const { heartbeatService } = await import("./heartbeat.js");
        await heartbeatService(db).cancelInvocationsForAgents(stoppedPresenceIds, `Logical identity ${input.status}`);
      }
      return result;
    },
    addPresence: async (actor: AuthorizationActor, homeCompanyId: string, identityId: string, input: z.infer<typeof addAgentPresenceSchema>) => {
      await assertV5Enabled(db, "agent_multi_company_presence_v5");
      v5HumanActorId(actor);
      await assertV5Authorization(db, actor, homeCompanyId, "agents:configure");
      await assertV5Authorization(db, actor, input.companyId, "agents:create");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const identity = await identityForCompany(homeCompanyId, identityId, tx, true);
        if (identity.homeCompanyId !== homeCompanyId || identity.status !== "active") throw conflict("An active identity controlled from its home company is required");
        const [existing] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.agentIdentityId, identityId), eq(agents.companyId, input.companyId))).limit(1);
        if (existing) throw conflict("This identity already has a presence in that company");
        return createPresence(tx, actor, identity, input, publications);
      });
    },
    rehome: async (actor: AuthorizationActor, oldHomeCompanyId: string, identityId: string, newHomeCompanyId: string) => {
      await assertV5Enabled(db, "agent_multi_company_presence_v5");
      v5HumanActorId(actor);
      // Rehoming needs membership administration in BOTH companies; a global
      // identity or company relationship is never sufficient.
      await assertV5Authorization(db, actor, oldHomeCompanyId, "users:manage_permissions");
      await assertV5Authorization(db, actor, newHomeCompanyId, "users:manage_permissions");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const identity = await identityForCompany(oldHomeCompanyId, identityId, tx, true);
        if (identity.homeCompanyId !== oldHomeCompanyId) throw conflict("Home company changed; refresh before retrying");
        await activeCompany(newHomeCompanyId, tx);
        const [presence] = await tx.select({ status: agents.status }).from(agents).where(and(eq(agents.agentIdentityId, identityId), eq(agents.companyId, newHomeCompanyId))).limit(1);
        if (!presence || !["idle", "running", "error"].includes(presence.status)) throw conflict("The new home requires an active local presence");
        const [updated] = await tx.update(agentIdentities).set({ homeCompanyId: newHomeCompanyId, updatedAt: new Date() }).where(eq(agentIdentities.id, identityId)).returning();
        await audit(tx, actor, oldHomeCompanyId, "agent_identity.rehomed", identityId, publications);
        await audit(tx, actor, newHomeCompanyId, "agent_identity.rehomed", identityId, publications);
        return updated!;
      });
    },
  };
}
