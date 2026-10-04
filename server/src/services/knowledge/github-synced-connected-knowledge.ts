import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  externalObjectMentions,
  externalObjects,
  issues,
  type Db,
} from "@paperclipai/db";
import type {
  ConnectedKnowledgeAccessDecision,
  ConnectedKnowledgeAuthorizedScope,
  ConnectedKnowledgeProviderResult,
  ConnectedKnowledgeRequest,
  EvidenceItem,
} from "@paperclipai/shared";
import { forbidden } from "../../errors.js";
import { accessService } from "../access.js";
import type {
  ConnectedKnowledgeProvider,
  ConnectedKnowledgeRetrievalInput,
} from "./connected-knowledge.js";

const PROVIDER_KEY = "github-sync";
const SOURCE_PROVIDER = "github";
const AUTH_SCOPE_TTL_MS = 30_000;
const MAX_AUTHORIZED_OBJECTS = 500;

export interface GitHubSyncedKnowledgeObject {
  id: string;
  companyId: string;
  providerKey: string;
  objectType: string;
  externalId: string;
  sanitizedCanonicalUrl: string | null;
  displayKey: string | null;
  displayTitle: string | null;
  statusKey: string | null;
  statusLabel: string | null;
  statusCategory: string;
  liveness: string;
  isTerminal: boolean;
  data: Record<string, unknown>;
  remoteVersion: string | null;
  etag: string | null;
  lastResolvedAt: Date | null;
  lastChangedAt: Date | null;
  nextRefreshAt: Date | null;
  updatedAt: Date;
}

export type GitHubSyncedIssueAccess =
  | {
      allowed: true;
      authorizationVersion: string;
    }
  | {
      allowed: false;
      reason: string;
    };

export interface GitHubSyncedKnowledgeDependencies {
  authorizeIssue(input: {
    request: ConnectedKnowledgeRequest;
  }): Promise<GitHubSyncedIssueAccess>;
  listAuthorizedObjectIds(input: {
    request: ConnectedKnowledgeRequest;
  }): Promise<string[]>;
  loadObjects(input: {
    request: ConnectedKnowledgeRequest;
    objectIds: string[];
  }): Promise<GitHubSyncedKnowledgeObject[]>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueBoundedIds(values: string[]): string[] {
  return [...new Set(values)].sort().slice(0, MAX_AUTHORIZED_OBJECTS);
}

function scopeObjectIds(
  scope: ConnectedKnowledgeAuthorizedScope,
  request: ConnectedKnowledgeRequest,
): string[] {
  if (
    scope.constraints.issueId !== request.issueId ||
    !Array.isArray(scope.constraints.objectIds) ||
    scope.constraints.objectIds.length > MAX_AUTHORIZED_OBJECTS
  ) {
    throw forbidden("GitHub synced knowledge scope is invalid", {
      code: "connected_knowledge_scope_invalid",
      providerKey: PROVIDER_KEY,
    });
  }

  const objectIds: string[] = [];
  for (const value of scope.constraints.objectIds) {
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw forbidden("GitHub synced knowledge scope contains an invalid object id", {
        code: "connected_knowledge_scope_invalid",
        providerKey: PROVIDER_KEY,
      });
    }
    objectIds.push(value);
  }
  return uniqueBoundedIds(objectIds);
}

function objectData(
  object: GitHubSyncedKnowledgeObject,
): Record<string, unknown> {
  return object.data && typeof object.data === "object" && !Array.isArray(object.data)
    ? object.data
    : {};
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  maxLength = 500,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  return typeof record[key] === "boolean" ? (record[key] as boolean) : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTombstone(object: GitHubSyncedKnowledgeObject): boolean {
  return object.statusKey === "not_found" || objectData(object).notFound === true;
}

function validIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeHttpUrl(value: string | null): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function freshnessFor(
  object: GitHubSyncedKnowledgeObject,
  asOfMs: number,
): "fresh" | "stale" | "reauthorization_required" | "unreachable" | "unknown" {
  if (object.liveness === "auth_required") return "reauthorization_required";
  if (object.liveness === "unreachable") return "unreachable";
  if (
    object.liveness === "stale" ||
    (object.nextRefreshAt && object.nextRefreshAt.getTime() <= asOfMs)
  ) {
    return "stale";
  }
  if (object.liveness === "fresh") return "fresh";
  return "unknown";
}

function searchableText(object: GitHubSyncedKnowledgeObject): {
  title: string;
  all: string;
} {
  const data = objectData(object);
  const title = [
    object.displayTitle,
    object.displayKey,
    object.externalId,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();

  const all = [
    title,
    object.statusLabel,
    object.statusKey,
    object.statusCategory,
    object.objectType,
    stringField(data, "state"),
    stringField(data, "stateReason"),
    stringField(data, "authorLogin"),
    stringField(data, "headRef"),
    stringField(data, "baseRef"),
    stringField(data, "reviewDecision"),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();

  return { title, all };
}

function retrievalScore(
  object: GitHubSyncedKnowledgeObject,
  query: string,
): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const tokens = [
    ...new Set(
      normalizedQuery
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ];
  const searchable = searchableText(object);
  let score = 1;

  if (normalizedQuery && searchable.all.includes(normalizedQuery)) score += 100;
  for (const token of tokens) {
    if (searchable.title.includes(token)) score += 20;
    else if (searchable.all.includes(token)) score += 6;
  }
  return score;
}

function buildExcerpt(object: GitHubSyncedKnowledgeObject): string {
  const data = objectData(object);
  const lines = [
    object.statusLabel || object.statusKey
      ? `Status: ${(object.statusLabel ?? object.statusKey)!.slice(0, 500)}`
      : null,
    stringField(data, "state")
      ? `State: ${stringField(data, "state")}`
      : null,
    stringField(data, "stateReason")
      ? `State reason: ${stringField(data, "stateReason")}`
      : null,
    booleanField(data, "merged") !== null
      ? `Merged: ${String(booleanField(data, "merged"))}`
      : null,
    booleanField(data, "draft") !== null
      ? `Draft: ${String(booleanField(data, "draft"))}`
      : null,
    stringField(data, "reviewDecision")
      ? `Review decision: ${stringField(data, "reviewDecision")}`
      : null,
    stringField(data, "authorLogin")
      ? `Author: ${stringField(data, "authorLogin")}`
      : null,
    stringField(data, "headRef")
      ? `Head: ${stringField(data, "headRef")}`
      : null,
    stringField(data, "baseRef")
      ? `Base: ${stringField(data, "baseRef")}`
      : null,
    numberField(data, "changedFiles") !== null
      ? `Changed files: ${numberField(data, "changedFiles")}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    lines.join("\n") ||
    object.displayTitle?.trim() ||
    object.displayKey?.trim() ||
    `GitHub ${object.objectType.replace(/_/g, " ")} ${object.externalId}`
  ).slice(0, 64_000);
}

function evidenceFromObject(input: {
  request: ConnectedKnowledgeRequest;
  scope: ConnectedKnowledgeAuthorizedScope;
  object: GitHubSyncedKnowledgeObject;
  score: number;
}): EvidenceItem {
  const object = input.object;
  const title = (
    object.displayTitle?.trim() ||
    object.displayKey?.trim() ||
    object.externalId
  ).slice(0, 1000);
  const excerpt = buildExcerpt(object);
  const href = safeHttpUrl(object.sanitizedCanonicalUrl);
  const sourceRef = (
    href ??
    `github://${object.externalId}`
  ).slice(0, 2048);
  const sourceUpdatedAt =
    validIso(object.remoteVersion) ??
    object.lastChangedAt?.toISOString() ??
    object.updatedAt.toISOString();
  const observedAt =
    object.lastResolvedAt?.toISOString() ??
    object.updatedAt.toISOString();
  const asOfMs = Date.parse(input.request.asOf);
  const freshness = freshnessFor(
    object,
    Number.isFinite(asOfMs) ? asOfMs : Date.now(),
  );
  const sourceVersion = (
    object.remoteVersion ??
    object.etag ??
    object.updatedAt.toISOString()
  ).slice(0, 1000);
  const label = title.slice(0, 500);

  return {
    id: `github-sync:${object.id}`,
    companyId: input.request.companyId,
    sourceClass: "external_untrusted",
    sourceProvider: SOURCE_PROVIDER,
    sourceType:
      object.objectType === "pull_request"
        ? "github_pull_request"
        : "github_issue",
    sourceRef,
    title,
    excerpt,
    sourceVersion,
    sourceUpdatedAt,
    observedAt,
    validFrom: null,
    validUntil: null,
    authorityDomain: null,
    trustLevel: "untrusted",
    sensitivity: "internal",
    citation: {
      label,
      ...(href ? { href } : {}),
    },
    metadata: {
      syncMode: "synced",
      providerIsAuthority: true,
      externalObjectId: object.id,
      externalId: object.externalId,
      objectType: object.objectType,
      remoteVersion: object.remoteVersion,
      etag: object.etag,
      indexedAt: observedAt,
      sourceUpdatedAt,
      contentHash: sha256(JSON.stringify({ title, excerpt })),
      aclFingerprint: input.scope.aclVersion,
      tombstone: false,
      liveness: object.liveness,
      freshness,
      stale: freshness === "stale",
      lastResolvedAt: object.lastResolvedAt?.toISOString() ?? null,
      lastChangedAt: object.lastChangedAt?.toISOString() ?? null,
      nextRefreshAt: object.nextRefreshAt?.toISOString() ?? null,
      retrievalScore: input.score,
    },
  };
}

function validateLoadedObjects(
  request: ConnectedKnowledgeRequest,
  requestedIds: Set<string>,
  objects: GitHubSyncedKnowledgeObject[],
): void {
  for (const object of objects) {
    if (
      object.companyId !== request.companyId ||
      object.providerKey !== SOURCE_PROVIDER ||
      !requestedIds.has(object.id)
    ) {
      throw forbidden("GitHub synced provider returned an object outside the authorized scope", {
        code: "connected_knowledge_scope_invalid",
        providerKey: PROVIDER_KEY,
        objectId: object.id,
      });
    }
  }
}

export function createGitHubSyncedConnectedKnowledgeProvider(
  deps: GitHubSyncedKnowledgeDependencies,
): ConnectedKnowledgeProvider {
  return {
    descriptor: {
      key: PROVIDER_KEY,
      displayName: "GitHub synced",
      sourceProvider: SOURCE_PROVIDER,
      accessMode: "synced",
      sourceClasses: ["external_untrusted"],
    },

    async authorize({
      request,
      requestFingerprint,
    }): Promise<ConnectedKnowledgeAccessDecision> {
      if (!request.issueId) {
        return {
          allowed: false,
          code: "principal_unresolved",
          reason: "GitHub synced knowledge requires an authorized task scope.",
        };
      }

      const access = await deps.authorizeIssue({ request });
      if (!access.allowed) {
        return {
          allowed: false,
          code: "permission_denied",
          reason: access.reason,
        };
      }

      const objectIds = uniqueBoundedIds(
        await deps.listAuthorizedObjectIds({ request }),
      );
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
          aclVersion: sha256(
            JSON.stringify({
              issueAuthorization: access.authorizationVersion,
              objectIds,
            }),
          ),
          authorizedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + AUTH_SCOPE_TTL_MS).toISOString(),
          constraints: {
            issueId: request.issueId,
            objectIds,
          },
        },
      };
    },

    async retrieveAuthorized(
      input: ConnectedKnowledgeRetrievalInput,
    ): Promise<ConnectedKnowledgeProviderResult> {
      const scopedIds = scopeObjectIds(input.authorizedScope, input.request);
      const access = await deps.authorizeIssue({ request: input.request });
      if (!access.allowed) {
        throw forbidden(
          "GitHub synced knowledge authorization changed before retrieval",
          {
            code: "connected_knowledge_permission_denied",
            providerKey: PROVIDER_KEY,
          },
        );
      }

      const currentIds = new Set(
        uniqueBoundedIds(
          await deps.listAuthorizedObjectIds({ request: input.request }),
        ),
      );
      const objectIds = scopedIds.filter((id) => currentIds.has(id));
      if (objectIds.length === 0) return { evidence: [] };

      const objects = await deps.loadObjects({
        request: input.request,
        objectIds,
      });
      const requestedIds = new Set(objectIds);
      validateLoadedObjects(input.request, requestedIds, objects);

      const ranked = objects
        .filter(
          (object) =>
            (object.objectType === "issue" ||
              object.objectType === "pull_request") &&
            !isTombstone(object),
        )
        .map((object) => ({
          object,
          score: retrievalScore(object, input.request.query),
        }))
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          const rightTime =
            right.object.lastChangedAt?.getTime() ??
            right.object.lastResolvedAt?.getTime() ??
            right.object.updatedAt.getTime();
          const leftTime =
            left.object.lastChangedAt?.getTime() ??
            left.object.lastResolvedAt?.getTime() ??
            left.object.updatedAt.getTime();
          return rightTime - leftTime || left.object.id.localeCompare(right.object.id);
        })
        .slice(0, input.request.limit);

      return {
        evidence: ranked.map(({ object, score }) =>
          evidenceFromObject({
            request: input.request,
            scope: input.authorizedScope,
            object,
            score,
          }),
        ),
      };
    },
  };
}

export function githubSyncedConnectedKnowledgeProvider(
  db: Db,
): ConnectedKnowledgeProvider {
  const access = accessService(db);

  const deps: GitHubSyncedKnowledgeDependencies = {
    authorizeIssue: async ({ request }) => {
      if (!request.issueId) {
        return {
          allowed: false,
          reason: "GitHub synced knowledge requires a task.",
        };
      }

      const issueScope = await db
        .select({
          id: issues.id,
          status: issues.status,
          projectId: issues.projectId,
          parentId: issues.parentId,
          assigneeAgentId: issues.assigneeAgentId,
          assigneeUserId: issues.assigneeUserId,
          originKind: issues.originKind,
          originId: issues.originId,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, request.companyId),
            eq(issues.id, request.issueId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!issueScope) {
        return {
          allowed: false,
          reason: "GitHub synced knowledge task is unavailable.",
        };
      }

      const decision = await access.decide({
        enforceResponsibleUserIntersection: request.enforceResponsibleUserIntersection,
        actor: {
          type: "agent",
          agentId: request.agentId,
          companyId: request.companyId,
          runId: request.runId ?? null,
          onBehalfOfUserId: request.responsibleUserId ?? null,
          source: "agent_jwt",
        },
        action: "issue:read",
        resource: {
          type: "issue",
          companyId: request.companyId,
          issueId: issueScope.id,
          projectId: issueScope.projectId,
          parentIssueId: issueScope.parentId,
          assigneeAgentId: issueScope.assigneeAgentId,
          assigneeUserId: issueScope.assigneeUserId,
          originKind: issueScope.originKind,
          originId: issueScope.originId,
          status: issueScope.status,
        },
      });
      if (!decision.allowed) {
        return {
          allowed: false,
          reason: decision.reason ?? "Issue read permission denied.",
        };
      }

      return {
        allowed: true,
        authorizationVersion: sha256(
          JSON.stringify({
            issueId: issueScope.id,
            status: issueScope.status,
            projectId: issueScope.projectId,
            parentId: issueScope.parentId,
            assigneeAgentId: issueScope.assigneeAgentId,
            assigneeUserId: issueScope.assigneeUserId,
            originKind: issueScope.originKind,
            originId: issueScope.originId,
            updatedAt: issueScope.updatedAt.toISOString(),
          }),
        ),
      };
    },

    listAuthorizedObjectIds: async ({ request }) => {
      if (!request.issueId) return [];
      const rows = await db
        .select({
          objectId: externalObjectMentions.objectId,
        })
        .from(externalObjectMentions)
        .where(
          and(
            eq(externalObjectMentions.companyId, request.companyId),
            eq(externalObjectMentions.sourceIssueId, request.issueId),
            eq(externalObjectMentions.providerKey, SOURCE_PROVIDER),
            isNotNull(externalObjectMentions.objectId),
          ),
        )
        .orderBy(desc(externalObjectMentions.updatedAt))
        .limit(MAX_AUTHORIZED_OBJECTS + 1);

      return uniqueBoundedIds(
        rows.flatMap((row) =>
          typeof row.objectId === "string" ? [row.objectId] : [],
        ),
      );
    },

    loadObjects: async ({ request, objectIds }) => {
      if (objectIds.length === 0) return [];
      return db
        .select({
          id: externalObjects.id,
          companyId: externalObjects.companyId,
          providerKey: externalObjects.providerKey,
          objectType: externalObjects.objectType,
          externalId: externalObjects.externalId,
          sanitizedCanonicalUrl: externalObjects.sanitizedCanonicalUrl,
          displayKey: externalObjects.displayKey,
          displayTitle: externalObjects.displayTitle,
          statusKey: externalObjects.statusKey,
          statusLabel: externalObjects.statusLabel,
          statusCategory: externalObjects.statusCategory,
          liveness: externalObjects.liveness,
          isTerminal: externalObjects.isTerminal,
          data: externalObjects.data,
          remoteVersion: externalObjects.remoteVersion,
          etag: externalObjects.etag,
          lastResolvedAt: externalObjects.lastResolvedAt,
          lastChangedAt: externalObjects.lastChangedAt,
          nextRefreshAt: externalObjects.nextRefreshAt,
          updatedAt: externalObjects.updatedAt,
        })
        .from(externalObjects)
        .where(
          and(
            eq(externalObjects.companyId, request.companyId),
            eq(externalObjects.providerKey, SOURCE_PROVIDER),
            inArray(externalObjects.id, objectIds),
          ),
        );
    },
  };

  return createGitHubSyncedConnectedKnowledgeProvider(deps);
}
