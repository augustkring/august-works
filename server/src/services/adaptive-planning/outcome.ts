import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, issues, type Db } from "@paperclipai/db";
import { planningOutcomeSchema, recordPlanningOutcomeSchema, startPlanningOutcomeLearningSchema, v8FeatureEnabled, type PlanningOutcome, type StartPlanningOutcomeLearning } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound } from "../../errors.js";
import { assertAnalyticalReader } from "../analytical-reader.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { instanceSettingsService } from "../instance-settings.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { inspectAnalyticalEvidenceAuthority } from "../analytical-evidence.js";
import { inspectRetainedProjectPlanningProposal } from "./project-owner.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { learningService } from "../learning/learning-service.js";

const DAY=86_400_000;
async function admit(tx:Db,companyId:string,actor:AuthorizationActor,write=false){
  await assertAnalyticalReader(tx,companyId,actor);
  await assertV7Authorization(tx,actor,companyId,write?"users:manage_permissions":"company_scope:read");
  if(!v8FeatureEnabled(await instanceSettingsService(tx).getExperimental(),"planning_optimizer_v8"))throw notFound("Native planning outcomes are unavailable");
  await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await tx.execute(sql`set local statement_timeout='8s'`);
}
async function completed(tx:Db,companyId:string,projectId:string,original:Awaited<ReturnType<typeof inspectRetainedProjectPlanningProposal>>){
  if(original.proposal.status!=="accepted"||!original.proposal.reviewedByUserId)throw conflict("A separately approved native plan is required before observing its outcome");
  const schedule=original.context.result.schedule;
  const rows=await tx.select().from(issues).where(and(eq(issues.companyId,companyId),eq(issues.projectId,projectId),inArray(issues.id,schedule.map(task=>task.taskKey)))).for("share");
  if(rows.length!==schedule.length||!schedule.length)throw conflict("The complete planned native Task population is unavailable");
  const start=Date.parse(`${original.context.profile.horizon.start}T00:00:00Z`),now=Date.now();
  return schedule.map(item=>{
    const row=rows.find(row=>row.id===item.taskKey)!;
    const plannedEndAt=new Date(start+item.endDay*DAY);
    if(row.hiddenAt||row.harnessKind==="conversation"||row.status!=="done"||!row.completedAt||row.completedAt<original.proposal.updatedAt||row.completedAt.getTime()>now||row.updatedAt.getTime()>now||row.plannedStartAt?.getTime()!==start+item.startDay*DAY||row.plannedEndAt?.getTime()!==plannedEndAt.getTime())throw conflict("Complete the actual planned Tasks under the approved dates before recording an outcome");
    return {issueId:row.id,updatedAt:row.updatedAt.toISOString(),completedAt:row.completedAt.toISOString(),plannedEndAt:plannedEndAt.toISOString(),completionDeltaDays:(row.completedAt.getTime()-plannedEndAt.getTime())/DAY};
  });
}
const lineageHash=(edges:Array<{inputType:string;inputRef:string;inputHash:string;relationship:string}>)=>nativeSha256(edges.map(({inputType,inputRef,inputHash,relationship})=>({inputType,inputRef,inputHash,relationship})).sort((a,b)=>`${a.inputType}:${a.inputRef}:${a.relationship}`.localeCompare(`${b.inputType}:${b.inputRef}:${b.relationship}`)));
const material=(manifest:typeof analyticalLineageManifests.$inferSelect)=>({domain:"aw-planning:outcome:v1",companyId:manifest.companyId,manifestId:manifest.id,proposalId:manifest.analysisRef,inputHash:manifest.inputHash,definitionHash:manifest.definitionHash,createdAt:manifest.createdAt.toISOString(),expiresAt:manifest.expiresAt.toISOString(),sourceCount:manifest.sourceCount,lineageHash:manifest.parameters.lineageHash});
export async function inspectPlanningOutcome(tx:Db,companyId:string,actor:AuthorizationActor,projectId:string,proposalId:string,manifestId:string){
  await admit(tx,companyId,actor);
  const original=await inspectRetainedProjectPlanningProposal(tx,companyId,projectId,actor,proposalId);
  const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,manifestId))).for("share");
  if(!manifest||manifest.analysisType!=="project_planning_outcome"||manifest.analysisRef!==proposalId||manifest.expiresAt<=new Date())throw notFound("Native planning outcome is erased, expired or unavailable");
  const outcome=planningOutcomeSchema.parse(manifest.parameters.outcome);
  if(outcome.companyId!==companyId||outcome.projectId!==projectId||outcome.proposalId!==proposalId||outcome.contextHash!==original.proposal.planningContextHash||outcome.recordedBy!==manifest.requestedBy||outcome.recordedAt!==manifest.createdAt.toISOString()||outcome.expiresAt!==manifest.expiresAt.toISOString()||nativeSha256(outcome)!==manifest.definitionHash||!verifyDecisionSpec(material(manifest),String(manifest.parameters.signature)))throw conflict("The signed native planning outcome changed");
  const facts=await completed(tx,companyId,projectId,original);
  if(nativeSha256(facts)!==manifest.inputHash||nativeSha256(facts)!==nativeSha256(outcome.tasks))throw conflict("Native completion facts changed; review a fresh planning outcome");
  const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,manifestId))).limit(20_066);
  if(edges.length!==manifest.sourceCount||edges.length>20_065||lineageHash(edges)!==manifest.parameters.lineageHash)throw conflict("Complete planning outcome provenance is unavailable");
  await inspectAnalyticalEvidenceAuthority(tx,companyId,actor,edges,performance.now()+30_000);
  return {manifestId,outcome,sourceSensitivity:original.context.profile.sensitivity,manifestIds:[original.manifest.id,manifest.id],expiresAt:new Date(Math.min(original.manifest.expiresAt.getTime(),manifest.expiresAt.getTime()))};
}
export function planningOutcomeService(db:Db){return {
  async detail(companyId:string,projectId:string,actor:AuthorizationActor,proposalId:string,manifestId:string){return db.transaction(raw=>inspectPlanningOutcome(raw as unknown as Db,companyId,actor,projectId,proposalId,manifestId));},
  async record(companyId:string,projectId:string,actor:AuthorizationActor,proposalId:string,raw:unknown){
    const userId=v7HumanActorId(actor),input=recordPlanningOutcomeSchema.parse(raw);
    return withV7ActivityTransaction(db,async(tx,publications)=>{
      await admit(tx,companyId,actor,true);
      const original=await inspectRetainedProjectPlanningProposal(tx,companyId,projectId,actor,proposalId),tasks=await completed(tx,companyId,projectId,original),now=new Date(),id=randomUUID();
      const outcome:PlanningOutcome=planningOutcomeSchema.parse({companyId,projectId,proposalId,contextHash:original.proposal.planningContextHash,recordedBy:userId,recordedAt:now.toISOString(),expiresAt:original.manifest.expiresAt.toISOString(),rationale:input.rationale,tasks,authority:"supplemental_descriptive_signal",causalClaimRef:null});
      const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,original.manifest.id))).limit(20_066);
      if(edges.length!==original.manifest.sourceCount||edges.length>20_065)throw conflict("Complete native planning provenance is unavailable");
      const manifest={id,companyId,analysisType:"project_planning_outcome",analysisRef:proposalId,engineVersion:"aw-native-planning-outcome-v1",inputHash:nativeSha256(tasks),definitionHash:nativeSha256(outcome),requestedBy:userId,sourceWatermark:now.toISOString(),sourceCount:edges.length,parameters:{} as Record<string,unknown>,createdAt:now,expiresAt:original.manifest.expiresAt};
      manifest.parameters={outcome,lineageHash:lineageHash(edges)};manifest.parameters.signature=signDecisionSpec(material(manifest));
      await tx.insert(analyticalLineageManifests).values(manifest);
      for(let offset=0;offset<edges.length;offset+=500)await tx.insert(analyticalLineageEdges).values(edges.slice(offset,offset+500).map(edge=>({...edge,manifestId:id})));
      await logActivity(tx,{companyId,actorType:"user",actorId:userId,action:"planning.outcome_recorded",entityType:"project",entityId:projectId,details:{proposalId,manifestId:id,taskCount:tasks.length}},publications);
      return {manifestId:id,outcome};
    });
  },
  async startLearning(companyId:string,projectId:string,actor:AuthorizationActor,proposalId:string,raw:StartPlanningOutcomeLearning){
    v7HumanActorId(actor);const input=startPlanningOutcomeLearningSchema.parse(raw);
    return withV7ActivityTransaction(db,async(tx,publications)=>{
      await admit(tx,companyId,actor,true);await inspectPlanningOutcome(tx,companyId,actor,projectId,proposalId,input.manifestId);
      const {manifestId,...cycleInput}=input;
      const cycle=await learningService(tx).createInTransaction(actor,companyId,{...cycleInput,scope:{type:"company",id:null},analyticalSources:[{kind:"planning_outcome",projectId,proposalId,manifestId}]},publications);
      return {cycleId:cycle.id};
    });
  },
};}
