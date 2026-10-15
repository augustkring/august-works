import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authUsers, companyMemberships, createDb, heartbeatRuns, issues, memoryDeletionMarkers, notificationPreferenceProposals, principalPermissionGrants, toolPolicies, saasNotificationPreferences } from "@paperclipai/db";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { notificationPreferenceProposalService } from "../services/notification-preference-proposals.js";
import { notificationService } from "../services/notifications/notifications.js";
import { transactionalEmail } from "../services/notifications/transactional-email.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("Owned conversational notification proposals require explicit current Human confirmation",()=>{
  let database:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
  let f:Awaited<ReturnType<typeof seedV5Presences>>,conversationId:string,runId:string;
  const input=()=>({idempotencyKey:"work-updates",preference:{category:"work_update",emailEnabled:false}});
  // This owner path never sends or enqueues mail. Fail if that invariant changes.
  const email={enqueue:async()=>{throw new Error("A preference proposal must not send mail");}} as unknown as ReturnType<typeof transactionalEmail>;
  const original=(tx:typeof db)=>notificationService(tx,email);
  const owner=()=>notificationPreferenceProposalService(db);
  const create=()=>owner().propose({companyId:f.home,agentId:f.presence.id,runId},input());
  const review=(id:string)=>owner().review(f.actor,f.home,id);
  const apply=async(id:string)=>{const current=await review(id);return owner().apply(f.actor,f.home,id,
    {requestId:randomUUID(),expectedProposalVersion:current.version,expectedBaselineHash:current.baselineHash},original);};
  beforeAll(async()=>{database=await startEmbeddedPostgresTestDatabase("aw-v9-notification-proposals-");db=createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();await enableV5ForTest(db);},60000);
  afterAll(async()=>{await database?.cleanup();},30000);
  beforeEach(async()=>{
    await instanceSettingsService(db).updateExperimental({experience_projection_v9:true,ambient_commands_v9:true,notification_policy_v9:true});f=await seedV5Presences(db);
    await db.insert(principalPermissionGrants).values({companyId:f.home,principalType:"agent",principalId:f.presence.id,permissionKey:"tasks:assign"}).onConflictDoNothing();
    const chat=await issueService(db).create(f.home,{title:"Owned notification conversation",assigneeAgentId:f.presence.id,
      conversationAgentId:f.presence.id,conversationUserId:f.userId,conversationState:"active",status:"in_progress",createdByUserId:f.userId});
    conversationId=chat.id;
    const [run]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,nativeIssueId:chat.id,
      runtimeMode:"native",status:"running",contextSnapshot:{conversationSessionGeneration:0}}).returning();runId=run!.id;
    await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,chat.id));
  });
  it("saves and exactly replays one proposal without changing preferences",async()=>{
    const saved=await create();expect(saved).toMatchObject({status:"created",preferenceApplied:false,requiresHumanReview:true});
    expect(await create()).toEqual({...saved,status:"replayed"});
    expect(await db.select().from(saasNotificationPreferences).where(eq(saasNotificationPreferences.userId,f.userId))).toEqual([]);
    expect(await db.select().from(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.companyId,f.home))).toHaveLength(1);
    await expect(owner().propose({companyId:f.home,agentId:f.presence.id,runId},{...input(),preference:{category:"billing",emailEnabled:false}})).rejects.toMatchObject({status:409});
  });
  it("applies through the actual preference owner and replays the exact confirmation without a second write",async()=>{
    const saved=await create(),current=await review(saved.proposalId),confirmation={requestId:randomUUID(),expectedProposalVersion:current.version,expectedBaselineHash:current.baselineHash};
    const first=await owner().apply(f.actor,f.home,saved.proposalId,confirmation,original);
    expect(first).toMatchObject({status:"applied",version:2,preferenceApplied:true,requiresHumanReview:false});
    expect(await owner().apply(f.actor,f.home,saved.proposalId,confirmation,original)).toEqual(first);
    expect((await original(db).preferences(f.userId)).find(row=>row.category==="work_update")).toMatchObject({emailEnabled:false});
    await expect(owner().apply(f.actor,f.home,saved.proposalId,{...confirmation,expectedProposalVersion:2},original)).rejects.toMatchObject({status:409});
  });
  it("rejects an intervening manual change until the Human reviews the new baseline",async()=>{
    const saved=await create(),current=await review(saved.proposalId);
    await original(db).updatePreference(f.home,f.userId,{category:"work_update",emailEnabled:false});
    await expect(owner().apply(f.actor,f.home,saved.proposalId,{requestId:randomUUID(),expectedProposalVersion:current.version,expectedBaselineHash:current.baselineHash},original)).rejects.toMatchObject({status:409});
    expect(await review(saved.proposalId)).toMatchObject({status:"pending",baselineChanged:true});
    expect(await apply(saved.proposalId)).toMatchObject({status:"applied"});
  });
  it("refuses foreign users, foreign companies and unverified accounts",async()=>{
    const saved=await create(),other=await seedV5Presences(db);
    await expect(owner().review(other.actor,f.home,saved.proposalId)).rejects.toMatchObject({status:403});
    await expect(owner().review(f.actor,f.guest,saved.proposalId)).rejects.toMatchObject({status:404});
    await db.update(authUsers).set({emailVerified:false}).where(eq(authUsers.id,f.userId));
    await expect(review(saved.proposalId)).rejects.toMatchObject({status:403});await expect(create()).rejects.toMatchObject({status:403});
  });
  it("withdraws proposals from an older chat generation",async()=>{
    const saved=await create();await db.update(issues).set({conversationSessionGeneration:1}).where(eq(issues.id,conversationId));
    await expect(review(saved.proposalId)).rejects.toMatchObject({status:403});await expect(create()).rejects.toMatchObject({status:403});
  });
  it("erases the saved source payload and prevents direct restore without reverting a Human-applied preference",async()=>{
    const saved=await create();await apply(saved.proposalId);
    await db.transaction(async rawTx=>{const tx=rawTx as unknown as typeof db;await lockMemoryPrivacy(tx,f.home);
      await tx.insert(memoryDeletionMarkers).values({companyId:f.home,kind:"source",key:`memory-run-source-erasure:v1:${runId}`});
      await purgeDerivedWorkflowMemory(tx,f.home,[],new Date(),{workflowRevisionIds:[],artifactVersionIds:[],runIds:[runId]});});
    const [row]=await db.select().from(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.id,saved.proposalId));
    expect(row).toMatchObject({preference:null,status:"erased"});
    await db.update(notificationPreferenceProposals).set({preference:input().preference as typeof row.preference,status:"pending"}).where(eq(notificationPreferenceProposals.id,saved.proposalId));
    expect((await db.select().from(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.id,saved.proposalId)))[0]).toMatchObject({preference:null,status:"erased"});
    await expect(review(saved.proposalId)).rejects.toMatchObject({status:403});
    expect((await original(db).preferences(f.userId)).find(row=>row.category==="work_update")).toMatchObject({emailEnabled:false});
  });
  it("retains a deleted proposal identity marker and prevents restoration of its payload",async()=>{
    const saved=await create(),[row]=await db.select().from(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.id,saved.proposalId));
    await db.delete(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.id,saved.proposalId));await db.insert(notificationPreferenceProposals).values(row!);
    expect((await db.select().from(notificationPreferenceProposals).where(eq(notificationPreferenceProposals.id,saved.proposalId)))[0]).toMatchObject({status:"erased",preference:null});
    await expect(review(saved.proposalId)).rejects.toMatchObject({status:403});
  });
  it("rolls back a preference write when membership is withdrawn by a late database writer",async()=>{
    const saved=await create();
    await db.execute(sql`create function aw_test_late_notification_member() returns trigger language plpgsql as $$ begin
      delete from company_memberships where principal_type='user' and principal_id=NEW.user_id; return NEW; end $$`);
    await db.execute(sql`create trigger aw_test_late_notification_member after insert on saas_notification_preferences for each row execute function aw_test_late_notification_member()`);
    try{await expect(apply(saved.proposalId)).rejects.toMatchObject({status:403});
      expect(await db.select().from(saasNotificationPreferences).where(eq(saasNotificationPreferences.userId,f.userId))).toEqual([]);
      expect(await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId,f.home),eq(companyMemberships.principalId,f.userId)))).toHaveLength(1);
      expect(await review(saved.proposalId)).toMatchObject({status:"pending"});
    }finally{await db.execute(sql`drop trigger aw_test_late_notification_member on saas_notification_preferences`);await db.execute(sql`drop function aw_test_late_notification_member()`);}
  });
  it("uses the actual SDK descriptor and shows only current body-free conversation references",async()=>{
    const name="paperclip-self:propose_notification_preferences";
    await db.insert(toolPolicies).values({companyId:f.home,name:"Explicit notification proposal software fixture",policyType:"allow",selectors:{toolName:name}});
    const gateway=createToolGatewayService(db,{toolActionSigningSecret:"notification-proposal-test-only-secret"});
    const session=await gateway.createSession({companyId:f.home,agentId:f.presence.id,runId,issueId:conversationId});
    expect((await gateway.listToolsForSession(session.token)).map(tool=>tool.name)).toContain(name);
    const receipt=await gateway.executeTool({sessionToken:session.token,tool:name,parameters:input()});
    expect(receipt).toMatchObject({status:"completed",result:{data:{status:"created",preferenceApplied:false}}});
    const saved=await create(),view=await conversationAuthoringService(db).get(f.actor,f.home,conversationId);
    expect(view.savedNotificationProposals).toEqual([{kind:"notification_proposal",id:saved.proposalId,category:"work_update",status:"pending",version:1}]);
    expect(JSON.stringify(view)).not.toMatch(/baselineHash|emailEnabled|responsibleUserId/);
    await instanceSettingsService(db).updateExperimental({notification_policy_v9:false});
    expect((await gateway.listToolsForSession(session.token)).map(tool=>tool.name)).not.toContain(name);
  });
  it("rejects direct provenance changes and serializes concurrent confirmations",async()=>{
    const saved=await create();
    await expect(db.update(notificationPreferenceProposals).set({conversationId:randomUUID()}).where(eq(notificationPreferenceProposals.id,saved.proposalId))).rejects.toThrow();
    const current=await review(saved.proposalId),confirmation={requestId:randomUUID(),expectedProposalVersion:1,expectedBaselineHash:current.baselineHash};
    const results=await Promise.all([owner().apply(f.actor,f.home,saved.proposalId,confirmation,original),owner().apply(f.actor,f.home,saved.proposalId,confirmation,original)]);
    expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({version:2,status:"applied"});
    expect(await db.select().from(saasNotificationPreferences).where(eq(saasNotificationPreferences.userId,f.userId))).toHaveLength(1);
  });
  it("rolls back the actual preference if its conversation Source disappears during the write",async()=>{
    const saved=await create();
    await db.execute(sql`create function aw_test_late_notification_source() returns trigger language plpgsql as $$ begin
      insert into memory_deletion_markers(company_id,kind,key) select company_id,'source','memory-run-source-erasure:v1:'||source_run_id::text
        from notification_preference_proposals where user_id=NEW.user_id; return NEW; end $$`);
    await db.execute(sql`create trigger aw_test_late_notification_source after insert on saas_notification_preferences for each row execute function aw_test_late_notification_source()`);
    try{await expect(apply(saved.proposalId)).rejects.toMatchObject({status:403});
      expect(await db.select().from(saasNotificationPreferences).where(eq(saasNotificationPreferences.userId,f.userId))).toEqual([]);
      expect(await review(saved.proposalId)).toMatchObject({status:"pending"});
    }finally{await db.execute(sql`drop trigger aw_test_late_notification_source on saas_notification_preferences`);await db.execute(sql`drop function aw_test_late_notification_source()`);}
  });
  it("preserves mandatory security delivery and the current feature gate",async()=>{
    await expect(owner().propose({companyId:f.home,agentId:f.presence.id,runId},{...input(),preference:{category:"security",emailEnabled:false}})).rejects.toMatchObject({status:403});
    const saved=await create();await instanceSettingsService(db).updateExperimental({notification_policy_v9:false});
    await expect(apply(saved.proposalId)).rejects.toMatchObject({status:404});
    expect(await db.select().from(saasNotificationPreferences).where(eq(saasNotificationPreferences.userId,f.userId))).toEqual([]);
  });
});
