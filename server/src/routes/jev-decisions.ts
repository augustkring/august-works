import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { companyMemberships, jevDecisionSettings, type Db } from "@paperclipai/db";
import { jevDecisionSettingsUpdateSchema, JEV_DECISION_MODEL } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { accessService } from "../services/access.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { logActivity } from "../services/activity-log.js";
import { conflict, forbidden } from "../errors.js";

export function jevDecisionRoutes(db: Db) {
  const router = Router();
  async function manager(companyId: string, userId: string) {
    const access = accessService(db);
    const [member] = await db.select().from(companyMemberships).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, userId), eq(companyMemberships.status, "active"),
    )).limit(1);
    if (!member || member.membershipRole === "viewer") throw forbidden();
    if (member.membershipRole === "owner" || member.membershipRole === "admin" ||
      await access.hasPermission(companyId, "user", userId, "tools:manage_connections")) return;
    throw forbidden("A company connection manager is required");
  }
  router.get("/companies/:companyId/jev-decisions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    await manager(companyId, userId);
    const [row] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
    const connections = await aiConnectionService(db).list(companyId, userId);
    const choices = connections.filter(item => item.provider === "openrouter" && item.method === "api_key" && item.ownership === "shared")
      .map(item => ({ id: item.id, grantId: item.grantId, name: item.name, status: item.status, model: JEV_DECISION_MODEL }));
    res.json({ settings: row ?? { companyId, mode: "off", allowBackground: false, connectionId: null, grantId: null, updatedAt: new Date(0) }, choices, suggestionsQualified: false });
  });
  router.put("/companies/:companyId/jev-decisions", validate(jevDecisionSettingsUpdateSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req); assertCompanyAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    await manager(companyId, userId);
    const input = jevDecisionSettingsUpdateSchema.parse(req.body);
    if (input.mode === "suggestions") throw conflict("User-visible Jev suggestions are not qualified for activation");
    if (input.mode !== "off" && !input.connectionId) throw conflict("Select a company-shared OpenRouter API-key connection first");
    if (input.connectionId && input.grantId) await aiConnectionService(db).selectDecision({ companyId, userId, connectionId: input.connectionId, grantId: input.grantId });
    const [previous] = await db.select().from(jevDecisionSettings).where(eq(jevDecisionSettings.companyId, companyId));
    const values = { companyId, mode: input.mode, allowBackground: input.allowBackground ?? previous?.allowBackground ?? false,
      connectionId: input.connectionId, grantId: input.grantId, updatedByUserId: userId, updatedAt: new Date() };
    const saved = await db.transaction(async tx => {
      const [row] = await tx.insert(jevDecisionSettings).values(values).onConflictDoUpdate({ target: jevDecisionSettings.companyId, set: values }).returning();
      await logActivity(tx, { companyId, actorType: "user", actorId: userId, action: "jev_skill_decisions.configured", entityType: "company", entityId: companyId,
        details: { mode: row!.mode, allowBackground: row!.allowBackground, connectionId: row!.connectionId } });
      return row!;
    });
    res.json({ settings: saved, suggestionsQualified: false });
  });
  return router;
}
