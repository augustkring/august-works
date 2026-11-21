import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Db } from "@paperclipai/db";
import request from "supertest";
import { errorHandler } from "../middleware/index.js";
import { createRuntimeToolsToken } from "../runtime-tools-token.js";
import { runtimeConnectionIntentRoutes } from "./connection-intents.js";
import {
  CONNECTION_REQUEST_TOOL_DESCRIPTION,
  CONNECTION_RUNTIME_TOOL_NAMES,
  CONNECTIONS_SEARCH_TOOL_DESCRIPTION,
} from "@paperclipai/shared";
import {
  RUNTIME_CONNECTION_TOOL_DEFINITIONS,
  wakeConnectionIntentAfterResolution,
} from "./connection-intents.js";

describe("runtime connection MCP contract", () => {
  it("advertises both canonical tools with the shared descriptions and narrow schemas", () => {
    expect(
      RUNTIME_CONNECTION_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).toEqual(CONNECTION_RUNTIME_TOOL_NAMES);
    expect(RUNTIME_CONNECTION_TOOL_DEFINITIONS).toEqual([
      {
        name: "connections_search",
        description: CONNECTIONS_SEARCH_TOOL_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            retryProviderChoice: {
              type: "boolean",
              description: "Only when the user explicitly asks to reconsider a previous provider choice or decline",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "connection_request",
        description: CONNECTION_REQUEST_TOOL_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string" },
            targetService: { type: "string", description: "App slug returned by search only when the user explicitly named this external provider" },
            selectionInteractionId: {
              type: "string",
              description: "Saved answered provider-choice interaction ID for aggregator routes",
            },
          },
          required: ["service"],
          additionalProperties: false,
        },
      },
    ]);
  });

  it("does not accept run identity, task identity, users, or credentials from tool input", () => {
    const serialized = JSON.stringify(
      RUNTIME_CONNECTION_TOOL_DEFINITIONS.map(
        (definition) => definition.inputSchema,
      ),
    );
    expect(serialized).not.toMatch(
      /companyId|agentId|runId|issueId|responsibleUserId|credential|token/i,
    );
  });
});

describe("connection intent continuation wake contract", () => {
  it.each([
    ["accepted", "connected"],
    ["rejected", "declined"],
  ])(
    "emits one idempotent continuation wake for %s intents",
    async (status) => {
      const wakeup = vi.fn().mockResolvedValue(undefined);

      await wakeConnectionIntentAfterResolution({ wakeup } as never, {
        loaded: {
          issue: {
            id: "issue-123",
            assigneeAgentId: "agent-123",
            status: "in_progress",
          },
          interaction: { id: "interaction-123" },
        },
        status,
        actorId: "user-123",
      });

      expect(wakeup).toHaveBeenCalledTimes(1);
      expect(wakeup).toHaveBeenCalledWith(
        "agent-123",
        expect.objectContaining({
          idempotencyKey: `connection-intent:interaction-123:${status}`,
          requestedByActorType: "user",
          requestedByActorId: "user-123",
          contextSnapshot: expect.objectContaining({
            issueId: "issue-123",
            interactionId: "interaction-123",
            interactionStatus: status,
            forceFreshSession: true,
          }),
        }),
      );
    },
  );

  it.each(["backlog", "todo", "done", "blocked", "cancelled"])(
    "does not wake a parked or closed %s task",
    async (issueStatus) => {
      const wakeup = vi.fn().mockResolvedValue(undefined);

      await wakeConnectionIntentAfterResolution({ wakeup } as never, {
        loaded: {
          issue: {
            id: "issue-closed",
            assigneeAgentId: "agent-123",
            status: issueStatus,
          },
          interaction: { id: "interaction-123" },
        },
        status: "accepted",
        actorId: "user-123",
      });

      expect(wakeup).not.toHaveBeenCalled();
    },
  );
});


const managedRouteIds = {
  agent: "10000000-0000-4000-8000-000000000001",
  company: "10000000-0000-4000-8000-000000000002",
  run: "10000000-0000-4000-8000-000000000003",
  human: "10000000-0000-4000-8000-000000000004",
  group: "10000000-0000-4000-8000-000000000005",
  probe: "10000000-0000-4000-8000-000000000006",
  plan: "10000000-0000-4000-8000-000000000007",
  profile: "10000000-0000-4000-8000-000000000008",
  nonce: "10000000-0000-4000-8000-000000000009",
};
const managedRouteAuthorityHash = "a".repeat(64);

function managedRouteToken(scope: "worker_model" | "conversation_model" | "provider_conformance" | "connection_intents") {
  return createRuntimeToolsToken({
    agentId: managedRouteIds.agent,
    companyId: managedRouteIds.company,
    runId: managedRouteIds.run,
    responsibleUserId: managedRouteIds.human,
    scope,
    ...(scope === "worker_model" ? { workerModelBinding: {
      planId: managedRouteIds.plan, workerId: managedRouteIds.probe, workerAttemptId: managedRouteIds.nonce,
      executionManifestId: managedRouteIds.profile, expectedPlanVersion: 1,
    } } : {}),
    ...(scope === "conversation_model" ? { conversationModelBinding: {
      issueId: managedRouteIds.probe, conversationSessionGeneration: 1, executionManifestId: managedRouteIds.profile,
      executionManifestHash: managedRouteAuthorityHash,
    } } : {}),
    ...(scope === "provider_conformance" ? { providerConformanceBinding: {
      qualificationGroupId: managedRouteIds.group, probeId: managedRouteIds.probe, probeRunId: managedRouteIds.run,
      planId: managedRouteIds.plan, profileId: managedRouteIds.profile, dispatchNonce: managedRouteIds.nonce,
      authorityHash: managedRouteAuthorityHash,
    }, providerConformanceDeadlineAt: new Date(Date.now() + 30_000) } : {}),
  });
}

function managedMessagesApp(callManagedMessages: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json());
  app.use("/api", runtimeConnectionIntentRoutes({} as Db, { callManagedMessages } as never));
  app.use(errorHandler);
  return app;
}

describe("shared managed Messages route scopes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["worker_model", "conversation_model", "provider_conformance"] as const)(
    "forwards a valid %s claim to the shared gateway",
    async (scope) => {
      vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "managed-messages-route-test-secret");
      const callManagedMessages = vi.fn().mockResolvedValue({ sse: "event: message\ndata: {}\n\n" });
      const minted = managedRouteToken(scope);
      expect(minted).not.toBeNull();
      const response = await request(managedMessagesApp(callManagedMessages))
        .post("/api/runtime-tools/model/v1/messages")
        .set("Authorization", `Bearer ${minted!.token}`)
        .send({ probe: "synthetic" });
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(callManagedMessages).toHaveBeenCalledOnce();
      expect(callManagedMessages.mock.calls[0]?.[0]).toMatchObject({ scope, run_id: managedRouteIds.run });
      expect(callManagedMessages.mock.calls[0]?.[1]).toEqual({ probe: "synthetic" });
    },
  );

  it("keeps general RuntimeTools claims outside the typed managed model route", async () => {
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", "managed-messages-route-test-secret");
    const callManagedMessages = vi.fn();
    const minted = managedRouteToken("connection_intents");
    const response = await request(managedMessagesApp(callManagedMessages))
      .post("/api/runtime-tools/model/v1/messages")
      .set("Authorization", `Bearer ${minted!.token}`)
      .send({ probe: "synthetic" });
    expect(response.status).toBe(401);
    expect(callManagedMessages).not.toHaveBeenCalled();
  });
});
