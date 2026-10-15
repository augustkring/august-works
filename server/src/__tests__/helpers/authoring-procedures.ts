import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accessService } from "../../services/access.js";
import { createPlaybookSchema } from "@paperclipai/shared";
import { companySkills, companySkillVersions, companyMemberships, principalPermissionGrants, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { rolePackService } from "../../services/role-packs.js";
import { playbookService } from "../../services/playbooks.js";

/** Actual approved procedure owner in a disposable software test company. */
export async function seedApprovedAuthoringPlaybook(db: Db, actor: AuthorizationActor, companyId: string) {
  const body = "Canonical fixture procedure: write only an internal welcome draft; never send external messages.";
  const service = playbookService(db);
  const playbook = await service.create(actor, companyId, createPlaybookSchema.parse({
    key: `welcome-${randomUUID()}`, title: "Approved welcome procedure", markdown: body,
  }));
  const row = await service.get(actor, companyId, playbook.id);
  await service.review(actor, companyId, playbook.id, { expectedRevisionId: row.document.latestRevisionId!,
    decision: "approve", rationale: "Human-reviewed procedure for the isolated software test" });
  const current = await service.runtimeRevision(actor, companyId, playbook.id);
  return { playbookId: playbook.id, revisionId: current.revision.id, key: current.key,
    name: current.revision.title!, body: current.revision.body, documentId: current.documentId };
}

export async function bindAuthoringPlaybook(db: Db, actor: AuthorizationActor, companyId: string, agentId: string,
  playbook: Awaited<ReturnType<typeof seedApprovedAuthoringPlaybook>>) {
  const service = rolePackService(db), role = await service.create(actor, companyId, {
    key: `playbook-${randomUUID()}`, name: "Required approved welcome", description: "Software procedural mapping",
  });
  const version = await service.createVersion(actor, companyId, role.id, { summary: "Use the exact human-reviewed procedure",
    items: [{ type: "required_playbook", ref: playbook.playbookId, versionId: playbook.revisionId, operation: "add",
      loadPoint: "task_relevant", triggerTerms: ["absent-trigger-term"], excludeTerms: [] }],
  });
  await service.publish(actor, companyId, role.id, version.id, null);
  await service.assign(actor, companyId, { scopeType: "agent", scopeId: agentId, rolePackId: role.id,
    versionPolicy: "pinned", pinnedVersionId: version.id });
}

/** Explicit disposable-fixture access prerequisite. Production authoring does
 * not create this grant or turn a procedural component into read authority. */
export async function grantAuthoringPlaybookReadFixture(db: Db, companyId: string, agentId: string) {
  await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" }).onConflictDoNothing();
  await db.insert(principalPermissionGrants).values(["company_scope:read", "foundation:read"].map(permissionKey => ({
    companyId, principalType: "agent", principalId: agentId, permissionKey }))).onConflictDoNothing();
}

/** Explicit canonical software prerequisites in the throwaway test database.
 * These active rows do not establish customer publication or provider proof. */
export async function seedRequiredAuthoringProcedures(db: Db, actor: AuthorizationActor, companyId: string, agentId: string) {
  const rolePack = await rolePackService(db).resolve(actor, companyId, agentId);
  const pins = [];
  for (const item of rolePack.items.filter(item => item.type === "required_skill")) {
    const body = `# ${item.ref}\nFixture required procedure: keep the result an internal draft for accountable human review.\n`;
    const [skill] = await db.insert(companySkills).values({ companyId, key: item.ref, slug: item.ref, name: item.ref,
      markdown: body, trustLevel: "markdown_only", fileInventory: [{ path: "SKILL.md", kind: "skill" }] }).returning();
    const [version] = await db.insert(companySkillVersions).values({ companyId, companySkillId: skill!.id,
      revisionNumber: 1, state: "active", visibility: "company", fileInventory: [{ path: "SKILL.md", kind: "skill", content: body }] }).returning();
    await db.update(companySkills).set({ lifecycleState: "active", activeVersionId: version!.id,
      currentVersionId: version!.id, headVersionId: version!.id }).where(eq(companySkills.id, skill!.id));
    pins.push({ skillId: skill!.id, versionId: version!.id, key: skill!.key, body });
  }
  return pins;
}
/** Actual membership/grant owner; a grant row alone is not current access. */
export async function grantAuthoringKnowledgeReadFixture(db: Db, companyId: string, agentId: string, userId: string) {
  const owner = accessService(db);
  await owner.setPrincipalPermission(companyId, "agent", agentId, "foundation:read", true, userId);
  const [human] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId),
    eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId)));
  await owner.setPrincipalPermission(companyId, "user", userId, "foundation:read", true, userId);
  // This fixture retains the existing human role. The grant owner defaults a
  // newly enabled membership to member; verification still needs its real owner.
  if (human) await owner.ensureMembership(companyId, "user", userId, human.membershipRole, human.status);
}
