import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  heartbeatRuns,
  issues,
  memoryBindings,
  memoryBindingTargets,
  memoryRecords,
} from "@paperclipai/db";
import {
  memoryPostRunCandidateProposalListSchema,
  type MemoryCandidateInputParsed,
  type MemoryPostRunCandidateProposalParsed,
} from "@paperclipai/shared";
import { HttpError } from "../../errors.js";
import { containsProtectedSemanticData } from "../../vendor/paperclip-runner/index.js";
import { logActivity } from "../activity-log.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";

const POST_RUN_EXTRACTION_VERSION = "v1";
const MAX_RESULT_CANDIDATES = 8;

type HeartbeatRun = typeof heartbeatRuns.$inferSelect;

export type MemoryPostRunExtractionSkipReason =
  | "feature_disabled"
  | "run_not_succeeded"
  | "semantic_result_unavailable"
  | "semantic_result_yielded"
  | "candidate_contract_invalid"
  | "source_task_unavailable"
  | "scope_unsupported"
  | "scope_mismatch"
  | "private_scope_requires_explicit_remember"
  | "restricted_sensitivity"
  | "protected_data_detected"
  | "sensitive_personal_inference"
  | "evidence_ref_unverified"
  | "binding_unavailable"
  | "binding_ambiguous"
  | "operation_conflict";

export interface MemoryPostRunExtractionResult {
  runId: string;
  proposed: number;
  persisted: number;
  duplicates: number;
  skipped: number;
  skipReasons: Partial<Record<MemoryPostRunExtractionSkipReason, number>>;
}

type CandidateScopeResolution =
  | {
      kind: "ok";
      scope: MemoryCandidateInputParsed["scope"];
      target: { type: "company" | "project"; id: string };
    }
  | {
      kind: "skip";
      reason:
        | "scope_unsupported"
        | "scope_mismatch"
        | "private_scope_requires_explicit_remember";
    };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function semanticResultCandidates(resultJson: unknown): Record<string, unknown>[] {
  const root = record(resultJson);
  return [
    record(root.nativeResult),
    record(root.acceptedResult),
    record(record(root.semanticResult).result),
  ];
}

function acceptedSemanticResult(
  resultJson: unknown,
): { result: Record<string, unknown>; yielded: boolean } | null {
  let sawYielded = false;
  for (const candidate of semanticResultCandidates(resultJson)) {
    if (candidate.schema !== "paperclip.run_result.v1") continue;
    if (candidate.reportedWorkDisposition === "yielded") {
      sawYielded = true;
      continue;
    }
    if (
      candidate.reportedWorkDisposition === "done" ||
      candidate.reportedWorkDisposition === "needs_review"
    ) {
      return { result: candidate, yielded: false };
    }
  }
  return sawYielded ? { result: {}, yielded: true } : null;
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object") return String(value);

  const source = value as Record<string, unknown>;
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    if (item !== undefined) result[key] = canonicalValue(item);
  }
  return result;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(canonicalValue(value)));
}

function deterministicOperationId(runId: string, candidateIndex: number): string {
  const hex = sha256(
    `memory:post-run:${POST_RUN_EXTRACTION_VERSION}:${runId}:${candidateIndex}`,
  ).slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13)}`;
  const variantNibble = (
    (Number.parseInt(versioned[16] ?? "0", 16) & 0x3) |
    0x8
  ).toString(16);
  const normalized =
    `${versioned.slice(0, 16)}${variantNibble}${versioned.slice(17)}`;
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

function subjectFor(
  candidate: MemoryPostRunCandidateProposalParsed,
): { type: string; id: string } | null {
  if (!candidate.subjectType || !candidate.subjectId) return null;
  return { type: candidate.subjectType, id: candidate.subjectId };
}

function subjectScopeId(candidate: MemoryPostRunCandidateProposalParsed): string {
  return `${candidate.subjectType!}:${candidate.subjectId!}`;
}

function resolveCandidateScope(input: {
  candidate: MemoryPostRunCandidateProposalParsed;
  companyId: string;
  projectId: string | null;
}): CandidateScopeResolution {
  const { candidate, companyId, projectId } = input;

  switch (candidate.proposedScopeType) {
    case "org":
      if (
        candidate.proposedScopeId !== null &&
        candidate.proposedScopeId !== companyId
      ) {
        return { kind: "skip", reason: "scope_mismatch" };
      }
      return {
        kind: "ok",
        scope: { type: "company", id: null },
        target: { type: "company", id: companyId },
      };
    case "project":
      if (!projectId) return { kind: "skip", reason: "scope_mismatch" };
      if (
        candidate.proposedScopeId !== null &&
        candidate.proposedScopeId !== projectId
      ) {
        return { kind: "skip", reason: "scope_mismatch" };
      }
      return {
        kind: "ok",
        scope: { type: "project", id: projectId },
        target: { type: "project", id: projectId },
      };
    case "subject": {
      if (!candidate.subjectType || !candidate.subjectId) {
        return { kind: "skip", reason: "scope_mismatch" };
      }
      const scopeId = subjectScopeId(candidate);
      if (
        candidate.proposedScopeId !== null &&
        candidate.proposedScopeId !== scopeId
      ) {
        return { kind: "skip", reason: "scope_mismatch" };
      }
      return {
        kind: "ok",
        scope: { type: "subject", id: scopeId },
        target: { type: "company", id: companyId },
      };
    }
    case "agent":
      return {
        kind: "skip",
        reason: "private_scope_requires_explicit_remember",
      };
    case "team":
      return { kind: "skip", reason: "scope_unsupported" };
  }
}

const SENSITIVE_PERSONAL_INFERENCE_TERMS = [
  "health",
  "medical",
  "diagnosis",
  "diagnosed",
  "disease",
  "illness",
  "disability",
  "pregnant",
  "pregnancy",
  "medication",
  "mental health",
  "depressed",
  "depression",
  "anxiety",
  "burnout",
  "politics",
  "political party",
  "voting preference",
  "religion",
  "religious",
  "faith",
  "race",
  "racial",
  "ethnicity",
  "ethnic",
  "sexual orientation",
  "gay",
  "lesbian",
  "bisexual",
  "homosexual",
  "trade union",
  "union membership",
  "criminal record",
  "criminal conviction",
  "arrested",
  "plans to resign",
  "intends to resign",
  "plans to quit",
  "helbred",
  "sygdom",
  "diagnose",
  "handicap",
  "gravid",
  "graviditet",
  "medicin",
  "psykisk",
  "deprimeret",
  "angst",
  "udbrændt",
  "politik",
  "politisk parti",
  "stemmepræference",
  "religion",
  "religiøs",
  "tro",
  "etnicitet",
  "etnisk",
  "seksuel orientering",
  "homoseksuel",
  "fagforening",
  "straffeattest",
  "kriminel",
  "domfældt",
  "planlægger at sige op",
  "vil sige op",
] as const;

function normalizeSensitiveText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsSensitivePersonalInference(
  candidate: MemoryPostRunCandidateProposalParsed,
): boolean {
  const normalized = normalizeSensitiveText(
    [
      candidate.title ?? "",
      candidate.content,
      candidate.rationale,
      candidate.subjectType ?? "",
      candidate.subjectId ?? "",
      candidate.proposedScopeId ?? "",
    ].join(" "),
  );
  const padded = ` ${normalized} `;
  return SENSITIVE_PERSONAL_INFERENCE_TERMS.some((term) => {
    const normalizedTerm = normalizeSensitiveText(term);
    return normalizedTerm.length > 0 && padded.includes(` ${normalizedTerm} `);
  });
}

function allowedEvidenceRefs(): ReadonlySet<string> {
  // PR 36 deliberately admits only the server-verifiable current task/run.
  // Semantic-result evidence/artifact refs are model-authored claims and cannot
  // authenticate themselves by appearing elsewhere in the same result.
  // Broader refs may be admitted later only after resolving them against an
  // authoritative same-company artifact/evidence store.
  return new Set<string>(["task"]);
}

async function resolveBinding(
  db: Db,
  input: {
    companyId: string;
    target: { type: "company" | "project"; id: string };
  },
): Promise<
  | { kind: "ok"; binding: typeof memoryBindings.$inferSelect }
  | { kind: "skip"; reason: "binding_unavailable" | "binding_ambiguous" }
> {
  const rows = await db
    .select({ binding: memoryBindings })
    .from(memoryBindings)
    .innerJoin(
      memoryBindingTargets,
      and(
        eq(memoryBindingTargets.companyId, memoryBindings.companyId),
        eq(memoryBindingTargets.bindingId, memoryBindings.id),
      ),
    )
    .where(
      and(
        eq(memoryBindings.companyId, input.companyId),
        eq(memoryBindings.enabled, true),
        eq(memoryBindingTargets.targetType, input.target.type),
        eq(memoryBindingTargets.targetId, input.target.id),
      ),
    )
    .orderBy(memoryBindings.key);

  if (rows.length === 0) {
    return { kind: "skip", reason: "binding_unavailable" };
  }
  if (rows.length > 1) {
    return { kind: "skip", reason: "binding_ambiguous" };
  }
  return { kind: "ok", binding: rows[0]!.binding };
}

function extractionFingerprint(input: {
  runId: string;
  issueId: string;
  bindingId: string;
  scope: MemoryCandidateInputParsed["scope"];
  candidate: MemoryPostRunCandidateProposalParsed;
}): string {
  return fingerprint({
    version: POST_RUN_EXTRACTION_VERSION,
    runId: input.runId,
    issueId: input.issueId,
    bindingId: input.bindingId,
    scope: input.scope,
    candidate: input.candidate,
  });
}

function existingExtractionFingerprint(
  recordRow: typeof memoryRecords.$inferSelect,
): string | null {
  return stringValue(record(recordRow.metadata).postRunExtractionFingerprint);
}

async function existingOperationRecord(
  db: Db,
  companyId: string,
  operationId: string,
) {
  return db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.companyId, companyId),
        eq(memoryRecords.createdByOperationId, operationId),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);
}

function emptyResult(runId: string): MemoryPostRunExtractionResult {
  return {
    runId,
    proposed: 0,
    persisted: 0,
    duplicates: 0,
    skipped: 0,
    skipReasons: {},
  };
}

function addSkip(
  result: MemoryPostRunExtractionResult,
  reason: MemoryPostRunExtractionSkipReason,
): void {
  result.skipped += 1;
  result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
}

async function auditExtraction(
  db: Db,
  run: HeartbeatRun,
  issueId: string | null,
  result: MemoryPostRunExtractionResult,
): Promise<void> {
  if (result.proposed === 0) return;
  await logActivity(db, {
    companyId: run.companyId,
    actorType: "system",
    actorId: "memory-post-run-extraction",
    agentId: run.agentId,
    runId: run.id,
    issueId,
    action: "memory.post_run_extracted",
    entityType: "heartbeat_run",
    entityId: run.id,
    responsibleUserIdOverride: run.responsibleUserId,
    details: {
      version: POST_RUN_EXTRACTION_VERSION,
      proposed: result.proposed,
      persisted: result.persisted,
      duplicates: result.duplicates,
      skipped: result.skipped,
      skipReasons: result.skipReasons,
    },
  });
}

export function memoryPostRunExtractionService(db: Db) {
  const settings = instanceSettingsService(db);
  const memory = memoryService(db);

  return {
    extract: async (run: HeartbeatRun): Promise<MemoryPostRunExtractionResult> => {
      const result = emptyResult(run.id);

      const experimental = await settings.getExperimental();
      if (
        experimental.enableCollectiveMemoryV1 !== true ||
        experimental.enableMemoryPostRunExtractionV1 !== true
      ) {
        addSkip(result, "feature_disabled");
        return result;
      }

      if (run.status !== "succeeded") {
        addSkip(result, "run_not_succeeded");
        return result;
      }

      const semantic = acceptedSemanticResult(run.resultJson);
      if (!semantic) {
        addSkip(result, "semantic_result_unavailable");
        return result;
      }
      if (semantic.yielded) {
        addSkip(result, "semantic_result_yielded");
        return result;
      }

      const rawCandidates = semantic.result.memoryCandidates;
      if (rawCandidates === undefined) return result;
      const parsedCandidates =
        memoryPostRunCandidateProposalListSchema.safeParse(rawCandidates);
      if (!parsedCandidates.success) {
        addSkip(result, "candidate_contract_invalid");
        return result;
      }

      result.proposed = Math.min(
        parsedCandidates.data.length,
        MAX_RESULT_CANDIDATES,
      );
      if (result.proposed === 0) return result;

      const context = record(run.contextSnapshot);
      const issueId =
        stringValue(run.nativeIssueId) ??
        stringValue(context.issueId) ??
        stringValue(context.taskId);
      if (!issueId) {
        addSkip(result, "source_task_unavailable");
        await auditExtraction(db, run, null, result);
        return result;
      }

      const issue = await db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          projectId: issues.projectId,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, run.companyId),
            eq(issues.id, issueId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!issue) {
        addSkip(result, "source_task_unavailable");
        await auditExtraction(db, run, issueId, result);
        return result;
      }

      const permittedEvidenceRefs = allowedEvidenceRefs();
      const observedAt = (
        run.finishedAt ??
        run.updatedAt ??
        issue.updatedAt
      ).toISOString();
      const actor: MemoryMutationActor = {
        principal: {
          type: "agent",
          agentId: run.agentId,
          responsibleUserId: run.responsibleUserId ?? null,
        },
        runId: run.id,
      };

      for (const [candidateIndex, candidate] of parsedCandidates.data.entries()) {
        if (candidate.sensitivity === "restricted") {
          addSkip(result, "restricted_sensitivity");
          continue;
        }
        if (containsProtectedSemanticData(candidate)) {
          addSkip(result, "protected_data_detected");
          continue;
        }
        if (containsSensitivePersonalInference(candidate)) {
          addSkip(result, "sensitive_personal_inference");
          continue;
        }
        if (
          candidate.evidenceRefs.some(
            (evidenceRef) => !permittedEvidenceRefs.has(evidenceRef),
          )
        ) {
          addSkip(result, "evidence_ref_unverified");
          continue;
        }

        const scope = resolveCandidateScope({
          candidate,
          companyId: run.companyId,
          projectId: issue.projectId,
        });
        if (scope.kind === "skip") {
          addSkip(result, scope.reason);
          continue;
        }

        const binding = await resolveBinding(db, {
          companyId: run.companyId,
          target: scope.target,
        });
        if (binding.kind === "skip") {
          addSkip(result, binding.reason);
          continue;
        }

        const operationId = deterministicOperationId(run.id, candidateIndex);
        const candidateFingerprint = extractionFingerprint({
          runId: run.id,
          issueId: issue.id,
          bindingId: binding.binding.id,
          scope: scope.scope,
          candidate,
        });

        const existing = await existingOperationRecord(
          db,
          run.companyId,
          operationId,
        );
        if (existing) {
          if (
            existingExtractionFingerprint(existing) === candidateFingerprint
          ) {
            result.duplicates += 1;
          } else {
            addSkip(result, "operation_conflict");
          }
          continue;
        }

        const subject = subjectFor(candidate);
        const input: MemoryCandidateInputParsed = {
          bindingId: binding.binding.id,
          memoryType: candidate.memoryType,
          scope: scope.scope,
          subject,
          ownerAgentId: null,
          title: candidate.title,
          content: candidate.content,
          summary: null,
          sensitivity: candidate.sensitivity,
          importance: 50,
          confidenceScore: 0.5,
          validFrom: candidate.validFrom,
          validUntil: candidate.validUntil,
          observedAt,
          retentionPolicy: "standard",
          expiresAt: null,
          createdByOperationId: operationId,
          metadata: {
            createdVia: "post_run_extraction",
            postRunExtractionVersion: POST_RUN_EXTRACTION_VERSION,
            postRunExtractionFingerprint: candidateFingerprint,
            sourceRunId: run.id,
            sourceIssueId: issue.id,
            sourceCandidateIndex: candidateIndex,
            proposedScopeType: candidate.proposedScopeType,
            proposedScopeId: candidate.proposedScopeId,
            proposedEvidenceRefs: candidate.evidenceRefs,
            rationale: candidate.rationale,
          },
          evidence: [
            {
              sourceClass: "task",
              sourceProvider: "august_works_post_run_extraction",
              sourceType: "agent_run_memory_candidate",
              sourceRef: `run://${run.id}/issue/${issue.id}`,
              sourceVersion:
                run.finishedAt?.toISOString() ??
                run.updatedAt.toISOString(),
              sourceUpdatedAt:
                run.finishedAt?.toISOString() ??
                issue.updatedAt.toISOString(),
              observedAt,
              excerptHash: sha256(candidate.content),
              citation: {
                label: issue.identifier
                  ? `${issue.identifier}: ${issue.title}`
                  : issue.title,
              },
              trustLevel: "low",
              relation: "supports",
            },
          ],
        };

        try {
          await memory.createCandidate(run.companyId, input, actor);
          result.persisted += 1;
        } catch (error) {
          if (
            error instanceof HttpError &&
            error.status === 409 &&
            record(error.details).code === "memory_operation_conflict"
          ) {
            const raced = await existingOperationRecord(
              db,
              run.companyId,
              operationId,
            );
            if (
              raced &&
              existingExtractionFingerprint(raced) === candidateFingerprint
            ) {
              result.duplicates += 1;
              continue;
            }
            addSkip(result, "operation_conflict");
            continue;
          }
          throw error;
        }
      }

      await auditExtraction(db, run, issue.id, result);
      return result;
    },
  };
}
