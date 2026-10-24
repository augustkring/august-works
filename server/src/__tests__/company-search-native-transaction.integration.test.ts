import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authSessions,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issues,
} from "@paperclipai/db";
import type { CompanySearchQuery, CompanySearchExtractQuery } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/error-handler.js";
import { authorizationService } from "../services/authorization.js";
import { companySearchService } from "../services/company-search.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("company search native transaction credential lifetime", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let userId: string;
  const marker = `native-search-${randomUUID()}`;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("company-search-native-tx-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    userId = randomUUID();
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Native search fixture", issuePrefix: `NS${companyId.slice(0, 6)}` });
    await db.insert(authUsers).values({ id: userId, name: "Search reader", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "member", status: "active" });
    await db.insert(issues).values({ companyId, title: marker, description: `Extractable ${marker}`, createdByUserId: userId, responsibleUserId: userId });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  async function sessionActor(originalDeadline: Date, storedExpiry = new Date(Date.now() + 60_000)) {
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now, expiresAt: storedExpiry });
    return { type: "board" as const, source: "session" as const, userId, sessionId, companyIds: [companyId],
      authenticatedCredentialExpiresAt: originalDeadline.getTime() };
  }

  function appFor(actor: Awaited<ReturnType<typeof sessionActor>>, delayPastExpiry: boolean) {
    const app = express();
    // Structural carrier after authentication; the session, user and membership are persisted above.
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", issueRoutes(db, {} as never, {
      searchService: (queryDb: Db) => {
        const service = companySearchService(queryDb);
        const delay = async () => {
          if (delayPastExpiry) await queryDb.execute(sql`select pg_sleep(2.2)`);
        };
        return {
          search: async (id: string, query: CompanySearchQuery, options?: Parameters<typeof service.search>[2]) => {
            await delay();
            return service.search(id, query, options);
          },
          extract: async (id: string, query: CompanySearchExtractQuery, options?: Parameters<typeof service.extract>[2]) => {
            await delay();
            return service.extract(id, query, options);
          },
        };
      },
    }));
    app.use(errorHandler);
    return request(app);
  }

  const requests = [
    ["interactive search", (http: ReturnType<typeof request>) => http.get(`/api/companies/${companyId}/search`).query({ q: marker }), marker],
    ["extract search", (http: ReturnType<typeof request>) => http.get(`/api/companies/${companyId}/search/extract`).query({ contains: marker }), marker],
  ] as const;

  it.each(requests)("returns %s results for a current session", async (_name, send, expected) => {
    const actor = await sessionActor(new Date(Date.now() + 60_000));
    const response = await send(appFor(actor, false)).expect(200);
    expect(response.body.results).toHaveLength(1);
    expect(JSON.stringify(response.body.results)).toContain(expected);
  });

  it.each(requests)("discards %s results when its original deadline expires during the database read", async (_name, send) => {
    const actor = await sessionActor(new Date(Date.now() + 1_200));
    const response = await send(appFor(actor, true)).expect(403);
    expect(JSON.stringify(response.body)).not.toContain(marker);
  }, 10_000);

  it("keeps the company search Source scope narrow and invalidates its owner after the callback", async () => {
    const actor = await sessionActor(new Date(Date.now() + 60_000));
    type Owner = Parameters<Parameters<ReturnType<typeof authorizationService>["withReadCompany"]>[1]>[0];
    let escaped!: Owner;
    await db.transaction(async tx => authorizationService(tx).withReadCompany(companyId, async owner => {
      escaped = owner;
      const companyRead = await owner.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } });
      const issueRead = await owner.decide({ actor, action: "issue:read", resource: { type: "issue", companyId, issueId: randomUUID() } });
      expect(companyRead.allowed).toBe(true);
      expect(issueRead).toMatchObject({ allowed: false, reason: "deny_scope" });
    }));
    await expect(escaped.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } }))
      .rejects.toThrow("Native Source read scope has ended");
  });
});
