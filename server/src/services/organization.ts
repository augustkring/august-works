import { withV5ActivityTransaction } from "./v5-mutations.js";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { agents, companies, companyMemberships, companyRelationships, orgUnitMemberships, orgUnits, type Db } from "@paperclipai/db";
import { isUuidLike, type createCompanyRelationshipSchema, type createOrgUnitSchema, type setOrgUnitMembershipSchema, type updateOrgUnitSchema } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";

export function organizationService(db: Db) {
  async function authorize(actor: AuthorizationActor, companyId: string, feature: "company_relationships_v5" | "org_units_v5", write: boolean) {
    await assertV5Enabled(db, feature);
    if (write) v5HumanActorId(actor);
    await assertV5Authorization(db, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  }
  async function activeCompanyLock(tx: Db, companyId: string) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), eq(companies.status, "active"))).limit(1).for("update");
    if (!row) throw conflict("An active company is required");
  }
  async function audit(tx: Db, actor: AuthorizationActor, companyId: string, action: string, entityId: string, entityType: string, publications: ActivityPublication[]) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action, entityType, entityId }, publications);
  }
  async function unit(tx: Db, companyId: string, unitId: string) {
    if (!isUuidLike(unitId)) throw notFound("Organization unit not found");
    const [row] = await tx.select().from(orgUnits).where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, unitId))).limit(1);
    if (!row) throw notFound("Organization unit not found");
    return row;
  }
  async function assertPrincipal(tx: Db, companyId: string, principalType: "agent" | "user", principalId: string) {
    if (principalType === "agent") {
      if (!isUuidLike(principalId)) throw unprocessable("An agent membership requires a local presence id");
      const [row] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, principalId), ne(agents.status, "terminated"))).limit(1);
      if (!row) throw unprocessable("Agent must have a valid local company presence");
    } else {
      const [row] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, principalId), eq(companyMemberships.status, "active"))).limit(1);
      if (!row) throw unprocessable("Human must have active company membership");
    }
  }
  async function validateUnit(tx: Db, companyId: string, input: z.infer<typeof updateOrgUnitSchema>, currentId?: string) {
    if (input.leadUserId) await assertPrincipal(tx, companyId, "user", input.leadUserId);
    if (input.leadAgentId) await assertPrincipal(tx, companyId, "agent", input.leadAgentId);
    let parentId = input.parentId;
    const seen = new Set(currentId ? [currentId] : []);
    for (let depth = 0; parentId; depth++) {
      if (depth >= 64 || seen.has(parentId)) throw unprocessable("Organization hierarchy must be acyclic and at most 64 levels deep");
      seen.add(parentId);
      const parent = await unit(tx, companyId, parentId);
      if (parent.status !== "active") throw unprocessable("Parent organization unit must be active");
      parentId = parent.parentId;
    }
  }
  return {
    listRelationships: async (actor: AuthorizationActor, companyId: string) => {
      await authorize(actor, companyId, "company_relationships_v5", false);
      return db.select().from(companyRelationships).where(or(eq(companyRelationships.sourceCompanyId, companyId), eq(companyRelationships.targetCompanyId, companyId))).orderBy(companyRelationships.id).limit(500);
    },
    proposeRelationship: async (actor: AuthorizationActor, companyId: string, input: z.infer<typeof createCompanyRelationshipSchema>) => {
      await authorize(actor, companyId, "company_relationships_v5", true);
      if (input.targetCompanyId === companyId) throw unprocessable("A company cannot relate to itself");
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await activeCompanyLock(tx, companyId);
        const [target] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, input.targetCompanyId), eq(companies.status, "active"))).limit(1);
        if (!target) throw notFound("Target company not found");
        const [row] = await tx.insert(companyRelationships).values({ sourceCompanyId: companyId, ...input, createdByUserId: v5HumanActorId(actor) })
          .onConflictDoUpdate({ target: [companyRelationships.sourceCompanyId, companyRelationships.targetCompanyId, companyRelationships.relationshipType], set: { status: "proposed", createdByUserId: v5HumanActorId(actor), acceptedByUserId: null, updatedAt: new Date() }, setWhere: inArray(companyRelationships.status, ["rejected", "revoked"]) }).returning();
        if (!row) throw conflict("This relationship already has an active or pending proposal");
        await audit(tx, actor, companyId, "company_relationship.proposed", row.id, "company_relationship", publications);
        return row;
      });
    },
    transitionRelationship: async (actor: AuthorizationActor, companyId: string, relationshipId: string, action: "accept" | "reject" | "revoke") => {
      await authorize(actor, companyId, "company_relationships_v5", true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const [row] = await tx.select().from(companyRelationships).where(and(eq(companyRelationships.id, relationshipId), or(eq(companyRelationships.sourceCompanyId, companyId), eq(companyRelationships.targetCompanyId, companyId)))).limit(1).for("update");
        if (!row) throw notFound("Company relationship not found");
        if (action !== "revoke" && row.targetCompanyId !== companyId) throw conflict("Only the target company may accept or reject this relationship");
        if (action !== "revoke" && row.status !== "proposed") throw conflict("The proposal has already been decided");
        if (action === "accept") await activeCompanyLock(tx, companyId);
        const [updated] = await tx.update(companyRelationships).set({ status: action === "accept" ? "active" : action === "reject" ? "rejected" : "revoked", acceptedByUserId: action === "accept" ? v5HumanActorId(actor) : row.acceptedByUserId, updatedAt: new Date() }).where(eq(companyRelationships.id, relationshipId)).returning();
        await audit(tx, actor, companyId, `company_relationship.${action === "accept" ? "accepted" : action === "reject" ? "rejected" : "revoked"}`, row.id, "company_relationship", publications);
        return updated!;
      });
    },
    listUnits: async (actor: AuthorizationActor, companyId: string) => {
      await authorize(actor, companyId, "org_units_v5", false);
      return db.select().from(orgUnits).where(eq(orgUnits.companyId, companyId)).orderBy(orgUnits.id).limit(500);
    },
    createUnit: async (actor: AuthorizationActor, companyId: string, input: z.infer<typeof createOrgUnitSchema>) => {
      await authorize(actor, companyId, "org_units_v5", true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await activeCompanyLock(tx, companyId); // Serializes concurrent reparent/cycle checks.
        await validateUnit(tx, companyId, input);
        const [row] = await tx.insert(orgUnits).values({ companyId, ...input }).returning();
        await audit(tx, actor, companyId, "org_unit.created", row!.id, "org_unit", publications);
        return row!;
      });
    },
    updateUnit: async (actor: AuthorizationActor, companyId: string, unitId: string, input: z.infer<typeof updateOrgUnitSchema>) => {
      await authorize(actor, companyId, "org_units_v5", true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await activeCompanyLock(tx, companyId);
        const current = await unit(tx, companyId, unitId);
        await validateUnit(tx, companyId, { ...current, ...input, type: (input.type ?? current.type) as z.infer<typeof createOrgUnitSchema>["type"], status: (input.status ?? current.status) as "active" | "archived" }, unitId);
        if (input.status === "archived") {
          const [child] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.parentId, unitId), eq(orgUnits.status, "active"))).limit(1);
          if (child) throw conflict("Reparent or archive child units before archiving their parent");
          await tx.update(orgUnitMemberships).set({ status: "archived", updatedAt: new Date() }).where(and(eq(orgUnitMemberships.companyId, companyId), eq(orgUnitMemberships.orgUnitId, unitId)));
        }
        const [updated] = await tx.update(orgUnits).set({ ...input, updatedAt: new Date() }).where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, unitId))).returning();
        await audit(tx, actor, companyId, "org_unit.updated", unitId, "org_unit", publications);
        return updated!;
      });
    },
    listMemberships: async (actor: AuthorizationActor, companyId: string, unitId: string) => {
      await authorize(actor, companyId, "org_units_v5", false);
      await unit(db, companyId, unitId);
      return db.select().from(orgUnitMemberships).where(and(eq(orgUnitMemberships.companyId, companyId), eq(orgUnitMemberships.orgUnitId, unitId))).orderBy(orgUnitMemberships.id).limit(500);
    },
    setMembership: async (actor: AuthorizationActor, companyId: string, unitId: string, input: z.infer<typeof setOrgUnitMembershipSchema>) => {
      await authorize(actor, companyId, "org_units_v5", true);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await activeCompanyLock(tx, companyId);
        const current = await unit(tx, companyId, unitId);
        if (current.status !== "active" && input.status === "active") throw conflict("An active organization unit is required");
        if (input.status === "active") await assertPrincipal(tx, companyId, input.principalType, input.principalId);
        const [membership] = await tx.insert(orgUnitMemberships).values({ companyId, orgUnitId: unitId, ...input }).onConflictDoUpdate({ target: [orgUnitMemberships.orgUnitId, orgUnitMemberships.principalType, orgUnitMemberships.principalId], set: { role: input.role, status: input.status, updatedAt: new Date() } }).returning();
        await audit(tx, actor, companyId, "org_unit.membership_updated", unitId, "org_unit", publications);
        return membership!;
      });
    },
  };
}
