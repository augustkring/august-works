import express, { type RequestHandler } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { authUsers, companyMemberships, principalPermissionGrants, projects, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { errorHandler } from "../../middleware/index.js";
import { projectRoutes } from "../../routes/projects.js";
import { grantsForHumanRole } from "../../services/company-member-roles.js";
import { seedNativePasskeySession } from "./native-authentication-fixtures.js";

export async function seedCurrentHumanSourceActor(db: Db, companyIds: string[], userId = "local-board"): Promise<AuthorizationActor> {
  const now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Current Human source owner", email: `${userId}@fixture.invalid`, emailVerified: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
  for (const companyId of companyIds) {
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId, principalType: "user", principalId: userId, ...grant }))).onConflictDoNothing();
  }
  return { type: "board", source: "session", userId, sessionId: await seedNativePasskeySession(db, userId), companyIds };
}

export async function createCanonicalHumanProject(db: Db, companyId: string, actor: AuthorizationActor, name: string) {
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => {
    req.actor = { ...actor, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    next();
  }) as RequestHandler);
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  const created = await request(app).post(`/api/companies/${companyId}/projects`).send({ name });
  if (created.status !== 201 || typeof created.body.id !== "string") throw new Error(`Canonical Human Project fixture creation failed: ${created.status}`);
  return (await db.select().from(projects).where(eq(projects.id, created.body.id)))[0]!;
}
