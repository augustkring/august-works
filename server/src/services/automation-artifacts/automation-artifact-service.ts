import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  automationArtifacts,
  automationArtifactVersions,
  companyMemberships,
  heartbeatRuns,
  workflows,
} from "@paperclipai/db";
import {
  appendAutomationArtifactVersionSchema,
  archiveAutomationArtifactSchema,
  createAutomationArtifactSchema,
  executionPrincipalToActivityActor,
  transitionAutomationArtifactStatusSchema,
  type AppendAutomationArtifactVersion,
  type AutomationArtifact,
  type AutomationArtifactDetail,
  type AutomationArtifactKind,
  type AutomationArtifactLanguage,
  type AutomationArtifactStatus,
  type AutomationArtifactVersion,
  type CreateAutomationArtifact,
  type ExecutionPrincipal,
  type TransitionAutomationArtifactStatus,
} from "@paperclipai/shared";
import {
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from "../../errors.js";
import {
  persistActivity,
  publishActivity,
  type ActivityPublication,
} from "../activity-log.js";
import {
  AutomationArtifactDeclarativeError,
  validateAutomationArtifactDeclarativeSource,
} from "./automation-artifact-declarative.js";

export interface AutomationArtifactMutationActor {
  principal: ExecutionPrincipal;
  runId?: string | null;
}

type ArtifactDb = Db;

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalValue(value: unknown): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw unprocessable("Automation Artifact content contains a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const output: Record<string, CanonicalValue> = Object.create(null) as Record<
      string,
      CanonicalValue
    >;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = (value as Record<string, unknown>)[key];
      if (next === undefined) continue;
      output[key] = canonicalValue(next);
    }
    return output;
  }
  throw unprocessable("Automation Artifact content must be JSON-compatible");
}

export function automationArtifactVersionContentHash(input: {
  kind: AutomationArtifactKind;
  language: AutomationArtifactLanguage | null;
  sourceCode: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  dependencyManifest: Record<string, unknown>;
  testSpec: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(input)))
    .digest("hex");
}

function mapArtifact(
  row: typeof automationArtifacts.$inferSelect,
): AutomationArtifact {
  return row;
}

function mapVersion(
  row: typeof automationArtifactVersions.$inferSelect,
): AutomationArtifactVersion {
  return row;
}

function actorFields(actor: AutomationArtifactMutationActor) {
  const activity = executionPrincipalToActivityActor(actor.principal);
  return {
    actorType: activity.actorType,
    actorId: activity.actorId,
    agentId: actor.principal.type === "agent" ? actor.principal.agentId : null,
    userId: actor.principal.type === "user" ? actor.principal.userId : null,
    runId: actor.runId ?? null,
    responsibleUserId: activity.responsibleUserId,
  };
}

async function persistedActivityRunId(
  db: ArtifactDb,
  companyId: string,
  runId: string | null,
): Promise<string | null> {
  if (!runId) return null;
  return db
    .select({ id: heartbeatRuns.id })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)))
    .then((rows) => rows[0]?.id ?? null);
}

async function persistArtifactActivity(
  db: ArtifactDb,
  actor: AutomationArtifactMutationActor,
  input: {
    companyId: string;
    action: string;
    artifactId: string;
    details?: Record<string, unknown> | null;
  },
) {
  const identity = actorFields(actor);
  const runId = await persistedActivityRunId(
    db,
    input.companyId,
    identity.runId,
  );
  const result = await persistActivity(db, {
    companyId: input.companyId,
    actorType: identity.actorType,
    actorId: identity.actorId,
    agentId: identity.agentId,
    runId,
    responsibleUserIdOverride: identity.responsibleUserId,
    action: input.action,
    entityType: "automation_artifact",
    entityId: input.artifactId,
    details: input.details ?? null,
  });
  return result.publication;
}

async function assertActorCompanyScope(
  db: ArtifactDb,
  companyId: string,
  actor: AutomationArtifactMutationActor,
) {
  if (actor.principal.type === "system") return;

  if (actor.principal.type === "agent") {
    const row = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.id, actor.principal.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw forbidden("Agent does not belong to this company", {
        code: "company_boundary_denied",
      });
    }
    return;
  }

  const membership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, actor.principal.userId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!membership) {
    throw forbidden("User does not have an active company membership", {
      code: "company_boundary_denied",
    });
  }
}

async function assertOriginWorkflow(
  db: ArtifactDb,
  companyId: string,
  workflowId: string | null,
) {
  if (!workflowId) return;
  const row = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.companyId, companyId), eq(workflows.id, workflowId)))
    .then((rows) => rows[0] ?? null);
  if (!row) {
    throw unprocessable("Automation Artifact origin workflow must belong to the company", {
      code: "cross_company_reference",
      resourceType: "workflow",
      resourceId: workflowId,
    });
  }
}

function assertOptimizerProvenance(
  optimizerSuggestionId: string | null,
  actor: AutomationArtifactMutationActor,
) {
  if (optimizerSuggestionId && actor.principal.type !== "system") {
    throw forbidden(
      "Optimizer suggestion provenance can only be assigned by the system",
      { code: "automation_artifact_optimizer_provenance_denied" },
    );
  }
}

async function getArtifactRow(
  db: ArtifactDb,
  companyId: string,
  artifactId: string,
) {
  return db
    .select()
    .from(automationArtifacts)
    .where(
      and(
        eq(automationArtifacts.companyId, companyId),
        eq(automationArtifacts.id, artifactId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function getVersionRow(
  db: ArtifactDb,
  companyId: string,
  artifactId: string,
  versionId: string,
) {
  return db
    .select()
    .from(automationArtifactVersions)
    .where(
      and(
        eq(automationArtifactVersions.companyId, companyId),
        eq(automationArtifactVersions.artifactId, artifactId),
        eq(automationArtifactVersions.id, versionId),
      ),
    )
    .then((rows) => rows[0] ?? null);
}

async function getDetail(
  db: ArtifactDb,
  companyId: string,
  artifactId: string,
): Promise<AutomationArtifactDetail | null> {
  const artifact = await getArtifactRow(db, companyId, artifactId);
  if (!artifact) return null;

  const latestVersion = artifact.latestVersionId
    ? await getVersionRow(db, companyId, artifact.id, artifact.latestVersionId)
    : null;
  if (artifact.latestVersionId && !latestVersion) {
    throw conflict("Automation Artifact latest-version pointer is invalid", {
      code: "automation_artifact_pointer_invalid",
      artifactId,
      latestVersionId: artifact.latestVersionId,
    });
  }

  return {
    artifact: mapArtifact(artifact),
    latestVersion: latestVersion ? mapVersion(latestVersion) : null,
  };
}

async function lockArtifact(
  db: ArtifactDb,
  companyId: string,
  artifactId: string,
) {
  return db
    .select()
    .from(automationArtifacts)
    .where(
      and(
        eq(automationArtifacts.companyId, companyId),
        eq(automationArtifacts.id, artifactId),
      ),
    )
    .for("update")
    .then((rows) => rows[0] ?? null);
}

function assertExpectedPointer(
  artifact: typeof automationArtifacts.$inferSelect,
  expectedLatestVersionId: string,
) {
  if (artifact.latestVersionId !== expectedLatestVersionId) {
    throw conflict("Automation Artifact version changed elsewhere", {
      code: "revision_conflict",
      currentLatestVersionId: artifact.latestVersionId,
    });
  }
}

function assertVersionAppendAllowed(
  artifact: typeof automationArtifacts.$inferSelect,
) {
  if (artifact.archivedAt) {
    throw conflict("Archived Automation Artifact cannot receive new versions", {
      code: "automation_artifact_archived",
    });
  }
  if (
    artifact.status === "active" ||
    artifact.status === "shadow" ||
    artifact.status === "deprecated" ||
    artifact.status === "revoked"
  ) {
    throw conflict(
      "Automation Artifact must leave executable lifecycle states before a new version can be appended",
      {
        code: "automation_artifact_version_locked",
        status: artifact.status,
      },
    );
  }
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<AutomationArtifactStatus, readonly AutomationArtifactStatus[]>
> = {
  candidate: ["testing", "failed", "deprecated", "revoked"],
  testing: ["candidate", "failed", "deprecated", "revoked"],
  shadow: ["candidate", "failed", "deprecated", "revoked"],
  active: ["failed", "deprecated", "revoked"],
  deprecated: ["revoked"],
  revoked: [],
  failed: ["candidate", "testing", "deprecated", "revoked"],
};

function assertStatusTransitionAllowed(
  current: AutomationArtifactStatus,
  next: AutomationArtifactStatus,
) {
  if (current === next) return;
  if (next === "active" || next === "shadow") {
    throw forbidden(
      "Automation Artifact activation requires the PR 41 validation and security gate",
      { code: "automation_artifact_security_gate_required", targetStatus: next },
    );
  }
  if (!ALLOWED_STATUS_TRANSITIONS[current].includes(next)) {
    throw conflict("Automation Artifact lifecycle transition is invalid", {
      code: "automation_artifact_invalid_transition",
      currentStatus: current,
      targetStatus: next,
    });
  }
}

function validateDeclarativeSource(
  kind: AutomationArtifactKind,
  sourceCode: string,
) {
  try {
    validateAutomationArtifactDeclarativeSource(kind, sourceCode);
  } catch (error) {
    if (error instanceof AutomationArtifactDeclarativeError) {
      throw unprocessable(error.message, { code: error.code });
    }
    throw error;
  }
}

function versionHashFor(
  artifact: Pick<
    typeof automationArtifacts.$inferSelect,
    "kind" | "language"
  >,
  input: {
    sourceCode: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    dependencyManifest: Record<string, unknown>;
    testSpec: Record<string, unknown>;
  },
) {
  return automationArtifactVersionContentHash({
    kind: artifact.kind,
    language: artifact.language,
    sourceCode: input.sourceCode,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    dependencyManifest: input.dependencyManifest,
    testSpec: input.testSpec,
  });
}

export function automationArtifactService(db: Db) {
  return {
    list: async (
      companyId: string,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifact[]> => {
      await assertActorCompanyScope(db, companyId, actor);
      return db
        .select()
        .from(automationArtifacts)
        .where(eq(automationArtifacts.companyId, companyId))
        .orderBy(desc(automationArtifacts.updatedAt))
        .then((rows) => rows.map(mapArtifact));
    },

    getDetail: async (
      companyId: string,
      artifactId: string,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactDetail | null> => {
      await assertActorCompanyScope(db, companyId, actor);
      return getDetail(db, companyId, artifactId);
    },

    create: async (
      companyId: string,
      rawInput: CreateAutomationArtifact,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactDetail> => {
      const parsed = createAutomationArtifactSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          "Invalid Automation Artifact",
          parsed.error.issues,
        );
      }
      const input = parsed.data;
      validateDeclarativeSource(input.kind, input.sourceCode);
      const publications: ActivityPublication[] = [];

      const artifactId = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        await assertOriginWorkflow(txDb, companyId, input.originWorkflowId);
        assertOptimizerProvenance(
          input.createdByOptimizerSuggestionId,
          actor,
        );

        const identity = actorFields(actor);
        const now = new Date();
        const [artifact] = await txDb
          .insert(automationArtifacts)
          .values({
            companyId,
            name: input.name,
            description: input.description,
            kind: input.kind,
            language: input.language,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            riskClass: input.riskClass,
            sideEffectClass: input.sideEffectClass,
            status: "candidate",
            createdByAgentId: identity.agentId,
            createdByUserId: identity.userId,
            createdByOptimizerSuggestionId:
              input.createdByOptimizerSuggestionId,
            originWorkflowId: input.originWorkflowId,
            originNodeId: input.originNodeId,
            latestVersionId: null,
            successCount: 0,
            failureCount: 0,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!artifact) {
          throw new Error("Automation Artifact insert returned no row");
        }

        const contentHash = versionHashFor(artifact, input);
        const [version] = await txDb
          .insert(automationArtifactVersions)
          .values({
            companyId,
            artifactId: artifact.id,
            versionNumber: 1,
            sourceCode: input.sourceCode,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            dependencyManifest: input.dependencyManifest,
            testSpec: input.testSpec,
            validationReport: null,
            securityReport: null,
            contentHash,
            createdByAgentId: identity.agentId,
            createdByUserId: identity.userId,
            createdAt: now,
          })
          .returning();
        if (!version) {
          throw new Error("Automation Artifact version insert returned no row");
        }

        const [updated] = await txDb
          .update(automationArtifacts)
          .set({
            latestVersionId: version.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(automationArtifacts.companyId, companyId),
              eq(automationArtifacts.id, artifact.id),
              isNull(automationArtifacts.latestVersionId),
            ),
          )
          .returning({ id: automationArtifacts.id });
        if (!updated) {
          throw conflict("Automation Artifact version pointer changed during creation", {
            code: "revision_conflict",
          });
        }

        publications.push(
          await persistArtifactActivity(txDb, actor, {
            companyId,
            action: "automation_artifact.created",
            artifactId: artifact.id,
            details: {
              versionId: version.id,
              versionNumber: version.versionNumber,
              contentHash,
              kind: artifact.kind,
              riskClass: artifact.riskClass,
              sideEffectClass: artifact.sideEffectClass,
            },
          }),
        );

        return artifact.id;
      });

      publications.forEach(publishActivity);
      const detail = await getDetail(db, companyId, artifactId);
      if (!detail) {
        throw new Error("Automation Artifact disappeared after creation");
      }
      return detail;
    },

    appendVersion: async (
      companyId: string,
      artifactId: string,
      rawInput: AppendAutomationArtifactVersion,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactDetail> => {
      const parsed = appendAutomationArtifactVersionSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          "Invalid Automation Artifact version",
          parsed.error.issues,
        );
      }
      const input = parsed.data;
      const publications: ActivityPublication[] = [];

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const artifact = await lockArtifact(txDb, companyId, artifactId);
        if (!artifact) throw notFound("Automation Artifact not found");
        assertExpectedPointer(artifact, input.expectedLatestVersionId);
        validateDeclarativeSource(artifact.kind, input.sourceCode);
        assertVersionAppendAllowed(artifact);

        const currentVersion = artifact.latestVersionId
          ? await getVersionRow(
              txDb,
              companyId,
              artifact.id,
              artifact.latestVersionId,
            )
          : null;
        if (!currentVersion) {
          throw conflict("Automation Artifact latest-version pointer is invalid", {
            code: "automation_artifact_pointer_invalid",
            currentLatestVersionId: artifact.latestVersionId,
          });
        }

        const contentHash = versionHashFor(artifact, input);
        const duplicate = await txDb
          .select({ id: automationArtifactVersions.id })
          .from(automationArtifactVersions)
          .where(
            and(
              eq(automationArtifactVersions.companyId, companyId),
              eq(automationArtifactVersions.artifactId, artifact.id),
              eq(automationArtifactVersions.contentHash, contentHash),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (duplicate) {
          throw conflict("Automation Artifact version content already exists", {
            code: "automation_artifact_version_unchanged",
            existingVersionId: duplicate.id,
          });
        }

        const identity = actorFields(actor);
        const now = new Date();
        const [version] = await txDb
          .insert(automationArtifactVersions)
          .values({
            companyId,
            artifactId: artifact.id,
            versionNumber: currentVersion.versionNumber + 1,
            sourceCode: input.sourceCode,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            dependencyManifest: input.dependencyManifest,
            testSpec: input.testSpec,
            validationReport: null,
            securityReport: null,
            contentHash,
            createdByAgentId: identity.agentId,
            createdByUserId: identity.userId,
            createdAt: now,
          })
          .returning();
        if (!version) {
          throw new Error("Automation Artifact version insert returned no row");
        }

        const [updated] = await txDb
          .update(automationArtifacts)
          .set({
            latestVersionId: version.id,
            inputSchema: input.inputSchema,
            outputSchema: input.outputSchema,
            status: "candidate",
            updatedAt: now,
          })
          .where(
            and(
              eq(automationArtifacts.companyId, companyId),
              eq(automationArtifacts.id, artifact.id),
              eq(
                automationArtifacts.latestVersionId,
                input.expectedLatestVersionId,
              ),
            ),
          )
          .returning({ id: automationArtifacts.id });
        if (!updated) {
          throw conflict("Automation Artifact version changed during append", {
            code: "revision_conflict",
          });
        }

        publications.push(
          await persistArtifactActivity(txDb, actor, {
            companyId,
            action: "automation_artifact.version_created",
            artifactId: artifact.id,
            details: {
              versionId: version.id,
              versionNumber: version.versionNumber,
              contentHash,
              previousVersionId: input.expectedLatestVersionId,
            },
          }),
        );
      });

      publications.forEach(publishActivity);
      const detail = await getDetail(db, companyId, artifactId);
      if (!detail) {
        throw new Error("Automation Artifact disappeared after version append");
      }
      return detail;
    },

    transitionStatus: async (
      companyId: string,
      artifactId: string,
      rawInput: TransitionAutomationArtifactStatus,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactDetail> => {
      const parsed =
        transitionAutomationArtifactStatusSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          "Invalid Automation Artifact status transition",
          parsed.error.issues,
        );
      }
      const input = parsed.data;
      const publications: ActivityPublication[] = [];

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const artifact = await lockArtifact(txDb, companyId, artifactId);
        if (!artifact) throw notFound("Automation Artifact not found");
        assertExpectedPointer(artifact, input.expectedLatestVersionId);
        if (artifact.status !== input.expectedStatus) {
          throw conflict("Automation Artifact status changed elsewhere", {
            code: "revision_conflict",
            currentStatus: artifact.status,
          });
        }
        assertStatusTransitionAllowed(artifact.status, input.status);
        if (artifact.status === input.status) return;

        const now = new Date();
        const [updated] = await txDb
          .update(automationArtifacts)
          .set({ status: input.status, updatedAt: now })
          .where(
            and(
              eq(automationArtifacts.companyId, companyId),
              eq(automationArtifacts.id, artifact.id),
              eq(automationArtifacts.status, input.expectedStatus),
              eq(
                automationArtifacts.latestVersionId,
                input.expectedLatestVersionId,
              ),
            ),
          )
          .returning({ id: automationArtifacts.id });
        if (!updated) {
          throw conflict("Automation Artifact lifecycle changed during transition", {
            code: "revision_conflict",
          });
        }

        publications.push(
          await persistArtifactActivity(txDb, actor, {
            companyId,
            action: "automation_artifact.status_changed",
            artifactId: artifact.id,
            details: {
              from: artifact.status,
              to: input.status,
              latestVersionId: artifact.latestVersionId,
            },
          }),
        );
      });

      publications.forEach(publishActivity);
      const detail = await getDetail(db, companyId, artifactId);
      if (!detail) {
        throw new Error("Automation Artifact disappeared after status transition");
      }
      return detail;
    },

    archive: async (
      companyId: string,
      artifactId: string,
      rawInput: unknown,
      actor: AutomationArtifactMutationActor,
    ): Promise<AutomationArtifactDetail> => {
      const parsed = archiveAutomationArtifactSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw unprocessable(
          "Invalid Automation Artifact archive request",
          parsed.error.issues,
        );
      }
      const publications: ActivityPublication[] = [];

      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        await assertActorCompanyScope(txDb, companyId, actor);
        const artifact = await lockArtifact(txDb, companyId, artifactId);
        if (!artifact) throw notFound("Automation Artifact not found");
        assertExpectedPointer(
          artifact,
          parsed.data.expectedLatestVersionId,
        );
        if (artifact.archivedAt) return;

        const now = new Date();
        const nextStatus =
          artifact.status === "revoked" ? "revoked" : "deprecated";
        await txDb
          .update(automationArtifacts)
          .set({
            status: nextStatus,
            archivedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(automationArtifacts.companyId, companyId),
              eq(automationArtifacts.id, artifact.id),
              eq(
                automationArtifacts.latestVersionId,
                parsed.data.expectedLatestVersionId,
              ),
            ),
          );

        publications.push(
          await persistArtifactActivity(txDb, actor, {
            companyId,
            action: "automation_artifact.archived",
            artifactId: artifact.id,
            details: {
              previousStatus: artifact.status,
              status: nextStatus,
              latestVersionId: artifact.latestVersionId,
            },
          }),
        );
      });

      publications.forEach(publishActivity);
      const detail = await getDetail(db, companyId, artifactId);
      if (!detail) {
        throw new Error("Automation Artifact disappeared after archive");
      }
      return detail;
    },
  };
}
