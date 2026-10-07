import {z} from "zod";
import {and,eq,isNull,sql} from "drizzle-orm";
import {agents,authUsers,chatConversations,companyMemberships,heartbeatRuns,issues,type Db} from "@paperclipai/db";
import {v8FeatureEnabled} from "@paperclipai/shared";
import type {AuthorizationActor} from "./authorization.js";
import {assertV7Authorization,v7HumanActorId} from "./v7-authorization.js";
import {instanceSettingsService} from "./instance-settings.js";
import {heartbeatMemoryPayloadRetained} from "./memory/memory-privacy.js";
import {forbidden,notFound} from "../errors.js";
/** Read identity only: an actual running native conversation and its current
 * responsible human. Source owners still enforce agent × human authorization;
 * this never creates a board principal or admits human publication/choice. */
export async function assertAnalyticalReader(db:Db,companyId:string,actor:AuthorizationActor) {
 if(actor.type==="board"){v7HumanActorId(actor);return;}
 if(actor.type!=="agent"||actor.source!=="agent_jwt"||actor.companyId!==companyId||!actor.agentId||!actor.runId||!actor.onBehalfOfUserId||actor.keyId||actor.keyScope||!z.string().uuid().safeParse(actor.agentId).success||!z.string().uuid().safeParse(actor.runId).success)throw forbidden("Current native analytical conversation identity is required");
 if(!v8FeatureEnabled(await instanceSettingsService(db).getExperimental(),"management_chat_tools_v8"))throw notFound("Management chat tools are not enabled");
 const [binding]=await db.select({run:heartbeatRuns,agent:agents,issue:issues}).from(heartbeatRuns)
  .innerJoin(agents,and(eq(agents.companyId,heartbeatRuns.companyId),eq(agents.id,heartbeatRuns.agentId)))
  .innerJoin(issues,and(eq(issues.companyId,heartbeatRuns.companyId),eq(issues.id,heartbeatRuns.nativeIssueId)))
  .innerJoin(authUsers,eq(authUsers.id,heartbeatRuns.responsibleUserId))
  .innerJoin(companyMemberships,and(eq(companyMemberships.companyId,heartbeatRuns.companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,heartbeatRuns.responsibleUserId),eq(companyMemberships.status,"active")))
  .where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,actor.runId),eq(heartbeatRuns.agentId,actor.agentId),eq(heartbeatRuns.responsibleUserId,actor.onBehalfOfUserId),eq(heartbeatRuns.status,"running"),eq(heartbeatRuns.runtimeMode,"native"),eq(issues.assigneeAgentId,actor.agentId),eq(issues.conversationAgentId,actor.agentId),eq(issues.conversationUserId,actor.onBehalfOfUserId),sql`not exists(select 1 from ${chatConversations} c where c.company_id=${companyId}::uuid and c.issue_id=${issues.id})`,eq(issues.executionRunId,actor.runId),isNull(issues.hiddenAt))).limit(1);
 if(!binding||["paused","terminated","pending_approval","error"].includes(binding.agent.status)||binding.run.contextSnapshot?.externalChatQuestionResponse)throw forbidden("Native conversation analytical authority changed");
 if(!await heartbeatMemoryPayloadRetained(db,companyId,actor.runId))throw forbidden("The conversation source payload was erased");
 await assertV7Authorization(db,actor,companyId,"company_scope:read");await assertV7Authorization(db,actor,companyId,"issue:read",{type:"issue",companyId,issueId:binding.issue.id});
}
/** Used only after current read admission, when comparing declared human owners. */
export function analyticalPrincipalId(actor:AuthorizationActor){return actor.type==="agent"&&actor.onBehalfOfUserId?actor.onBehalfOfUserId:v7HumanActorId(actor);}
/** Agent-derived measurements retain their actual requesting principal. */
export function analyticalRequesterId(actor:AuthorizationActor){return actor.type==="agent"?`agent:${actor.agentId}`:v7HumanActorId(actor);}
