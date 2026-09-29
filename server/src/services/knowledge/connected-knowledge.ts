import {
  connectedKnowledgeAccessDecisionSchema,
  connectedKnowledgeAuthorizedScopeSchema,
  connectedKnowledgeProviderDescriptorSchema,
  connectedKnowledgeRequestSchema,
  evidenceItemsSchema,
  type ConnectedKnowledgeAuthorizedScope,
  type ConnectedKnowledgeProviderDescriptor,
  type ConnectedKnowledgeProviderResult,
  type ConnectedKnowledgeRequest,
  type ConnectedKnowledgeSourceClass,
  type ContextProviderRequirement,
} from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import type {
  ContextProvider,
  ContextProviderInput,
} from "../context/context-engine.js";

export interface ConnectedKnowledgeAuthorizationInput {
  request: ConnectedKnowledgeRequest;
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
  ): Promise<unknown>;
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

function scopesMatch(
  scope: ConnectedKnowledgeAuthorizedScope,
  descriptor: ConnectedKnowledgeProviderDescriptor,
  request: ConnectedKnowledgeRequest,
): boolean {
  return (
    scope.providerKey === descriptor.key &&
    scope.companyId === request.companyId &&
    scope.agentId === request.agentId &&
    scope.responsibleUserId === request.responsibleUserId &&
    scope.runId === request.runId
  );
}

function assertAuthorizedScope(
  scope: ConnectedKnowledgeAuthorizedScope,
  descriptor: ConnectedKnowledgeProviderDescriptor,
  request: ConnectedKnowledgeRequest,
): void {
  if (!scopesMatch(scope, descriptor, request)) {
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
      const decision = connectedKnowledgeAccessDecisionSchema.parse(
        await found.provider.authorize({
          request,
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
      assertAuthorizedScope(scope, found.descriptor, request);

      // Retrieval is deliberately unreachable until authorization has produced a
      // request-bound scope. Provider implementations must use this scope to
      // construct the permitted retrieval universe before search/ranking.
      const result = await found.provider.retrieveAuthorized({
        request,
        authorizedScope: scope,
        signal: rawInput.signal,
        deadlineAt: rawInput.deadlineAt,
      });

      const evidence = validateProviderEvidence(
        found.descriptor,
        request,
        result.evidence,
      );
      const warnings = (result.warnings ?? []).map((warning) => ({
        ...warning,
        providerKey: found.descriptor.key,
      }));

      return { evidence, warnings };
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

export function connectedKnowledgeSourceClass(
  value: string,
): ConnectedKnowledgeSourceClass | null {
  return value === "system_of_record" ||
    value === "conversation" ||
    value === "external_untrusted"
    ? value
    : null;
}
