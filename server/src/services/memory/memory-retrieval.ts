import type { Db } from "@paperclipai/db";
import type {
  EvidenceSensitivity,
  MemoryRecord,
  MemoryRecordDetail,
} from "@paperclipai/shared";
import { unprocessable } from "../../errors.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";

const ELIGIBLE_SCOPE_SCAN_LIMIT = 100;

export interface MemoryRetrievalScope {
  scopeType: "company" | "agent" | "project" | "subject";
  scopeId: string | null;
}

export interface RetrieveEligibleMemoryInput {
  companyId: string;
  agentId: string;
  runId?: string | null;
  responsibleUserId?: string | null;
  projectId?: string | null;
  subjectScopeIds?: string[];
  allowShared: boolean;
  allowPrivate: boolean;
  query: string;
  asOf?: Date;
  topK: number;
  sensitivityCeiling: EvidenceSensitivity;
}

export interface RetrievedMemoryRecord {
  detail: MemoryRecordDetail;
  relevanceScore: number;
}

export function memorySubjectScopeId(subject: {
  type: string;
  id: string;
}): string {
  const value = `${subject.type}:${subject.id}`;
  if (value.length > 500) {
    throw unprocessable("Memory subject scope identifier is too long", {
      code: "memory_subject_scope_too_long",
    });
  }
  return value;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function queryTokens(query: string): string[] {
  return [
    ...new Set(
      normalized(query)
        .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)
        ?.filter((token) => token.length > 1) ?? [],
    ),
  ].slice(0, 32);
}

export function memoryRelevanceScore(
  record: MemoryRecord,
  query: string,
): number {
  const phrase = normalized(query);
  const tokens = queryTokens(query);
  const title = normalized(record.title ?? "");
  const summary = normalized(record.summary ?? "");
  const content = normalized(record.content);
  const subject = normalized(
    [record.subjectType, record.subjectId, record.scopeId]
      .filter(Boolean)
      .join(" "),
  );

  let score = 0;
  if (phrase && title.includes(phrase)) score += 18;
  if (phrase && summary.includes(phrase)) score += 14;
  if (phrase && content.includes(phrase)) score += 10;
  if (phrase && subject.includes(phrase)) score += 12;

  for (const token of tokens) {
    if (title.includes(token)) score += 5;
    if (summary.includes(token)) score += 4;
    if (subject.includes(token)) score += 4;
    if (content.includes(token)) score += 2;
  }

  if (score > 0) {
    score += Math.min(1, record.importance / 100);
    score += Math.min(0.5, record.confidenceScore / 2);
  }
  return score;
}

const SENSITIVITY_RANK: Record<EvidenceSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export function memorySensitivityAllowed(
  record: MemoryRecord,
  ceiling: EvidenceSensitivity,
): boolean {
  return SENSITIVITY_RANK[record.sensitivityLabel] <= SENSITIVITY_RANK[ceiling];
}

function recordStillEligible(
  record: MemoryRecord,
  asOf: Date,
  sensitivityCeiling: EvidenceSensitivity,
): boolean {
  const asOfMs = asOf.getTime();
  return (
    record.reviewState === "accepted" &&
    record.retentionState === "active" &&
    record.revokedAt === null &&
    record.deletedAt === null &&
    record.supersededByRecordId === null &&
    (!record.validFrom || record.validFrom.getTime() <= asOfMs) &&
    (!record.validUntil || record.validUntil.getTime() > asOfMs) &&
    (!record.expiresAt || record.expiresAt.getTime() > asOfMs) &&
    memorySensitivityAllowed(record, sensitivityCeiling)
  );
}

function retrievalActor(input: RetrieveEligibleMemoryInput): MemoryMutationActor {
  return {
    principal: {
      type: "agent",
      agentId: input.agentId,
      responsibleUserId: input.responsibleUserId ?? null,
    },
    runId: input.runId ?? null,
  };
}

export function resolveMemoryRetrievalScopes(
  input: Pick<
    RetrieveEligibleMemoryInput,
    "agentId" | "projectId" | "subjectScopeIds" | "allowShared" | "allowPrivate"
  >,
): MemoryRetrievalScope[] {
  const scopes: MemoryRetrievalScope[] = [];

  if (input.allowShared) {
    scopes.push({ scopeType: "company", scopeId: null });
    if (input.projectId) {
      scopes.push({ scopeType: "project", scopeId: input.projectId });
    }
    for (const subjectScopeId of [...new Set(input.subjectScopeIds ?? [])]) {
      const normalizedSubjectScopeId = subjectScopeId.trim();
      if (!normalizedSubjectScopeId) continue;
      if (normalizedSubjectScopeId.length > 500) {
        throw unprocessable("Memory subject scope identifier is too long", {
          code: "memory_subject_scope_too_long",
        });
      }
      scopes.push({
        scopeType: "subject",
        scopeId: normalizedSubjectScopeId,
      });
    }
  }

  if (input.allowPrivate) {
    scopes.push({ scopeType: "agent", scopeId: input.agentId });
  }

  return scopes;
}

export async function retrieveEligibleMemory(
  db: Db,
  input: RetrieveEligibleMemoryInput,
): Promise<RetrievedMemoryRecord[]> {
  const service = memoryService(db);
  const actor = retrievalActor(input);
  const asOf = input.asOf ?? new Date();
  const topK = Math.min(50, Math.max(1, input.topK));
  const scopes = resolveMemoryRetrievalScopes(input);

  const recordsById = new Map<string, MemoryRecord>();
  for (const scope of scopes) {
    const rows = await service.listEligible(
      input.companyId,
      {
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        asOf,
        limit: ELIGIBLE_SCOPE_SCAN_LIMIT,
      },
      actor,
    );
    for (const row of rows) {
      if (memorySensitivityAllowed(row, input.sensitivityCeiling)) {
        recordsById.set(row.id, row);
      }
    }
  }

  const ranked = [...recordsById.values()]
    .map((record) => ({
      record,
      score: memoryRelevanceScore(record, input.query),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.record.observedAt.getTime() - left.record.observedAt.getTime(),
    )
    .slice(0, topK);

  const result: RetrievedMemoryRecord[] = [];
  for (const { record, score } of ranked) {
    const detail = await service.get(input.companyId, record.id, actor);
    if (
      detail &&
      recordStillEligible(detail.record, asOf, input.sensitivityCeiling)
    ) {
      result.push({
        detail,
        relevanceScore: Number(score.toFixed(3)),
      });
    }
  }

  return result;
}
