import {
  constants,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  verify,
} from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  runtimeHostEnrollments,
  runtimeHostRequestNonces,
  runtimeHosts,
  type Db,
} from "@paperclipai/db";
import {
  runtimeEnrollmentSchema,
  runtimeHostProofSchema,
  runtimeRequestSigningInput,
} from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { randomToken, seal, sha256 } from "../saas/crypto.js";

export function runtimeHostAuth(db: Db) {
  async function issueEnrollment(
    hostId: string,
    operatorId: string,
    now = new Date(),
    beforeProvision = false,
  ) {
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId))
        .for("update");
      if (
        !host ||
        (!host.providerResourceId && !beforeProvision) ||
        !["PROVISIONING", "BOOTSTRAPPING"].includes(host.status) ||
        host.publicKeyPem
      )
        throw conflict("Host is not eligible for enrollment");
      const token = randomToken();
      await tx
        .update(runtimeHostEnrollments)
        .set({ expiresAt: now })
        .where(
          and(
            eq(runtimeHostEnrollments.runtimeHostId, hostId),
            isNull(runtimeHostEnrollments.usedAt),
          ),
        );
      await tx
        .insert(runtimeHostEnrollments)
        .values({
          runtimeHostId: hostId,
          tokenHash: sha256(token),
          expectedProviderResourceId: host.providerResourceId,
          expectedRegion: host.region,
          expiresAt: new Date(now.getTime() + 600000),
          createdByUserId: operatorId,
        });
      return token;
    });
  }
  async function enrollmentContext(raw: unknown, now = new Date()) {
    const input = runtimeEnrollmentSchema
      .pick({ hostId: true, token: true })
      .parse(raw);
    const [row] = await db
      .select({
        providerResourceId: runtimeHosts.providerResourceId,
        region: runtimeHosts.region,
      })
      .from(runtimeHostEnrollments)
      .innerJoin(
        runtimeHosts,
        eq(runtimeHosts.id, runtimeHostEnrollments.runtimeHostId),
      )
      .where(
        and(
          eq(runtimeHosts.id, input.hostId),
          isNull(runtimeHosts.publicKeyPem),
          inArray(runtimeHosts.status, ["PROVISIONING", "BOOTSTRAPPING"]),
          eq(runtimeHostEnrollments.tokenHash, sha256(input.token)),
          gt(runtimeHostEnrollments.expiresAt, now),
          isNull(runtimeHostEnrollments.usedAt),
        ),
      )
      .limit(1);
    if (!row?.providerResourceId)
      throw forbidden("Enrollment context unavailable");
    return row;
  }
  async function enroll(raw: unknown, now = new Date()) {
    const input = runtimeEnrollmentSchema.parse(raw);
    let key: ReturnType<typeof createPublicKey>;
    try {
      key = createPublicKey(input.publicKeyPem);
    } catch {
      throw forbidden("Invalid host key");
    }
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) > 4096
    )
      throw forbidden("Host key must be RSA 3072 or 4096");
    const publicKeyPem = key.export({ type: "spki", format: "pem" }).toString();
    return db.transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, input.hostId))
        .for("update");
      if (
        !host ||
        host.publicKeyPem ||
        !["PROVISIONING", "BOOTSTRAPPING"].includes(host.status)
      )
        throw forbidden("Host enrollment unavailable");
      const [token] = await tx
        .update(runtimeHostEnrollments)
        .set({ usedAt: now })
        .where(
          and(
            eq(runtimeHostEnrollments.runtimeHostId, input.hostId),
            eq(runtimeHostEnrollments.tokenHash, sha256(input.token)),
            eq(
              runtimeHostEnrollments.expectedProviderResourceId,
              input.providerResourceId,
            ),
            eq(runtimeHostEnrollments.expectedRegion, input.region),
            gt(runtimeHostEnrollments.expiresAt, now),
            isNull(runtimeHostEnrollments.usedAt),
          ),
        )
        .returning({ id: runtimeHostEnrollments.id });
      if (
        !token ||
        host.providerResourceId !== input.providerResourceId ||
        host.region !== input.region
      )
        throw forbidden("Invalid host enrollment");
      await tx
        .update(runtimeHosts)
        .set({
          publicKeyPem,
          hostAgentVersion: input.agentVersion,
          credentialRevokedAt: null,
          status: "BOOTSTRAPPING",
          updatedAt: now,
        })
        .where(eq(runtimeHosts.id, host.id));
      return {
        hostId: host.id,
        credentialVersion: host.credentialVersion,
        authorizationTtlSeconds: 60,
      };
    });
  }
  async function authenticate(
    input: unknown,
    method: string,
    path: string,
    raw: Buffer,
    now = new Date(),
  ) {
    const proof = runtimeHostProofSchema.parse(input);
    if (
      Math.abs(now.getTime() - Number(proof.timestamp)) > 60000 ||
      raw.length > 1024 * 1024
    )
      throw forbidden("Host request expired");
    const [host] = await db
      .select()
      .from(runtimeHosts)
      .where(
        and(
          eq(runtimeHosts.id, proof.hostId),
          eq(runtimeHosts.credentialVersion, proof.epoch),
          isNull(runtimeHosts.credentialRevokedAt),
          isNull(runtimeHosts.retiredAt),
          isNull(runtimeHosts.fencedAt),
        ),
      )
      .limit(1);
    if (!host?.publicKeyPem || ["FAILED", "RETIRED"].includes(host.status))
      throw forbidden("Host credential unavailable");
    let valid = false;
    try {
      valid = verify(
        "sha256",
        Buffer.from(
          runtimeRequestSigningInput(method, path, sha256(raw), proof),
        ),
        {
          key: host.publicKeyPem,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        Buffer.from(proof.signature, "base64url"),
      );
    } catch {
      /* Fail closed for malformed signatures. */
    }
    if (!valid) throw forbidden("Invalid host signature");
    const [nonce] = await db
      .insert(runtimeHostRequestNonces)
      .values({
        runtimeHostId: host.id,
        nonce: proof.nonce,
        expiresAt: new Date(now.getTime() + 120000),
      })
      .onConflictDoNothing()
      .returning({ nonce: runtimeHostRequestNonces.nonce });
    if (!nonce) throw forbidden("Host request replayed");
    // Recheck revocation after nonce insertion to close the verification/write race.
    const [current] = await db
      .select({ id: runtimeHosts.id })
      .from(runtimeHosts)
      .where(
        and(
          eq(runtimeHosts.id, host.id),
          eq(runtimeHosts.credentialVersion, proof.epoch),
          isNull(runtimeHosts.credentialRevokedAt),
          isNull(runtimeHosts.fencedAt),
        ),
      )
      .limit(1);
    if (!current) throw forbidden("Host credential revoked");
    return host;
  }
  async function recoverEnrollment(
    hostId: string,
    raw: unknown,
    now = new Date(),
  ) {
    const input = runtimeEnrollmentSchema
      .pick({ token: true, providerResourceId: true, region: true })
      .parse(raw);
    const [host] = await db
      .select()
      .from(runtimeHosts)
      .where(
        and(
          eq(runtimeHosts.id, hostId),
          eq(runtimeHosts.providerResourceId, input.providerResourceId),
          eq(runtimeHosts.region, input.region),
          isNull(runtimeHosts.credentialRevokedAt),
          isNull(runtimeHosts.fencedAt),
          isNull(runtimeHosts.retiredAt),
        ),
      )
      .limit(1);
    const [enrollment] = await db
      .select({ id: runtimeHostEnrollments.id })
      .from(runtimeHostEnrollments)
      .where(
        and(
          eq(runtimeHostEnrollments.runtimeHostId, hostId),
          eq(runtimeHostEnrollments.tokenHash, sha256(input.token)),
          sql`${runtimeHostEnrollments.usedAt} is not null`,
        ),
      )
      .limit(1);
    if (!host?.publicKeyPem || !enrollment)
      throw forbidden("Enrollment recovery unavailable");
    // Caller has already proved possession of the exact installed private key, not just the bootstrap token.
    return {
      hostId: host.id,
      credentialVersion: host.credentialVersion,
      authorizationTtlSeconds: 60,
    };
  }
  function protectCommand(
    host: typeof runtimeHosts.$inferSelect,
    commandId: string,
    payload: unknown,
  ) {
    if (!host.publicKeyPem || host.credentialRevokedAt || host.fencedAt)
      throw forbidden("Host credential unavailable");
    const key = randomBytes(32);
    return {
      version: 1,
      encryptedKey: publicEncrypt(
        {
          key: host.publicKeyPem,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
          oaepLabel: Buffer.from("aw-runtime-command-v6"),
        },
        key,
      ).toString("base64url"),
      ciphertext: seal(
        payload,
        key.toString("hex"),
        "command:" + commandId + ":" + host.id + ":" + host.credentialVersion,
      ),
    };
  }
  async function revoke(hostId: string, now = new Date()) {
    const [host] = await db
      .update(runtimeHosts)
      .set({
        credentialRevokedAt: now,
        credentialVersion: sql`${runtimeHosts.credentialVersion}+1`,
        status: "DRAINING",
        updatedAt: now,
      })
      .where(eq(runtimeHosts.id, hostId))
      .returning();
    if (!host) throw notFound();
    return host;
  }
  async function pruneNonces(now = new Date()) {
    await db
      .delete(runtimeHostRequestNonces)
      .where(lt(runtimeHostRequestNonces.expiresAt, now));
  }
  return {
    issueEnrollment,
    enrollmentContext,
    enroll,
    authenticate,
    recoverEnrollment,
    protectCommand,
    revoke,
    pruneNonces,
  };
}
