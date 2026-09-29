import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectedKnowledgeAuthorizedScope,
  ConnectedKnowledgeProviderDescriptor,
  ConnectedKnowledgeRequest,
  EvidenceItem,
} from "@paperclipai/shared";
import {
  connectedKnowledgeContextProvider,
  createConnectedKnowledgeRegistry,
  type ConnectedKnowledgeProvider,
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
    projectId: randomUUID(),
    query: "current account status",
    intent: "prepare account review",
    subjectRefs: ["account:acme"],
    limit: 10,
    asOf: new Date().toISOString(),
    ...overrides,
  };
}

function scopeFor(
  input: ConnectedKnowledgeRequest,
  providerKey: string,
  overrides: Partial<ConnectedKnowledgeAuthorizedScope> = {},
): ConnectedKnowledgeAuthorizedScope {
  return {
    providerKey,
    companyId: input.companyId,
    agentId: input.agentId,
    responsibleUserId: input.responsibleUserId,
    runId: input.runId,
    aclVersion: "acl-v1",
    authorizedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    constraints: { accountIds: ["acme"] },
    ...overrides,
  };
}

function evidenceFor(
  input: ConnectedKnowledgeRequest,
  descriptor: ConnectedKnowledgeProviderDescriptor,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id: `evidence:${randomUUID()}`,
    companyId: input.companyId,
    sourceClass: "system_of_record",
    sourceProvider: descriptor.sourceProvider,
    sourceType: "account",
    sourceRef: "crm://account/acme",
    title: "Acme",
    excerpt: "Current opportunity stage: proposal.",
    sourceVersion: "42",
    sourceUpdatedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    validFrom: null,
    validUntil: null,
    authorityDomain: "crm_opportunity",
    trustLevel: "high",
    sensitivity: "internal",
    citation: { label: "Acme CRM record" },
    metadata: {},
    ...overrides,
  };
}

function provider(input?: {
  accessMode?: "live" | "synced" | "hybrid";
  sourceClasses?: ConnectedKnowledgeProviderDescriptor["sourceClasses"];
}) {
  const descriptor: ConnectedKnowledgeProviderDescriptor = {
    key: "crm-live",
    displayName: "CRM live",
    sourceProvider: "test_crm",
    accessMode: input?.accessMode ?? "live",
    sourceClasses: input?.sourceClasses ?? ["system_of_record"],
  };
  const authorize = vi.fn();
  const retrieveAuthorized = vi.fn();
  const value: ConnectedKnowledgeProvider = {
    descriptor,
    authorize,
    retrieveAuthorized,
  };
  return { value, descriptor, authorize, retrieveAuthorized };
}

describe("Connected Knowledge registry", () => {
  it("requires authorization before retrieval and forwards only a request-bound scope", async () => {
    const p = provider();
    const req = request();
    const authorizedScope = scopeFor(req, p.descriptor.key);
    p.authorize.mockResolvedValue({ allowed: true, scope: authorizedScope });
    p.retrieveAuthorized.mockResolvedValue({
      evidence: [evidenceFor(req, p.descriptor)],
    });
    const registry = createConnectedKnowledgeRegistry([p.value]);
    const controller = new AbortController();

    const result = await registry.retrieve({
      providerKey: p.descriptor.key,
      request: req,
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(p.authorize).toHaveBeenCalledTimes(1);
    expect(p.retrieveAuthorized).toHaveBeenCalledTimes(1);
    expect(p.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      p.retrieveAuthorized.mock.invocationCallOrder[0]!,
    );
    expect(p.retrieveAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({
        request: req,
        authorizedScope,
      }),
    );
    expect(result.evidence).toHaveLength(1);
  });

  it("fails closed before retrieval when access is denied", async () => {
    const p = provider();
    const req = request();
    p.authorize.mockResolvedValue({
      allowed: false,
      code: "permission_denied",
      reason: "Agent cannot read this CRM connection.",
    });
    const registry = createConnectedKnowledgeRegistry([p.value]);

    await expect(
      registry.retrieve({
        providerKey: p.descriptor.key,
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "connected_knowledge_permission_denied",
        providerKey: p.descriptor.key,
      }),
    });
    expect(p.retrieveAuthorized).not.toHaveBeenCalled();
  });

  it("rejects an authorization scope replayed for another tenant or principal", async () => {
    const p = provider();
    const req = request();
    p.authorize.mockResolvedValue({
      allowed: true,
      scope: scopeFor(req, p.descriptor.key, {
        companyId: randomUUID(),
      }),
    });
    const registry = createConnectedKnowledgeRegistry([p.value]);

    await expect(
      registry.retrieve({
        providerKey: p.descriptor.key,
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "connected_knowledge_scope_mismatch",
      }),
    });
    expect(p.retrieveAuthorized).not.toHaveBeenCalled();
  });

  it("rejects cross-company and undeclared evidence instead of filtering it after retrieval", async () => {
    const p = provider();
    const req = request();
    p.authorize.mockResolvedValue({
      allowed: true,
      scope: scopeFor(req, p.descriptor.key),
    });
    p.retrieveAuthorized.mockResolvedValue({
      evidence: [
        evidenceFor(req, p.descriptor, {
          companyId: randomUUID(),
        }),
      ],
    });
    const registry = createConnectedKnowledgeRegistry([p.value]);

    await expect(
      registry.retrieve({
        providerKey: p.descriptor.key,
        request: req,
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1_000,
      }),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({
        code: "company_boundary_denied",
      }),
    });
  });

  it("adapts a registered provider into the existing Context Engine provider contract", async () => {
    const p = provider();
    p.authorize.mockImplementation(async ({ request: req }) => ({
      allowed: true,
      scope: scopeFor(req, p.descriptor.key),
    }));
    p.retrieveAuthorized.mockImplementation(async ({ request: req }) => ({
      evidence: [evidenceFor(req, p.descriptor)],
    }));
    const registry = createConnectedKnowledgeRegistry([p.value]);
    const contextProvider = connectedKnowledgeContextProvider(
      registry,
      p.descriptor.key,
      { requirement: "mandatory", timeoutMs: 750 },
    );
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const projectId = randomUUID();
    const asOf = new Date();

    const result = await contextProvider.retrieve({
      request: {
        companyId,
        agentId,
        responsibleUserId: "user-1",
        runId: null,
        issueId,
        projectId,
        subjectRefs: ["account:acme", "account:acme"],
        query: "current status",
        intent: "account review",
        asOf,
        budget: {
          maxItems: 20,
          maxEstimatedTokens: 8_000,
          buckets: {
            foundation: { maxItems: 4 },
            connected_evidence: { maxItems: 7 },
            shared_memory: { maxItems: 4 },
            private_memory: { maxItems: 2 },
            task_context: { maxItems: 2 },
            artifacts: { maxItems: 1 },
          },
        },
      },
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    });

    expect(contextProvider).toMatchObject({
      key: "crm-live",
      requirement: "mandatory",
      timeoutMs: 750,
    });
    expect(p.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          companyId,
          agentId,
          issueId,
          projectId,
          subjectRefs: [
            "account:acme",
            `issue:${issueId}`,
            `project:${projectId}`,
          ],
          limit: 7,
          asOf: asOf.toISOString(),
        }),
      }),
    );
    expect(result.evidence).toHaveLength(1);
  });
});
