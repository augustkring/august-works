import { createHash } from "node:crypto";
import {
  connectedKnowledgeAccessDecisionSchema,
  connectedKnowledgeAuthorizedScopeSchema,
  connectedKnowledgeEvidenceProvenanceSchema,
  connectedKnowledgeProviderDescriptorSchema,
  connectedKnowledgeRequestSchema,
  evidenceItemsSchema,
  type ConnectedKnowledgeAccessDecision,
  type ConnectedKnowledgeAuthorizedScope,
  type ConnectedKnowledgeFreshnessState,
  type ConnectedKnowledgeProviderDescriptor,
  type ConnectedKnowledgeProviderResult,
  type ConnectedKnowledgeRequest,
  type ContextProviderRequirement,
  type ContextProviderWarning,
  type EvidenceItem,
} from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import type {
  ContextProvider,
  ContextProviderInput,
} from "../context/context-engine.js";

export interface ConnectedKnowledgeAuthorizationInput {
  request: ConnectedKnowledgeRequest;
  requestFingerprint: string;
  signal: AbortSignal;
  deadlineAt: number;
}

export interface ConnectedKnowledgeRetrievalInput
  extends ConnectedKnowledgeAuthorizationInput {
  authorizedScope: ConnectedKnowledgeAuthorizedScope;
}

export interface ConnectedKnowledgeProvider {
  descriptor: ConnectedKnowledgeProviderDescriptor;
  authorize(
    input: ConnectedKnowledgeAuthorizationInput,
  ): Promise<ConnectedKnowledgeAccessDecision>;
  retrieveAuthorized(
    input: ConnectedKnowledgeRetrievalInput,
  ): Promise<ConnectedKnowledgeProviderResult>;
}

export interface ConnectedKnowledgeRegistryRetrieveInput {
  providerKey: string;
  request: ConnectedKnowledgeRequest;
  signal: AbortSignal;
  deadlineAt: number;
}

export interface ConnectedKnowledgeRegistry {
  list(): ConnectedKnowledgeProviderDescriptor[];
  get(providerKey: string): ConnectedKnowledgeProviderDescriptor | null;
  retrieve(
    input: ConnectedKnowledgeRegistryRetrieveInput,
  ): Promise<ConnectedKnowledgeProviderResult>;
}

interface RegisteredProvider {
  descriptor: ConnectedKnowledgeProviderDescriptor;
  provider: ConnectedKnowledgeProvider;
}

export function fingerprintConnectedKnowledgeRequest(
  request: ConnectedKnowledgeRequest,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        companyId: request.companyId,
        agentId: request.agentId,
        responsibleUserId: request.responsibleUserId,
        runId: request.runId,
        issueId: request.issueId,
        projectId: request.projectId,
        query: request.query,
        intent: request.intent,
        subjectRefs: [...request.subjectRefs].sort(),
        asOf: request.asOf,
      }),
    )
    .digest("hex");
}

function scopesMatch(
  scope: ConnectedKnowledgeAuthorizedScope,
  descriptor: ConnectedKnowledgeProviderDescriptor,
  request: ConnectedKnowledgeRequest,
  requestFingerprint: string,
): boolean {
  return (
    scope.providerKey === descriptor.key &&
    scope.companyId === request.companyId &&
    scope.agentId === request.agentId &&
    scope.responsibleUserId === request.responsibleUserId &&
    scope.runId === request.runId &&
    scope.requestFingerprint === requestFingerprint
  );
}

function assertAuthorizedScope(
  scope: ConnectedKnowledgeAuthorizedScope,
  descriptor: ConnectedKnowledgeProviderDescriptor,
  request: ConnectedKnowledgeRequest,
  requestFingerprint: string,
): void {
  if (!scopesMatch(scope, descriptor, request, requestFingerprint)) {
    throw forbidden("Connected Knowledge authorization scope is not bound to this request", {
      code: "connected_knowledge_scope_mismatch",
      providerKey: descriptor.key,
    });
  }

  if (
    scope.expiresAt &&
    new Date(scope.expiresAt).getTime() <= Date.now()
  ) {
    throw forbidden("Connected Knowledge authorization scope has expired", {
      code: "connected_knowledge_scope_expired",
      providerKey: descriptor.key,
    });
  }
}

function validateProviderEvidence(
  descriptor: ConnectedKnowledgeProviderDescriptor,
  request: ConnectedKnowledgeRequest,
  rawEvidence: unknown,
) {
  const evidence = evidenceItemsSchema.parse(rawEvidence);
  const allowedSourceClasses = new Set<string>(descriptor.sourceClasses);

  for (const item of evidence) {
    if (item.companyId !== request.companyId) {
      throw forbidden("Connected Knowledge provider returned cross-company evidence", {
        code: "company_boundary_denied",
        providerKey: descriptor.key,
        evidenceId: item.id,
      });
    }

    if (item.sourceProvider !== descriptor.sourceProvider) {
      throw forbidden("Connected Knowledge provider returned evidence for an undeclared source provider", {
        code: "connected_knowledge_source_provider_mismatch",
        providerKey: descriptor.key,
        evidenceId: item.id,
      });
    }

    if (!allowedSourceClasses.has(item.sourceClass)) {
      throw forbidden("Connected Knowledge provider returned evidence outside its declared source classes", {
        code: "connected_knowledge_source_class_mismatch",
        providerKey: descriptor.key,
        evidenceId: item.id,
        sourceClass: item.sourceClass,
      });
    }
  }

  return evidence;
}

function metadataRecord(
  item: EvidenceItem,
): Record<string, unknown> {
  return item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata
    : {};
}

function requireSyncedEvidenceInvariants(
  descriptor: ConnectedKnowledgeProviderDescriptor,
  scope: ConnectedKnowledgeAuthorizedScope,
  item: EvidenceItem,
): {
  freshness: ConnectedKnowledgeFreshnessState;
  indexedAt: string;
} {
  if (!scope.aclVersion) {
    throw new Error(
      `Connected Knowledge synced provider ${descriptor.key} did not produce an ACL fingerprint`,
    );
  }

  const metadata = metadataRecord(item);
  const freshness = metadata.freshness;
  const indexedAt = metadata.indexedAt;
  const contentHash = metadata.contentHash;
  const aclFingerprint = metadata.aclFingerprint;

  if (
    typeof freshness !== "string" ||
    ![
      "fresh",
      "stale",
      "unknown",
      "reauthorization_required",
      "unreachable",
    ].includes(freshness)
  ) {
    throw new Error(
      `Connected Knowledge synced provider ${descriptor.key} returned invalid freshness metadata`,
    );
  }
  if (
    typeof indexedAt !== "string" ||
    Number.isNaN(new Date(indexedAt).getTime())
  ) {
    throw new Error(
      `Connected Knowledge synced provider ${descriptor.key} returned invalid indexedAt metadata`,
    );
  }
  if (
    metadata.providerIsAuthority !== true ||
    typeof contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(contentHash) ||
    typeof metadata.externalId !== "string" ||
    typeof metadata.objectType !== "string" ||
    !Object.prototype.hasOwnProperty.call(metadata, "remoteVersion") ||
    !Object.prototype.hasOwnProperty.call(metadata, "etag") ||
    typeof metadata.tombstone !== "boolean" ||
    item.sourceUpdatedAt === null
  ) {
    throw new Error(
      `Connected Knowledge synced provider ${descriptor.key} did not preserve required sync provenance`,
    );
  }
  if (aclFingerprint !== scope.aclVersion) {
    throw forbidden(
      "Connected Knowledge evidence ACL fingerprint does not match the authorized scope",
      {
        code: "connected_knowledge_acl_mismatch",
        providerKey: descriptor.key,
        evidenceId: item.id,
      },
    );
  }
  if (metadata.tombstone === true) {
    throw forbidden(
      "Connected Knowledge provider attempted to surface tombstoned content",
      {
        code: "connected_knowledge_tombstone_leak",
        providerKey: descriptor.key,
        evidenceId: item.id,
      },
    );
  }

  return {
    freshness: freshness as ConnectedKnowledgeFreshnessState,
    indexedAt: new Date(indexedAt).toISOString(),
  };
}

function hardenConnectedEvidence(input: {
  descriptor: ConnectedKnowledgeProviderDescriptor;
  scope: ConnectedKnowledgeAuthorizedScope;
  evidence: EvidenceItem[];
}): {
  evidence: EvidenceItem[];
  warnings: ContextProviderWarning[];
} {
  const hardened: EvidenceItem[] = [];
  let staleCount = 0;
  let unavailableCount = 0;

  for (const item of input.evidence) {
    const metadata = metadataRecord(item);
    if (metadata.tombstone === true) {
      throw forbidden(
        "Connected Knowledge provider attempted to surface tombstoned content",
        {
          code: "connected_knowledge_tombstone_leak",
          providerKey: input.descriptor.key,
          evidenceId: item.id,
        },
      );
    }

    const synced =
      input.descriptor.accessMode === "synced" ||
      input.descriptor.accessMode === "hybrid";
    const syncState = synced
      ? requireSyncedEvidenceInvariants(
          input.descriptor,
          input.scope,
          item,
        )
      : {
          freshness: "fresh" as const,
          indexedAt: item.observedAt,
        };

    if (
      syncState.freshness === "reauthorization_required" ||
      syncState.freshness === "unreachable"
    ) {
      unavailableCount += 1;
      continue;
    }
    if (
      syncState.freshness === "stale" ||
      syncState.freshness === "unknown"
    ) {
      staleCount += 1;
    }

    const provenance = connectedKnowledgeEvidenceProvenanceSchema.parse({
      providerKey: input.descriptor.key,
      sourceProvider: input.descriptor.sourceProvider,
      accessMode: input.descriptor.accessMode,
      aclFingerprint: input.scope.aclVersion,
      authorizedAt: input.scope.authorizedAt,
      expiresAt: input.scope.expiresAt,
      sourceAuthority: "provider",
      freshness: syncState.freshness,
      indexedAt: syncState.indexedAt,
      tombstone: false,
    });

    hardened.push({
      ...item,
      metadata: {
        ...metadata,
        aclFingerprint: input.scope.aclVersion,
        freshness: syncState.freshness,
        indexedAt: syncState.indexedAt,
        tombstone: false,
        connectedKnowledge: provenance,
      },
    });
  }

  const warnings: ContextProviderWarning[] = [];
  if (staleCount > 0) {
    warnings.push({
      providerKey: input.descriptor.key,
      code: "stale_source",
      message:
        `${staleCount} Connected Knowledge result${staleCount === 1 ? "" : "s"} ` +
        "came from a stale or freshness-unknown synchronized source.",
    });
  }
  if (unavailableCount > 0) {
    warnings.push({
      providerKey: input.descriptor.key,
      code: "source_unavailable",
      message:
        `${unavailableCount} Connected Knowledge result${unavailableCount === 1 ? "" : "s"} ` +
        "were omitted because the synchronized source could not be freshly authorized or reached.",
    });
  }

  return { evidence: hardened, warnings };
}

export function createConnectedKnowledgeRegistry(
  providers: ConnectedKnowledgeProvider[],
): ConnectedKnowledgeRegistry {
  const registered = new Map<string, RegisteredProvider>();

  for (const provider of providers) {
    const descriptor = connectedKnowledgeProviderDescriptorSchema.parse(
      provider.descriptor,
    );
    if (registered.has(descriptor.key)) {
      throw new Error(
        `Duplicate Connected Knowledge provider key: ${descriptor.key}`,
      );
    }
    registered.set(descriptor.key, { descriptor, provider });
  }

  return {
    list: () =>
      [...registered.values()]
        .map(({ descriptor }) => ({
          ...descriptor,
          sourceClasses: [...descriptor.sourceClasses],
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),

    get: (providerKey) => {
      const found = registered.get(providerKey);
      if (!found) return null;
      return {
        ...found.descriptor,
        sourceClasses: [...found.descriptor.sourceClasses],
      };
    },

    retrieve: async (rawInput) => {
      const found = registered.get(rawInput.providerKey);
      if (!found) {
        throw new Error(
          `Unknown Connected Knowledge provider: ${rawInput.providerKey}`,
        );
      }

      const request = connectedKnowledgeRequestSchema.parse(rawInput.request);
      const requestFingerprint = fingerprintConnectedKnowledgeRequest(request);
      const decision = connectedKnowledgeAccessDecisionSchema.parse(
        await found.provider.authorize({
          request,
          requestFingerprint,
          signal: rawInput.signal,
          deadlineAt: rawInput.deadlineAt,
        }),
      );

      if (!decision.allowed) {
        throw forbidden(decision.reason, {
          code: "connected_knowledge_permission_denied",
          providerKey: found.descriptor.key,
          denialCode: decision.code,
        });
      }

      const scope = connectedKnowledgeAuthorizedScopeSchema.parse(
        decision.scope,
      );
      assertAuthorizedScope(
        scope,
        found.descriptor,
        request,
        requestFingerprint,
      );

      // Retrieval is deliberately unreachable until authorization has produced a
      // request-bound scope. Provider implementations must use this scope to
      // construct the permitted retrieval universe before search/ranking.
      const result = await found.provider.retrieveAuthorized({
        request,
        requestFingerprint,
        authorizedScope: scope,
        signal: rawInput.signal,
        deadlineAt: rawInput.deadlineAt,
      });

      const validated = validateProviderEvidence(
        found.descriptor,
        request,
        result.evidence,
      );
      const hardened = hardenConnectedEvidence({
        descriptor: found.descriptor,
        scope,
        evidence: validated,
      });
      const warnings = [
        ...(result.warnings ?? []),
        ...hardened.warnings,
      ].map((warning) => ({
        ...warning,
        providerKey: found.descriptor.key,
      }));

      return { evidence: hardened.evidence, warnings };
    },
  };
}

function connectedKnowledgeRequestFromContext(
  input: ContextProviderInput,
): ConnectedKnowledgeRequest | null {
  const connectedEvidenceLimit =
    input.request.budget?.buckets.connected_evidence.maxItems ?? 10;
  if (connectedEvidenceLimit <= 0) return null;

  const subjectRefs = [
    ...(input.request.subjectRefs ?? []),
    ...(input.request.issueId ? [`issue:${input.request.issueId}`] : []),
    ...(input.request.projectId ? [`project:${input.request.projectId}`] : []),
  ];

  return connectedKnowledgeRequestSchema.parse({
    companyId: input.request.companyId,
    agentId: input.request.agentId,
    responsibleUserId: input.request.responsibleUserId ?? null,
    runId: input.request.runId ?? null,
    issueId: input.request.issueId ?? null,
    projectId: input.request.projectId ?? null,
    query: input.request.query,
    intent: input.request.intent?.trim() || null,
    subjectRefs: [...new Set(subjectRefs)],
    limit: Math.min(100, Math.max(1, connectedEvidenceLimit)),
    asOf: (input.request.asOf ?? new Date()).toISOString(),
  });
}

export function connectedKnowledgeContextProvider(
  registry: ConnectedKnowledgeRegistry,
  providerKey: string,
  options: {
    requirement?: ContextProviderRequirement;
    timeoutMs?: number;
  } = {},
): ContextProvider {
  const descriptor = registry.get(providerKey);
  if (!descriptor) {
    throw new Error(
      `Unknown Connected Knowledge provider: ${providerKey}`,
    );
  }

  return {
    key: descriptor.key,
    requirement: options.requirement ?? "optional",
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    async retrieve(input) {
      const request = connectedKnowledgeRequestFromContext(input);
      if (!request) return { evidence: [] };

      return registry.retrieve({
        providerKey: descriptor.key,
        request,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      });
    },
  };
}

