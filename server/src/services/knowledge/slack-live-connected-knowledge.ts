import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import type {
  ConnectedKnowledgeAccessDecision,
  ConnectedKnowledgeAuthorizedScope,
  ConnectedKnowledgeProviderResult,
  ConnectedKnowledgeRequest,
  EvidenceItem,
  EvidenceSensitivity,
} from "@paperclipai/shared";
import {
  executeSlackTool,
  slackConnectedKnowledgeResources,
  type SlackConnectedKnowledgeResource,
} from "../connectors/slack.js";
import type {
  ConnectedKnowledgeProvider,
  ConnectedKnowledgeRetrievalInput,
} from "./connected-knowledge.js";

const PROVIDER_KEY = "slack-live";
const SOURCE_PROVIDER = "slack";
const AUTH_SCOPE_TTL_MS = 30_000;
const MAX_AUTHORIZED_RESOURCES = 8;

type FetchImpl = typeof globalThis.fetch;

export interface SlackLiveKnowledgeSearchResult {
  channelName: string | null;
  privateChannel: boolean;
  directMessage: boolean;
  retrievalMode: string;
  exhaustive: boolean;
  coverage: string | null;
  matches: Array<{
    ts: string;
    threadTs: string | null;
    userId: string | null;
    text: string;
    sourceUrl: string | null;
  }>;
}

export interface SlackLiveKnowledgeDependencies {
  listAuthorizedResources(input: {
    request: ConnectedKnowledgeRequest;
  }): Promise<SlackConnectedKnowledgeResource[]>;
  searchAuthorizedResource(input: {
    request: ConnectedKnowledgeRequest;
    resource: SlackConnectedKnowledgeResource;
    limit: number;
    signal: AbortSignal;
    deadlineAt: number;
  }): Promise<SlackLiveKnowledgeSearchResult>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function authorizedAclVersion(
  resources: SlackConnectedKnowledgeResource[],
): string {
  return sha256(
    JSON.stringify(
      [...resources]
        .map((resource) => ({
          endpointId: resource.endpointId,
          connectionId: resource.connectionId,
          workspaceId: resource.workspaceId,
          channelId: resource.channelId,
          responsibleUserId: resource.responsibleUserId,
          authorizationRevision: resource.authorizationRevision,
        }))
        .sort((left, right) =>
          left.endpointId.localeCompare(right.endpointId) ||
          left.channelId.localeCompare(right.channelId),
        ),
    ),
  );
}

function requestedSlackChannelIds(subjectRefs: string[]): string[] {
  return [
    ...new Set(
      subjectRefs.flatMap((subjectRef) => {
        const match = /^slack:channel:([CGD][A-Z0-9]+)$/.exec(subjectRef);
        return match ? [match[1]!] : [];
      }),
    ),
  ];
}

function constrainResources(
  request: ConnectedKnowledgeRequest,
  resources: SlackConnectedKnowledgeResource[],
): SlackConnectedKnowledgeResource[] {
  const samePrincipal = resources.filter(
    (resource) =>
      resource.responsibleUserId === request.responsibleUserId,
  );
  const requestedChannels = requestedSlackChannelIds(request.subjectRefs);
  if (requestedChannels.length === 0) {
    return samePrincipal.slice(0, MAX_AUTHORIZED_RESOURCES);
  }
  const requested = new Set(requestedChannels);
  return samePrincipal
    .filter((resource) => requested.has(resource.channelId))
    .slice(0, MAX_AUTHORIZED_RESOURCES);
}

function scopeResources(
  scope: ConnectedKnowledgeAuthorizedScope,
): SlackConnectedKnowledgeResource[] {
  const raw = scope.constraints.resources;
  if (!Array.isArray(raw) || raw.length > MAX_AUTHORIZED_RESOURCES) {
    throw new Error("Slack Connected Knowledge authorization scope is invalid");
  }

  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Slack Connected Knowledge resource scope is invalid");
    }
    const value = entry as Record<string, unknown>;
    const endpointId = value.endpointId;
    const connectionId = value.connectionId;
    const workspaceId = value.workspaceId;
    const channelId = value.channelId;
    const responsibleUserId = value.responsibleUserId;
    const authorizationRevision = value.authorizationRevision;
    if (
      typeof endpointId !== "string" ||
      typeof connectionId !== "string" ||
      typeof workspaceId !== "string" ||
      typeof channelId !== "string" ||
      typeof responsibleUserId !== "string" ||
      typeof authorizationRevision !== "string"
    ) {
      throw new Error("Slack Connected Knowledge resource scope is incomplete");
    }
    return {
      endpointId,
      connectionId,
      workspaceId,
      channelId,
      responsibleUserId,
      authorizationRevision,
    };
  });
}

function sensitivityForChannel(
  result: SlackLiveKnowledgeSearchResult,
): EvidenceSensitivity {
  return result.privateChannel || result.directMessage
    ? "confidential"
    : "internal";
}

function slackTimestampIso(value: string): string | null {
  if (!/^\d+\.\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function evidenceFromSlackMatch(input: {
  request: ConnectedKnowledgeRequest;
  resource: SlackConnectedKnowledgeResource;
  result: SlackLiveKnowledgeSearchResult;
  match: SlackLiveKnowledgeSearchResult["matches"][number];
  observedAt: string;
}): EvidenceItem {
  const sourceUpdatedAt = slackTimestampIso(input.match.ts);
  const sourceRef =
    `slack://${input.resource.workspaceId}/${input.resource.channelId}/${input.match.ts}`;
  const label = input.result.channelName
    ? `Slack #${input.result.channelName}`
    : "Slack message";

  return {
    id: `slack-live:${sha256(sourceRef)}`,
    companyId: input.request.companyId,
    sourceClass: "external_untrusted",
    sourceProvider: SOURCE_PROVIDER,
    sourceType: "slack_message",
    sourceRef,
    title: label,
    excerpt: input.match.text.trim().slice(0, 64_000),
    sourceVersion: input.match.ts,
    sourceUpdatedAt,
    observedAt: input.observedAt,
    validFrom: null,
    validUntil: null,
    authorityDomain: null,
    trustLevel: "untrusted",
    sensitivity: sensitivityForChannel(input.result),
    citation: {
      label,
      ...(input.match.sourceUrl ? { href: input.match.sourceUrl } : {}),
    },
    metadata: {
      endpointId: input.resource.endpointId,
      connectionId: input.resource.connectionId,
      workspaceId: input.resource.workspaceId,
      channelId: input.resource.channelId,
      messageTs: input.match.ts,
      ...(input.match.threadTs ? { threadTs: input.match.threadTs } : {}),
      ...(input.match.userId ? { authorUserId: input.match.userId } : {}),
      authorizationRevision: input.resource.authorizationRevision,
      retrievalMode: input.result.retrievalMode,
      exhaustive: input.result.exhaustive,
      ...(input.result.coverage ? { coverage: input.result.coverage } : {}),
    },
  };
}

export function createSlackLiveConnectedKnowledgeProvider(
  deps: SlackLiveKnowledgeDependencies,
): ConnectedKnowledgeProvider {
  return {
    descriptor: {
      key: PROVIDER_KEY,
      displayName: "Slack live",
      sourceProvider: SOURCE_PROVIDER,
      accessMode: "live",
      sourceClasses: ["external_untrusted"],
    },

    async authorize({
      request,
      requestFingerprint,
    }): Promise<ConnectedKnowledgeAccessDecision> {
      if (
        !request.runId ||
        !request.issueId ||
        !request.responsibleUserId
      ) {
        return {
          allowed: false,
          code: "principal_unresolved",
          reason:
            "Slack live knowledge requires a task run with an accepted responsible user.",
        };
      }

      const available = await deps.listAuthorizedResources({ request });
      const resources = constrainResources(request, available);
      const requestedChannels = requestedSlackChannelIds(request.subjectRefs);

      if (resources.length === 0) {
        return {
          allowed: false,
          code:
            requestedChannels.length > 0
              ? "scope_denied"
              : "permission_denied",
          reason:
            requestedChannels.length > 0
              ? "The requested Slack channel is outside the current task and requester scope."
              : "No active Slack source is authorized for this task and requester.",
        };
      }

      const now = Date.now();
      return {
        allowed: true,
        scope: {
          providerKey: PROVIDER_KEY,
          companyId: request.companyId,
          agentId: request.agentId,
          responsibleUserId: request.responsibleUserId,
          runId: request.runId,
          requestFingerprint,
          aclVersion: authorizedAclVersion(resources),
          authorizedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + AUTH_SCOPE_TTL_MS).toISOString(),
          constraints: {
            resources: resources.map((resource) => ({ ...resource })),
          },
        },
      };
    },

    async retrieveAuthorized(
      input: ConnectedKnowledgeRetrievalInput,
    ): Promise<ConnectedKnowledgeProviderResult> {
      const resources = scopeResources(input.authorizedScope);
      const evidence: EvidenceItem[] = [];
      const observedAt = new Date().toISOString();

      for (const resource of resources) {
        if (evidence.length >= input.request.limit) break;
        const remaining = Math.min(
          20,
          input.request.limit - evidence.length,
        );
        const result = await deps.searchAuthorizedResource({
          request: input.request,
          resource,
          limit: remaining,
          signal: input.signal,
          deadlineAt: input.deadlineAt,
        });

        for (const match of result.matches) {
          const text = match.text.trim();
          if (!text) continue;
          evidence.push(
            evidenceFromSlackMatch({
              request: input.request,
              resource,
              result,
              match: { ...match, text },
              observedAt,
            }),
          );
          if (evidence.length >= input.request.limit) break;
        }
      }

      return { evidence };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contextBoundFetch(
  parentSignal: AbortSignal,
  deadlineAt: number,
  fetchImpl: FetchImpl,
): FetchImpl {
  return async (input, init) => {
    const controller = new AbortController();
    const signals = [
      parentSignal,
      init?.signal ?? null,
    ].filter((signal): signal is AbortSignal => signal !== null);
    const listeners: Array<{
      signal: AbortSignal;
      listener: () => void;
    }> = [];

    const abortFrom = (signal: AbortSignal) => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason);
      }
    };

    for (const signal of signals) {
      if (signal.aborted) {
        abortFrom(signal);
        break;
      }
      const listener = () => abortFrom(signal);
      signal.addEventListener("abort", listener, { once: true });
      listeners.push({ signal, listener });
    }

    const remainingMs = deadlineAt - Date.now();
    const timer =
      remainingMs > 0
        ? setTimeout(() => {
            if (!controller.signal.aborted) {
              controller.abort(
                new Error("Slack Connected Knowledge deadline exceeded"),
              );
            }
          }, remainingMs)
        : null;
    timer?.unref?.();
    if (remainingMs <= 0 && !controller.signal.aborted) {
      controller.abort(
        new Error("Slack Connected Knowledge deadline exceeded"),
      );
    }

    try {
      return await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  };
}

function parseSlackSearchResult(input: {
  channelInfo: unknown;
  searchResult: unknown;
}): SlackLiveKnowledgeSearchResult {
  const info = asRecord(input.channelInfo);
  const channel = asRecord(info?.channel);
  const search = asRecord(input.searchResult);
  const rawMatches = Array.isArray(search?.matches)
    ? search.matches
    : [];

  const matches = rawMatches.flatMap((raw) => {
    const match = asRecord(raw);
    const ts = stringOrNull(match?.ts);
    const text = stringOrNull(match?.text);
    if (!ts || !text) return [];
    return [{
      ts,
      threadTs: stringOrNull(match?.threadTs),
      userId: stringOrNull(match?.user),
      text,
      sourceUrl: stringOrNull(match?.sourceUrl),
    }];
  });

  return {
    channelName: stringOrNull(channel?.name),
    privateChannel: channel?.private === true,
    directMessage: channel?.direct === true,
    retrievalMode: stringOrNull(search?.mode) ?? "bounded_history",
    exhaustive: search?.exhaustive === true,
    coverage: stringOrNull(search?.limitation) ??
      stringOrNull(search?.coverage),
    matches,
  };
}

export function slackLiveConnectedKnowledgeProvider(
  db: Db,
  options: { fetchImpl?: FetchImpl } = {},
): ConnectedKnowledgeProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return createSlackLiveConnectedKnowledgeProvider({
    listAuthorizedResources: async ({ request }) => {
      if (!request.runId || !request.issueId) return [];
      return slackConnectedKnowledgeResources(db, {
        companyId: request.companyId,
        agentId: request.agentId,
        runId: request.runId,
        issueId: request.issueId,
      });
    },

    searchAuthorizedResource: async ({
      request,
      resource,
      limit,
      signal,
      deadlineAt,
    }) => {
      if (!request.runId || !request.issueId) {
        throw new Error(
          "Slack live knowledge lost its task binding before retrieval",
        );
      }
      const boundFetch = contextBoundFetch(
        signal,
        deadlineAt,
        fetchImpl,
      );
      const binding = {
        companyId: request.companyId,
        agentId: request.agentId,
        runId: request.runId,
        issueId: request.issueId,
        endpointId: resource.endpointId,
      };

      const channelInfo = await executeSlackTool(
        db,
        binding,
        "slack_channel_info",
        {
          endpointId: resource.endpointId,
          channel: resource.channelId,
        },
        boundFetch,
      );
      const searchResult = await executeSlackTool(
        db,
        binding,
        "slack_search",
        {
          endpointId: resource.endpointId,
          channels: [resource.channelId],
          query: request.query,
          limit,
        },
        boundFetch,
      );

      return parseSlackSearchResult({
        channelInfo,
        searchResult,
      });
    },
  });
}
