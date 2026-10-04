import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { agents, agentRolePackAssignments, orgUnitMemberships, orgUnits, rolePackItems, rolePacks, rolePackVersions, type Db } from "@paperclipai/db";
import { assignRolePackSchema, createRolePackSchema, mergeRolePackItems, rolePackVersionInputSchema, SYSTEM_ROLE_PACKS, type RolePackItem } from "@paperclipai/shared";
import type { z } from "zod";
import { conflict, notFound, unprocessable } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization, assertV5Enabled, v5HumanActorId } from "./v5-authorization.js";
import { withV5ActivityTransaction } from "./v5-mutations.js";
import { logActivity, type ActivityPublication } from "./activity-log.js";

export function rolePackService(db: Db) {
  async function readable(actor: AuthorizationActor, companyId: string) {
    await assertV5Enabled(db, "role_packs_v5");
    await assertV5Authorization(db, actor, companyId, "company_scope:read");
  }
  async function configurable(actor: AuthorizationActor, companyId: string) {
    await readable(actor, companyId); v5HumanActorId(actor);
    await assertV5Authorization(db, actor, companyId, "agents:configure");
  }
  async function pack(tx: Db, companyId: string, id: string, lock = false) {
    const query = tx.select().from(rolePacks).where(and(eq(rolePacks.companyId, companyId), eq(rolePacks.id, id))).limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row || row.status !== "active") throw notFound("Role Pack not found");
    return row;
  }
  async function version(tx: Db, companyId: string, packId: string, versionId: string) {
    const [row] = await tx.select().from(rolePackVersions).where(and(eq(rolePackVersions.companyId, companyId), eq(rolePackVersions.rolePackId, packId), eq(rolePackVersions.id, versionId))).limit(1);
    if (!row) throw notFound("Role Pack version not found");
    const rows = await tx.select().from(rolePackItems).where(and(eq(rolePackItems.companyId, companyId), eq(rolePackItems.versionId, versionId))).orderBy(asc(rolePackItems.ordinal));
    return { ...row, items: rows.map((item) => item.item) };
  }
  async function audit(tx: Db, actor: AuthorizationActor, companyId: string, id: string, action: string, publications: ActivityPublication[]) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v5HumanActorId(actor), action, entityType: "role_pack", entityId: id }, publications);
  }
  return {
    list: async (actor: AuthorizationActor, companyId: string) => { await readable(actor, companyId); return db.select().from(rolePacks).where(eq(rolePacks.companyId, companyId)).orderBy(asc(rolePacks.key)); },
    catalog: async (actor: AuthorizationActor, companyId: string) => { await readable(actor, companyId); return SYSTEM_ROLE_PACKS; },
    get: async (actor: AuthorizationActor, companyId: string, id: string) => {
      await readable(actor, companyId); const row = await pack(db, companyId, id);
      const versions = await db.select().from(rolePackVersions).where(and(eq(rolePackVersions.companyId, companyId), eq(rolePackVersions.rolePackId, id))).orderBy(asc(rolePackVersions.revisionNumber));
      return { ...row, versions };
    },
    getVersion: async (actor: AuthorizationActor, companyId: string, id: string, versionId: string) => { await readable(actor, companyId); await pack(db, companyId, id); return version(db, companyId, id, versionId); },
    create: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof createRolePackSchema>) => {
      await configurable(actor, companyId); const input = createRolePackSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const [row] = await tx.insert(rolePacks).values({ ...input, companyId }).onConflictDoNothing().returning();
        if (!row) throw conflict("This Role Pack key already exists");
        await audit(tx, actor, companyId, row.id, "role_pack.created", publications); return row;
      });
    },
    createVersion: async (actor: AuthorizationActor, companyId: string, id: string, raw: z.infer<typeof rolePackVersionInputSchema>) => {
      await configurable(actor, companyId); const input = rolePackVersionInputSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        await pack(tx, companyId, id, true);
        const [next] = await tx.select({ revision: sql<number>`coalesce(max(${rolePackVersions.revisionNumber}), 0) + 1` }).from(rolePackVersions).where(and(eq(rolePackVersions.companyId, companyId), eq(rolePackVersions.rolePackId, id)));
        const [row] = await tx.insert(rolePackVersions).values({ companyId, rolePackId: id, revisionNumber: Number(next!.revision), summary: input.summary, createdByUserId: v5HumanActorId(actor) }).returning();
        if (input.items.length) await tx.insert(rolePackItems).values(input.items.map((item, ordinal) => ({ companyId, versionId: row!.id, ordinal, item })));
        await audit(tx, actor, companyId, id, "role_pack.draft_created", publications); return { ...row!, items: input.items };
      });
    },
    publish: async (actor: AuthorizationActor, companyId: string, id: string, versionId: string, expectedPublishedVersionId: string | null) => {
      await configurable(actor, companyId);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await pack(tx, companyId, id, true);
        if (row.publishedVersionId !== expectedPublishedVersionId) throw conflict("The published Role Pack changed; refresh before publishing");
        const draft = await version(tx, companyId, id, versionId);
        if (draft.state !== "draft") throw conflict("Only a draft Role Pack can be published");
        mergeRolePackItems([draft.items]); // Detect invalid/ambiguous requirements before publication.
        await tx.update(rolePackVersions).set({ state: "published", publishedAt: new Date() }).where(eq(rolePackVersions.id, versionId));
        const [published] = await tx.update(rolePacks).set({ publishedVersionId: versionId, updatedAt: new Date() }).where(eq(rolePacks.id, id)).returning();
        await audit(tx, actor, companyId, id, "role_pack.published", publications); return published!;
      });
    },
    assign: async (actor: AuthorizationActor, companyId: string, raw: z.infer<typeof assignRolePackSchema>) => {
      await configurable(actor, companyId); const input = assignRolePackSchema.parse(raw);
      return withV5ActivityTransaction(db, async (tx, publications) => {
        const row = await pack(tx, companyId, input.rolePackId, true);
        if (input.scopeType === "company" && input.scopeId !== companyId) throw unprocessable("Company overlay must use its local company id");
        if (input.scopeType === "agent") {
          const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, input.scopeId))).limit(1);
          if (!agent) throw unprocessable("Role Pack assignment requires a local presence");
        }
        if (input.scopeType === "org_unit") {
          const [unit] = await tx.select({ id: orgUnits.id }).from(orgUnits).where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.id, input.scopeId), eq(orgUnits.status, "active"))).limit(1);
          if (!unit) throw unprocessable("Role Pack assignment requires an active local unit");
        }
        const selectedId = input.pinnedVersionId ?? row.publishedVersionId;
        if (!selectedId || (await version(tx, companyId, row.id, selectedId)).state !== "published") throw conflict("Assignments require a published Role Pack version");
        const [assignment] = await tx.insert(agentRolePackAssignments).values({ ...input, companyId }).onConflictDoUpdate({ target: [agentRolePackAssignments.companyId, agentRolePackAssignments.scopeType, agentRolePackAssignments.scopeId], set: { ...input, updatedAt: new Date() } }).returning();
        await audit(tx, actor, companyId, row.id, "role_pack.assigned", publications); return assignment!;
      });
    },
    resolve: async (actor: AuthorizationActor, companyId: string, agentId: string) => {
      await readable(actor, companyId);
      const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).limit(1);
      if (!agent) throw notFound("Agent presence not found");
      const roleKey = ({ engineer: "backend_engineer", researcher: "research", general: "ops", pm: "ceo", qa: "backend_engineer" } as Record<string, string>)[agent.role] ?? agent.role;
      const system = SYSTEM_ROLE_PACKS.find((item) => item.key === roleKey) ?? SYSTEM_ROLE_PACKS.find((item) => item.key === "ops")!;
      const directUnits = await db.select({ unitId: orgUnitMemberships.orgUnitId }).from(orgUnitMemberships).where(and(eq(orgUnitMemberships.companyId, companyId), eq(orgUnitMemberships.principalType, "agent"), eq(orgUnitMemberships.principalId, agentId), eq(orgUnitMemberships.status, "active")));
      const units = await db.select().from(orgUnits).where(and(eq(orgUnits.companyId, companyId), eq(orgUnits.status, "active"))).orderBy(asc(orgUnits.slug));
      const unitById = new Map(units.map((unit) => [unit.id, unit]));
      const ancestry = new Map<string, number>();
      for (const direct of directUnits) {
        let id: string | null = direct.unitId; const seen = new Set<string>();
        for (let depth = 0; id && depth < 64 && !seen.has(id); depth++) {
          seen.add(id); const unit = unitById.get(id); if (!unit) break;
          ancestry.set(id, Math.max(ancestry.get(id) ?? 0, depth)); id = unit.parentId;
        }
        if (id) throw conflict("Organization ancestry is cyclic or exceeds its depth limit");
      }
      const scopeIds = [companyId, ...ancestry.keys(), agentId];
      const assignments = await db.select().from(agentRolePackAssignments).where(and(eq(agentRolePackAssignments.companyId, companyId), inArray(agentRolePackAssignments.scopeId, scopeIds)));
      const scopeOrder = [companyId, ...[...ancestry.keys()].sort((a, b) => (ancestry.get(b)! - ancestry.get(a)!) || unitById.get(a)!.slug.localeCompare(unitById.get(b)!.slug)), agentId];
      assignments.sort((a, b) => scopeOrder.indexOf(a.scopeId) - scopeOrder.indexOf(b.scopeId));
      const layers: RolePackItem[][] = [system.items], pins: Array<{ rolePackId: string; versionId: string; scopeType: string; scopeId: string }> = [];
      for (const assignment of assignments) {
        const assigned = await pack(db, companyId, assignment.rolePackId);
        const versionId = assignment.pinnedVersionId ?? assigned.publishedVersionId;
        if (!versionId) throw conflict("Assigned Role Pack has no published version");
        const selected = await version(db, companyId, assigned.id, versionId);
        if (selected.state !== "published") throw conflict("Assigned Role Pack version is not published");
        layers.push(selected.items); pins.push({ rolePackId: assigned.id, versionId, scopeType: assignment.scopeType, scopeId: assignment.scopeId });
      }
      return { systemKey: system.key, systemVersion: system.version, pins, items: mergeRolePackItems(layers) };
    },
  };
}
