import type { Db } from "@paperclipai/db";
import type { AgentExecutionManifest, RolePackItem } from "@paperclipai/shared";
import {conflict} from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import type {NativeReadScope} from "./analytical-reader.js";
import { playbookService } from "./playbooks.js";
import { skillTaskMatches } from "./skill-resolver.js";

export function playbookResolverService(db: Db) {
  async function validate(actor: AuthorizationActor, companyId: string, pin: AgentExecutionManifest["playbooks"][number],readScope?:NativeReadScope) {
    return playbookService(db).runtimeRevision(actor,companyId,pin.playbookId,pin.revisionId,readScope);
  }
  return {
    validate,
    resolve: async (actor: AuthorizationActor, companyId: string, query: string, requirements: readonly RolePackItem[],readScope?:NativeReadScope) => {
      const relevant = requirements.filter((r) => r.type === "required_playbook" || r.type === "recommended_playbook");
      if(relevant.length>100)throw conflict("Runtime Playbook requirements exceed 100 references");
      if (!relevant.length) return { pins: [] as AgentExecutionManifest["playbooks"], warnings: [] as string[] };
      const pins: AgentExecutionManifest["playbooks"] = [], warnings: string[] = [];
      for (const item of relevant) {
        const required = item.type === "required_playbook";
        if(item.loadPoint!=="always"&&item.triggerTerms.length&&!skillTaskMatches(query,item.triggerTerms,item.excludeTerms))continue;
        let row;
        try{row=await playbookService(db).runtimeRevision(actor,companyId,item.ref,item.versionId??undefined,readScope);}
        catch(error){if(required)throw error;warnings.push(`Optional Playbook unavailable: ${item.ref}`);continue;}
        if (item.loadPoint !== "always" && !skillTaskMatches(query, item.triggerTerms.length ? item.triggerTerms : [row.key.replaceAll("-", " ")], item.excludeTerms)) continue;
        const pin = { playbookId: row.id, revisionId: row.approvedRevisionId!, required };
        if (pins.length >= 32) throw conflict("Runtime Playbook inventory exceeds 32 revisions");
        pins.push(pin);
      }
      return { pins, warnings };
    },
  };
}
