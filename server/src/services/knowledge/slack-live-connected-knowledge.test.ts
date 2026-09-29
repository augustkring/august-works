import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectedKnowledgeRequest,
} from "@paperclipai/shared";
import {
  createSlackLiveConnectedKnowledgeProvider,
  type SlackLiveKnowledgeDependencies,
} from "./slack-live-connected-knowledge.js";
import {
  createConnectedKnowledgeRegistry,
} from "./connected-knowledge.js";

function request(
  overrides: Partial<ConnectedKnowledgeRequest> = {},
): ConnectedKnowledgeRequest {
  return {
    companyId: randomUUID(),
    agentId: randomUUID(),
    responsibleUserId: "user-1",
    runId: randomUUID(),
    issueId: randomUUID(),
    projectId: null,
    query: "renewal risk",
    intent: "account review",
    subjectRefs: [],
    limit: 10,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function resource(
  input: ConnectedKnowledgeRequest,
  overrides: Partial<{
    endpointId: string;
    connectionId: string;
    workspaceId: string;
    channelId: string;
    responsibleUserId: string;
    authorizationRevision: string;
  }> = {},
) {
  return {
    endpointId: randomUUID(),
    connectionId: randomUUID(),
    workspaceId: "T123",
    channelId: "C123",
    responsibleUserId: input.responsibleUserId ?? "user-1",
    authorizationRevision: "revision-1",
    ...overrides,
  };
}

function deps(): {
  value: SlackLiveKnowledgeDependencies;
  listAuthorizedResources: ReturnType<typeof vi.fn>;
  searchAuthorizedResource: ReturnType<typeof vi.fn>;
} {
  const listAuthorizedResources = vi.fn();
  const searchAuthorizedResource = vi.fn();
  return {
    value: {
      listAuthorizedResources,
      searchAuthorizedResource,
    },
    listAuthorizedResources,
    searchAuthorizedResource,
  };
}

describe("Slack live Connected Knowledge", () => {
  it("requires a run, task and accepted responsible user before admitting Slack", async () => {
    const d = deps();
    const provider = createSlackLiveConnectedKnowledgeProvider(d.value);
    const registry = createConnectedKnowledgeRegistry([provider]);

    await expect(
      registry.retrieve({
        providerKey: "slack-live",
        request: request({
          runId: null,
          issueId: null,
          responsibleUserId: null,
        }),
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "connected_knowledge_permission_denied",
        denialCode: "principal_unresolved",
      }),
    });
    expect(d.listAuthorizedResources).not.toHaveBeenCalled();
    expect(d.searchAuthorizedResource).not.toHaveBeenCalled();
  });

  it("uses Slack subject refs only to narrow authorized channels, never to widen them", async () => {
    const req = request({
      subjectRefs: ["slack:channel:C999"],
    });
    const d = deps();
    d.listAuthorizedResources.mockResolvedValue([
      resource(req, { channelId: "C123" }),
    ]);
    const registry = createConnectedKnowledgeRegistry([
      createSlackLiveConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "slack-live",
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        denialCode: "scope_denied",
      }),
    });
    expect(d.searchAuthorizedResource).not.toHaveBeenCalled();
  });

  it("fails closed on malformed Slack channel subject refs instead of widening scope", async () => {
    const req = request({
      subjectRefs: ["slack:channel:not-a-valid-channel"],
    });
    const d = deps();
    d.listAuthorizedResources.mockResolvedValue([
      resource(req, { channelId: "C123" }),
    ]);
    const registry = createConnectedKnowledgeRegistry([
      createSlackLiveConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "slack-live",
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        denialCode: "scope_denied",
      }),
    });
    expect(d.searchAuthorizedResource).not.toHaveBeenCalled();
  });

  it("normalizes live Slack messages as untrusted evidence with private sensitivity", async () => {
    const req = request({ limit: 3 });
    const allowed = resource(req);
    const d = deps();
    d.listAuthorizedResources.mockResolvedValue([allowed]);
    d.searchAuthorizedResource.mockResolvedValue({
      channelName: "account-acme",
      privateChannel: true,
      directMessage: false,
      retrievalMode: "bounded_history",
      exhaustive: false,
      coverage: "Newest authorized Slack history only.",
      matches: [
        {
          ts: "1790683200.123456",
          threadTs: null,
          userId: "U123",
          text: "Customer mentioned renewal risk in the last call.",
          sourceUrl:
            "https://app.slack.com/client/T123/C123/thread/C123-1790683200.123456",
        },
      ],
    });
    const registry = createConnectedKnowledgeRegistry([
      createSlackLiveConnectedKnowledgeProvider(d.value),
    ]);

    const result = await registry.retrieve({
      providerKey: "slack-live",
      request: req,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(d.searchAuthorizedResource).toHaveBeenCalledWith(
      expect.objectContaining({
        request: req,
        resource: allowed,
        limit: 3,
      }),
    );
    expect(result.evidence).toEqual([
      expect.objectContaining({
        companyId: req.companyId,
        sourceClass: "external_untrusted",
        sourceProvider: "slack",
        sourceType: "slack_message",
        sourceRef:
          "slack://T123/C123/1790683200.123456",
        excerpt:
          "Customer mentioned renewal risk in the last call.",
        sourceVersion: "1790683200.123456",
        trustLevel: "untrusted",
        sensitivity: "confidential",
        citation: {
          label: "Slack #account-acme",
          href:
            "https://app.slack.com/client/T123/C123/thread/C123-1790683200.123456",
        },
        metadata: expect.objectContaining({
          endpointId: allowed.endpointId,
          connectionId: allowed.connectionId,
          authorizationRevision: "revision-1",
          retrievalMode: "bounded_history",
          exhaustive: false,
        }),
      }),
    ]);
  });

  it("binds the ACL snapshot to the responsible user and enforces the global evidence limit", async () => {
    const req = request({ limit: 1 });
    const allowed = resource(req, { channelId: "C123" });
    const wrongUser = resource(req, {
      channelId: "C456",
      responsibleUserId: "user-2",
    });
    const d = deps();
    d.listAuthorizedResources.mockResolvedValue([wrongUser, allowed]);
    d.searchAuthorizedResource.mockResolvedValue({
      channelName: "public-channel",
      privateChannel: false,
      directMessage: false,
      retrievalMode: "bounded_history",
      exhaustive: false,
      coverage: null,
      matches: [
        {
          ts: "1790683201.000001",
          threadTs: null,
          userId: null,
          text: "One",
          sourceUrl: null,
        },
        {
          ts: "1790683202.000001",
          threadTs: null,
          userId: null,
          text: "Two",
          sourceUrl: null,
        },
      ],
    });
    const registry = createConnectedKnowledgeRegistry([
      createSlackLiveConnectedKnowledgeProvider(d.value),
    ]);

    const result = await registry.retrieve({
      providerKey: "slack-live",
      request: req,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(result.evidence).toHaveLength(1);
    expect(d.searchAuthorizedResource).toHaveBeenCalledTimes(1);
    expect(d.searchAuthorizedResource).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: allowed,
        limit: 1,
      }),
    );
    expect(result.evidence[0]).toMatchObject({
      sensitivity: "internal",
      excerpt: "One",
    });
  });
});
