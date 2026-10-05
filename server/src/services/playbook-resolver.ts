import { assertLearningAssetCurrent } from "./learning/learning-assets.js";
import type { Db } from "@paperclipai/db";
import type { AgentExecutionManifest, RolePackItem } from "@paperclipai/shared";
import { conflict } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { playbookService } from "./playbooks.js";
import { skillTaskMatches } from "./skill-resolver.js";

export function playbookResolverService(db: Db) {
  async function validate(actor: AuthorizationActor, companyId: string, pin: AgentExecutionManifest["playbooks"][number]) {
    const row = await playbookService(db).get(actor, companyId, pin.playbookId);
    if (!["approved", "in_review"].includes(row.status) || row.approvedRevisionId !== pin.revisionId || row.overdue) throw conflict("Pinned Playbook is stale, unapproved, or overdue");
    await assertLearningAssetCurrent(db, companyId, "document_revision", pin.revisionId);
    return row;
  }
  return {
    validate,
    resolve: async (actor: AuthorizationActor, companyId: string, query: string, requirements: readonly RolePackItem[]) => {
      const relevant = requirements.filter((r) => r.type === "required_playbook" || r.type === "recommended_playbook");
      if (!relevant.length) return { pins: [] as AgentExecutionManifest["playbooks"], warnings: [] as string[] };
      const rows = await playbookService(db).list(actor, companyId), pins: AgentExecutionManifest["playbooks"] = [], warnings: string[] = [];
      for (const item of relevant) {
        const row = rows.find((r) => r.id === item.ref || r.key === item.ref), required = item.type === "required_playbook";
        if (!row) { if (required) throw conflict(`Required Playbook is unavailable: ${item.ref}`); warnings.push(`Optional Playbook unavailable: ${item.ref}`); continue; }
        if (item.loadPoint !== "always" && !skillTaskMatches(query, item.triggerTerms.length ? item.triggerTerms : [row.key.replaceAll("-", " ")], item.excludeTerms)) continue;
        if (!row.approvedRevisionId) { if (required) throw conflict(`Required Playbook has no approved revision: ${row.key}`); continue; }
        const pin = { playbookId: row.id, revisionId: item.versionId ?? row.approvedRevisionId, required };
        try { await validate(actor, companyId, pin); }
        catch (error) { if (required) throw error; warnings.push(`Optional Playbook needs review: ${row.key}`); continue; }
        if (pins.length >= 32) throw conflict("Runtime Playbook inventory exceeds 32 revisions");
        pins.push(pin);
      }
      return { pins, warnings };
    },
  };
}
