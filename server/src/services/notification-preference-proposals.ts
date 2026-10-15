import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { authUsers, notificationPreferenceProposals, type Db } from "@paperclipai/db";
import { notificationPreferenceProposalInputSchema, notificationPreferenceProposalConfirmSchema, v9FeatureEnabled } from "@paperclipai/shared";
import type { AuthorizationActor } from "./authorization.js";
import { v5HumanActorId, assertV5Authorization } from "./v5-authorization.js";
import { assertConversationRoutineAuthoring } from "./routine-authoring-authority.js";
import { assertAnalyticalContextPayloadAccess } from "./analytical-context-authority.js";
import { instanceSettingsService } from "./instance-settings.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";
import { lockNotificationPreference, notificationPreferenceBaseline, notificationService } from "./notifications/notifications.js";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { withV7ActivityTransaction, logActivity } from "./v7-mutations.js";
import { conflict, forbidden, notFound } from "../errors.js";

type Proposal=typeof notificationPreferenceProposals.$inferSelect;
/** An own-account draft is not a notification delivery or an Agent grant. */
export function notificationPreferenceProposalService(db:Db){
  async function source(tx:Db,row:Proposal,actor:AuthorizationActor){
    const [retained]=await tx.execute<{erased:boolean}>(sql`select aw_notification_proposal_erased(${row.companyId}::uuid,${row.id}::uuid) as erased`);
    if(retained?.erased!==false||row.status==="erased"||!row.preference)throw forbidden("The saved preference proposal source is unavailable");
    await assertAnalyticalContextPayloadAccess(tx,row.companyId,actor,{runId:row.sourceRunId});
  }
  async function owned(tx:Db,actor:AuthorizationActor,companyId:string,id:string,write=false){
    const userId=v5HumanActorId(actor);
    if(actor.source==="local_implicit")throw forbidden("Current account identity is required");
    await assertV5Authorization(tx,{...actor,ignoreInstanceAdmin:true,isInstanceAdmin:false},companyId,"company_scope:read");
    const account=tx.select({verified:authUsers.emailVerified}).from(authUsers).where(eq(authUsers.id,userId));
    const [current]=write?await account.for("share"):await account;
    if(!current?.verified)throw forbidden("A verified current account is required");
    const query=tx.select().from(notificationPreferenceProposals).where(and(eq(notificationPreferenceProposals.companyId,companyId),
      eq(notificationPreferenceProposals.id,id),eq(notificationPreferenceProposals.userId,userId)));
    const [row]=write?await query.for("update"):await query;
    if(!row)throw notFound("The owned preference proposal is unavailable");
    await source(tx,row,actor);return row;
  }
  function view(row:Proposal,currentHash:string){
    return {id:row.id,companyId:row.companyId,version:row.version,status:row.status,category:row.category,
      preference:row.preference,baselineHash:currentHash,baselineChanged:currentHash!==row.baselineHash,confirmationRequestId:row.confirmationRequestId,
      preferenceApplied:row.status==="applied",requiresHumanReview:row.status==="pending"};
  }
  return {
    propose:async(context:{companyId:string;agentId:string;runId:string},raw:unknown)=>{
      const input=notificationPreferenceProposalInputSchema.parse(raw);
      if(input.preference.category==="security")throw forbidden("Account safety delivery is not a conversational preference change");
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        await lockAnalyticalCompany(tx,context.companyId);await lockMemoryPrivacy(tx,context.companyId);
        if(!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(),"notification_policy_v9"))throw notFound("Notification policy proposals are not enabled");
        const current=await assertConversationRoutineAuthoring(tx,context);
        await lockNotificationPreference(tx,current.responsibleUserId,input.preference.category);
        const hex=createHash("sha256").update(JSON.stringify(["aw-notification-preference-proposal-v1",context.companyId,context.agentId,
          current.conversation.id,current.conversation.conversationSessionGeneration,input.idempotencyKey])).digest("hex").slice(0,32);
        const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${((parseInt(hex[16]!,16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20)}`;
        const requestHash=nativeSha256(input),baselineHash=await notificationPreferenceBaseline(tx,current.responsibleUserId,input.preference.category);
        const [existing]=await tx.select().from(notificationPreferenceProposals).where(and(eq(notificationPreferenceProposals.companyId,context.companyId),
          eq(notificationPreferenceProposals.id,id))).for("share");
        const actor:AuthorizationActor={type:"agent",source:"agent_jwt",companyId:context.companyId,agentId:context.agentId,runId:context.runId,onBehalfOfUserId:current.responsibleUserId};
        let row=existing;
        if(existing){
          if(existing.requestHash!==requestHash||existing.userId!==current.responsibleUserId||existing.createdByAgentId!==context.agentId)
            throw conflict("The saved preference request has different content");
          await source(tx,existing,actor);
        }else{
          [row]=await tx.insert(notificationPreferenceProposals).values({id,companyId:context.companyId,userId:current.responsibleUserId,
            createdByAgentId:context.agentId,sourceRunId:context.runId,conversationId:current.conversation.id,generation:current.conversation.conversationSessionGeneration,
            category:input.preference.category,requestHash,baselineHash,preference:input.preference}).returning();
          await logActivity(tx,{companyId:context.companyId,actorType:"agent",actorId:context.agentId,agentId:context.agentId,runId:context.runId,
            action:"notifications.preference_proposed",entityType:"notification_preference_proposal",entityId:id,details:{category:input.preference.category,version:1,preferenceApplied:false}},publications);
        }
        await assertConversationRoutineAuthoring(tx,context);
        if(!row)throw conflict("The preference proposal was not saved");await source(tx,row,actor);
        return {status:existing?"replayed" as const:"created" as const,proposalId:row.id,version:row.version,category:row.category,
          proposalStatus:row.status,preferenceApplied:row.status==="applied",requiresHumanReview:row.status==="pending"};
      });
    },
    review:async(actor:AuthorizationActor,companyId:string,id:string)=>db.transaction(async rawTx=>{
      const tx=rawTx as unknown as Db;await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
      const row=await owned(tx,actor,companyId,id);await lockNotificationPreference(tx,row.userId,row.category);
      const hash=await notificationPreferenceBaseline(tx,row.userId,row.category);await owned(tx,actor,companyId,id);return view(row,hash);
    }),
    apply:async(actor:AuthorizationActor,companyId:string,id:string,raw:unknown,ownerForTransaction:(tx:Db)=>ReturnType<typeof notificationService>)=>{
      const input=notificationPreferenceProposalConfirmSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
        const row=await owned(tx,actor,companyId,id,true);await lockNotificationPreference(tx,row.userId,row.category);
        const requestHash=nativeSha256(input);
        if(row.confirmationRequestId===input.requestId){
          if(row.confirmationRequestHash!==requestHash)throw conflict("The original preference confirmation changed");
          return view(row,await notificationPreferenceBaseline(tx,row.userId,row.category));
        }
        if(row.status!=="pending"||row.version!==input.expectedProposalVersion)throw conflict("The preference proposal changed");
        if(!v9FeatureEnabled(await instanceSettingsService(tx).getExperimental(),"notification_policy_v9"))throw notFound("Notification policy confirmation is not enabled");
        // Construct the Original preference owner on this same transaction.
        await ownerForTransaction(tx).updatePreference(companyId,row.userId,row.preference,{expectedBaselineHash:input.expectedBaselineHash});
        await owned(tx,actor,companyId,id);
        const [saved]=await tx.update(notificationPreferenceProposals).set({status:"applied",version:row.version+1,
          confirmationRequestId:input.requestId,confirmationRequestHash:requestHash,updatedAt:new Date()}).where(eq(notificationPreferenceProposals.id,id)).returning();
        await logActivity(tx,{companyId,actorType:"user",actorId:row.userId,action:"notifications.preference_proposal_applied",
          entityType:"notification_preference_proposal",entityId:id,details:{category:row.category,version:saved!.version}},publications);
        await owned(tx,actor,companyId,id);
        return view(saved!,await notificationPreferenceBaseline(tx,row.userId,row.category));
      });
    },
  };
}
