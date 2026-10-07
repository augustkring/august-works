import {randomUUID} from "node:crypto";
import {and,desc,eq,sql} from "drizzle-orm";
import {analyticalLineageEdges,analyticalLineageManifests,businessMetricObservations,businessMetricVersions,decisionOutcomeReviews,decisionOutcomeReviewReceipts,type Db} from "@paperclipai/db";
import {scheduleDecisionOutcomeReviewSchema,transitionDecisionOutcomeReviewSchema,finishDecisionOutcomeReviewSchema,type ScheduleDecisionOutcomeReview,type TransitionDecisionOutcomeReview,type FinishDecisionOutcomeReview,type DecisionOutcomeReviewReceipt,type DecisionOutcomeReviewView,type CapturedDecisionEvidence,type DecisionMetricComparison} from "@paperclipai/shared";
import {conflict,notFound,unprocessable} from "../errors.js";
import type {AuthorizationActor} from "./authorization.js";
import {inspectBoundDecisionContext,inspectDecisionSourceAuthority} from "./decision-intelligence.js";
import {authorizeStrategyReference} from "./strategy-execution/references.js";
import {businessMetricService} from "./business-metrics/service.js";
import {v7HumanActorId} from "./v7-authorization.js";
import {nativeSha256} from "./native-runtime/canonical.js";
import {logActivity,withV7ActivityTransaction} from "./v7-mutations.js";

type Root=typeof decisionOutcomeReviews.$inferSelect;
type Bound=Awaited<ReturnType<typeof inspectBoundDecisionContext>>;
type Edge=Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
const BUDGET=20_065;
function receiptHash(receipt:DecisionOutcomeReviewReceipt) {const {contentHash:_,...material}=receipt;return nativeSha256(material);}
function deadlineCheck(deadline:number) {if(performance.now()>deadline) throw unprocessable("Decision outcome review exceeded its bounded source budget");}
async function root(tx:Db,companyId:string,decisionId:string) {
  const [row]=await tx.select().from(decisionOutcomeReviews).where(and(eq(decisionOutcomeReviews.companyId,companyId),eq(decisionOutcomeReviews.decisionId,decisionId))).for("update");return row;
}
async function lineage(tx:Db,companyId:string,manifestId:string) {
  const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,manifestId))).for("share");
  const rows=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,manifestId))).limit(BUDGET+1);
  if(!manifest || manifest.expiresAt<=new Date() || rows.length>BUDGET) throw notFound("Decision outcome review lineage is unavailable");
  const edges=rows.map(({inputType,inputRef,inputHash,relationship})=>({inputType,inputRef,inputHash,relationship})).sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  return {manifest,edges};
}
function mergeEdges(groups:Edge[][]) {
  const edges=new Map<string,Edge>();
  for(const group of groups) for(let value of group) {
    if(value.inputType==="issue" || value.inputType==="project") value={...value,inputHash:nativeSha256({type:value.inputType,id:value.inputRef})};
    const key=`${value.inputType}:${value.inputRef}`,old=edges.get(key);
    if(old && old.inputHash!==value.inputHash) throw conflict("Review evidence disagrees about its pinned native source version");
    edges.set(key,value);if(edges.size>BUDGET) throw unprocessable("Decision outcome review exceeds its native source budget");
  }
  return [...edges.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
}
async function actualEvidence(tx:Db,companyId:string,actor:AuthorizationActor,bound:Bound,input:FinishDecisionOutcomeReview) {
  const deadline=performance.now()+30_000,actual:CapturedDecisionEvidence[]=[],groups:Edge[][]=[];
  let expiresAt=bound.version.expiresAt;
  for(const pin of input.actualMetrics) {
    deadlineCheck(deadline);const source=pin.source;if(source.type!=="metric_observation") throw conflict("Only native outcome measurements are admitted");
    await authorizeStrategyReference(tx,companyId,actor,source,bound.version.definition.sensitivity);
    const value=await businessMetricService(tx).inspectCurrentObservation(companyId,actor,source.id);
    const [observation]=await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId,companyId),eq(businessMetricObservations.id,source.id))).for("share");
    const [definition]=await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId,companyId),eq(businessMetricVersions.metricId,source.metricId),eq(businessMetricVersions.id,source.metricVersionId))).for("share");
    if(!observation || !definition || value.metricId!==source.metricId || value.versionId!==source.metricVersionId || !bound.decision.decidedAt || Date.parse(value.asOf)<bound.decision.decidedAt.getTime()) throw conflict("Outcome evidence must be the exact native observation captured after the choice");
    const inherited=await lineage(tx,companyId,observation.lineageManifestId);groups.push(inherited.edges);
    expiresAt=new Date(Math.min(expiresAt.getTime(),observation.expiresAt.getTime(),inherited.manifest.expiresAt.getTime()));
    actual.push({key:pin.key,source,sourceHash:nativeSha256(value),capturedAt:new Date().toISOString(),expiresAt:observation.expiresAt.toISOString(),
      facts:{value:value.value,status:value.status,unit:definition.definition.unit,from:value.from,until:value.until,asOf:value.asOf},
      limitations:["Native observation of the declared population; it is not a causal estimate.","Population membership uses the native definition's window; lifecycle state is observed at capture."]});
  }
  return {actual,groups,expiresAt};
}
function assess(bound:Bound,input:FinishDecisionOutcomeReview,actual:CapturedDecisionEvidence[]) {
  const definition=bound.version.definition,expected=definition.expectedOutcomes;
  const selected=expected.map((item,index)=>({item,index})).filter(({item})=>item.optionId===bound.binding.optionId);
  const chosenIndices=new Set(selected.map(({index})=>index));
  if(!selected.length || [...input.metricOutcomes,...input.qualitativeOutcomes].some(item=>!chosenIndices.has(item.expectationIndex))) throw conflict("Review outcomes must belong to the frozen chosen option");
  const assumptionKeys=new Set(definition.assumptions.map(item=>item.key));
  if(input.assumptionOutcomes.length!==assumptionKeys.size || input.assumptionOutcomes.some(item=>!assumptionKeys.has(item.key))) throw conflict("Every frozen assumption requires its own explicit outcome assessment");
  const citations=new Set(["native_execution",...bound.version.evidence.map(item=>`baseline:${item.key}`),...actual.map(item=>`actual:${item.key}`)]);
  for(const judgment of [...Object.values(input.assessments).filter(item=>"evidenceKeys" in item),...input.qualitativeOutcomes,...input.assumptionOutcomes])
    if(judgment.evidenceKeys.some(key=>!citations.has(key))) throw conflict("Human review citations require declared retained native evidence");
  if(input.qualitativeOutcomes.some(item=>expected[item.expectationIndex].kind!=="qualitative")) throw conflict("A measured expectation cannot be replaced by qualitative prose");
  if(input.result==="completed" && (selected.length!==input.metricOutcomes.length+input.qualitativeOutcomes.length || input.qualitativeOutcomes.some(item=>item.assessment==="inconclusive"))) throw conflict("Completion requires an outcome assessment for every chosen expectation");
  if(input.result==="completed" && (!bound.decision.decidedAt || Date.parse(definition.timeHorizon.until)<bound.decision.decidedAt.getTime() || Date.parse(definition.timeHorizon.until)>Date.now())) throw conflict("Final completion requires the prospective horizon to have elapsed after the native choice");
  const comparisons:DecisionMetricComparison[]=[];
  for(const pin of input.metricOutcomes) {
    const expectation=expected[pin.expectationIndex];if(expectation.kind!=="metric") throw conflict("Numeric comparison requires a frozen metric expectation");
    const baseline=bound.version.evidence.find(item=>item.key===expectation.evidenceKey),outcome=actual.find(item=>item.key===pin.actualEvidenceKey);
    if(!baseline || !outcome || baseline.source.type!=="metric_observation" || outcome.source.type!=="metric_observation" || baseline.source.metricId!==outcome.source.metricId || baseline.source.metricVersionId!==outcome.source.metricVersionId || baseline.facts.unit!==outcome.facts.unit) throw conflict("Expected and actual measurements require the same exact native definition and unit");
    if(outcome.facts.from!==definition.timeHorizon.from || outcome.facts.until!==definition.timeHorizon.until || typeof outcome.facts.asOf!=="string" || Date.parse(outcome.facts.asOf)<Date.parse(definition.timeHorizon.until)) throw conflict("Actual metric evidence must cover the exact elapsed declared horizon");
    const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:null;
    const baselineValue=finite(baseline.facts.value),actualValue=finite(outcome.facts.value);
    if(input.result==="completed" && (actualValue===null || outcome.facts.status!=="observed")) throw conflict("Unavailable actual measurements require an inconclusive review");
    comparisons.push({expectationIndex:pin.expectationIndex,baselineEvidenceKey:baseline.key,actualEvidenceKey:outcome.key,metricId:outcome.source.metricId,metricVersionId:outcome.source.metricVersionId,unit:String(outcome.facts.unit),baselineValue,actualValue,
      expectedRange:expectation.expectedRange,expectedDirection:expectation.expectedDirection,
      rangePosition:actualValue===null?"unavailable":actualValue<expectation.expectedRange.lower?"below":actualValue>expectation.expectedRange.upper?"above":"within",
      observedDirection:baselineValue===null || actualValue===null?"unavailable":actualValue>baselineValue?"increase":actualValue<baselineValue?"decrease":"stable",
      limitations:["Expected range is the recorded human judgment, not a calibrated prediction interval.","Before/after association does not identify the effect of this decision.","The metric definition fixes a created-object population; a later horizon may contain a different cohort."]});
  }
  return comparisons;
}
async function append(tx:Db,row:Root,receipt:DecisionOutcomeReviewReceipt,edges:Edge[]) {
  receipt.contentHash=receiptHash(receipt);const id=randomUUID();
  await tx.insert(analyticalLineageManifests).values({id,companyId:row.companyId,analysisType:"decision_outcome_review",analysisRef:row.id,
    engineVersion:"aw-native-decision-outcome-review-v1",inputHash:nativeSha256({actualEvidence:receipt.actualEvidence,comparisons:receipt.comparisons,nativeExecution:receipt.nativeExecution}),definitionHash:receipt.contentHash,
    requestedBy:receipt.recordedBy,sourceWatermark:receipt.recordedAt,sourceCount:edges.length,
    parameters:{revision:receipt.revision,contextHash:row.contextHash,lineageHash:nativeSha256(edges)},createdAt:new Date(receipt.recordedAt),expiresAt:new Date(receipt.expiresAt)});
  for(let start=0;start<edges.length;start+=500) await tx.insert(analyticalLineageEdges).values(edges.slice(start,start+500).map(edge=>({...edge,companyId:row.companyId,manifestId:id})));
  await tx.insert(decisionOutcomeReviewReceipts).values({companyId:row.companyId,reviewId:row.id,revision:receipt.revision,payload:receipt,lineageManifestId:id});
}
async function inspect(tx:Db,row:Root,actor:AuthorizationActor,bound:Bound):Promise<DecisionOutcomeReviewView> {
  if(row.contextVersionId!==bound.version.id || row.contextHash!==bound.version.contentHash || row.optionId!==bound.binding.optionId) throw conflict("Outcome review no longer agrees with its frozen native baseline");
  const receipts=await tx.select().from(decisionOutcomeReviewReceipts).where(and(eq(decisionOutcomeReviewReceipts.companyId,row.companyId),eq(decisionOutcomeReviewReceipts.reviewId,row.id))).orderBy(desc(decisionOutcomeReviewReceipts.revision)).limit(4);
  if(receipts.length!==row.revision || receipts.length>3 || receipts[0]?.revision!==row.revision) throw notFound("Outcome review receipts are erased or unavailable");
  const deadline=performance.now()+30_000;
  for(const item of receipts) {
    deadlineCheck(deadline);const receipt=item.payload,source=await lineage(tx,row.companyId,item.lineageManifestId);
    if(receipt.contentHash!==receiptHash(receipt) || receipt.contextHash!==row.contextHash || new Date(receipt.expiresAt)<=new Date() || source.manifest.analysisType!=="decision_outcome_review" || source.manifest.analysisRef!==row.id || source.manifest.definitionHash!==receipt.contentHash
      || source.manifest.inputHash!==nativeSha256({actualEvidence:receipt.actualEvidence,comparisons:receipt.comparisons,nativeExecution:receipt.nativeExecution}) || source.manifest.parameters.lineageHash!==nativeSha256(source.edges) || source.manifest.sourceCount!==source.edges.length) throw conflict("Outcome review evidence integrity is unavailable");
    if(receipt.assessment && !finishDecisionOutcomeReviewSchema.safeParse(receipt.assessment).success) throw conflict("Outcome review human assessment integrity is unavailable");
    for(const pin of receipt.actualEvidence) {deadlineCheck(deadline);if(pin.source.type!=="metric_observation") throw conflict("Outcome review measurement type is unavailable");await authorizeStrategyReference(tx,row.companyId,actor,pin.source,bound.version.definition.sensitivity);}
    await inspectDecisionSourceAuthority(tx,row.companyId,actor,source.edges,deadline);
  }
  return {id:row.id,companyId:row.companyId,decisionId:row.decisionId,contextVersionId:row.contextVersionId,contextHash:row.contextHash,optionId:row.optionId,revision:row.revision,
    status:row.status==="scheduled"&&row.reviewDueAt<=new Date()?"due":row.status,reviewDueAt:row.reviewDueAt.toISOString(),reviewedAt:row.reviewedAt?.toISOString()??null,reviewedByUserId:row.reviewedByUserId,
    receipts:receipts.map(item=>item.payload),causalClaimRef:null,learningCycleId:null,authorizationCheckedAt:new Date().toISOString()};
}
function receipt(row:Root,actor:AuthorizationActor,action:DecisionOutcomeReviewReceipt["action"],fromState:DecisionOutcomeReviewReceipt["fromState"],rationale:string,expiresAt:Date):DecisionOutcomeReviewReceipt {
  return {revision:row.revision,action,fromState,toState:row.status,rationale,recordedBy:v7HumanActorId(actor),recordedAt:row.updatedAt.toISOString(),contextHash:row.contextHash,contentHash:"",assessment:null,actualEvidence:[],comparisons:[],nativeExecution:null,expiresAt:expiresAt.toISOString()};
}
export function decisionOutcomeReviewService(db:Db) {
  const audit=(tx:Db,actor:AuthorizationActor,row:Root,publications:Parameters<typeof logActivity>[2],action:string)=>logActivity(tx,{companyId:row.companyId,actorType:"user",actorId:v7HumanActorId(actor),action:`decision.outcome_review_${action}`,entityType:"decision",entityId:row.decisionId,details:{reviewId:row.id,revision:row.revision,status:row.status}},publications);
  return {
    async detail(companyId:string,actor:AuthorizationActor,decisionId:string) {
      return db.transaction(async raw=>{const tx=raw as unknown as Db,bound=await inspectBoundDecisionContext(tx,companyId,actor,decisionId),row=await root(tx,companyId,decisionId);return row?inspect(tx,row,actor,bound):null;});
    },
    async schedule(companyId:string,actor:AuthorizationActor,decisionId:string,raw:ScheduleDecisionOutcomeReview) {
      const input=scheduleDecisionOutcomeReviewSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        const bound=await inspectBoundDecisionContext(tx,companyId,actor,decisionId,true);
        if(bound.version.id!==input.contextVersionId || await root(tx,companyId,decisionId)) throw conflict("Review baseline changed or this native decision already has a review");
        const expectations=bound.version.definition.expectedOutcomes.filter(item=>item.optionId===bound.binding.optionId);
        if(!expectations.length) throw conflict("The chosen option has no declared prospective expectations");
        const now=new Date(),reviewDueAt=new Date(Math.max(...expectations.map(item=>Date.parse(item.reviewAt))));
        const [row]=await tx.insert(decisionOutcomeReviews).values({companyId,decisionId,contextVersionId:bound.version.id,contextHash:bound.version.contentHash,optionId:bound.binding.optionId,createdBy:v7HumanActorId(actor),createdAt:now,updatedAt:now,reviewDueAt}).returning();
        const sources=await lineage(tx,companyId,bound.version.lineageManifestId);
        await append(tx,row,receipt(row,actor,"schedule",null,input.rationale,bound.version.expiresAt),mergeEdges([sources.edges]));
        await audit(tx,actor,row,publications,"scheduled");return inspect(tx,row,actor,bound);
      });
    },
    async transition(companyId:string,actor:AuthorizationActor,decisionId:string,raw:TransitionDecisionOutcomeReview) {
      const input=transitionDecisionOutcomeReviewSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        const bound=await inspectBoundDecisionContext(tx,companyId,actor,decisionId,true),prior=await root(tx,companyId,decisionId);
        if(!prior || prior.revision!==input.expectedRevision || !["scheduled","in_review"].includes(prior.status) || input.action==="begin"&&prior.status!=="scheduled") throw conflict("Outcome review changed or this transition is unavailable");
        await inspect(tx,prior,actor,bound);const now=new Date();
        const [row]=await tx.update(decisionOutcomeReviews).set({status:input.action==="begin"?"in_review":"cancelled",revision:prior.revision+1,updatedAt:now}).where(and(eq(decisionOutcomeReviews.companyId,companyId),eq(decisionOutcomeReviews.id,prior.id),eq(decisionOutcomeReviews.revision,prior.revision))).returning();
        if(!row) throw conflict("Outcome review revision changed");
        const sources=await lineage(tx,companyId,bound.version.lineageManifestId);
        await append(tx,row,receipt(row,actor,input.action,prior.status,input.rationale,bound.version.expiresAt),mergeEdges([sources.edges]));
        await audit(tx,actor,row,publications,row.status);return inspect(tx,row,actor,bound);
      });
    },
    async finish(companyId:string,actor:AuthorizationActor,decisionId:string,raw:FinishDecisionOutcomeReview) {
      const input=finishDecisionOutcomeReviewSchema.parse(raw);
      return withV7ActivityTransaction(db,async(tx,publications)=>{
        const bound=await inspectBoundDecisionContext(tx,companyId,actor,decisionId,true),prior=await root(tx,companyId,decisionId);
        if(!prior || prior.revision!==input.expectedRevision || prior.status!=="in_review") throw conflict("Outcome review changed or is not in review");
        await inspect(tx,prior,actor,bound);const actual=await actualEvidence(tx,companyId,actor,bound,input),comparisons=assess(bound,input,actual.actual),sources=await lineage(tx,companyId,bound.version.lineageManifestId);
        const now=new Date();if(actual.expiresAt<=now) throw conflict("Outcome review evidence expired before publication");
        const [row]=await tx.update(decisionOutcomeReviews).set({status:input.result,revision:prior.revision+1,updatedAt:now,reviewedAt:now,reviewedByUserId:v7HumanActorId(actor)}).where(and(eq(decisionOutcomeReviews.companyId,companyId),eq(decisionOutcomeReviews.id,prior.id),eq(decisionOutcomeReviews.revision,prior.revision))).returning();
        if(!row) throw conflict("Outcome review revision changed");
        const result=receipt(row,actor,"finish",prior.status,input.lessonSummary,actual.expiresAt);result.assessment=input;result.actualEvidence=actual.actual;result.comparisons=comparisons;result.nativeExecution={status:bound.decision.executionStatus,capturedAt:now.toISOString()};
        const edges=mergeEdges([sources.edges,...actual.groups]);await inspectDecisionSourceAuthority(tx,companyId,actor,edges,performance.now()+30_000);await append(tx,row,result,edges);
        await audit(tx,actor,row,publications,input.result);return inspect(tx,row,actor,bound);
      });
    },
  };
}
