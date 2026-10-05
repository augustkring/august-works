import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  sign,
} from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, runtimeHosts } from "@paperclipai/db";
import { runtimeRequestSigningInput } from "@paperclipai/shared";
import { runtimeHostAuth } from "../services/runtime/host-auth.js";
import { open, sha256 } from "../services/saas/crypto.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)(
  "V6 host enrollment and machine authentication",
  () => {
    let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,
      db: ReturnType<typeof createDb>,
      hostId: string;
    let enrollmentToken: string;
    const providerId = "11111111-1111-4111-8111-111111111111";
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 3072,
    });
    beforeAll(async () => {
      database = await startEmbeddedPostgresTestDatabase("aw-v6-host-auth-");
      db = createDb(database.connectionString);
      const [host] = await db
        .insert(runtimeHosts)
        .values({
          providerResourceId: providerId,
          environment: "staging",
          region: "dk-cph1",
          capacityClass: "standard",
          cpuTotalMillis: 4000,
          memoryTotalBytes: 8000000000n,
          diskTotalBytes: 40000000000n,
        })
        .returning();
      hostId = host!.id;
    }, 60000);
    afterAll(async () => {
      await database?.cleanup();
    }, 30000);
    it("consumes a bounded enrollment exactly once and rejects a different provider resource", async () => {
      const auth = runtimeHostAuth(db);
      const token = await auth.issueEnrollment(hostId, "operator");
      enrollmentToken = token;
      const input = {
        hostId,
        token,
        providerResourceId: providerId,
        region: "dk-cph1",
        publicKeyPem: publicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
        agentVersion: "6.0.0",
      };
      await expect(
        auth.enroll({
          ...input,
          providerResourceId: "22222222-2222-4222-8222-222222222222",
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(await auth.enroll(input)).toMatchObject({
        hostId,
        credentialVersion: 1,
        authorizationTtlSeconds: 60,
      });
      await expect(auth.enroll(input)).rejects.toMatchObject({ status: 403 });
    });
    it("binds signed requests to raw bytes, method and host, rejects nonce replay and expiration", async () => {
      const auth = runtimeHostAuth(db),
        raw = Buffer.from('{"fixture":true}'),
        path = `/api/internal/runtime/hosts/${hostId}/heartbeat`;
      const proof = {
        hostId,
        epoch: 1,
        timestamp: Date.now().toString(),
        nonce: randomBytes(32).toString("base64url"),
      };
      const signature = sign(
        "sha256",
        Buffer.from(
          runtimeRequestSigningInput("POST", path, sha256(raw), proof),
        ),
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
      ).toString("base64url");
      await expect(
        auth.authenticate(
          { ...proof, signature },
          "POST",
          path,
          Buffer.from('{"fixture":false}'),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await auth.authenticate({ ...proof, signature }, "POST", path, raw))
          .id,
      ).toBe(hostId);
      await expect(
        auth.authenticate({ ...proof, signature }, "POST", path, raw),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        auth.authenticate(
          { ...proof, signature },
          "POST",
          path,
          raw,
          new Date(Date.now() + 61000),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("recovers a lost enrollment response only after installed-key authentication", async () => {
      const auth = runtimeHostAuth(db),
        path = `/api/internal/runtime/hosts/${hostId}/enrollment-recovery`;
      const body = {
          token: enrollmentToken,
          providerResourceId: providerId,
          region: "dk-cph1",
        },
        raw = Buffer.from(JSON.stringify(body));
      const proof = {
        hostId,
        epoch: 1,
        timestamp: Date.now().toString(),
        nonce: randomBytes(32).toString("base64url"),
      };
      const signature = sign(
        "sha256",
        Buffer.from(
          runtimeRequestSigningInput("POST", path, sha256(raw), proof),
        ),
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
      ).toString("base64url");
      await auth.authenticate({ ...proof, signature }, "POST", path, raw);
      expect(await auth.recoverEnrollment(hostId, body)).toMatchObject({
        hostId,
        credentialVersion: 1,
      });
      await expect(
        auth.recoverEnrollment(hostId, { ...body, token: "x".repeat(43) }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("encrypts delegated command credentials for this host and closes requests after revocation", async () => {
      const auth = runtimeHostAuth(db);
      const [host] = await db
        .select()
        .from(runtimeHosts)
        .where(eq(runtimeHosts.id, hostId));
      const envelope = auth.protectCommand(host!, "command-fixture", {
        gatewayToken: "not-public",
        companyId: "tenant-a",
      });
      expect(JSON.stringify(envelope)).not.toContain("not-public");
      const key = privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
          oaepLabel: Buffer.from("aw-runtime-command-v6"),
        },
        Buffer.from(envelope.encryptedKey, "base64url"),
      );
      expect(
        open(
          envelope.ciphertext,
          key.toString("hex"),
          `command:command-fixture:${hostId}:1`,
        ),
      ).toEqual({ gatewayToken: "not-public", companyId: "tenant-a" });
      expect(() =>
        open(
          envelope.ciphertext,
          key.toString("hex"),
          `command:command-fixture:other-host:1`,
        ),
      ).toThrow();
      await auth.revoke(hostId);
      const raw = Buffer.from("{}"),
        path = `/api/internal/runtime/hosts/${hostId}/commands/claim`;
      const proof = {
        hostId,
        epoch: 1,
        timestamp: Date.now().toString(),
        nonce: randomBytes(32).toString("base64url"),
      };
      const signature = sign(
        "sha256",
        Buffer.from(
          runtimeRequestSigningInput("POST", path, sha256(raw), proof),
        ),
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
      ).toString("base64url");
      await expect(
        auth.authenticate({ ...proof, signature }, "POST", path, raw),
      ).rejects.toMatchObject({ status: 403 });
    });
  },
);
