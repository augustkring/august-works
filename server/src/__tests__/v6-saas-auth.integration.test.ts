import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
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
  resolveBetterAuthSession,
} from "../auth/better-auth.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { authRoutes } from "../routes/auth.js";
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
      app.use(actorMiddleware(db, {
        deploymentMode: "authenticated",
        resolveSession: req => resolveBetterAuthSession(auth, req),
      }));
      // Parse only the original preferences route; native auth owns its raw body.
      app.patch("/api/auth/preferences", express.json());
      app.use("/api/auth", authRoutes(db));
      app.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
      app.use(errorHandler);
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
      if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previousSecret;
    }, 30000);
    const post = (path: string, body: unknown, locale?: string) => {
      const call = request(app)
        .post("/api/auth/" + path)
        .set("Origin", ORIGIN);
      if (locale) call.set("X-Blentera-Locale", locale);
      return call.send(body);
    };
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
    async function mail(purpose: string) {
      const [row] = await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.purpose, purpose))
        .orderBy(emailDeliveries.createdAt)
        .limit(1);
      expect(row?.payloadCiphertext).toBeTruthy();
      return open<{ subject: string; message: string; actionPath: string }>(
        row!.payloadCiphertext!,
        KEY,
        "email:" + row!.id,
      );
    }
    it("registers without a login session and blocks unverified sign in", async () => {
      const signup = await post("sign-up/email", {
        name: "Founder",
        email: EMAIL,
        password: PASSWORD,
      }, "da");
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
      const verificationMail = await mail("verification");
      expect(verificationMail.subject).toContain("Bekræft din e-mailadresse til");
      expect(verificationMail.message).toContain("Bekræft din e-mail");
      expect(verify.origin).toBe(ORIGIN);
      expect(verify.pathname).toBe("/api/auth/verify-email");
      expect(verify.searchParams.get("callbackURL")).toBe(
        ORIGIN + "/saas/welcome?locale=da",
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
      const cookie = cookies.filter(value => value.includes("session_token="))
        .map(value => value.split(";")[0]!).join("; ");
      const preferences = await request(app).get(`/api/auth/preferences?expectedUserId=${encodeURIComponent(userId)}`)
        .set("Cookie", cookie);
      expect(preferences.status).toBe(200);
      expect(preferences.body).toEqual({ keyboardShortcuts: false, locale: null });
      const saved = await request(app).patch("/api/auth/preferences").set("Cookie", cookie)
        .send({ expectedUserId: userId, locale: "en" });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ keyboardShortcuts: false, locale: "en" });
      const switched = await request(app).patch("/api/auth/preferences").set("Cookie", cookie)
        .send({ expectedUserId: "different-account", locale: "da" });
      expect(switched.status).toBe(401);
      const nativeWrite = await request(app).post("/api/auth/update-user").set("Origin", ORIGIN)
        .set("Cookie", cookie).send({ locale: "da" });
      expect(nativeWrite.status).toBe(400);
      await expect(db.execute(sql`update ${authUsers} set locale = 'fr' where id = ${userId}`))
        .rejects.toMatchObject({ cause: { code: "23514" } });
      const [persisted] = await db.select({ locale: authUsers.locale, keyboardShortcuts: authUsers.keyboardShortcuts })
        .from(authUsers).where(eq(authUsers.id, userId));
      expect(persisted).toEqual({ locale: "en", keyboardShortcuts: false });
    });
    it("uses a single-use reset token and revokes every existing session after a successful reset", async () => {
      const requested = await post("request-password-reset", {
        email: EMAIL,
        redirectTo: ORIGIN + "/saas/reset-password",
      }, "da");
      expect(requested.status).toBe(200);
      const reset = await action("password_reset"),
        token = reset.pathname.split("/").at(-1)!;
      const resetMail = await mail("password_reset");
      // The persisted account choice takes precedence over the Danish request.
      expect(resetMail.subject).toContain("Reset your");
      expect(resetMail.message).toContain("Use this link to reset your password");
      expect(reset.pathname).toMatch(/^\/api\/auth\/reset-password\//);
      expect(reset.searchParams.get("callbackURL")).toBe(
        ORIGIN + "/saas/reset-password?locale=en",
      );
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
