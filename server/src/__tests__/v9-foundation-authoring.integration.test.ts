import express from "express";
import request from "supertest";
import { foundationRoutes } from "../routes/foundation.js";
import { errorHandler } from "../middleware/index.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { contextManifestService } from "../services/context/context-manifest.js";
import { assertAnalyticalContextPayloadAccess } from "../services/analytical-context-authority.js";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { companyMemberships, createDb, documentRevisions, documents, foundationChangeProposals, heartbeatRuns, issues, memoryDeletionMarkers,
  principalPermissionGrants, toolPolicies } from "@paperclipai/db";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { foundationAuthoringToolsService } from "../services/foundation-authoring-tools.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("Conversation Foundation proposals retain the Original pending review", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, runId: string, conversationId: string, targetId: string, revisionId: string, documentId: string;
  const input = () => ({ idempotencyKey: "proposed-policy", foundationDocumentId: targetId, baseRevisionId: revisionId,
    proposedBody: "PRIVATE proposed replacement", changeSummary: "A reviewed change", reason: "PRIVATE customer intent" });
  const propose = (raw: unknown = input()) => foundationAuthoringToolsService(db).propose({ companyId: f.home, agentId: f.presence.id, runId }, raw);
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-foundation-authoring-");
    db = createDb(database.connectionString); await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
    f = await seedV5Presences(db);
    await db.insert(companyMemberships).values({ companyId:f.home,principalType:"agent",principalId:f.presence.id,status:"active" });
    await db.insert(principalPermissionGrants).values(["foundation:read", "foundation:propose"].map(permissionKey => ({
      companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey })));
    const conversation = await issueService(db).create(f.home, { title: "Owned Foundation conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    conversationId = conversation.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      nativeIssueId: conversationId, runtimeMode: "native", status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = run!.id; await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, conversationId));
    const owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
    const draft = await owner.createDraft(f.home, { foundationKey: "operating-policy", title: "Approved operating policy",
      body: "Original approved body", category: "governance", documentType: "policy", ownerUserId: f.userId }, actor);
    targetId = draft.id; revisionId = draft.latestRevisionId!; documentId = draft.documentId;
    await owner.submitForReview(f.home, targetId, revisionId, actor); await owner.approve(f.home, targetId, revisionId, actor);
  });
  it("saves one exact pending proposal without changing or approving the Foundation", async () => {
    const saved = await propose();
    expect(saved).toMatchObject({ status: "created", proposalStatus: "pending", requiresHumanReview: true, canonicalChanged: false,
      foundationDocumentId: targetId, baseRevisionId: revisionId, href: `/foundation/${targetId}` });
    expect(await propose()).toEqual({ ...saved, status: "replayed" });
    const rows = await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId, f.home));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ conversationSourceRunId: runId,
      conversationResponsibleUserId: f.userId, proposedByAgentId: f.presence.id, proposedBody: input().proposedBody });
    expect((await db.select().from(documents).where(eq(documents.id, documentId)))[0]!.latestBody).toBe("Original approved body");
    expect(JSON.stringify(saved)).not.toContain("PRIVATE");
  });
  it("refuses changed content and model-supplied source or approval authority", async () => {
    await propose(); await expect(propose({ ...input(), proposedBody: "Changed" })).rejects.toMatchObject({ status: 409 });
    for (const field of ["status", "sourceId", "conversationResponsibleUserId"])
      await expect(propose({ ...input(), [field]: "untrusted" })).rejects.toThrow();
  });
  it("requires current Agent proposal permission and conversation generation", async () => {
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "foundation:propose")));
    await expect(propose()).rejects.toMatchObject({ status: 403 });
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id, permissionKey: "foundation:propose" });
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversationId));
    await expect(propose()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId, f.home))).toEqual([]);
  });
  it("withdraws proposal reads and Human acceptance when the actual authoring source is erased", async () => {
    const saved = await propose();
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    await expect(foundationService(db).listProposals(f.home, targetId, f.actor)).rejects.toMatchObject({ status: 403 });
    await expect(foundationService(db).acceptProposal(f.home, targetId, saved.proposalId,
      { principal: { type: "user", userId: f.userId } })).rejects.toMatchObject({ status: 403 });
  });
  it("scrubs pending proposal bodies and refuses direct late payload restoration", async () => {
    const saved=await propose();
    await db.transaction(async rawTx=>{
      const tx=rawTx as unknown as typeof db;await lockMemoryPrivacy(tx,f.home);
      await tx.insert(memoryDeletionMarkers).values({companyId:f.home,kind:"source",key:`memory-run-source-erasure:v1:${runId}`});
      await purgeDerivedWorkflowMemory(tx,f.home,[],new Date(),{workflowRevisionIds:[],artifactVersionIds:[],runIds:[runId]});
    });
    await db.update(foundationChangeProposals).set({proposedBody:"PRIVATE restored body",reason:"PRIVATE restored reason",status:"pending"})
      .where(eq(foundationChangeProposals.id,saved.proposalId));
    expect((await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id,saved.proposalId)))[0])
      .toMatchObject({proposedBody:"",reason:null,changeSummary:null,status:"rejected",conversationSourceRunId:runId,conversationResponsibleUserId:f.userId});
  });

  it("retains actual Human audit and conversation provenance through accepted and later edited revisions",async()=>{
    const saved=await propose(),owner=foundationService(db),actor={principal:{type:"user" as const,userId:f.userId}};
    const accepted=await owner.acceptProposal(f.home,targetId,saved.proposalId,actor);
    const edited=await owner.updateDraft(f.home,targetId,{baseRevisionId:accepted.foundation.latestRevisionId!,body:"PRIVATE later Human edit"},actor);
    const laterTask=await issueService(db).create(f.home,{title:"Later Foundation consumer",assigneeAgentId:f.presence.id});
    const [laterRun]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
      nativeIssueId:laterTask.id,runtimeMode:"native",status:"running",resultJson:{body:"PRIVATE copied Foundation result"}}).returning();
    await db.update(issues).set({executionRunId:laterRun!.id}).where(eq(issues.id,laterTask.id));
    await contextManifestService(db).create({companyId:f.home,agentId:f.presence.id,issueId:laterTask.id,runId:laterRun!.id,responsibleUserId:f.userId,
      query:"Read the retained Foundation",policySnapshot:{fixture:true},selected:[{decision:{authorityRank:0,primaryForDomain:true,reason:"preferred_authority",
        evidence:{id:edited.latestRevisionId!,companyId:f.home,sourceClass:"foundation",sourceProvider:"august_works_foundation",sourceType:"foundation_section",
        sourceRef:`foundation://${targetId}/${edited.latestRevisionId}/0`,sourceVersion:edited.latestRevisionId!,title:"Approved context",excerpt:"PRIVATE later Human edit",
        sourceUpdatedAt:new Date().toISOString(),observedAt:new Date().toISOString(),validFrom:null,validUntil:null,
        authorityDomain:"governance",trustLevel:"high",sensitivity:"internal",citation:{label:"Retained Foundation"},metadata:{}}}}]});
    const history=await db.select().from(documentRevisions).where(eq(documentRevisions.documentId,documentId));
    for(const id of [accepted.foundation.latestRevisionId,edited.latestRevisionId]){
      expect(history.find(row=>row.id===id)).toMatchObject({createdByUserId:f.userId,createdByRunId:null,conversationFoundationProposalIds:[saved.proposalId]});
    }
    await db.transaction(async rawTx=>{
      const tx=rawTx as unknown as typeof db;await lockMemoryPrivacy(tx,f.home);
      await tx.insert(memoryDeletionMarkers).values({companyId:f.home,kind:"source",key:`memory-run-source-erasure:v1:${runId}`});
      await purgeDerivedWorkflowMemory(tx,f.home,[],new Date(),{workflowRevisionIds:[],artifactVersionIds:[],runIds:[runId]});
    });
    const scrubbed=await db.select().from(documentRevisions).where(eq(documentRevisions.documentId,documentId));
    expect(JSON.stringify(scrubbed)).not.toContain("PRIVATE");
    expect((await db.select().from(documents).where(eq(documents.id,documentId)))[0]!.latestBody).toBe("");
    await expect(owner.get(f.home,targetId,f.actor)).rejects.toMatchObject({status:403});
    await expect(assertAnalyticalContextPayloadAccess(db,f.home,f.actor,{runId:laterRun!.id})).rejects.toMatchObject({status:403});
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id,laterRun!.id)))[0]!.resultJson).toBeNull();
    await db.update(documentRevisions).set({body:"PRIVATE restored revision"}).where(eq(documentRevisions.id,edited.latestRevisionId!));
    await db.update(documents).set({latestBody:"PRIVATE restored document"}).where(eq(documents.id,documentId));
    expect((await db.select().from(documentRevisions).where(eq(documentRevisions.id,edited.latestRevisionId!)))[0]!.body).toBe("");
    expect((await db.select().from(documents).where(eq(documents.id,documentId)))[0]!.latestBody).toBe("");
    await expect(db.update(documentRevisions).set({conversationFoundationProposalIds:[]}).where(eq(documentRevisions.id,edited.latestRevisionId!))).rejects.toThrow();
  });

  it("discovers and invokes the actual SDK proposal while preserving current feature gates",async()=>{
    const name="paperclip-self:propose_foundation_change";
    await db.insert(toolPolicies).values({companyId:f.home,name:"Explicit Foundation proposal fixture",policyType:"allow",selectors:{toolName:name}});
    const gateway=createToolGatewayService(db,{toolActionSigningSecret:"foundation-test-only-signing-secret"});
    const session=await gateway.createSession({companyId:f.home,agentId:f.presence.id,runId,issueId:conversationId});
    expect((await gateway.listToolsForSession(session.token)).map(tool=>tool.name)).toContain(name);
    expect(await gateway.executeTool({sessionToken:session.token,tool:name,parameters:input()})).toMatchObject({status:"completed",
      result:{data:{proposalStatus:"pending",canonicalChanged:false,requiresHumanReview:true}}});
    await instanceSettingsService(db).updateExperimental({ambient_commands_v9:false});
    expect((await gateway.listToolsForSession(session.token)).map(tool=>tool.name)).not.toContain(name);
  });

  it("projects only the actual proposal metadata and excludes earlier conversation generations",async()=>{
    const saved=await propose(),read=()=>conversationAuthoringService(db).get(f.actor,f.home,conversationId);
    const view=await read();
    expect(view.savedFoundationProposals).toEqual([expect.objectContaining({id:saved.proposalId,foundationDocumentId:targetId,
      baseRevisionId:revisionId,currentRevisionId:revisionId,status:"pending",href:`/foundation/${targetId}`})]);
    expect(JSON.stringify(view)).not.toContain("PRIVATE");expect(JSON.stringify(view)).not.toContain("conversationResponsibleUserId");
    await db.update(issues).set({conversationSessionGeneration:1}).where(eq(issues.id,conversationId));
    expect((await read()).savedFoundationProposals).toEqual([]);
  });

  it("rolls back the actual pending proposal and a late role withdrawal atomically",async()=>{
    await db.execute(sql`create function aw_v9_test_withdraw_foundation_author() returns trigger language plpgsql as $$
      begin delete from company_memberships where company_id=NEW.company_id and principal_type='user'
        and principal_id=NEW.conversation_responsible_user_id;return NEW;end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_foundation_author after insert on foundation_change_proposals
      for each row execute function aw_v9_test_withdraw_foundation_author()`);
    try{
      await expect(propose()).rejects.toMatchObject({status:403});
      expect(await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId,f.home))).toEqual([]);
      expect(await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId,f.home),
        eq(companyMemberships.principalId,f.userId)))).toHaveLength(1);
    }finally{
      await db.execute(sql`drop trigger aw_v9_test_late_foundation_author on foundation_change_proposals`);
      await db.execute(sql`drop function aw_v9_test_withdraw_foundation_author()`);
    }
  });
  it("does not expose private conversation provenance in the actual Foundation HTTP response",async()=>{
    const saved=await propose(),app=express();app.use(express.json());
    app.use((req,_res,next)=>{req.actor=f.actor;next();});app.use("/api",foundationRoutes(db));app.use(errorHandler);
    const response=await request(app).get(`/api/companies/${f.home}/foundation/${targetId}/proposals`);
    expect(response.status).toBe(200);expect(response.body).toEqual([expect.objectContaining({id:saved.proposalId,status:"pending"})]);
    expect(JSON.stringify(response.body)).not.toContain("conversationResponsibleUserId");
    expect(JSON.stringify(response.body)).not.toContain("conversationSourceRunId");
  });

  it("preserves frozen provenance and exact request identity across a later current run",async()=>{
    const saved=await propose();
    await expect(db.update(foundationChangeProposals).set({conversationSourceRunId:null}).where(eq(foundationChangeProposals.id,saved.proposalId))).rejects.toThrow();
    await db.update(heartbeatRuns).set({status:"succeeded"}).where(eq(heartbeatRuns.id,runId));
    const [next]=await db.insert(heartbeatRuns).values({companyId:f.home,agentId:f.presence.id,responsibleUserId:f.userId,
      nativeIssueId:conversationId,runtimeMode:"native",status:"running",contextSnapshot:{conversationSessionGeneration:0}}).returning();
    runId=next!.id;await db.update(issues).set({executionRunId:runId}).where(eq(issues.id,conversationId));
    expect(await propose()).toMatchObject({status:"replayed",proposalId:saved.proposalId});
    expect(await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.companyId,f.home))).toHaveLength(1);
  });
  it("withholds malformed promoted source IDs and bounds recursive source review",async()=>{
    const saved=await propose();
    const [masked]=await db.insert(documentRevisions).values({companyId:f.home,documentId,revisionNumber:2,
      body:"PRIVATE malformed copy",conversationFoundationProposalIds:["untrusted invalid id"]}).returning();
    expect(masked!.body).toBe("");
    await db.transaction(async tx=>{
      await tx.execute(sql`select set_config('aw.foundation_source_depth','16',true)`);
      const [source]=await tx.execute<{erased:boolean}>(sql`select aw_conversation_foundation_proposal_erased(${f.home}::uuid,${saved.proposalId}::uuid) as erased`);
      expect(source?.erased).toBe(true);
    });
  });

  it("retains erasure identity when a conversation proposal is deleted and restored directly",async()=>{
    const saved=await propose();
    const [original]=await db.select().from(foundationChangeProposals).where(eq(foundationChangeProposals.id,saved.proposalId));
    await db.delete(foundationChangeProposals).where(eq(foundationChangeProposals.id,saved.proposalId));
    const [restored]=await db.insert(foundationChangeProposals).values(original!).returning();
    expect(restored).toMatchObject({proposedBody:"",reason:null,status:"rejected",conversationSourceRunId:runId});
    await expect(foundationService(db).listProposals(f.home,targetId,f.actor)).rejects.toMatchObject({status:403});
  });

  it("keeps a deleted revision unavailable after restoring it without its retained Source array",async()=>{
    const saved=await propose(),owner=foundationService(db);
    const accepted=await owner.acceptProposal(f.home,targetId,saved.proposalId,{principal:{type:"user",userId:f.userId}});
    const [original]=await db.select().from(documentRevisions).where(eq(documentRevisions.id,accepted.foundation.latestRevisionId!));
    await db.delete(documentRevisions).where(eq(documentRevisions.id,original!.id));
    await db.insert(documentRevisions).values({...original!,conversationFoundationProposalIds:[],body:"PRIVATE restored without Source"});
    await db.update(documents).set({latestBody:"PRIVATE restored latest copy"}).where(eq(documents.id,documentId));
    expect((await db.select().from(documents).where(eq(documents.id,documentId)))[0]!.latestBody).toBe("");
    await expect(owner.get(f.home,targetId,f.actor)).rejects.toMatchObject({status:403});
  });

});
