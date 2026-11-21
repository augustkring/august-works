import { describe, expect, it } from "vitest";
import { compareModelMigrationBehavior, modelLifecycleHash, modelQualificationProfileHash, modelRoutingRollbackWouldChange } from "./model-routing-snapshots.js";

describe("generic Agent revision rollback model-routing fence", () => {
  const baseline = { adapterType: "paperclip_runner", adapterConfig: {
    provider: "aw_text_only", model: "model-a", workerModelProfileId: "stable-profile-id", maxOutputTokens: 2048,
  } };

  it("allows non-model rollback when neither snapshot selects a model route", () => {
    expect(modelRoutingRollbackWouldChange(
      { adapterType: "claude_local", adapterConfig: { workingDirectory: "/repo/a" } },
      { adapterType: "claude_local", adapterConfig: { workingDirectory: "/repo/b" } },
    )).toBe(false);
  });

  it("keeps credential/setup repair and other non-routing config edits on their existing owner", () => {
    expect(modelRoutingRollbackWouldChange(baseline, {
      ...baseline, adapterConfig: { ...baseline.adapterConfig, env: { API_KEY: "rotated" }, workingDirectory: "/safe/new" },
    })).toBe(false);
  });

  it("does not classify a standalone service endpoint as a model route", () => {
    expect(modelRoutingRollbackWouldChange(
      { adapterType: "mcp_remote", adapterConfig: { endpoint: "https://one.example.test" } },
      { adapterType: "mcp_remote", adapterConfig: { endpoint: "https://two.example.test" } },
    )).toBe(false);
  });

  it("leaves BYO/remote model setup and binding rotation on their existing owners without a lifecycle profile", () => {
    expect(modelRoutingRollbackWouldChange(
      { adapterType: "openclaw_gateway", adapterConfig: { provider: "openai", model: "gpt-x", baseUrl: "https://one.example.test" } },
      { adapterType: "openclaw_gateway", adapterConfig: { provider: "anthropic", model: "claude-y", baseUrl: "https://two.example.test" } },
    )).toBe(false);
    expect(modelRoutingRollbackWouldChange(
      { adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { aiConnection: { provider: "anthropic", mode: "shared", connectionId: "old", grantId: "grant-a" } } },
      { adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { aiConnection: { provider: "anthropic", mode: "shared", connectionId: "new", grantId: "grant-b" } } },
    )).toBe(false);
  });

  it("fences profile changes and same-ID configuration rotations", () => {
    expect(modelRoutingRollbackWouldChange(baseline, {
      ...baseline, adapterConfig: { ...baseline.adapterConfig, workerModelProfileId: "profile-b" },
    })).toBe(true);
    expect(modelRoutingRollbackWouldChange(baseline, {
      ...baseline, adapterConfig: { ...baseline.adapterConfig, maxOutputTokens: 4096 },
    })).toBe(true);
  });

  it("fences transitions into or out of model routing", () => {
    expect(modelRoutingRollbackWouldChange(
      { adapterType: "claude_local", adapterConfig: { workingDirectory: "/repo" } }, baseline,
    )).toBe(true);
    expect(modelRoutingRollbackWouldChange(baseline,
      { adapterType: "claude_local", adapterConfig: { workingDirectory: "/repo" } },
    )).toBe(true);
  });

  it("permits a migration only when published behavior and scenarios stay exact", () => {
    const prior = { instructions: { purpose: "Draft only" }, scenarios: ["Make an internal draft"], runtimeCandidateId: "old" };
    expect(compareModelMigrationBehavior(prior, { ...prior, runtimeCandidateId: "new" }).compatible).toBe(true);
    expect(compareModelMigrationBehavior(prior, { ...prior, runtimeCandidateId: "new", instructions: { purpose: "Different behavior" } }).compatible).toBe(false);
  });

  it("separates expected lifecycle updates from same-ID qualification rotations", () => {
    const profile = { id: "stable-id", tariff: { model: "model-a", qualificationHash: "old" }, binding: { connectionId: "grant-a" },
      lifecycle: { status: "active", retirementAt: null } };
    expect(modelQualificationProfileHash(profile)).toBe(modelQualificationProfileHash({ ...profile, lifecycle: { status: "migration_required", retirementAt: "2026-11-01T00:00:00Z" } }));
    expect(modelLifecycleHash(profile)).not.toBe(modelLifecycleHash({ ...profile, lifecycle: { status: "migration_required", retirementAt: "2026-11-01T00:00:00Z" } }));
    expect(modelQualificationProfileHash(profile)).not.toBe(modelQualificationProfileHash({ ...profile, tariff: { model: "model-b", qualificationHash: "new" } }));
  });

});
