import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { v5HumanActorId } from "../services/v5-authorization.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { ExperienceOverloadError } from "../services/experience/projection.js";
import { conflict } from "../errors.js";

export function conversationAuthoringRoutes(db: Db) {
  const router = Router(), service = conversationAuthoringService(db);
  router.get("/companies/:companyId/conversations/:conversationId/authoring", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store"); assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId), conversationId = z.uuid().parse(req.params.conversationId);
    assertCompanyAccess(req, companyId);
    const query = z.strictObject({ expectedUserId: z.string().min(1).max(300) }).parse(req.query);
    if (query.expectedUserId !== v5HumanActorId(req.actor)) throw conflict("Account changed; reload the conversation", { code: "ACCOUNT_CHANGED" });
    try { res.json(await service.get(req.actor, companyId, conversationId)); }
    catch (error) {
      if (!(error instanceof ExperienceOverloadError)) throw error;
      res.status(503).json({ error: "Current conversation proposals are temporarily unavailable", code: "CONVERSATION_VIEW_UNAVAILABLE" });
    }
  });
  return router;
}
