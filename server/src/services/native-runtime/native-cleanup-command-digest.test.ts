import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nativeSha256 } from "./canonical.js";
import { REMOTE_NATIVE_ERASER_ENV, REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT } from "./remote-runner-identity.js";

// Compare the actual issuer and Host object expressions, rather than copying
// either projection into a test. This catches extra/missing canonical keys.
function projection(source: string, pattern: RegExp): string {
  const expression = pattern.exec(source)?.[1];
  if (!expression) throw new Error("cleanup_digest_projection_missing");
  return expression;
}
describe("cleanup signed Host command digest", () => {
  it("uses exactly the real Host canonical keyset and excludes private desired-state fields", () => {
    const control = readFileSync(new URL("../runtime/control.ts", import.meta.url), "utf8");
    const host = readFileSync(new URL("../../../../deploy/v6/host-agent/openshell.mjs", import.meta.url), "utf8");
    const issuerExpression = projection(control, /const commandDigest = nativeSha256\((\{ argv: command,[\s\S]*?)\);/);
    const hostExpression = projection(host, /const commandDigest = hash\(JSON.stringify\(canonical\((\{ argv: request\.argv,[\s\S]*?)\)\)\);/);
    const command = ["/bin/sh", "-c", REMOTE_NATIVE_RUNTIME_ASSET_ERASURE_SCRIPT, "paperclip-native-asset-erasure"];
    const source = { remoteCwd: "/workspace/project" }, env = { ...REMOTE_NATIVE_ERASER_ENV };
    const deadlineAt = new Date("2026-11-01T00:01:00.000Z");
    const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
    const issuer = new Function("command", "source", "env", "sha256", "deadlineAt", `return (${issuerExpression})`)(command, source, env, sha256, deadlineAt);
    const request = { argv: command, cwd: source.remoteCwd, env, stdinBase64: "" };
    const observed = new Function("request", "hash", "deadlineAt", `return (${hostExpression})`)(request, sha256, deadlineAt.toISOString());
    expect(Object.keys(issuer).sort()).toEqual(Object.keys(observed).sort());
    expect(Object.keys(issuer)).toHaveLength(10);
    expect(issuer).not.toHaveProperty("nativePreparationPurpose");
    expect(issuer).not.toHaveProperty("remoteNativeSessionStartBinding");
    expect(issuer.modelBrokerSession).toBeNull();
    expect(nativeSha256(issuer)).toBe(nativeSha256(observed));
    expect(nativeSha256({ ...issuer, nativePreparationPurpose: "native_provider_data_erasure" })).not.toBe(nativeSha256(observed));
    expect(command[2].length).toBeLessThanOrEqual(8192);
  });
});
