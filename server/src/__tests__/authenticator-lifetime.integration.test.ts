import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accountDeletionOperations,
  authAccounts,
  authPasskeys,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
} from "@paperclipai/db";
import { assertConfiguredOperatorAuthentication, assertHumanAuthentication, assertPinnedAuthenticationDeadline } from "../auth/authenticator-assurance.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// These tests exercise native PostgreSQL lifetime constraints only. Provider
// ciphertexts, password bytes, and passkey public-key bytes below are structural
// SQL fixtures; no Better Auth ceremony or factor verification is performed.
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeNative = embeddedPostgresSupport.supported ? describe : describe.skip;

describeNative("native authenticator lifetime constraints", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-authenticator-lifetime-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
  }, 30_000);

  async function makeUser() {
    const id = randomUUID();
    const [user] = await db.insert(authUsers).values({
      id,
      name: "Native lifetime fixture",
      email: `${id}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return user!;
  }

  async function generation(userId: string) {
    const [user] = await db.select({ version: authUsers.authenticatorVersion })
      .from(authUsers).where(eq(authUsers.id, userId));
    return user!.version;
  }

  async function makeSession(userId: string, proof?: "password" | "totp" | "backup_code" | "passkey") {
    const now = new Date();
    const version = await generation(userId);
    const [session] = await db.insert(authSessions).values({
      id: randomUUID(),
      userId,
      token: randomUUID(),
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      ...(proof ? { authenticationMethod: proof, authenticatedAt: now, authenticatorVersion: version } : {}),
    }).returning();
    return session!;
  }

  async function makeSqlClockSession(
    userId: string,
    proof: "password" | "totp" | "backup_code" | "passkey",
    options: { ageSeconds?: number; expiresInSeconds?: number; versionOffset?: number } = {},
  ) {
    const version = await generation(userId);
    const ageSeconds = options.ageSeconds ?? 0;
    const expiresInSeconds = options.expiresInSeconds ?? 3600;
    const rows = await db.execute<{ id: string }>(sql`
      insert into "session" (
        id, user_id, token, created_at, updated_at, expires_at,
        authentication_method, authenticated_at, authenticator_version
      ) values (
        ${randomUUID()}, ${userId}, ${randomUUID()},
        clock_timestamp() - ${ageSeconds} * interval '1 second',
        clock_timestamp() - ${ageSeconds} * interval '1 second',
        clock_timestamp() + ${expiresInSeconds} * interval '1 second',
        ${proof}, clock_timestamp() - ${ageSeconds} * interval '1 second',
        ${version + (options.versionOffset ?? 0)}
      ) returning id
    `);
    return rows[0]!;
  }

  function sessionActor(userId: string, sessionId: string): AuthorizationActor {
    return { type: "board", source: "session", userId, sessionId };
  }

  async function expectAssuranceDenied(actor: AuthorizationActor, options = {
    requireRecent: true,
    phishingResistant: false,
  }) {
    await expect(assertHumanAuthentication(db, actor, options)).rejects.toMatchObject({
      status: 403,
      details: { code: "recent_authentication_required" },
    });
  }

  async function makeVerification(userId: string, value = userId) {
    const now = new Date();
    const [verification] = await db.insert(authVerifications).values({
      id: randomUUID(),
      identifier: `native-factor-fixture-${randomUUID()}`,
      value,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return verification!;
  }

  async function makeFactor(userId: string, verified = true) {
    const [factor] = await db.insert(authTwoFactors).values({
      id: randomUUID(),
      userId,
      secret: `fixture-encrypted-secret-${randomUUID()}`,
      backupCodes: `fixture-encrypted-backup-codes-${randomUUID()}`,
      verified,
    }).returning();
    return factor!;
  }

  async function makePasskey(userId: string, counter = 1) {
    const [passkey] = await db.insert(authPasskeys).values({
      id: randomUUID(),
      userId,
      name: "Native passkey fixture",
      publicKey: `fixture-public-key-${randomUUID()}`,
      credentialID: randomUUID(),
      counter,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
    }).returning();
    return passkey!;
  }

  async function makeCredentialAccount(userId: string, email: string, password = "fixture-password-hash-v1") {
    const now = new Date();
    const [account] = await db.insert(authAccounts).values({
      id: randomUUID(),
      issuer: "local:credential",
      accountId: email,
      providerId: "credential",
      userId,
      password,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return account!;
  }

  it("keeps legacy session proof wholly unknown and rejects partial proof tuples", async () => {
    const user = await makeUser();
    const legacy = await makeSession(user.id);
    expect(legacy).toMatchObject({ authenticationMethod: null, authenticatedAt: null, authenticatorVersion: null });
    await expectAssuranceDenied(sessionActor(user.id, legacy.id));

    const now = new Date();
    await expect(db.insert(authSessions).values({
      id: randomUUID(), userId: user.id, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000), authenticationMethod: "password",
    })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(authSessions).values({
      id: randomUUID(), userId: user.id, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000), authenticatedAt: now,
    })).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("clears old proof for pending factor setup, then activation revokes sessions and pending verifications", async () => {
    const user = await makeUser();
    const session = await makeSession(user.id, "password");
    await makeFactor(user.id, false);
    const [pending] = await db.select().from(authSessions).where(eq(authSessions.id, session.id));
    expect(await generation(user.id)).toBe(1);
    expect(pending).toMatchObject({ authenticationMethod: null, authenticatedAt: null, authenticatorVersion: null });
    expect(pending).toBeDefined();

    const verification = await makeVerification(user.id);
    await db.update(authUsers).set({ twoFactorEnabled: true }).where(eq(authUsers.id, user.id));
    expect(await generation(user.id)).toBe(2);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, user.id))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, verification.id))).toEqual([]);
  });

  it("consumes an exact backup-code bundle once and revokes enabled-user sessions", async () => {
    const user = await makeUser();
    const factor = await makeFactor(user.id);
    await db.update(authUsers).set({ twoFactorEnabled: true }).where(eq(authUsers.id, user.id));
    const session = await makeSession(user.id, "totp");
    await makeVerification(user.id);
    const before = await generation(user.id);
    const consumed = await db.update(authTwoFactors).set({ backupCodes: "fixture-encrypted-backup-codes-after" })
      .where(and(eq(authTwoFactors.id, factor.id), eq(authTwoFactors.backupCodes, factor.backupCodes)))
      .returning({ id: authTwoFactors.id });
    const duplicate = await db.update(authTwoFactors).set({ backupCodes: "fixture-encrypted-backup-codes-after" })
      .where(and(eq(authTwoFactors.id, factor.id), eq(authTwoFactors.backupCodes, factor.backupCodes)))
      .returning({ id: authTwoFactors.id });

    expect(consumed).toHaveLength(1);
    expect(duplicate).toHaveLength(0);
    expect(await generation(user.id)).toBe(before + 1);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toEqual([]);
  });

  it("accepts bounded passkey counters, preserves harmless updates, and protects the final key", async () => {
    const user = await makeUser();
    const passkey = await makePasskey(user.id, 12);
    expect(await generation(user.id)).toBe(1);
    const session = await makeSession(user.id, "passkey");
    const before = await generation(user.id);
    const [advanced] = await db.update(authPasskeys).set({ name: "Renamed passkey", counter: 13 })
      .where(eq(authPasskeys.id, passkey.id)).returning();
    expect(advanced).toMatchObject({ name: "Renamed passkey", counter: 13 });
    expect(await generation(user.id)).toBe(before);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toHaveLength(1);
    const [counterOnlyAdvance] = await db.update(authPasskeys).set({ counter: 14 })
      .where(eq(authPasskeys.id, passkey.id)).returning();
    expect(counterOnlyAdvance).toMatchObject({ name: "Renamed passkey", counter: 14 });
    expect(await generation(user.id)).toBe(before);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toHaveLength(1);

    await expect(db.update(authPasskeys).set({ counter: 13 }).where(eq(authPasskeys.id, passkey.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.update(authPasskeys).set({ publicKey: "rebound-public-key-fixture" }).where(eq(authPasskeys.id, passkey.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    const otherUser = await makeUser();
    await expect(db.update(authPasskeys).set({ userId: otherUser.id }).where(eq(authPasskeys.id, passkey.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    const [stillBound] = await db.select().from(authPasskeys).where(eq(authPasskeys.id, passkey.id));
    expect(stillBound).toMatchObject({ userId: user.id, publicKey: passkey.publicKey, counter: 14 });

    const maxCounterUser = await makeUser();
    const maxCounterPasskey = await makePasskey(maxCounterUser.id, 4_294_967_295);
    expect(maxCounterPasskey.counter).toBe(4_294_967_295);

    const passwordless = await makeUser();
    const onlyKey = await makePasskey(passwordless.id);
    await expect(db.delete(authPasskeys).where(eq(authPasskeys.id, onlyKey.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });

    const operator = await makeUser();
    await makeCredentialAccount(operator.id, operator.email);
    await db.update(authUsers).set({ phishingResistantRequired: true }).where(eq(authUsers.id, operator.id));
    const beforeKeyEnrollment = await generation(operator.id);
    const first = await makePasskey(operator.id);
    const last = await makePasskey(operator.id);
    expect(await generation(operator.id)).toBe(beforeKeyEnrollment + 2);
    const beforeRemoval = await generation(operator.id);
    expect(await db.delete(authPasskeys).where(eq(authPasskeys.id, first.id)).returning({ id: authPasskeys.id }))
      .toHaveLength(1);
    expect(await generation(operator.id)).toBe(beforeRemoval + 1);
    await expect(db.delete(authPasskeys).where(eq(authPasskeys.id, last.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await generation(operator.id)).toBe(beforeRemoval + 1);
    const [retainedOperator] = await db.select().from(authUsers).where(eq(authUsers.id, operator.id));
    expect(retainedOperator!.phishingResistantRequired).toBe(true);
  });

  it("replaces native credential proof but preserves generation for no-op password and locale updates", async () => {
    const user = await makeUser();
    let session = await makeSession(user.id, "password");
    let verification = await makeVerification(user.id);
    const account = await makeCredentialAccount(user.id, user.email);
    let before = await generation(user.id);
    expect(before).toBe(1);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, verification.id))).toEqual([]);

    session = await makeSession(user.id, "password");
    verification = await makeVerification(user.id);
    await db.update(authAccounts).set({ password: "fixture-password-hash-v2" }).where(eq(authAccounts.id, account.id));
    before += 1;
    expect(await generation(user.id)).toBe(before);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, verification.id))).toEqual([]);

    session = await makeSession(user.id, "password");
    verification = await makeVerification(user.id);
    await db.update(authAccounts).set({ password: "fixture-password-hash-v2" }).where(eq(authAccounts.id, account.id));
    await db.update(authUsers).set({ locale: "da" }).where(eq(authUsers.id, user.id));
    expect(await generation(user.id)).toBe(before);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toHaveLength(1);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, verification.id))).toHaveLength(1);

    await expect(db.update(authUsers).set({ authenticatorVersion: before - 1 }).where(eq(authUsers.id, user.id)))
      .rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it.each(["credential rotation", "factor activation", "user deletion"])(
    "erases native JSON challenges on %s while preserving unrelated verification data", async operation => {
      const user = await makeUser();
      const credential = await makeCredentialAccount(user.id, user.email);
      const other = await makeUser();
      const owned = await Promise.all(["registration", "authentication"].map(type => makeVerification(user.id,
        JSON.stringify({ type, expectedChallenge: randomUUID(),
          userData: { id: user.id, name: user.email, displayName: "Native challenge fixture" }, context: null }))));
      const unrelated = await Promise.all([
        makeVerification(other.id, JSON.stringify({ type: "registration", expectedChallenge: randomUUID(),
          userData: { id: other.id, name: other.email }, context: null })),
        makeVerification(other.id, "not JSON {"),
        makeVerification(other.id, JSON.stringify({ type: "other", userData: { id: user.id } })),
        makeVerification(other.id, JSON.stringify({ type: "registration", userData: { id: [user.id] } })),
      ]);
      if (operation === "credential rotation") await db.update(authAccounts).set({ password: "fixture-new-password-hash" })
        .where(eq(authAccounts.id, credential.id));
      else if (operation === "factor activation") await db.update(authUsers).set({ twoFactorEnabled: true })
        .where(eq(authUsers.id, user.id));
      else await db.delete(authUsers).where(eq(authUsers.id, user.id));
      for (const row of owned) expect(await db.select().from(authVerifications).where(eq(authVerifications.id, row.id))).toEqual([]);
      for (const row of unrelated) expect(await db.select().from(authVerifications).where(eq(authVerifications.id, row.id))).toHaveLength(1);
    });

  it("fences native JSON challenge writes against absent or erased owners and physical user locks", async () => {
    const user = await makeUser();
    const value = JSON.stringify({ type: "registration", expectedChallenge: randomUUID(),
      userData: { id: user.id, name: user.email }, context: null });
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holding = db.transaction(async tx => {
      await tx.execute(sql`select id from "user" where id=${user.id} for update`);
      locked(); await gate;
    });
    await ready;
    try { await expect(makeVerification(user.id, value)).rejects.toMatchObject({ cause: { code: "55P03" } }); }
    finally { release(); await holding; }
    const live = await makeVerification(user.id, value);
    await db.insert(accountDeletionOperations).values({ userId: user.id,
      idempotencyKey: randomUUID(), status: "completed", completedAt: new Date() });
    await expect(makeVerification(user.id, value)).rejects.toMatchObject({ cause: { code: "23503" } });
    await db.delete(authUsers).where(eq(authUsers.id, user.id));
    expect(await db.select().from(authVerifications).where(eq(authVerifications.id, live.id))).toEqual([]);
    await expect(makeVerification(user.id, value)).rejects.toMatchObject({ cause: { code: "23503" } });
    // Anonymous discoverable authentication carries no account identity yet.
    const anonymous = await makeVerification("", JSON.stringify({ type: "authentication",
      expectedChallenge: randomUUID(), userData: { id: "" } }));
    expect(anonymous.value).toContain('"id":""');
  });

  it("cascades user deletion across native factor, passkey, session, and verification rows", async () => {
    const user = await makeUser();
    await makeFactor(user.id);
    await makePasskey(user.id);
    await makeSession(user.id);
    await makeVerification(user.id);
    await db.delete(authUsers).where(eq(authUsers.id, user.id));
    expect(await db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, user.id))).toEqual([]);
    expect(await db.select().from(authPasskeys).where(eq(authPasskeys.userId, user.id))).toEqual([]);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, user.id))).toEqual([]);
    expect(await db.select().from(authVerifications).where(eq(authVerifications.value, user.id))).toEqual([]);
  });

  it("requires matching native human, session, credential, factor, and passkey evidence", async () => {
    const passwordUser = await makeUser();
    await makeCredentialAccount(passwordUser.id, passwordUser.email);
    const passwordSession = await makeSqlClockSession(passwordUser.id, "password");
    const passwordActor = sessionActor(passwordUser.id, passwordSession.id);
    await expect(assertHumanAuthentication(db, passwordActor, {
      requireRecent: true, phishingResistant: false,
    })).resolves.toMatchObject({ method: "password", authenticatorVersion: 1 });
    expect((await assertHumanAuthentication(db, passwordActor, {
      requireRecent: true, phishingResistant: false,
    })).authenticatedAt).toBeInstanceOf(Date);
    await expectAssuranceDenied({ ...passwordActor, userId: (await makeUser()).id });
    await expectAssuranceDenied({ ...passwordActor, source: "board_key" });
    await expectAssuranceDenied({ ...passwordActor, type: "agent" });

    const noCredentialUser = await makeUser();
    const noCredentialSession = await makeSqlClockSession(noCredentialUser.id, "password");
    await expectAssuranceDenied(sessionActor(noCredentialUser.id, noCredentialSession.id));

    const mismatchedEpochUser = await makeUser();
    await makeCredentialAccount(mismatchedEpochUser.id, mismatchedEpochUser.email);
    const mismatchedEpoch = await makeSqlClockSession(mismatchedEpochUser.id, "password", { versionOffset: 1 });
    await expectAssuranceDenied(sessionActor(mismatchedEpochUser.id, mismatchedEpoch.id));

    const expiredUser = await makeUser();
    await makeCredentialAccount(expiredUser.id, expiredUser.email);
    const expired = await makeSqlClockSession(expiredUser.id, "password", { expiresInSeconds: -1 });
    await expectAssuranceDenied(sessionActor(expiredUser.id, expired.id), {
      requireRecent: false, phishingResistant: false,
    });

    const factorUser = await makeUser();
    const unverifiedFactor = await makeFactor(factorUser.id, false);
    await db.update(authUsers).set({ twoFactorEnabled: true }).where(eq(authUsers.id, factorUser.id));
    const passwordAfterEnable = await makeSqlClockSession(factorUser.id, "password");
    await expectAssuranceDenied(sessionActor(factorUser.id, passwordAfterEnable.id));
    const unverifiedTotp = await makeSqlClockSession(factorUser.id, "totp");
    await expectAssuranceDenied(sessionActor(factorUser.id, unverifiedTotp.id));
    await db.update(authTwoFactors).set({ verified: true }).where(eq(authTwoFactors.id, unverifiedFactor.id));
    const verifiedTotp = await makeSqlClockSession(factorUser.id, "totp");
    await expect(assertHumanAuthentication(db, sessionActor(factorUser.id, verifiedTotp.id), {
      requireRecent: true, phishingResistant: false,
    })).resolves.toMatchObject({ method: "totp" });

    const missingFactorUser = await makeUser();
    await db.update(authUsers).set({ twoFactorEnabled: true }).where(eq(authUsers.id, missingFactorUser.id));
    const missingFactorTotp = await makeSqlClockSession(missingFactorUser.id, "totp");
    await expectAssuranceDenied(sessionActor(missingFactorUser.id, missingFactorTotp.id));
    const missingFactorPasskey = await makePasskey(missingFactorUser.id);
    const missingFactorPasskeySession = await makeSqlClockSession(missingFactorUser.id, "passkey");
    expect(missingFactorPasskey.userId).toBe(missingFactorUser.id);
    await expect(assertHumanAuthentication(db, sessionActor(missingFactorUser.id, missingFactorPasskeySession.id), {
      requireRecent: true, phishingResistant: false,
    })).resolves.toMatchObject({ method: "passkey" });
    await makeFactor(missingFactorUser.id, true);
    const verifiedFactorPasskeySession = await makeSqlClockSession(missingFactorUser.id, "passkey");
    await expect(assertHumanAuthentication(db, sessionActor(missingFactorUser.id, verifiedFactorPasskeySession.id), {
      requireRecent: true, phishingResistant: false,
    })).resolves.toMatchObject({ method: "passkey" });

    const passkeyUser = await makeUser();
    const passkey = await makePasskey(passkeyUser.id);
    const oldPasskeySession = await makeSqlClockSession(passkeyUser.id, "passkey", { ageSeconds: 301 });
    const oldPasskeyActor = sessionActor(passkeyUser.id, oldPasskeySession.id);
    await expectAssuranceDenied(oldPasskeyActor, { requireRecent: true, phishingResistant: false });
    await expect(assertHumanAuthentication(db, oldPasskeyActor, {
      requireRecent: false, phishingResistant: false,
    })).resolves.toMatchObject({ method: "passkey" });
    const notResistant = await makeSqlClockSession(passkeyUser.id, "password");
    await makeCredentialAccount(passkeyUser.id, passkeyUser.email);
    // Creating credentials revokes existing proof; the newly inserted proof below
    // has the post-change generation and is still rejected by phishing policy.
    const resistantPassword = await makeSqlClockSession(passkeyUser.id, "password");
    expect(notResistant.id).not.toBe(resistantPassword.id);
    await expectAssuranceDenied(sessionActor(passkeyUser.id, resistantPassword.id), {
      requireRecent: true, phishingResistant: true,
    });
    expect(passkey.userId).toBe(passkeyUser.id);

    const operator = await makeUser();
    await makeCredentialAccount(operator.id, operator.email);
    await db.update(authUsers).set({ phishingResistantRequired: true }).where(eq(authUsers.id, operator.id));
    const operatorPassword = await makeSqlClockSession(operator.id, "password");
    await expectAssuranceDenied(sessionActor(operator.id, operatorPassword.id), {
      requireRecent: true, phishingResistant: false,
    });
    await makePasskey(operator.id);
    const operatorPasskey = await makeSqlClockSession(operator.id, "passkey");
    await expect(assertHumanAuthentication(db, sessionActor(operator.id, operatorPasskey.id), {
      requireRecent: true, phishingResistant: false,
    })).resolves.toMatchObject({ method: "passkey" });
  });

  it("requires configured operators to present current verified native passkey proof", async () => {
    const user = await makeUser();
    await makeCredentialAccount(user.id, user.email);
    await makePasskey(user.id);
    const session = await makeSqlClockSession(user.id, "passkey");
    const actor = sessionActor(user.id, session.id);
    const allowlist = [user.id];
    const check = (candidate = actor, recent = true) => db.transaction(tx =>
      assertConfiguredOperatorAuthentication(tx, candidate, allowlist, { requireRecent: recent }));
    await expect(check()).rejects.toMatchObject({ status: 403 });
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, user.id));
    await expect(check()).resolves.toMatchObject({ method: "passkey" });
    await expect(db.transaction(tx => assertConfiguredOperatorAuthentication(tx, actor, [])))
      .rejects.toMatchObject({ status: 403 });
    await expect(check({ ...actor, sessionId: undefined })).rejects.toMatchObject({ status: 403 });
    await expect(check({ ...actor, source: "board_key" })).rejects.toMatchObject({ status: 403 });
    await expect(check({ ...actor, source: "local_implicit" })).rejects.toMatchObject({ status: 403 });
    const password = await makeSqlClockSession(user.id, "password");
    await expect(check(sessionActor(user.id, password.id))).rejects.toMatchObject({ status: 403 });
    const old = await makeSqlClockSession(user.id, "passkey", { ageSeconds: 301 });
    await expect(check(sessionActor(user.id, old.id))).rejects.toMatchObject({ status: 403 });
    await expect(check(sessionActor(user.id, old.id), false)).resolves.toMatchObject({ method: "passkey" });
    const expired = await makeSqlClockSession(user.id, "passkey", { expiresInSeconds: -1 });
    await expect(check(sessionActor(user.id, expired.id), false)).rejects.toMatchObject({ status: 403 });
    const wrongGeneration = await makeSqlClockSession(user.id, "passkey", { versionOffset: 1 });
    await expect(check(sessionActor(user.id, wrongGeneration.id))).rejects.toMatchObject({ status: 403 });
    await db.delete(authSessions).where(eq(authSessions.id, session.id));
    await expect(check()).rejects.toMatchObject({ status: 403 });
  });

  it("retains the originally verified request deadline when the stored session has been extended", async () => {
    const user = await makeUser();
    await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, user.id));
    await makePasskey(user.id);
    const session = await makeSqlClockSession(user.id, "passkey", { expiresInSeconds: 2 });
    const [verified] = await db.select({ expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.id, session.id));
    const actor = { ...sessionActor(user.id, session.id), authenticatedCredentialExpiresAt: verified!.expiresAt.getTime() };
    await db.execute(sql`update "session" set expires_at=clock_timestamp()+interval '1 hour' where id=${session.id}`);

    await expect(db.transaction(async tx => {
      const proof = await assertConfiguredOperatorAuthentication(tx, actor, [user.id]);
      await tx.update(authUsers).set({ name: "Must roll back after the original deadline" }).where(eq(authUsers.id, user.id));
      await tx.execute(sql`select pg_sleep(2.2)`);
      await assertPinnedAuthenticationDeadline(tx, proof);
    })).rejects.toMatchObject({ status: 403, details: { code: "recent_authentication_required" } });
    const [unchanged] = await db.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, user.id));
    expect(unchanged!.name).toBe(user.name);
    await expectAssuranceDenied(actor);

    // A new request verified against the later stored deadline still works.
    const [current] = await db.select({ expiresAt: authSessions.expiresAt }).from(authSessions).where(eq(authSessions.id, session.id));
    const currentActor = { ...sessionActor(user.id, session.id), authenticatedCredentialExpiresAt: current!.expiresAt.getTime() };
    await expect(db.transaction(tx => assertConfiguredOperatorAuthentication(tx, currentActor, [user.id])))
      .resolves.toMatchObject({ method: "passkey", credentialExpiresAt: current!.expiresAt });
    for (const invalid of [NaN, Infinity, -Infinity])
      await expectAssuranceDenied({ ...currentActor, authenticatedCredentialExpiresAt: invalid });
  });

  it("holds native session and user rows through assurance checks", async () => {
    const user = await makeUser();
    await makeCredentialAccount(user.id, user.email);
    const passkey = await makePasskey(user.id);
    const session = await makeSqlClockSession(user.id, "passkey");
    const actor = sessionActor(user.id, session.id);
    let checked = false;
    await db.transaction(async (tx) => {
      await expect(assertHumanAuthentication(tx, actor, {
        requireRecent: true, phishingResistant: true,
      })).resolves.toMatchObject({ method: "passkey" });
      checked = true;
      await expect(db.delete(authPasskeys).where(eq(authPasskeys.id, passkey.id)))
        .rejects.toMatchObject({ cause: { code: "55P03" } });
      expect(await tx.select().from(authPasskeys).where(eq(authPasskeys.id, passkey.id))).toHaveLength(1);
      expect(await tx.select().from(authSessions).where(eq(authSessions.id, session.id))).toHaveLength(1);
    });
    expect(checked).toBe(true);
    expect(await db.delete(authPasskeys).where(eq(authPasskeys.id, passkey.id)).returning({ id: authPasskeys.id }))
      .toHaveLength(1);
    expect(await db.select().from(authPasskeys).where(eq(authPasskeys.id, passkey.id))).toEqual([]);
    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toEqual([]);
  });
});
