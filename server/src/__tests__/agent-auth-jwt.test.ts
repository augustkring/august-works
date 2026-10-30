import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt, createSandboxBrokerJwt, createSandboxExecJwt, verifyLocalAgentJwt, verifySandboxBrokerJwt, verifySandboxExecJwt } from "../agent-auth-jwt.js";

describe("agent local JWT", () => {
  const secretEnv = "PAPERCLIP_AGENT_JWT_SECRET";
  const betterAuthSecretEnv = "BETTER_AUTH_SECRET";
  const ttlEnv = "PAPERCLIP_AGENT_JWT_TTL_SECONDS";
  const issuerEnv = "PAPERCLIP_AGENT_JWT_ISSUER";
  const audienceEnv = "PAPERCLIP_AGENT_JWT_AUDIENCE";
  const disableLegacyFallbackEnv = "PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK";
  const instanceIdEnv = "PAPERCLIP_INSTANCE_ID";

  const originalEnv = {
    secret: process.env[secretEnv],
    betterAuthSecret: process.env[betterAuthSecretEnv],
    ttl: process.env[ttlEnv],
    issuer: process.env[issuerEnv],
    audience: process.env[audienceEnv],
    disableLegacyFallback: process.env[disableLegacyFallbackEnv],
    instanceId: process.env[instanceIdEnv],
  };

  beforeEach(() => {
    process.env[secretEnv] = "test-secret";
    delete process.env[betterAuthSecretEnv];
    process.env[ttlEnv] = "3600";
    delete process.env[issuerEnv];
    delete process.env[audienceEnv];
    delete process.env[disableLegacyFallbackEnv];
    delete process.env[instanceIdEnv];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv.secret === undefined) delete process.env[secretEnv];
    else process.env[secretEnv] = originalEnv.secret;
    if (originalEnv.betterAuthSecret === undefined) delete process.env[betterAuthSecretEnv];
    else process.env[betterAuthSecretEnv] = originalEnv.betterAuthSecret;
    if (originalEnv.ttl === undefined) delete process.env[ttlEnv];
    else process.env[ttlEnv] = originalEnv.ttl;
    if (originalEnv.issuer === undefined) delete process.env[issuerEnv];
    else process.env[issuerEnv] = originalEnv.issuer;
    if (originalEnv.audience === undefined) delete process.env[audienceEnv];
    else process.env[audienceEnv] = originalEnv.audience;
    if (originalEnv.disableLegacyFallback === undefined) delete process.env[disableLegacyFallbackEnv];
    else process.env[disableLegacyFallbackEnv] = originalEnv.disableLegacyFallback;
    if (originalEnv.instanceId === undefined) delete process.env[instanceIdEnv];
    else process.env[instanceIdEnv] = originalEnv.instanceId;
  });

  it("creates and verifies a token", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1", "user-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
      responsible_user_id: "user-1",
      iss: "paperclip",
      aud: "paperclip-api",
    });
  });

  it("issues a short, exact sandbox-exec audience that ordinary API auth rejects", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);
    const claim = {
      requestId: "11111111-1111-4111-8111-111111111111",
      bindingId: "22222222-2222-4222-8222-222222222222",
      cellId: "33333333-3333-4333-8333-333333333333",
      generation: "7",
      hostId: "44444444-4444-4444-8444-444444444444",
      hostEpoch: 9,
      runId: "55555555-5555-4555-8555-555555555555",
      attemptId: "66666666-6666-4666-8666-666666666666",
      attempt: 1,
      manifestId: "77777777-7777-4777-8777-777777777777",
      manifestHash: "a".repeat(64),
      policySnapshotId: "88888888-8888-4888-8888-888888888888",
      policyHash: "b".repeat(64),
      commandDigest: "c".repeat(64),
      deadlineAt: new Date(now.getTime() + 30_000).toISOString(),
    };
    const token = createSandboxExecJwt({
      agentId: "agent-1", companyId: "company-1", adapterType: "paperclip_runner",
      runId: claim.runId, responsibleUserId: "user-1", claim,
      parentExpiresAt: new Date(now.getTime() + 60_000),
      nativeLeaseExpiresAt: new Date(now.getTime() + 45_000),
    });
    expect(token).toBeTruthy();
    expect(verifyLocalAgentJwt(token!)).toBeNull();
    expect(verifySandboxExecJwt(token!)).toMatchObject({
      purpose: "sandbox_exec", aud: "paperclip-sandbox-exec", sandbox_exec: claim,
      exp: Math.floor((now.getTime() + 30_000) / 1000),
    });
    const [header, body, signature] = token!.split(".");
    const tampered = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    tampered.sandbox_exec.commandDigest = "d".repeat(64);
    expect(verifySandboxExecJwt(`${header}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${signature}`)).toBeNull();
  });

  it("does not allow dedicated sandbox capabilities through legacy master-secret fallback or another instance", () => {
    const claim = {
      requestId: "11111111-1111-4111-8111-111111111111",
      bindingId: "22222222-2222-4222-8222-222222222222",
      cellId: "33333333-3333-4333-8333-333333333333",
      generation: "7", hostId: "44444444-4444-4444-8444-444444444444", hostEpoch: 9,
      runId: "55555555-5555-4555-8555-555555555555", attemptId: null, attempt: 1,
      manifestId: "77777777-7777-4777-8777-777777777777", manifestHash: "a".repeat(64),
      policySnapshotId: "88888888-8888-4888-8888-888888888888", policyHash: "b".repeat(64),
      commandDigest: "c".repeat(64), deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    };
    process.env.PAPERCLIP_INSTANCE_ID = "sandbox-capability-other-instance";
    const forkToken = createSandboxExecJwt({
      agentId: "agent-1", companyId: "company-1", adapterType: "paperclip_runner", runId: claim.runId,
      responsibleUserId: "user-1", claim, parentExpiresAt: new Date(Date.now() + 60_000),
      nativeLeaseExpiresAt: new Date(Date.now() + 45_000),
    })!;
    process.env.PAPERCLIP_INSTANCE_ID = "sandbox-capability-current-instance";
    expect(verifySandboxExecJwt(forkToken)).toBeNull();

    const [header, body] = forkToken.split(".");
    const signingInput = `${header}.${body}`;
    const legacySignature = createHmac("sha256", process.env.PAPERCLIP_AGENT_JWT_SECRET!)
      .update(signingInput).digest("base64url");
    expect(verifySandboxExecJwt(`${signingInput}.${legacySignature}`)).toBeNull();
  });

  it("issues a short sandbox broker capability bound to an exact gateway destination and rejects API auth", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(now);
    const claim = {
      parentRequestId: "11111111-1111-4111-8111-111111111111",
      bindingId: "22222222-2222-4222-8222-222222222222",
      cellId: "33333333-3333-4333-8333-333333333333",
      generation: "7", hostId: "44444444-4444-4444-8444-444444444444", hostEpoch: 9,
      runId: "55555555-5555-4555-8555-555555555555", attemptId: null, attempt: 1,
      manifestId: "77777777-7777-4777-8777-777777777777", manifestHash: "a".repeat(64),
      policySnapshotId: "88888888-8888-4888-8888-888888888888", policyHash: "b".repeat(64),
      brokerSessionId: "99999999-9999-4999-8999-999999999999", endpointOrigin: "https://paperclip.example/",
      bindings: [{ connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", grantVersionHash: "c".repeat(64), gatewayPublicId: "assigned-gateway", endpointPath: "/mcp/gateways/assigned-gateway", allowedTools: ["read_issue"], binary: null, destination: { hostname: "api.example.com", port: 443, method: "POST" as const, path: "/v1/read" } }],
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    };
    const token = createSandboxBrokerJwt({
      agentId: "agent-1", companyId: "company-1", adapterType: "paperclip_runner", runId: claim.runId,
      responsibleUserId: "user-1", claim,
      parentExpiresAt: new Date(now.getTime() + 60_000), nativeLeaseExpiresAt: new Date(now.getTime() + 45_000),
      execDeadlineAt: new Date(now.getTime() + 40_000),
    });
    expect(token).toBeTruthy();
    expect(verifyLocalAgentJwt(token!)).toBeNull();
    expect(verifySandboxExecJwt(token!)).toBeNull();
    expect(verifySandboxBrokerJwt(token!)).toMatchObject({ purpose: "sandbox_broker", aud: "paperclip-sandbox-broker", sandbox_broker: claim, exp: Math.floor((now.getTime() + 30_000) / 1000) });
    const executableClaim = { ...claim, bindings: claim.bindings.map(binding => ({ ...binding, binary: "/usr/bin/node" })) };
    const executableToken = createSandboxBrokerJwt({
      agentId: "agent-1", companyId: "company-1", adapterType: "paperclip_runner", runId: claim.runId,
      responsibleUserId: "user-1", claim: executableClaim,
      parentExpiresAt: new Date(now.getTime() + 60_000), nativeLeaseExpiresAt: new Date(now.getTime() + 45_000),
      execDeadlineAt: new Date(now.getTime() + 40_000),
    });
    expect(verifySandboxBrokerJwt(executableToken!)).toMatchObject({ sandbox_broker: executableClaim });
    const [header, body] = token!.split(".");
    const signingInput = `${header}.${body}`;
    const legacySignature = createHmac("sha256", process.env.PAPERCLIP_AGENT_JWT_SECRET!)
      .update(signingInput).digest("base64url");
    expect(verifySandboxBrokerJwt(`${signingInput}.${legacySignature}`)).toBeNull();
    process.env.PAPERCLIP_INSTANCE_ID = "sandbox-broker-other-instance";
    const otherInstanceToken = createSandboxBrokerJwt({
      agentId: "agent-1", companyId: "company-1", adapterType: "paperclip_runner", runId: claim.runId,
      responsibleUserId: "user-1", claim,
      parentExpiresAt: new Date(now.getTime() + 60_000), nativeLeaseExpiresAt: new Date(now.getTime() + 45_000),
      execDeadlineAt: new Date(now.getTime() + 40_000),
    })!;
    process.env.PAPERCLIP_INSTANCE_ID = "sandbox-broker-current-instance";
    expect(verifySandboxBrokerJwt(otherInstanceToken)).toBeNull();
  });

  it("round-trips a skill_test run scope", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const issueId = "11111111-1111-4111-8111-111111111111";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1", "user-1", {
      kind: "skill_test",
      issueId,
    });

    const claims = verifyLocalAgentJwt(token!);
    expect(claims?.key_scope).toEqual({ kind: "skill_test", issueId });
  });

  it("round-trips only a closed native HTTP effect claim and rejects malformed claim extensions", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const native_tool_effect = {
      dispatchId: "11111111-1111-4111-8111-111111111111", eventSeq: 7, attempt: 3,
      turnId: "provider-turn", callId: "provider-call", tool: "call_api" as const,
      operationId: "POST /api/issues", method: "POST", pathAndQuery: "/api/issues?x=1", bodyPresent: true,
      bodyHash: "a".repeat(64), apiReceiptDigest: "b".repeat(64), leaseOwner: "lease-owner",
      leaseExpiresAt: "2026-01-01T00:01:00.000Z", controllerBootId: "controller-boot", controllerPid: 42,
      controllerProcessStartedAt: "2026-01-01T00:00:00.000Z",
    };
    const token = createLocalAgentJwt("agent-1", "company-1", "paperclip_runner", "run-1", "user-1", { kind: "standard" }, native_tool_effect);
    expect(verifyLocalAgentJwt(token!)?.native_tool_effect).toEqual(native_tool_effect);
    const [header, encoded, signature] = token!.split(".");
    const body = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    body.native_tool_effect.pathAndQuery = "/api/other";
    const changed = Buffer.from(JSON.stringify(body)).toString("base64url");
    expect(verifyLocalAgentJwt(`${header}.${changed}.${signature}`)).toBeNull();
  });

  it("will not mint a native effect token that outlives its pinned lease deadline", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    const claim = {
      dispatchId: "11111111-1111-4111-8111-111111111111", eventSeq: 7, attempt: 3,
      turnId: "provider-turn", callId: "provider-call", tool: "call_api" as const,
      operationId: "POST /api/issues", method: "POST", pathAndQuery: "/api/issues", bodyPresent: false,
      bodyHash: "a".repeat(64), apiReceiptDigest: "b".repeat(64), leaseOwner: "lease-owner",
      leaseExpiresAt: "2026-01-01T00:00:04.000Z", controllerBootId: "controller-boot", controllerPid: 42,
      controllerProcessStartedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(createLocalAgentJwt("agent-1", "company-1", "paperclip_runner", "run-1", "user-1", { kind: "standard" }, claim)).toBeNull();
  });

  it("returns null when secret is missing", () => {
    process.env[secretEnv] = "";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).toBeNull();
    expect(verifyLocalAgentJwt("abc.def.ghi")).toBeNull();
  });

  it("falls back to BETTER_AUTH_SECRET when PAPERCLIP_AGENT_JWT_SECRET is absent", () => {
    delete process.env[secretEnv];
    process.env[betterAuthSecretEnv] = "fallback-secret";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
    });
  });

  it("rejects expired tokens", () => {
    process.env[ttlEnv] = "1";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects at the exact expiry instant after a valid pre-expiry read", () => {
    process.env[ttlEnv] = "1";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.999Z"));
    expect(verifyLocalAgentJwt(token!)).not.toBeNull();
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects issuer/audience mismatch", () => {
    process.env[issuerEnv] = "custom-issuer";
    process.env[audienceEnv] = "custom-audience";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");

    process.env[issuerEnv] = "paperclip";
    process.env[audienceEnv] = "paperclip-api";
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("does not verify a token across companies (per-company isolation)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const tokenA = createLocalAgentJwt("agent-1", "company-A", "claude_local", "run-1");
    expect(tokenA).not.toBeNull();

    // A token whose body claims company-A must verify successfully under its
    // own company-A derived key.
    expect(verifyLocalAgentJwt(tokenA!)?.company_id).toBe("company-A");

    // Tamper: forge a token by copying tokenA's header+signature and swapping
    // the claim's company_id to company-B. The signature was bound to the
    // company-A derived key over the original claims; once we re-encode with a
    // different company_id (or rebind to company-B's key) verification must
    // fail because the signature is over the original signing input.
    const [headerB64, claimsB64, signature] = tokenA!.split(".");
    const claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
    claims.company_id = "company-B";
    const tamperedClaimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const tampered = `${headerB64}.${tamperedClaimsB64}.${signature}`;
    expect(verifyLocalAgentJwt(tampered)).toBeNull();
  });

  it("accepts legacy tokens signed with the master secret (backward compat)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const masterSecret = process.env[secretEnv]!;

    // Hand-craft a token signed directly with the master secret, simulating a
    // JWT issued before per-company derivation existed.
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const claims = {
      sub: "agent-legacy",
      company_id: "company-legacy",
      adapter_type: "claude_local",
      run_id: "run-legacy",
      iat: now,
      exp: now + 3600,
      iss: "paperclip",
      aud: "paperclip-api",
    };
    const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    const legacySig = createHmac("sha256", masterSecret).update(signingInput).digest("base64url");
    const legacyToken = `${signingInput}.${legacySig}`;

    const verified = verifyLocalAgentJwt(legacyToken);
    expect(verified).toMatchObject({
      sub: "agent-legacy",
      company_id: "company-legacy",
      adapter_type: "claude_local",
      run_id: "run-legacy",
    });
  });

  // --- Instance isolation (PAP-12899) ---------------------------------------
  // A worktree/fork control-plane instance runs under a distinct
  // PAPERCLIP_INSTANCE_ID but deliberately shares PAPERCLIP_AGENT_JWT_SECRET
  // with its source instance (provisioning copies the secret). Before this
  // change, a fork-minted run JWT validated successfully against the live plane
  // (reads worked; writes then failed on missing heartbeat_runs FK rows). These
  // tests pin the boundary that keeps fork tokens out of the live plane.

  it("stamps the minting instance id into the token claims", () => {
    process.env[instanceIdEnv] = "default";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);
    expect(claims?.instance_id).toBe("default");
  });

  it("rejects a fork/worktree-minted token on the live control plane", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    // Mint on a worktree/fork instance (distinct instance id, SAME secret).
    process.env[instanceIdEnv] = "pap-12899-worktree";
    const forkToken = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(forkToken).not.toBeNull();
    // Sanity: it verifies on the instance that minted it.
    expect(verifyLocalAgentJwt(forkToken!)?.company_id).toBe("company-1");

    // Now switch to the live control plane (same shared secret, "default"
    // instance) and confirm the fork token no longer authenticates — neither
    // its instance-scoped signature nor the legacy master-secret fallback
    // matches, so reads and writes are both refused.
    process.env[instanceIdEnv] = "default";
    expect(verifyLocalAgentJwt(forkToken!)).toBeNull();
  });

  it("keeps live-plane heartbeat tokens authenticating across mint/verify", () => {
    process.env[instanceIdEnv] = "default";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1", "user-1");
    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      run_id: "run-1",
      instance_id: "default",
    });
  });

  it("rejects a token whose instance_id claim is forged to match the live plane", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    // Mint a fork token, then tamper the instance_id claim to impersonate the
    // live "default" instance. The signature was bound to the fork instance's
    // derived key, so re-encoding the claim cannot make it validate on the
    // live plane — the claim check is defense-in-depth, the key is the boundary.
    process.env[instanceIdEnv] = "pap-12899-worktree";
    const forkToken = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    const [headerB64, claimsB64, signature] = forkToken!.split(".");
    const claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
    claims.instance_id = "default";
    const tamperedClaimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const tampered = `${headerB64}.${tamperedClaimsB64}.${signature}`;

    process.env[instanceIdEnv] = "default";
    expect(verifyLocalAgentJwt(tampered)).toBeNull();
  });

  it("still rejects the master-secret legacy fallback once it is disabled (full instance isolation)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env[disableLegacyFallbackEnv] = "true";
    process.env[instanceIdEnv] = "default";
    // The legacy fallback signs with the raw shared secret and is therefore
    // instance-agnostic; disabling it closes that residual cross-instance hole.
    const legacyToken = craftLegacyMasterSecretToken(process.env[secretEnv]!, "company-1");
    expect(verifyLocalAgentJwt(legacyToken)).toBeNull();
  });

  it("defaults TTL to 48h when PAPERCLIP_AGENT_JWT_TTL_SECONDS is unset", () => {
    // Must match DEFAULT_AGENT_JWT_TTL_SECONDS in cli/src/commands/env.ts. Run
    // tokens are minted once at adapter spawn, and a suspended host (laptop lid
    // closed) can delay first execution past a short TTL, making the injected
    // PAPERCLIP_API_KEY dead on arrival.
    delete process.env[ttlEnv];
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);
    expect(claims).not.toBeNull();
    expect(claims!.exp - claims!.iat).toBe(60 * 60 * 48);
  });

  it.each([{}, { kind: "unknown" }, { kind: "skill_test", issueId: "invalid" },
    { kind: "task_bridge", parentIssueIds: [] }])("rejects a valid signature with malformed key scope %j", scope => {
    const token = craftLegacyMasterSecretToken("test-secret", "company-1", scope);
    expect(verifyLocalAgentJwt(token)).toBeNull();
  });

  it("preserves documented legacy absent and null standard scope", () => {
    expect(verifyLocalAgentJwt(craftLegacyMasterSecretToken("test-secret", "company-1"))).not.toBeNull();
    expect(verifyLocalAgentJwt(craftLegacyMasterSecretToken("test-secret", "company-1", null))?.key_scope).toEqual({ kind: "standard" });
  });

  // Helper: hand-craft a token signed with the raw master secret (legacy path).
  function craftLegacyMasterSecretToken(masterSecret: string, companyId: string, scope?: unknown) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const claims = {
      sub: "agent-legacy",
      ...(scope === undefined ? {} : { key_scope: scope }),
      company_id: companyId,
      adapter_type: "claude_local",
      run_id: "run-legacy",
      iat: now,
      exp: now + 3600,
      iss: "paperclip",
      aud: "paperclip-api",
    };
    const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    const legacySig = createHmac("sha256", masterSecret).update(signingInput).digest("base64url");
    return `${signingInput}.${legacySig}`;
  }

  it("accepts master-secret-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is unset", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    delete process.env[disableLegacyFallbackEnv];
    const legacyToken = craftLegacyMasterSecretToken(process.env[secretEnv]!, "company-legacy");
    const verified = verifyLocalAgentJwt(legacyToken);
    expect(verified).not.toBeNull();
    expect(verified!.company_id).toBe("company-legacy");
  });

  it("rejects master-secret-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is enabled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env[disableLegacyFallbackEnv] = "true";
    const legacyToken = craftLegacyMasterSecretToken(process.env[secretEnv]!, "company-legacy");
    expect(verifyLocalAgentJwt(legacyToken)).toBeNull();
  });

  it("still verifies per-company-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is enabled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env[disableLegacyFallbackEnv] = "true";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).not.toBeNull();
    const verified = verifyLocalAgentJwt(token!);
    expect(verified).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
    });
  });
});
