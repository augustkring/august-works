import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { redactPluginAgentRuntimeAgent } from "./plugin-agent-runtime-state.js";

describe("plugin lifecycle owner agent redaction", () => {
  it("redacts legacy inline credentials in config, env, auth headers and runtime metadata", () => {
    const raw = "canary-runtime-secret-92384";
    const agent = {
      id: "agent-id",
      companyId: "company-id",
      name: "Runtime owner",
      urlKey: "runtime-owner",
      role: "worker",
      title: null,
      icon: null,
      status: "idle",
      reportsTo: null,
      capabilities: null,
      adapterType: "claude_local",
      adapterConfig: {
        apiKey: raw,
        env: { OPENAI_API_KEY: { type: "plain", value: raw } },
        authHeaders: { Authorization: `Bearer ${raw}` },
        secretRef: { type: "secret_ref", secretId: "6a0e68b5-1655-44c0-bffe-aac2d7515e96", resolvedValue: raw },
      },
      runtimeConfig: { providerToken: raw },
      defaultEnvironmentId: null,
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      errorReason: raw,
      permissions: { providerCredential: raw },
      lastHeartbeatAt: null,
      metadata: { rawCredential: raw },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as unknown as Agent & { lifecycleRequiredPluginIds: string[] };
    const safe = redactPluginAgentRuntimeAgent({ ...agent, lifecycleRequiredPluginIds: ["other-plugin-id"] });
    expect(JSON.stringify(safe)).not.toContain(raw);
    expect(safe).not.toHaveProperty("lifecycleRequiredPluginIds");
    expect(safe.adapterConfig.env).toMatchObject({ OPENAI_API_KEY: { type: "plain" } });
  });
});
