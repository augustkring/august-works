import { eq } from "drizzle-orm";
import { companySkills, companySkillVersions, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../../services/authorization.js";
import { rolePackService } from "../../services/role-packs.js";

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
