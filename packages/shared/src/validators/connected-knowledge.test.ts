import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  connectedKnowledgeAccessDecisionSchema,
  connectedKnowledgeAuthorizedScopeSchema,
  connectedKnowledgeEvidenceProvenanceSchema,
  connectedKnowledgeProviderDescriptorSchema,
  connectedKnowledgeRequestSchema,
} from "./connected-knowledge.js";

describe("Connected Knowledge validators", () => {
  it("accepts the live/synced/hybrid provider contract and rejects duplicate source classes", () => {
    expect(
      connectedKnowledgeProviderDescriptorSchema.parse({
        key: "drive-sync",
        displayName: "Drive sync",
        sourceProvider: "google_drive",
        accessMode: "synced",
        sourceClasses: ["system_of_record"],
      }),
    ).toMatchObject({ accessMode: "synced" });

    expect(() =>
      connectedKnowledgeProviderDescriptorSchema.parse({
        key: "drive-sync",
        displayName: "Drive sync",
        sourceProvider: "google_drive",
        accessMode: "synced",
        sourceClasses: ["system_of_record", "system_of_record"],
      }),
    ).toThrow();
  });

  it("requires an authorization scope whose lifetime moves forward", () => {
    const authorizedAt = new Date();
    expect(() =>
      connectedKnowledgeAuthorizedScopeSchema.parse({
        providerKey: "crm-live",
        companyId: randomUUID(),
        agentId: randomUUID(),
        responsibleUserId: null,
        runId: null,
        requestFingerprint: "0".repeat(64),
        aclVersion: "v1",
        authorizedAt: authorizedAt.toISOString(),
        expiresAt: authorizedAt.toISOString(),
        constraints: {},
      }),
    ).toThrow();
  });

  it("validates server-stamped Connected Knowledge evidence provenance", () => {
    const parsed = connectedKnowledgeEvidenceProvenanceSchema.parse({
      providerKey: "github-sync",
      sourceProvider: "github",
      accessMode: "synced",
      aclFingerprint: "acl-v1",
      authorizedAt: "2026-09-29T12:00:00.000Z",
      expiresAt: "2026-09-29T12:00:30.000Z",
      sourceAuthority: "provider",
      freshness: "fresh",
      indexedAt: "2026-09-29T11:59:00.000Z",
      tombstone: false,
    });

    expect(parsed).toMatchObject({
      providerKey: "github-sync",
      accessMode: "synced",
      freshness: "fresh",
      tombstone: false,
    });

    expect(() =>
      connectedKnowledgeEvidenceProvenanceSchema.parse({
        ...parsed,
        freshness: "maybe",
      }),
    ).toThrow();
  });

  it("keeps request and authorization decisions strict", () => {
    const parsedRequest = connectedKnowledgeRequestSchema.parse({
      companyId: randomUUID(),
      agentId: randomUUID(),
      responsibleUserId: null,
      runId: null,
      issueId: null,
      projectId: null,
      query: "quarterly plan",
      intent: null,
      subjectRefs: [],
      limit: 10,
      asOf: new Date().toISOString(),
    });
    expect(parsedRequest.query).toBe("quarterly plan");

    expect(
      connectedKnowledgeAccessDecisionSchema.parse({
        allowed: false,
        code: "scope_denied",
        reason: "Connection ACL excludes this subject.",
      }),
    ).toEqual({
      allowed: false,
      code: "scope_denied",
      reason: "Connection ACL excludes this subject.",
    });

    expect(() =>
      connectedKnowledgeRequestSchema.parse({
        ...parsedRequest,
        unexpected: true,
      }),
    ).toThrow();
  });
});
