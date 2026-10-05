import {
  constants,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  sign,
} from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { runtimeRequestSigningInput } from "../../../packages/shared/src/runtime-signing.ts";
import { atomicJson } from "./journal.mjs";
import { hostGatewayRelay } from "./relay.mjs";
import { runtimeEngine } from "./engine.mjs";

const VERSION = "6.0.0";
const filename = process.env.AW_HOST_CONFIG_FILE ?? "/etc/aw-runtime/host.json";
const config = JSON.parse(await readFile(filename, "utf8"));
const origin = new URL(config.controlOrigin);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("invalid_control_origin");
if (!/^[a-f0-9-]{36}$/.test(config.hostId) || config.region !== "dk-cph1")
  throw new Error("invalid_host_configuration");
const root = "/var/lib/aw-runtime";
await mkdir(root, { recursive: true, mode: 0o700 });
const keyFile = path.join(root, "host-key.pem");
let privateKey;
try {
  privateKey = await readFile(keyFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKey = keys.privateKey;
  await writeFile(keyFile, privateKey, { mode: 0o600 });
}
await chmod(keyFile, 0o600);
if (!config.epoch) {
  const { createPublicKey } = await import("node:crypto");
  if (typeof config.enrollmentToken !== "string")
    throw new Error("enrollment_configuration_required");
  if (!config.providerResourceId) {
    const response = await fetch(
      origin.origin + "/api/internal/runtime/enrollment-context",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: config.hostId,
          token: config.enrollmentToken,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("enrollment_context_unavailable");
    const context = await response.json();
    if (
      context.region !== config.region ||
      !/^[a-f0-9-]{36}$/.test(context.providerResourceId)
    )
      throw new Error("enrollment_context_invalid");
    config.providerResourceId = context.providerResourceId;
    await atomicJson(filename, config);
  }
  let result;
  try {
    const response = await fetch(
      origin.origin + "/api/internal/runtime/enroll",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId: config.hostId,
          token: config.enrollmentToken,
          providerResourceId: config.providerResourceId,
          region: config.region,
          publicKeyPem: createPublicKey(privateKey)
            .export({ type: "spki", format: "pem" })
            .toString(),
          agentVersion: VERSION,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("host_enrollment_failed");
    result = await response.json();
  } catch {
    // First enrollment is epoch 1. Recover a lost acknowledgement only with proof of the persisted private key.
    const recoveryPath =
        "/api/internal/runtime/hosts/" + config.hostId + "/enrollment-recovery",
      raw = Buffer.from(
        JSON.stringify({
          token: config.enrollmentToken,
          providerResourceId: config.providerResourceId,
          region: config.region,
        }),
      );
    const p = {
      hostId: config.hostId,
      epoch: 1,
      timestamp: Date.now().toString(),
      nonce: randomBytes(32).toString("base64url"),
    };
    const signature = sign(
      "sha256",
      Buffer.from(
        runtimeRequestSigningInput(
          "POST",
          recoveryPath,
          createHash("sha256").update(raw).digest("hex"),
          p,
        ),
      ),
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
    ).toString("base64url");
    const response = await fetch(origin.origin + recoveryPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-aw-host-id": p.hostId,
        "x-aw-host-epoch": "1",
        "x-aw-host-timestamp": p.timestamp,
        "x-aw-host-nonce": p.nonce,
        "x-aw-host-signature": signature,
      },
      body: raw,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("host_enrollment_recovery_failed");
    result = await response.json();
  }
  if (
    result.hostId !== config.hostId ||
    !Number.isSafeInteger(result.credentialVersion) ||
    result.credentialVersion < 1
  )
    throw new Error("invalid_enrollment_response");
  config.epoch = result.credentialVersion;
  delete config.enrollmentToken;
  await atomicJson(filename, config);
}
function proof(method, requestPath, raw) {
  const input = {
    hostId: config.hostId,
    epoch: config.epoch,
    timestamp: Date.now().toString(),
    nonce: randomBytes(32).toString("base64url"),
  };
  return {
    ...input,
    signature: sign(
      "sha256",
      Buffer.from(
        runtimeRequestSigningInput(
          method,
          requestPath,
          createHash("sha256").update(raw).digest("hex"),
          input,
        ),
      ),
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
    ).toString("base64url"),
  };
}
let stopped = false,
  revoked = false,
  lastAuthorizedAt = Date.now();
async function request(suffix, value = {}) {
  const requestPath = "/api/internal/runtime/hosts/" + config.hostId + suffix,
    raw = Buffer.from(JSON.stringify(value));
  const p = proof("POST", requestPath, raw);
  const response = await fetch(origin.origin + requestPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aw-host-id": p.hostId,
      "x-aw-host-epoch": String(p.epoch),
      "x-aw-host-timestamp": p.timestamp,
      "x-aw-host-nonce": p.nonce,
      "x-aw-host-signature": p.signature,
    },
    body: raw,
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 403) {
    revoked = true;
    stopped = true;
    throw new Error("host_credential_revoked");
  }
  if (!response.ok) throw new Error("control_request_failed");
  if (suffix === "/heartbeat") lastAuthorizedAt = Date.now();
  return response.json();
}
function decrypt(id, envelope) {
  if (
    envelope?.version !== 1 ||
    typeof envelope.encryptedKey !== "string" ||
    typeof envelope.ciphertext !== "string"
  )
    throw new Error("invalid_command_envelope");
  const key = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
      oaepLabel: Buffer.from("aw-runtime-command-v6"),
    },
    Buffer.from(envelope.encryptedKey, "base64url"),
  );
  const [version, iv, tag, body] = envelope.ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("invalid_command_ciphertext");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(
    Buffer.from("command:" + id + ":" + config.hostId + ":" + config.epoch),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
const engine = runtimeEngine({ backupEndpoint: config.backupEndpoint });
await engine.initialize();
const relay = hostGatewayRelay({
  origin: origin.origin,
  proof: { hostId: config.hostId, epoch: config.epoch, sign: proof },
  engine,
});
let heartbeatActive = false;
async function heartbeat() {
  if (heartbeatActive || stopped) return;
  heartbeatActive = true;
  try {
    await request("/heartbeat", {
      agentVersion: VERSION,
      cells: await engine.inventory(),
    });
    relay.start();
  } catch {
    process.stderr.write("host_heartbeat_failed\n");
  } finally {
    heartbeatActive = false;
  }
}
const timer = setInterval(heartbeat, (config.heartbeatSeconds ?? 20) * 1000);
timer.unref();
await heartbeat();
let fenceActive = false;
const guardian = setInterval(async () => {
  if (
    fenceActive ||
    (Date.now() - lastAuthorizedAt <
      (config.unreachableSeconds ?? 180) * 1000 &&
      !revoked)
  )
    return;
  fenceActive = true;
  try {
    relay.stop();
    await engine.fenceAll();
  } catch {
    process.stderr.write("host_lease_fence_failed\n");
  } finally {
    fenceActive = false;
  }
}, 10000);
guardian.unref();
process.once("SIGTERM", () => {
  stopped = true;
  clearInterval(timer);
});
process.once("SIGINT", () => {
  stopped = true;
  clearInterval(timer);
});
while (!stopped) {
  try {
    const claimed = await request("/commands/claim");
    if (!claimed) {
      for (const recovery of await request("/commands/recovery")) {
        const receipt = await engine.receipt(recovery.id, recovery.generation);
        if (receipt) {
          await request("/commands/" + recovery.id + "/recovery", {
            ...receipt,
            generation: recovery.generation,
          });
          await engine.acknowledge(recovery.id);
        }
      }
    }
    if (claimed) {
      const payload = decrypt(claimed.id, claimed.envelope);
      if (new Date(claimed.deadlineAt) <= new Date())
        throw new Error("command_deadline_expired");
      const renewTimer = setInterval(() => {
        void request("/commands/" + claimed.id + "/renew", {
          claimToken: payload.claimToken,
          generation: payload.generation,
        }).catch(() =>
          process.stderr.write("host_command_lease_renew_failed\n"),
        );
      }, 30000);
      renewTimer.unref();
      let result;
      try {
        result = await engine.execute(claimed.id, claimed.type, payload);
      } catch (error) {
        try {
          await engine.fenceCell(payload);
        } catch {
          revoked = true;
          stopped = true;
          relay.stop();
          throw new Error("runtime_effect_requires_fencing");
        }
        result = {
          success: false,
          state: "failed",
          errorCode: /^[a-z_]{1,100}$/.test(error.message)
            ? error.message
            : "runtime_command_failed",
          evidence: {},
        };
        await engine.recordFailure(claimed.id, payload.generation, result);
      } finally {
        clearInterval(renewTimer);
      }
      await request("/commands/" + claimed.id + "/complete", {
        ...result,
        claimToken: payload.claimToken,
        generation: payload.generation,
      });
      await engine.acknowledge(claimed.id);
    }
  } catch {
    process.stderr.write("host_command_poll_failed\n");
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
clearInterval(timer);
clearInterval(guardian);
relay.stop();
if (revoked) await engine.fenceAll();
