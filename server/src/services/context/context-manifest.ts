import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  contextManifestItems,
  contextManifests,
  heartbeatRuns,
  issues,
  projects,
} from "@paperclipai/db";
import type {
  ContextAuthorityDecision,
  EvidenceItem,
} from "@paperclipai/shared";
import { forbidden, unprocessable } from "../../errors.js";

type JsonScalar = string | number | boolean | null;
type CanonicalJson = JsonScalar | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalJson(value: unknown, path = "$"): CanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Context policy snapshot contains a non-finite number", { path });
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
    }
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonicalJson(entry, `${path}.${key}`);
    }
    return result;
  }
  throw unprocessable("Context policy snapshot must be JSON-compatible", { path });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashContextQuery(query: string): string {
  return sha256(query);
}

export function hashContextPolicySnapshot(snapshot: unknown): string {
  return sha256(JSON.stringify(canonicalJson(snapshot)));
}

export function hashEvidenceContent(evidence: EvidenceItem): string {
  return sha256(
    JSON.stringify({
      title: evidence.title,
      excerpt: evidence.excerpt,
    }),
  );
}

export interface ContextManifestSelectedEvidence {
  decision: ContextAuthorityDecision;
  selectionReason?: string;
  retrievalScore?: number | null;
}

export interface CreateContextManifestInput {
  companyId: string;
  runId?: string | null;
  agentId: string;
  issueId?: string | null;
  projectId?: string | null;
  query: string;
  policySnapshot: unknown;
  selected: ContextManifestSelectedEvidence[];
}

async function assertManifestReferences(db: Db, input: CreateContextManifestInput) {
  const [agent, run, issue, project] = await Promise.all([
    db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId)))
      .then((rows) => rows[0] ?? null),
    input.runId
      ? db
          .select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, input.companyId),
              eq(heartbeatRuns.id, input.runId),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.issueId
      ? db
          .select({ id: issues.id, projectId: issues.projectId })
          .from(issues)
          .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.projectId
      ? db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.companyId, input.companyId), eq(projects.id, input.projectId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  if (!agent) throw forbidden("Context manifest agent is outside the company boundary");
  if (input.runId && !run) {
    throw forbidden("Context manifest run is outside the company boundary");
  }
  if (run && run.agentId !== input.agentId) {
    throw forbidden("Context manifest run does not belong to the selected agent");
  }
  if (input.issueId && !issue) {
    throw forbidden("Context manifest issue is outside the company boundary");
  }
  if (input.projectId && !project) {
    throw forbidden("Context manifest project is outside the company boundary");
  }
  if (issue?.projectId && input.projectId && issue.projectId !== input.projectId) {
    throw unprocessable("Context manifest issue and project do not match");
  }

  const crossCompanyEvidence = input.selected.find(
    ({ decision }) => decision.evidence.companyId !== input.companyId,
  );
  if (crossCompanyEvidence) {
    throw forbidden("Context manifest evidence crossed the company boundary");
  }

  for (const item of input.selected) {
    const score = item.retrievalScore;
    if (
      score !== undefined &&
      score !== null &&
      (!Number.isFinite(score))
    ) {
      throw unprocessable("Context manifest retrieval score must be finite");
    }
    const reason = item.selectionReason ?? item.decision.reason;
    if (!reason.trim() || reason.length > 500) {
      throw unprocessable("Context manifest selection reason is invalid");
    }
  }
}

export function contextManifestService(db: Db) {
  return {
    create: async (input: CreateContextManifestInput) => {
      await assertManifestReferences(db, input);

      const queryHash = hashContextQuery(input.query);
      const policySnapshotHash = hashContextPolicySnapshot(input.policySnapshot);

      return db.transaction(async (tx) => {
        const [manifest] = await tx
          .insert(contextManifests)
          .values({
            companyId: input.companyId,
            runId: input.runId ?? null,
            agentId: input.agentId,
            issueId: input.issueId ?? null,
            projectId: input.projectId ?? null,
            queryHash,
            policySnapshotHash,
          })
          .returning();

        const values = input.selected.map((selected, rank) => {
          const evidence = selected.decision.evidence;
          return {
            companyId: input.companyId,
            manifestId: manifest!.id,
            sourceClass: evidence.sourceClass,
            sourceProvider: evidence.sourceProvider,
            sourceRef: evidence.sourceRef,
            sourceVersion: evidence.sourceVersion,
            contentHash: hashEvidenceContent(evidence),
            authorityDomain: evidence.authorityDomain,
            trustLevel: evidence.trustLevel,
            sensitivity: evidence.sensitivity,
            rank,
            selectionReason: selected.selectionReason ?? selected.decision.reason,
            retrievalScore: selected.retrievalScore ?? null,
          };
        });

        const items = values.length > 0
          ? await tx.insert(contextManifestItems).values(values).returning()
          : [];

        return { manifest: manifest!, items };
      });
    },
  };
}
