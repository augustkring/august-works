import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertMigrationBackup,
  releaseConfigHash,
  validateReleaseIdentity,
} from "./release-policy.mjs";
const now = Date.parse("2026-10-05T12:00:00Z");
test("release rejects a different build and requires a fresh backup of the pre-migration schema", () => {
  const identity = {
    environment: "staging",
    sourceSha: "a".repeat(40),
    imageDigest: "sha256:" + "b".repeat(64),
    operator: "fixture-operator",
  };
  validateReleaseIdentity(identity, { commit: identity.sourceSha });
  assert.throws(() =>
    validateReleaseIdentity(identity, { commit: "c".repeat(40) }),
  );
  const receipt = {
    metadata: {
      environment: "staging",
      schemaVersion: "0344_dark_morlocks.sql",
      createdAt: new Date(now - 10000).toISOString(),
    },
    verifiedAt: new Date(now).toISOString(),
    ciphertextSha256: "c".repeat(64),
    byteSize: 1000,
    objectKey: "database/staging/fixture.awd6",
  };
  assertMigrationBackup(
    receipt,
    "staging",
    receipt.metadata.schemaVersion,
    now,
  );
  assert.throws(() =>
    assertMigrationBackup(
      receipt,
      "production",
      receipt.metadata.schemaVersion,
      now,
    ),
  );
  assert.throws(() =>
    assertMigrationBackup(receipt, "staging", "0338_tiny_bloodscream.sql", now),
  );
  assert.throws(() =>
    assertMigrationBackup(
      { ...receipt, verifiedAt: "invalid" },
      "staging",
      receipt.metadata.schemaVersion,
      now,
    ),
  );
  assert.throws(() =>
    assertMigrationBackup(
      receipt,
      "staging",
      receipt.metadata.schemaVersion,
      now + 3600001,
    ),
  );
});
test("deployment configuration evidence includes public changes and excludes all secrets", () => {
  const first = {
    AW_PUBLIC_APP_ORIGIN: "https://fixture.test",
    DATABASE_URL: "secret-a",
    BETTER_AUTH_SECRET: "secret-a",
  };
  assert.equal(
    releaseConfigHash(first),
    releaseConfigHash({
      ...first,
      DATABASE_URL: "secret-b",
      BETTER_AUTH_SECRET: "secret-b",
    }),
  );
  assert.notEqual(
    releaseConfigHash(first),
    releaseConfigHash({ ...first, AW_PUBLIC_APP_ORIGIN: "https://other.test" }),
  );
});
