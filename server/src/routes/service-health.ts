import { Router } from "express";
import { managedServiceHealthFromEnvironment } from "../services/experience/service-health.js";

export function serviceHealthRoutes(env: Readonly<Record<string, string | undefined>> = process.env) {
  const service = managedServiceHealthFromEnvironment(env);
  const router = Router();
  router.get("/api/service-status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.json(await service.read());
  });
  return router;
}
