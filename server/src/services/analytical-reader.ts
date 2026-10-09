import {z} from "zod";
import {AsyncLocalStorage} from "node:async_hooks";
import {and,eq,isNull,or,sql} from "drizzle-orm";
import {agents,authUsers,chatConversations,companyMemberships,heartbeatRuns,issues,type Db} from "@paperclipai/db";
import {v8FeatureEnabled} from "@paperclipai/shared";
import type {AuthorizationActor} from "./authorization.js";
import {assertV7Authorization,v7HumanActorId} from "./v7-authorization.js";
import {instanceSettingsService} from "./instance-settings.js";
import {heartbeatMemoryPayloadRetained} from "./memory/memory-privacy.js";
import {forbidden,notFound} from "../errors.js";
/** Read identity only: an actual running conversation or assigned Task and its current
 * responsible human. Source owners still enforce agent × human authorization;
 * this never creates a board principal or admits human publication/choice. */
export type NativeReadScope = "conversation" | "task";
async function assertNativeReaderIdentity(db:Db,companyId:string,actor:AuthorizationActor,scope:NativeReadScope="conversation") {
 if(actor.type==="board"){v7HumanActorId(actor);return;}
 if(actor.type!=="agent"||actor.source!=="agent_jwt"||actor.companyId!==companyId||!actor.agentId||!actor.runId||!actor.onBehalfOfUserId||actor.keyId||actor.keyScope||!z.string().uuid().safeParse(actor.agentId).success||!z.string().uuid().safeParse(actor.runId).success)throw forbidden("Current native analytical conversation identity is required");
 if(scope==="conversation"&&!v8FeatureEnabled(await instanceSettingsService(db).getExperimental(),"management_chat_tools_v8"))throw notFound("Management chat tools are not enabled");
 const [binding]=await db.select({run:heartbeatRuns,agent:agents,issue:issues}).from(heartbeatRuns)
  .innerJoin(agents,and(eq(agents.companyId,heartbeatRuns.companyId),eq(agents.id,heartbeatRuns.agentId)))
  .innerJoin(issues,and(eq(issues.companyId,heartbeatRuns.companyId),scope==="conversation"?eq(issues.id,heartbeatRuns.nativeIssueId):sql`(${issues.id}=${heartbeatRuns.nativeIssueId} or (${heartbeatRuns.nativeIssueId} is null and ${issues.id}::text=coalesce(${heartbeatRuns.contextSnapshot}->>'issueId',${heartbeatRuns.contextSnapshot}->>'taskId')))`))
  .innerJoin(authUsers,eq(authUsers.id,heartbeatRuns.responsibleUserId))
  .innerJoin(companyMemberships,and(eq(companyMemberships.companyId,heartbeatRuns.companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,heartbeatRuns.responsibleUserId),eq(companyMemberships.status,"active")))
  .where(and(eq(heartbeatRuns.companyId,companyId),eq(heartbeatRuns.id,actor.runId),eq(heartbeatRuns.agentId,actor.agentId),eq(heartbeatRuns.responsibleUserId,actor.onBehalfOfUserId),eq(heartbeatRuns.status,"running"),
   scope==="conversation"?eq(heartbeatRuns.runtimeMode,"native"):sql`(${heartbeatRuns.runtimeMode}='native' or ${heartbeatRuns.runtimeModeResolvedAt} is null)`,
   eq(issues.assigneeAgentId,actor.agentId),
   scope==="conversation"?eq(issues.conversationAgentId,actor.agentId):or(isNull(issues.conversationAgentId),eq(issues.conversationAgentId,actor.agentId)),
   scope==="conversation"?eq(issues.conversationUserId,actor.onBehalfOfUserId):and(or(isNull(issues.conversationUserId),eq(issues.conversationUserId,actor.onBehalfOfUserId)),isNull(issues.conversationRetiredAt),eq(issues.responsibleUserId,actor.onBehalfOfUserId)),
   sql`not exists(select 1 from ${chatConversations} c where c.company_id=${companyId}::uuid and c.issue_id=${issues.id})`,eq(issues.executionRunId,actor.runId),isNull(issues.hiddenAt))).limit(1);
 if(!binding||["paused","terminated","pending_approval","error"].includes(binding.agent.status)||binding.run.contextSnapshot?.externalChatQuestionResponse)throw forbidden("Native conversation analytical authority changed");
 if(binding.issue.conversationAgentId&&(binding.run.runtimeMode!=="native"||!v8FeatureEnabled(await instanceSettingsService(db).getExperimental(),"management_chat_tools_v8")))throw forbidden("Native conversation analytical authority changed");
 if(!await heartbeatMemoryPayloadRetained(db,companyId,actor.runId))throw forbidden("The conversation source payload was erased");
 await assertV7Authorization(db,actor,companyId,"company_scope:read");await assertV7Authorization(db,actor,companyId,"issue:read",{type:"issue",companyId,issueId:binding.issue.id});
}
const nativeReads=new AsyncLocalStorage<{companyId:string;agentId:string;runId:string;userId:string;active:boolean;scope:NativeReadScope}>();
/** Server-owned in-process read admission. HTTP arguments and JWT claims alone
 * cannot consume analytical facts without the native retention boundary. */
export async function withNativeAnalyticalReader<T>(db:Db,companyId:string,actor:AuthorizationActor,read:()=>Promise<T>,readScope?:NativeReadScope) {
 if(actor.type!=="agent")throw forbidden("A native analytical consumer is required");
 const parent=nativeReads.getStore();
 const scope=readScope??(parent?.active&&parent.companyId===companyId&&parent.agentId===actor.agentId&&parent.runId===actor.runId&&parent.userId===actor.onBehalfOfUserId?parent.scope:"conversation");
 await assertNativeReaderIdentity(db,companyId,actor,scope);
 const permit={companyId,agentId:actor.agentId!,runId:actor.runId!,userId:actor.onBehalfOfUserId!,active:true,scope};
 try{return await nativeReads.run(permit,read);}finally{permit.active=false;}
}
export async function assertAnalyticalReader(db:Db,companyId:string,actor:AuthorizationActor) {
 if(actor.type==="board"){v7HumanActorId(actor);return;}
 const permit=nativeReads.getStore();
 if(!permit?.active||permit.companyId!==companyId||permit.agentId!==actor.agentId||permit.runId!==actor.runId||permit.userId!==actor.onBehalfOfUserId)throw forbidden("Analytical reads require the native retained tool boundary");
 await assertNativeReaderIdentity(db,companyId,actor,permit.scope);
}
/** Used only after current read admission, when comparing declared human owners. */
export function analyticalPrincipalId(actor:AuthorizationActor){return actor.type==="agent"&&actor.onBehalfOfUserId?actor.onBehalfOfUserId:v7HumanActorId(actor);}
/** Agent-derived measurements retain their actual requesting principal. */
export function analyticalRequesterId(actor:AuthorizationActor){return actor.type==="agent"?`agent:${actor.agentId}`:v7HumanActorId(actor);}
