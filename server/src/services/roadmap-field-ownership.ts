import { and, eq } from "drizzle-orm";
import { projects, type Db } from "@paperclipai/db";
import { roadmapPolicySchema } from "@paperclipai/shared";
import { conflict } from "../errors.js";

/** Also guards legacy mutation APIs when an external system owns the field. */
export async function assertRoadmapFieldOwnership(db: Db, companyId: string, projectId: string | null | undefined, patch: Record<string, unknown>, current?: Record<string, unknown>) {
  // A rollback hides V5 behavior; it does not transfer authority from the
  // configured external master back to legacy mutation endpoints.
  if (!projectId) return;
  const [project] = await db.select({ policy: projects.roadmapPolicy }).from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, projectId))).limit(1);
  if (!project?.policy) return;
  const policy = roadmapPolicySchema.parse(project.policy);
  const groups = { title: ["title", "name"], status: ["status"], assignee: ["assigneeAgentId", "assigneeUserId"], plannedDates: ["plannedStartAt", "plannedEndAt", "milestoneId"], forecast: ["forecastStartAt", "forecastEndAt", "forecastConfidence", "forecastReason"] } as const;
  for (const [group, keys] of Object.entries(groups)) if (policy.fieldOwnership[group as keyof typeof groups] !== "internal" && keys.some((key) => Object.hasOwn(patch, key) && patch[key] !== undefined && (!current || patch[key] !== current[key]))) throw conflict(`The ${group} field is owned by the configured external system; update it there`);
  if (Object.hasOwn(patch, "projectId") && patch.projectId !== projectId && Object.values(policy.fieldOwnership).some((owner) => owner !== "internal")) throw conflict("External field ownership must be reviewed before moving this task to another project");
}
