import express from "express";
import { createDb } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { companyRoutes } from "../../routes/companies.js";
import { errorHandler } from "../../middleware/error-handler.js";

async function main() {
  const connectionString = process.env.PAPERCLIP_TEST_DATABASE_URL;
  const companyId = process.env.PAPERCLIP_TEST_COMPANY_ID;
  const userId = process.env.PAPERCLIP_TEST_USER_ID;
  const sessionId = process.env.PAPERCLIP_TEST_SESSION_ID;
  if (!connectionString || !companyId || !userId || !sessionId) {
    throw new Error("Worker test configuration is incomplete");
  }
  const db = createDb(connectionString, { maxConnections: 8 });
  const actor: AuthorizationActor = {
    type: "board",
    source: "session",
    userId,
    sessionId,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: false,
  };
  const app = express();
  app.use(express.json());
  // The worker uses the authenticated actor produced at the application
  // boundary in production; this process fixture holds that actor fixed while
  // the route and all domain owners below remain real.
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes(db));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string" || !process.send) {
      throw new Error("Worker test server did not expose an IPC address");
    }
    process.send({ type: "ready", port: address.port });
  });
}

void main();
