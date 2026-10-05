import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authSessions,
  authUsers,
  authVerifications,
  createDb,
  emailDeliveries,
} from "@paperclipai/db";
import { v6FeatureFlagsSchema, V6_FEATURE_KEYS } from "@paperclipai/shared";
import {
  createBetterAuthHandler,
  createBetterAuthInstance,
} from "../auth/better-auth.js";
import type { Config } from "../config.js";
import type { SaasPlatformConfig } from "../saas-platform-config.js";
import { saasAuthDelivery } from "../services/saas/auth-delivery.js";
import { transactionalEmail } from "../services/notifications/transactional-email.js";
import { open } from "../services/saas/crypto.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
const ORIGIN = "https://app.example.test",
  KEY = "a".repeat(64),
  EMAIL = "auth-fixture@example.test",
  PASSWORD = "correct-horse-battery-staple";
(support.supported ? describe : describe.skip)(
  "V6 verified account and native password recovery",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      app: express.Express,
      userId: string;
    const previousSecret = process.env.BETTER_AUTH_SECRET;
    const config = {
      deploymentProfile: "saas",
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: ORIGIN,
      authDisableSignUp: true,
      allowedHostnames: ["app.example.test"],
      port: 3100,
    } as Config;
    beforeAll(async () => {
      process.env.BETTER_AUTH_SECRET =
        "saas-auth-fixture-secret-with-32-characters";
      database = await startEmbeddedPostgresTestDatabase("aw-v6-auth-");
      db = createDb(database.connectionString);
      const platformConfig = {
        environment: "staging",
        mail: { domain: "mail.example.test" },
        outbox: {
          encryptionKey: KEY,
          keyId: "initial",
          previousKeys: {},
          recipientHashKey: "b".repeat(64),
        },
      } as SaasPlatformConfig;
      const origins = {
        primaryAppOrigin: ORIGIN,
        allowedAppOrigins: [ORIGIN],
        legacyOrigins: [],
      };
      const email = transactionalEmail(db, platformConfig, origins, {
        send: async () => {
          throw new Error("No external delivery in auth fixture");
        },
        find: async () => null,
      });
      const flags = v6FeatureFlagsSchema.parse(
        Object.fromEntries(V6_FEATURE_KEYS.map((key) => [key, true])),
      );
      const auth = createBetterAuthInstance(
        db,
        config,
        [ORIGIN],
        saasAuthDelivery(db, email, origins, flags),
      );
      app = express();
      app.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previousSecret;
    }, 30000);
    const post = (path: string, body: unknown) =>
      request(app)
        .post("/api/auth/" + path)
        .set("Origin", ORIGIN)
        .send(body);
    async function action(purpose: string) {
      const [row] = await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.purpose, purpose))
        .orderBy(emailDeliveries.createdAt)
        .limit(1);
      expect(row?.payloadCiphertext).toBeTruthy();
      const payload = open<{ actionPath: string }>(
        row!.payloadCiphertext!,
        KEY,
        "email:" + row!.id,
      );
      return new URL(payload.actionPath, ORIGIN);
    }
    it("registers without a login session and blocks unverified sign in", async () => {
      const signup = await post("sign-up/email", {
        name: "Founder",
        email: EMAIL,
        password: PASSWORD,
      });
      expect(signup.status).toBe(200);
      expect(JSON.stringify(signup.body)).not.toContain("session_token");
      const [user] = await db
        .select()
        .from(authUsers)
        .where(eq(authUsers.email, EMAIL));
      userId = user!.id;
      expect(user!.emailVerified).toBe(false);
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, userId)),
      ).toHaveLength(0);
      const denied = await post("sign-in/email", {
        email: EMAIL,
        password: PASSWORD,
      });
      expect(denied.status).toBe(403);
      const verify = await action("verification");
      expect(verify.origin).toBe(ORIGIN);
      expect(verify.pathname).toBe("/api/auth/verify-email");
      expect(verify.searchParams.get("callbackURL")).toBe(
        ORIGIN + "/saas/welcome",
      );
    });
    it("verifies email without automatic sign in and uses secure host-only session cookies", async () => {
      const verify = await action("verification");
      const verified = await request(app)
        .get(verify.pathname + verify.search)
        .set("Origin", ORIGIN);
      expect([200, 302, 303]).toContain(verified.status);
      const [user] = await db
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, userId));
      expect(user!.emailVerified).toBe(true);
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, userId)),
      ).toHaveLength(0);
      const login = await post("sign-in/email", {
        email: EMAIL,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
      const cookies = login.headers["set-cookie"] as unknown as string[];
      expect(
        cookies.some(
          (cookie) =>
            cookie.includes("Secure") &&
            cookie.includes("HttpOnly") &&
            cookie.includes("SameSite=Lax"),
        ),
      ).toBe(true);
      expect(cookies.some((cookie) => /Domain=/i.test(cookie))).toBe(false);
    });
    it("uses a single-use reset token and revokes every existing session after a successful reset", async () => {
      const requested = await post("request-password-reset", {
        email: EMAIL,
        redirectTo: ORIGIN + "/saas/reset-password",
      });
      expect(requested.status).toBe(200);
      const reset = await action("password_reset"),
        token = reset.pathname.split("/").at(-1)!;
      expect(reset.pathname).toMatch(/^\/api\/auth\/reset-password\//);
      const verification = await action("verification");
      const wrongPurpose = await post("reset-password", {
        token: verification.searchParams.get("token"),
        newPassword: "new-strong-password-001",
      });
      expect(wrongPurpose.status).toBe(400);
      const result = await post("reset-password", {
        token,
        newPassword: "new-strong-password-001",
      });
      expect(result.status).toBe(200);
      expect(
        await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.userId, userId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(authVerifications)
          .where(eq(authVerifications.identifier, "reset-password:" + token)),
      ).toHaveLength(0);
      const replay = await post("reset-password", {
        token,
        newPassword: "other-strong-password-001",
      });
      expect(replay.status).toBe(400);
      const old = await post("sign-in/email", {
        email: EMAIL,
        password: PASSWORD,
      });
      expect(old.status).toBe(401);
      const limited = await post("sign-in/email", {
        email: EMAIL,
        password: "new-strong-password-001",
      });
      expect(limited.status).toBe(429);
      const later = Date.now() + 11000;
      const clock = vi.spyOn(Date, "now").mockReturnValue(later);
      try {
        const next = await post("sign-in/email", {
          email: EMAIL,
          password: "new-strong-password-001",
        });
        expect(next.status).toBe(200);
      } finally {
        clock.mockRestore();
      }
    });
    it("returns the same recovery response for an unknown email and keeps the default SaaS signup closed", async () => {
      const unknown = await post("request-password-reset", {
        email: "unknown@example.test",
        redirectTo: ORIGIN + "/saas/reset-password",
      });
      expect(unknown.status).toBe(200);
      const closed = express();
      closed.all(
        "/api/auth/{*authPath}",
        createBetterAuthHandler(createBetterAuthInstance(db, config, [ORIGIN])),
      );
      const signup = await request(closed)
        .post("/api/auth/sign-up/email")
        .set("Origin", ORIGIN)
        .send({
          name: "Closed",
          email: "closed@example.test",
          password: PASSWORD,
        });
      expect([400, 403]).toContain(signup.status);
      expect(
        await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.email, "closed@example.test")),
      ).toHaveLength(0);
    });
  },
);
