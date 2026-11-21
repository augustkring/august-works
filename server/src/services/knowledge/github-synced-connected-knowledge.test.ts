import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ConnectedKnowledgeAuthorizedScope, ConnectedKnowledgeRequest } from "@paperclipai/shared";
import type { NativeContextInspectionOwner } from "../authorization.js";
import {
  createGitHubSyncedConnectedKnowledgeProvider,
  githubSyncedKnowledgeActorMatchesRequest,
  type GitHubSyncedKnowledgeDependencies,
  type GitHubSyncedKnowledgeObject,
} from "./github-synced-connected-knowledge.js";
import { createConnectedKnowledgeRegistry, fingerprintConnectedKnowledgeRequest } from "./connected-knowledge.js";

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
    query: "critical bug",
    intent: "task execution",
    subjectRefs: [],
    limit: 10,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function object(
  input: ConnectedKnowledgeRequest,
  overrides: Partial<GitHubSyncedKnowledgeObject> = {},
): GitHubSyncedKnowledgeObject {
  return {
    id: randomUUID(),
    companyId: input.companyId,
    providerKey: "github",
    objectType: "issue",
    externalId: "openai/example#issues/42",
    sanitizedCanonicalUrl: "https://github.com/openai/example/issues/42",
    displayKey: "GitHub Issue",
    displayTitle: "openai/example#42: Critical bug",
    statusKey: "open",
    statusLabel: "Open",
    statusCategory: "open",
    liveness: "fresh",
    isTerminal: false,
    data: {
      state: "open",
      authorLogin: "octocat",
    },
    remoteVersion: "2026-09-29T12:00:00.000Z",
    etag: "\"etag-42\"",
    lastResolvedAt: new Date("2026-09-29T12:01:00.000Z"),
    lastChangedAt: new Date("2026-09-29T12:00:00.000Z"),
    nextRefreshAt: new Date("2026-09-29T12:06:00.000Z"),
    updatedAt: new Date("2026-09-29T12:01:00.000Z"),
    ...overrides,
  };
}

function deps(): {
  value: GitHubSyncedKnowledgeDependencies;
  authorizeIssue: ReturnType<typeof vi.fn>;
  listAuthorizedObjectIds: ReturnType<typeof vi.fn>;
  loadObjects: ReturnType<typeof vi.fn>;
} {
  const authorizeIssue = vi.fn();
  const listAuthorizedObjectIds = vi.fn();
  const loadObjects = vi.fn();
  return {
    value: {
      authorizeIssue,
      listAuthorizedObjectIds,
      loadObjects,
    },
    authorizeIssue,
    listAuthorizedObjectIds,
    loadObjects,
  };
}

describe("GitHub synced Connected Knowledge", () => {

  it("keeps current authorization inside direct retrieval calls", async () => {
    const req = request();
    const d = deps();
    d.authorizeIssue.mockResolvedValue({ allowed: true, authorizationVersion: "issue-acl-v1" });
    d.listAuthorizedObjectIds.mockResolvedValue([]);
    const provider = createGitHubSyncedConnectedKnowledgeProvider(d.value);
    const requestFingerprint = fingerprintConnectedKnowledgeRequest(req);
    const authorizedScope: ConnectedKnowledgeAuthorizedScope = {
      providerKey: "github-sync",
      companyId: req.companyId,
      agentId: req.agentId,
      responsibleUserId: req.responsibleUserId,
      runId: req.runId,
      requestFingerprint,
      aclVersion: "acl-v1",
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      constraints: { issueId: req.issueId, objectIds: [] },
    };

    await provider.retrieveAuthorized({
      request: req,
      requestFingerprint,
      authorizedScope,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(d.authorizeIssue).toHaveBeenCalledTimes(1);
    expect(d.authorizeIssue).toHaveBeenCalledWith({ request: req });
  });

  it("rejects direct retrieval with a mismatched request fingerprint", async () => {
    const req = request();
    const d = deps();
    const provider = createGitHubSyncedConnectedKnowledgeProvider(d.value);
    const requestFingerprint = fingerprintConnectedKnowledgeRequest(req);
    const authorizedScope: ConnectedKnowledgeAuthorizedScope = {
      providerKey: "github-sync",
      companyId: req.companyId,
      agentId: req.agentId,
      responsibleUserId: req.responsibleUserId,
      runId: req.runId,
      requestFingerprint,
      aclVersion: "acl-v1",
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      constraints: { issueId: req.issueId, objectIds: [] },
    };

    await expect(provider.retrieveAuthorized({
      request: req,
      requestFingerprint: "0".repeat(64),
      authorizedScope,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    })).rejects.toMatchObject({ status: 403 });
    expect(d.authorizeIssue).not.toHaveBeenCalled();
  });

  it("binds the private Context reader to the exact company, agent, run, and human", () => {
    const req = request();
    const actor = {
      type: "agent" as const,
      source: "none" as const,
      companyId: req.companyId,
      agentId: req.agentId,
      runId: req.runId,
      onBehalfOfUserId: req.responsibleUserId,
    };
    expect(githubSyncedKnowledgeActorMatchesRequest(req, actor)).toBe(true);
    expect(githubSyncedKnowledgeActorMatchesRequest(req, { ...actor, runId: randomUUID() })).toBe(false);
    expect(githubSyncedKnowledgeActorMatchesRequest(req, { ...actor, onBehalfOfUserId: "other-human" })).toBe(false);
  });


  it("reuses the exact server reader for the immediate pre-retrieval check", async () => {
    const req = request();
    const actor = {
      type: "agent" as const,
      source: "none" as const,
      companyId: req.companyId,
      agentId: req.agentId,
      runId: req.runId,
      onBehalfOfUserId: req.responsibleUserId,
    };
    const decision = vi.fn();
    const synced = object(req);
    const d = deps();
    d.authorizeIssue.mockResolvedValue({ allowed: true, authorizationVersion: "issue-acl-v1" });
    d.listAuthorizedObjectIds.mockResolvedValue([synced.id]);
    d.loadObjects.mockResolvedValue([synced]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await registry.retrieve({
      providerKey: "github-sync",
      request: req,
      authorizationActor: actor,
      authorizationDecision: decision,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(d.authorizeIssue).toHaveBeenCalledTimes(3);
    for (const call of d.authorizeIssue.mock.calls) {
      expect(call[0]).toMatchObject({ request: req, authorizationActor: actor, authorizationDecision: decision });
    }
    expect(d.loadObjects).toHaveBeenCalledWith({ request: req, objectIds: [synced.id] });
    expect(JSON.stringify(d.loadObjects.mock.calls)).not.toContain("authorizationDecision");
  });

  it("forwards the source-none bootstrap actor without fabricating a callback", async () => {
    const req = request();
    const actor = {
      type: "agent" as const,
      source: "none" as const,
      companyId: req.companyId,
      agentId: req.agentId,
      runId: req.runId,
      onBehalfOfUserId: req.responsibleUserId,
    };
    const d = deps();
    d.authorizeIssue.mockResolvedValue({ allowed: true, authorizationVersion: "issue-acl-v1" });
    d.listAuthorizedObjectIds.mockResolvedValue([]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await expect(registry.retrieve({
      providerKey: "github-sync",
      request: req,
      authorizationActor: actor,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    })).resolves.toMatchObject({ evidence: [] });

    expect(d.authorizeIssue).toHaveBeenCalledTimes(3);
    expect(d.authorizeIssue.mock.calls[0]![0]).toMatchObject({ request: req, authorizationActor: actor });
    expect(d.authorizeIssue.mock.calls[0]![0]).not.toHaveProperty("authorizationDecision");
    expect(d.authorizeIssue.mock.calls[1]![0]).toMatchObject({ request: req, authorizationActor: actor });
    expect(d.authorizeIssue.mock.calls[1]![0]).not.toHaveProperty("authorizationDecision");
    expect(d.authorizeIssue.mock.calls[2]![0]).toMatchObject({ request: req, authorizationActor: actor });
    expect(d.authorizeIssue.mock.calls[2]![0]).not.toHaveProperty("authorizationDecision");
  });

  it("uses the task-bound decision callback and refuses a different task", async () => {
    const req = request();
    const actor = {
      type: "agent" as const,
      source: "none" as const,
      companyId: req.companyId,
      agentId: req.agentId,
      runId: req.runId,
      onBehalfOfUserId: req.responsibleUserId,
    };
    const boundTaskId = req.issueId;
    const decision = vi.fn(async ({ resource }: Parameters<NativeContextInspectionOwner["decide"]>[0]) => ({
      allowed: resource.type === "issue" && resource.issueId === boundTaskId,
      action: "issue:read" as const,
      explanation: "task-scoped test decision",
      reason: resource.type === "issue" && resource.issueId === boundTaskId ? "allow_self" as const : "deny_issue_private" as const,
    }));
    const d = deps();
    d.authorizeIssue.mockImplementation(async ({ request: authRequest, authorizationActor, authorizationDecision }) => {
      const result = await authorizationDecision!({
        actor: authorizationActor!,
        action: "issue:read",
        resource: { type: "issue", companyId: authRequest.companyId, issueId: authRequest.issueId } as never,
      });
      return result.allowed
        ? { allowed: true, authorizationVersion: "issue-acl-v1" }
        : { allowed: false, reason: result.reason };
    });
    d.listAuthorizedObjectIds.mockResolvedValue([]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);
    const common = {
      providerKey: "github-sync",
      authorizationActor: actor,
      authorizationDecision: decision,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    };

    await expect(registry.retrieve({ ...common, request: req })).resolves.toMatchObject({ evidence: [] });
    expect(decision).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      action: "issue:read",
      resource: expect.objectContaining({ issueId: boundTaskId }),
    }));

    await expect(registry.retrieve({ ...common, request: { ...req, issueId: randomUUID() } }))
      .rejects.toMatchObject({ status: 403 });
    expect(d.listAuthorizedObjectIds).toHaveBeenCalledTimes(2);
    expect(decision).toHaveBeenLastCalledWith(expect.objectContaining({
      actor,
      action: "issue:read",
      resource: expect.objectContaining({ issueId: expect.not.stringMatching(String(boundTaskId)) }),
    }));
  });

  it("requires task scope before touching synced objects", async () => {
    const d = deps();
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "github-sync",
        request: request({ issueId: null }),
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        denialCode: "principal_unresolved",
      }),
    });
    expect(d.authorizeIssue).not.toHaveBeenCalled();
    expect(d.listAuthorizedObjectIds).not.toHaveBeenCalled();
    expect(d.loadObjects).not.toHaveBeenCalled();
  });

  it("fails authorization before constructing the permitted retrieval universe", async () => {
    const req = request();
    const d = deps();
    d.authorizeIssue.mockResolvedValue({
      allowed: false,
      reason: "Issue access denied.",
    });
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "github-sync",
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        denialCode: "permission_denied",
      }),
    });
    expect(d.listAuthorizedObjectIds).not.toHaveBeenCalled();
    expect(d.loadObjects).not.toHaveBeenCalled();
  });

  it("normalizes authorized cached GitHub state with sync and freshness provenance", async () => {
    const req = request({
      asOf: "2026-09-29T12:02:00.000Z",
    });
    const synced = object(req);
    const d = deps();
    d.authorizeIssue.mockResolvedValue({
      allowed: true,
      authorizationVersion: "issue-acl-v1",
    });
    d.listAuthorizedObjectIds.mockResolvedValue([synced.id]);
    d.loadObjects.mockResolvedValue([synced]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    const result = await registry.retrieve({
      providerKey: "github-sync",
      request: req,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(d.authorizeIssue).toHaveBeenCalledTimes(3);
    expect(d.listAuthorizedObjectIds).toHaveBeenCalledTimes(2);
    expect(d.loadObjects).toHaveBeenCalledWith({
      request: req,
      objectIds: [synced.id],
    });
    expect(result.evidence).toEqual([
      expect.objectContaining({
        id: `github-sync:${synced.id}`,
        companyId: req.companyId,
        sourceClass: "external_untrusted",
        sourceProvider: "github",
        sourceType: "github_issue",
        sourceRef: synced.sanitizedCanonicalUrl,
        title: synced.displayTitle,
        sourceVersion: synced.remoteVersion,
        sourceUpdatedAt: "2026-09-29T12:00:00.000Z",
        observedAt: "2026-09-29T12:01:00.000Z",
        trustLevel: "untrusted",
        sensitivity: "internal",
        citation: {
          label: synced.displayTitle,
          href: synced.sanitizedCanonicalUrl,
        },
        metadata: expect.objectContaining({
          syncMode: "synced",
          providerIsAuthority: true,
          remoteVersion: synced.remoteVersion,
          etag: synced.etag,
          indexedAt: "2026-09-29T12:01:00.000Z",
          tombstone: false,
          freshness: "fresh",
          stale: false,
          aclFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
          contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          retrievalScore: expect.any(Number),
        }),
      }),
    ]);
  });

  it("re-authorizes before retrieval and fails closed when access was revoked", async () => {
    const req = request();
    const synced = object(req);
    const d = deps();
    d.authorizeIssue
      .mockResolvedValueOnce({
        allowed: true,
        authorizationVersion: "issue-acl-v1",
      })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "Access revoked.",
      });
    d.listAuthorizedObjectIds.mockResolvedValue([synced.id]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "github-sync",
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "connected_knowledge_permission_denied",
      }),
    });
    expect(d.listAuthorizedObjectIds).toHaveBeenCalledTimes(1);
    expect(d.loadObjects).not.toHaveBeenCalled();
  });

  it("intersects the authorization snapshot with current issue provenance before loading content", async () => {
    const req = request();
    const synced = object(req);
    const d = deps();
    d.authorizeIssue.mockResolvedValue({
      allowed: true,
      authorizationVersion: "issue-acl-v1",
    });
    d.listAuthorizedObjectIds
      .mockResolvedValueOnce([synced.id])
      .mockResolvedValueOnce([]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    const result = await registry.retrieve({
      providerKey: "github-sync",
      request: req,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(result.evidence).toEqual([]);
    expect(d.loadObjects).not.toHaveBeenCalled();
  });

  it("ranks only the authorized cache and omits GitHub tombstones", async () => {
    const req = request({ limit: 1, query: "critical bug" });
    const lessRelevant = object(req, {
      id: randomUUID(),
      externalId: "openai/example#issues/41",
      displayTitle: "openai/example#41: Routine maintenance",
    });
    const relevant = object(req, {
      id: randomUUID(),
      externalId: "openai/example#issues/42",
      displayTitle: "openai/example#42: Critical bug in billing",
    });
    const tombstone = object(req, {
      id: randomUUID(),
      externalId: "openai/example#issues/43",
      displayTitle: "openai/example#43: Critical bug old copy",
      statusKey: "not_found",
      statusLabel: "Not found",
      data: { notFound: true },
    });
    const d = deps();
    d.authorizeIssue.mockResolvedValue({
      allowed: true,
      authorizationVersion: "issue-acl-v1",
    });
    d.listAuthorizedObjectIds.mockResolvedValue([
      lessRelevant.id,
      relevant.id,
      tombstone.id,
    ]);
    d.loadObjects.mockResolvedValue([
      lessRelevant,
      tombstone,
      relevant,
    ]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    const result = await registry.retrieve({
      providerKey: "github-sync",
      request: req,
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.title).toContain("Critical bug in billing");
    expect(result.evidence[0]?.metadata.tombstone).toBe(false);
  });

  it("rejects dependency output outside the authorized object-id scope", async () => {
    const req = request();
    const scoped = object(req);
    const injected = object(req, { id: randomUUID() });
    const d = deps();
    d.authorizeIssue.mockResolvedValue({
      allowed: true,
      authorizationVersion: "issue-acl-v1",
    });
    d.listAuthorizedObjectIds.mockResolvedValue([scoped.id]);
    d.loadObjects.mockResolvedValue([scoped, injected]);
    const registry = createConnectedKnowledgeRegistry([
      createGitHubSyncedConnectedKnowledgeProvider(d.value),
    ]);

    await expect(
      registry.retrieve({
        providerKey: "github-sync",
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "connected_knowledge_scope_invalid",
      }),
    });
  });
});
