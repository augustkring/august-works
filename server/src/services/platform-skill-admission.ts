import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, companySkills, companySkillVersions, type Db } from "@paperclipai/db";
import { agentExecutionManifestSchema } from "@paperclipai/shared";
import { z } from "zod";
import { conflict, forbidden } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { assertV5Authorization } from "./v5-authorization.js";
import { companySkillService } from "./company-skills.js";

const admissionSchema = z.object({
  schemaVersion: z.literal(1),
  platformSkill: agentExecutionManifestSchema.shape.platformSkill.unwrap(),
  operationManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  toolCatalogContractHash: z.string().regex(/^[a-f0-9]{64}$/),
  runtimeAdapter: z.string().min(1).max(100),
}).strict();
export type PlatformSkillContracts = Pick<z.infer<typeof admissionSchema>, "operationManifestHash" | "toolCatalogContractHash">;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function platformSkillAdmissionMatches(stored: unknown, current: unknown): boolean {
  const prior = admissionSchema.safeParse(stored), next = admissionSchema.safeParse(current);
  if (!prior.success || !next.success) return false;
  const a = prior.data, b = next.data;
  return a.schemaVersion === b.schemaVersion && a.runtimeAdapter === b.runtimeAdapter &&
    a.operationManifestHash === b.operationManifestHash && a.toolCatalogContractHash === b.toolCatalogContractHash &&
    a.platformSkill.key === b.platformSkill.key && a.platformSkill.version === b.platformSkill.version &&
    a.platformSkill.digest === b.platformSkill.digest && a.platformSkill.sourceSha === b.platformSkill.sourceSha;
}

function changed(): never {
  throw conflict("The required operating procedure changed or is unavailable. Validate it and start a new run.", {
    code: "platform_skill_readmission_required",
  });
}

/** A server-owned admission on the existing Run, including legacy/Fabric-off
 * paths. This records a procedure pin, not a grant or profile qualification. */
export async function preparePlatformSkillAdmission(db: Db, input: {
  companyId: string; agentId: string; runId: string; responsibleUserId: string | null;
  requireExisting: boolean;
}, contracts: PlatformSkillContracts) {
  if (!input.responsibleUserId) throw forbidden("Co-worker execution requires its responsible Human");
  const actor: AuthorizationActor = { type: "agent", source: "none", companyId: input.companyId,
    agentId: input.agentId, runId: input.runId, onBehalfOfUserId: input.responsibleUserId };
  await assertV5Authorization(db, actor, input.companyId, "company_scope:read");
  const platform = await companySkillService(db).requiredPlatformSkill(input.companyId, actor, contracts);
  return db.transaction(async tx => {
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, input.companyId),
      eq(heartbeatRuns.id, input.runId), eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.status, "running"))).for("update");
    const [agent] = await tx.select({ adapterType: agents.adapterType }).from(agents)
      .where(and(eq(agents.companyId, input.companyId), eq(agents.id, input.agentId))).limit(1);
    if (!run || !agent || run.responsibleUserId !== input.responsibleUserId)
      throw forbidden("The operating procedure admission requires the current Run and responsible Human");
    const admission = admissionSchema.parse({ schemaVersion: 1, platformSkill: platform.identity,
      ...contracts, runtimeAdapter: agent.adapterType });
    const previous = object(run.runnerProfileJson).platformSkillAdmission;
    if (previous !== undefined || input.requireExisting) {
      if (!platformSkillAdmissionMatches(previous, admission)) changed();
    } else {
      await tx.update(heartbeatRuns).set({ runnerProfileJson: sql`coalesce(${heartbeatRuns.runnerProfileJson}, '{}'::jsonb) || ${JSON.stringify({ platformSkillAdmission: admission })}::jsonb` })
        .where(and(eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId)));
    }
    return platform;
  });
}

/** Call at the canonical material-operation owner, after ordinary current
 * authority checks. Missing legacy pins require re-admission; flags never waive
 * the procedure/contract check. Caller data cannot select another principal. */
export async function assertPlatformSkillAdmission(db: Db, actor: AuthorizationActor, contracts: PlatformSkillContracts): Promise<void> {
  if (actor.type !== "agent" || !actor.companyId || !actor.agentId || !actor.runId || !actor.onBehalfOfUserId)
    throw forbidden("A material Co-worker operation requires the current Run and responsible Human");
  await assertV5Authorization(db, actor, actor.companyId, "company_scope:read");
  // At a transactional mutation owner these locks retain the current immutable
  // version and lifecycle decision until that same effect commits.
  const [skill] = await db.select({ id: companySkills.id, versionId: companySkills.activeVersionId }).from(companySkills)
    .where(and(eq(companySkills.companyId, actor.companyId), eq(companySkills.key, "blentera-platform"))).for("share");
  if (!skill?.versionId) changed();
  await db.select({ id: companySkillVersions.id }).from(companySkillVersions).where(and(
    eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.companySkillId, skill.id),
    eq(companySkillVersions.id, skill.versionId))).for("share");
  const platform = await companySkillService(db).requiredPlatformSkill(actor.companyId, actor, contracts, { ensureInventory: false });
  const [row] = await db.select({ profile: heartbeatRuns.runnerProfileJson, responsibleUserId: heartbeatRuns.responsibleUserId,
    adapterType: agents.adapterType }).from(heartbeatRuns).innerJoin(agents,
      and(eq(agents.id, heartbeatRuns.agentId), eq(agents.companyId, heartbeatRuns.companyId)))
    .where(and(eq(heartbeatRuns.companyId, actor.companyId), eq(heartbeatRuns.id, actor.runId),
      eq(heartbeatRuns.agentId, actor.agentId), eq(heartbeatRuns.status, "running"))).limit(1);
  if (!row || row.responsibleUserId !== actor.onBehalfOfUserId)
    throw forbidden("The material operation outlived its current Run or responsible Human");
  if (!platformSkillAdmissionMatches(object(row.profile).platformSkillAdmission, {
    schemaVersion: 1, platformSkill: platform.identity, ...contracts, runtimeAdapter: row.adapterType,
  })) changed();
}
