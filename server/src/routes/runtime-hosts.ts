import express, { Router } from "express";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { SaasPlatform } from "../services/saas/platform.js";

export function runtimeHostRoutes(platform: SaasPlatform) {
  const router = Router();
  router.use(
    "/api/internal/runtime",
    express.raw({ type: "application/json", limit: "1mb" }),
  );
  router.post("/api/internal/runtime/enrollment-context", async (req, res) => {
    if (!(await platform.enabled("runtime_host_agent_v6"))) throw notFound();
    if (req.headers.cookie || !Buffer.isBuffer(req.body))
      throw forbidden("Machine enrollment required");
    let input: unknown;
    try {
      input = JSON.parse(req.body.toString("utf8"));
    } catch {
      throw badRequest("Invalid enrollment request");
    }
    res
      .set("Cache-Control", "no-store")
      .json(await platform.runtime.auth.enrollmentContext(input));
  });
  router.post("/api/internal/runtime/enroll", async (req, res) => {
    if (!(await platform.enabled("runtime_host_agent_v6"))) throw notFound();
    if (req.headers.cookie || !Buffer.isBuffer(req.body))
      throw forbidden("Host enrollment requires a machine request");
    let input: unknown;
    try {
      input = JSON.parse(req.body.toString("utf8"));
    } catch {
      throw badRequest("Invalid enrollment request");
    }
    res
      .set("Cache-Control", "no-store")
      .json(await platform.runtime.auth.enroll(input));
  });
  router.use("/api/internal/runtime/hosts/:hostId", async (req, res, next) => {
    if (req.headers.cookie || req.originalUrl.includes("?"))
      throw forbidden("Machine authentication required");
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (raw.length && !req.is("application/json"))
      throw badRequest("JSON machine request required");
    const host = await platform.runtime.auth.authenticate(
      {
        hostId: req.get("x-aw-host-id"),
        epoch: req.get("x-aw-host-epoch"),
        timestamp: req.get("x-aw-host-timestamp"),
        nonce: req.get("x-aw-host-nonce"),
        signature: req.get("x-aw-host-signature"),
      },
      req.method,
      req.originalUrl,
      raw,
    );
    if (host.id !== String(req.params.hostId))
      throw forbidden("Host scope mismatch");
    res.locals.runtimeHost = host;
    if (raw.length)
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch {
        throw badRequest("Invalid host request");
      }
    next();
  });
  router.post(
    "/api/internal/runtime/hosts/:hostId/enrollment-recovery",
    async (req, res) => {
      res
        .set("Cache-Control", "no-store")
        .json(
          await platform.runtime.auth.recoverEnrollment(
            String(req.params.hostId),
            req.body,
          ),
        );
    },
  );
  router.post(
    "/api/internal/runtime/hosts/:hostId/commands/recovery",
    async (req, res) => {
      res
        .set("Cache-Control", "no-store")
        .json(
          await platform.runtime.recoveryCommands(String(req.params.hostId)),
        );
    },
  );
  router.post(
    "/api/internal/runtime/hosts/:hostId/commands/:commandId/recovery",
    async (req, res) => {
      res.json(
        await platform.runtime.recordRecovery(
          String(req.params.hostId),
          String(req.params.commandId),
          req.body,
        ),
      );
    },
  );
  router.post(
    "/api/internal/runtime/hosts/:hostId/heartbeat",
    async (req, res) => {
      res.json(
        await platform.runtime.heartbeat(String(req.params.hostId), req.body),
      );
    },
  );
  router.post(
    "/api/internal/runtime/hosts/:hostId/commands/claim",
    async (req, res) => {
      res
        .set("Cache-Control", "no-store")
        .json(
          await platform.runtime.claim(
            String(req.params.hostId),
            new Date(),
            await platform.enabled("hosted_openclaw_v6"),
          ),
        );
    },
  );
  router.post("/api/internal/runtime/hosts/:hostId/sandbox-commands/claim", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await platform.sandboxHosts.claim(String(req.params.hostId)));
  });
  router.post("/api/internal/runtime/hosts/:hostId/sandbox-commands/:commandId/complete", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await platform.sandboxHosts.complete(String(req.params.hostId), String(req.params.commandId), req.body));
  });
  router.post(
    "/api/internal/runtime/hosts/:hostId/commands/:commandId/renew",
    async (req, res) => {
      res.json(
        await platform.runtime.renew(
          String(req.params.hostId),
          String(req.params.commandId),
          req.body,
        ),
      );
    },
  );
  router.post(
    "/api/internal/runtime/hosts/:hostId/commands/:commandId/complete",
    async (req, res) => {
      res.json(
        await platform.runtime.complete(
          String(req.params.hostId),
          String(req.params.commandId),
          req.body,
        ),
      );
    },
  );
  return router;
}
