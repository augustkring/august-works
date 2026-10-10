import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  experienceProfileSchema,
  experienceCommandQuerySchema,
} from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { experienceService } from "../services/experience/service.js";
import { ExperienceOverloadError } from "../services/experience/projection.js";
import { badRequest, conflict } from "../errors.js";
import { companyExperience } from "../services/experience/company-navigation.js";
import { experienceCommands } from "../services/experience/commands.js";

export function experienceRoutes(db: Db) {
  const router = Router();
  const service = experienceService(db);
  router.get("/companies/:companyId/experience/commands", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    const query = experienceCommandQuerySchema.parse(req.query.q ?? "");
    const controller = new AbortController(),
      cancel = () => controller.abort();
    res.on("close", cancel);
    res.set("Cache-Control", "private, no-store");
    try {
      const result = await experienceCommands(
        db,
        req.actor,
        companyId,
        query,
        controller.signal,
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (error instanceof ExperienceOverloadError) {
        res.set("Retry-After", "2");
        res
          .status(503)
          .json({
            error: "Commands are busy. Try again shortly.",
            code: "experience_overloaded",
          });
        return;
      }
      throw error;
    } finally {
      res.off("close", cancel);
    }
  });
  router.get("/companies/:companyId/experience/company", async (req, res) => {
    assertBoard(req);
    const companyId = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    const controller = new AbortController(),
      cancel = () => controller.abort();
    res.on("close", cancel);
    res.set("Cache-Control", "private, no-store");
    try {
      const result = await companyExperience(
        db,
        req.actor,
        companyId,
        controller.signal,
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (error instanceof ExperienceOverloadError) {
        res.set("Retry-After", "2");
        res.status(503).json({
          error: "Company navigation is busy. Try again shortly.",
          code: "experience_overloaded",
        });
        return;
      }
      throw error;
    } finally {
      res.off("close", cancel);
    }
  });
  router.post("/companies/:companyId/experience/profile", async (req, res) => {
    assertBoard(req);
    const id = z.uuid().parse(req.params.companyId);
    assertCompanyAccess(req, id);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    )
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    const input = z
      .strictObject({ profile: experienceProfileSchema })
      .parse(req.body);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await service.setProfile(req.actor, id, input.profile));
  });
  router.get("/companies/:companyId/experience", async (req, res) => {
    assertBoard(req);
    const id = z.uuid().safeParse(req.params.companyId);
    const preferred = experienceProfileSchema
      .optional()
      .safeParse(req.query.profile);
    if (!id.success || !preferred.success)
      throw badRequest("Invalid experience context");
    assertCompanyAccess(req, id.data);
    const principal =
      req.actor.source === "local_implicit" ? "local-board" : req.actor.userId;
    if (
      req.query.expectedUserId !== undefined &&
      req.query.expectedUserId !== principal
    ) {
      throw conflict("Account changed; reload this page", {
        code: "ACCOUNT_CHANGED",
      });
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on("close", cancel);
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const projection = await service.home(
        req.actor,
        id.data,
        controller.signal,
        preferred.data,
      );
      if (!controller.signal.aborted) res.json(projection);
    } catch (error) {
      if (error instanceof ExperienceOverloadError) {
        res.setHeader("Retry-After", "2");
        res.status(503).json({
          error: "Home is busy. Try again shortly.",
          code: "experience_overloaded",
        });
        return;
      }
      throw error;
    } finally {
      res.off("close", cancel);
    }
  });
  return router;
}
