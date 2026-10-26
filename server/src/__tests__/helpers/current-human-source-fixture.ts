import express, { type RequestHandler } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { authUsers, companyMemberships, principalPermissionGrants, projects, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { errorHandler } from "../../middleware/index.js";
import { projectRoutes } from "../../routes/projects.js";
import { grantsForHumanRole } from "../../services/company-member-roles.js";
import { seedNativePasskeySession } from "./native-authentication-fixtures.js";

function assertCanonicalHumanSessionActor(actor: AuthorizationActor): asserts actor is AuthorizationActor & {
  type: "board"; source: "session"; userId: string; sessionId: string;
} {
  if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId)
    throw new Error("Canonical Human project fixture requires a seeded board session actor");
}

export async function seedCurrentHumanSourceActor(db: Db, companyIds: string[], userId = "local-board"): Promise<AuthorizationActor> {
  const now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Current Human source owner", email: `${userId}@fixture.invalid`, emailVerified: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
  for (const companyId of companyIds) {
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId, principalType: "user", principalId: userId, ...grant }))).onConflictDoNothing();
  }
  return { type: "board", source: "session", userId, sessionId: await seedNativePasskeySession(db, userId), companyIds };
}

export async function createCanonicalHumanProject(db: Db, companyId: string, actor: AuthorizationActor, name: string,
  options: { description?: string; status?: string } = {}) {
  assertCanonicalHumanSessionActor(actor);
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => {
    req.actor = { ...actor, userId: actor.userId ?? undefined, agentId: actor.agentId ?? undefined,
      companyId: actor.companyId ?? undefined, keyId: actor.keyId ?? undefined,
      authenticatedKeyHash: actor.authenticatedKeyHash ?? undefined,
      authenticatedCredentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? undefined,
      keyScope: actor.keyScope ?? undefined, runId: actor.runId ?? undefined,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  }) as RequestHandler);
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  const created = await request(app).post(`/api/companies/${companyId}/projects`).send({ name, ...options });
  if (created.status !== 201 || typeof created.body.id !== "string") throw new Error(`Canonical Human Project fixture creation failed: ${created.status}`);
  return (await db.select().from(projects).where(eq(projects.id, created.body.id)))[0]!;
}

export async function updateCanonicalHumanProject(db: Db, companyId: string, actor: AuthorizationActor, projectId: string,
  updates: { executionWorkspacePolicy: unknown }) {
  assertCanonicalHumanSessionActor(actor);
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => {
    req.actor = { ...actor, userId: actor.userId ?? undefined, agentId: actor.agentId ?? undefined,
      companyId: actor.companyId ?? undefined, keyId: actor.keyId ?? undefined,
      authenticatedKeyHash: actor.authenticatedKeyHash ?? undefined,
      authenticatedCredentialExpiresAt: actor.authenticatedCredentialExpiresAt ?? undefined,
      keyScope: actor.keyScope ?? undefined, runId: actor.runId ?? undefined,
      companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  }) as RequestHandler);
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  const updated = await request(app).patch(`/api/projects/${projectId}`).send(updates);
  if (updated.status !== 200) {
    const message = typeof updated.body?.error === "string" ? updated.body.error : "unspecified route error";
    const code = typeof updated.body?.code === "string" ? ` (${updated.body.code})` : "";
    throw new Error(`Canonical Human Project fixture update failed: ${updated.status}${code}: ${message}`);
  }
  return (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
}
