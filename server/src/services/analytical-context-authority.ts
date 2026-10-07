import {and,eq,sql} from "drizzle-orm";
import {analyticalContextDependencies,analyticalContextRoots,contextManifestMemoryRoots,contextManifests,decisionContextVersions,decisionOutcomeReviewReceipts,type Db} from "@paperclipai/db";
import {analyticalContextAuthorityPinSchema,type AnalyticalContextAuthorityPin} from "@paperclipai/shared";
import {z} from "zod";
import type {AuthorizationActor} from "./authorization.js";
import {HttpError,conflict,forbidden,unprocessable} from "../errors.js";

const pinsSchema=z.array(analyticalContextAuthorityPinSchema).min(1).max(32);
/** Exact native source owners reauthorize retained identities. No copied fact,
 * historical requester or feature flag supplies a current reader privilege. */
export async function inspectAnalyticalContextPins(tx:Db,companyId:string,actor:AuthorizationActor,raw:AnalyticalContextAuthorityPin[],deadline=performance.now()+30000,historicalQualification=true) {
 const pins=pinsSchema.parse(raw),manifestIds=new Set<string>();let expiresAt=Infinity;
 for(const pin of pins){
  if(performance.now()>deadline)throw unprocessable("The complete analytical source review exceeded its time budget");
  if(pin.kind==="analytical_evidence"){
   const {captureAnalyticalEvidence}=await import("./analytical-evidence.js");
   const captured=await captureAnalyticalEvidence(tx,companyId,actor,{sensitivity:"confidential",retentionDays:3650,evidence:[{key:"retained_source",source:pin.source}]},deadline,historicalQualification);
   captured.manifestIds.forEach(id=>manifestIds.add(id));expiresAt=Math.min(expiresAt,captured.expiresAt.getTime());
  }else if(pin.kind==="process_run"){
   const {processAnalysisService}=await import("./process-analysis.js");
   const run=await processAnalysisService(tx).getRun(companyId,actor,pin.definitionId,pin.runId);manifestIds.add(run.lineageManifestId);expiresAt=Math.min(expiresAt,Date.parse(run.expiresAt));
  }else if(pin.kind==="decision_context"){
   const {decisionIntelligenceService}=await import("./decision-intelligence.js");
   const view=await decisionIntelligenceService(tx).detail(companyId,actor,pin.decisionId),version=view.versions.find(v=>v.id===pin.versionId);
   if(!version)throw conflict("The retained native Decision context is unavailable");
   const [stored]=await tx.select().from(decisionContextVersions).where(and(eq(decisionContextVersions.companyId,companyId),eq(decisionContextVersions.decisionId,pin.decisionId),eq(decisionContextVersions.id,pin.versionId))).for("share");
   if(!stored||stored.contentHash!==version.contentHash)throw conflict("The native Decision context changed");
   manifestIds.add(stored.lineageManifestId);expiresAt=Math.min(expiresAt,stored.expiresAt.getTime());
  }else{
   const {decisionOutcomeReviewService}=await import("./decision-outcome-reviews.js");
   const view=await decisionOutcomeReviewService(tx).detail(companyId,actor,pin.decisionId);
   if(!view||view.revision!==pin.revision)throw conflict("The retained native outcome review changed");
   const receipts=await tx.select().from(decisionOutcomeReviewReceipts).where(and(eq(decisionOutcomeReviewReceipts.companyId,companyId),eq(decisionOutcomeReviewReceipts.reviewId,view.id))).limit(4);
   if(receipts.length!==view.receipts.length)throw conflict("Native outcome review provenance is unavailable");
   for(const receipt of receipts){manifestIds.add(receipt.lineageManifestId);expiresAt=Math.min(expiresAt,Date.parse(receipt.payload.expiresAt));}
  }
 }
 if(performance.now()>deadline)throw unprocessable("The complete analytical source review exceeded its time budget");
 if(manifestIds.size>26200||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw conflict("Native analytical source retention is unavailable");
 const {assertMemorySourcesRetained}=await import("./memory/memory-privacy.js");
 await assertMemorySourcesRetained(tx,companyId,[...manifestIds].map(id=>({sourceProvider:"august_works_analytical",sourceRef:`manifest://${id}`})));
 return {pins,manifestIds:[...manifestIds].sort(),expiresAt:new Date(expiresAt)};
}

/** Copied prose is admitted as one complete source-dependent payload. Owners
 * remain authoritative after an original run has finished or roles change. */
export async function assertAnalyticalContextPayloadAccess(db:Db,companyId:string,actor:AuthorizationActor|undefined,scope:{issueId:string}|{runId:string}) {
 const condition="issueId" in scope?eq(contextManifests.issueId,scope.issueId):eq(contextManifests.runId,scope.runId);
 const hasRoots=await db.select({id:analyticalContextRoots.memoryRecordId}).from(contextManifests).innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
  .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId))).where(and(eq(contextManifests.companyId,companyId),condition)).limit(1);
 if(!hasRoots.length)return;
 if(!actor)throw forbidden("A current reader is required for source-dependent analytical payloads");
 const {lockAnalyticalCompany}=await import("./analytical-privacy.js"),{lockMemoryPrivacy}=await import("./memory/memory-privacy.js");
 const inspect=()=>db.transaction(async rawTx=>{
  const tx=rawTx as unknown as Db;await tx.execute(sql`set local statement_timeout='8s'`);await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);
  const roots=await tx.selectDistinct({id:analyticalContextRoots.memoryRecordId,sourceCount:analyticalContextRoots.sourceCount,pins:analyticalContextRoots.authorityPins,expiresAt:analyticalContextRoots.expiresAt}).from(contextManifests).innerJoin(contextManifestMemoryRoots,and(eq(contextManifestMemoryRoots.companyId,contextManifests.companyId),eq(contextManifestMemoryRoots.manifestId,contextManifests.id)))
   .innerJoin(analyticalContextRoots,and(eq(analyticalContextRoots.companyId,contextManifests.companyId),eq(analyticalContextRoots.memoryRecordId,contextManifestMemoryRoots.memoryRecordId))).where(and(eq(contextManifests.companyId,companyId),condition)).limit(257);
  if(roots.length>256)throw forbidden("The complete analytical conversation exceeds its source review budget");
  const erased=await tx.execute<{erased:boolean}>(sql`select aw_workflow_memory_erased(${companyId}::uuid,${"runId"in scope?scope.runId:null}::uuid,${"issueId"in scope?scope.issueId:null}::uuid) as erased`);
  if(erased[0]?.erased)throw forbidden("The analytical conversation source was erased or expired");
  const deadline=performance.now()+30000;
  for(const root of roots){
   if(!root.pins.length||root.expiresAt.getTime()<=Date.now())throw forbidden("The analytical conversation requires current source review");
   const current=await inspectAnalyticalContextPins(tx,companyId,actor,root.pins,deadline);
   const retained=await tx.select({id:analyticalContextDependencies.sourceManifestId}).from(analyticalContextDependencies).where(and(eq(analyticalContextDependencies.companyId,companyId),eq(analyticalContextDependencies.memoryRecordId,root.id))).limit(26201);
   if(retained.length!==root.sourceCount||JSON.stringify(retained.map(source=>source.id).sort())!==JSON.stringify(current.manifestIds))throw forbidden("The complete retained analytical source authority changed");
  }
 });
 try {
  if(actor.type==="agent"){
   const {withNativeAnalyticalReader}=await import("./analytical-reader.js");
   return await withNativeAnalyticalReader(db,companyId,actor,inspect);
  }
  return await inspect();
 }catch(error){
  if(error instanceof HttpError&&[403,404,409,422].includes(error.status))throw new HttpError(error.status,"Analytical conversation source access is unavailable",{code:"analytical_source_access_lost"});
  throw error;
 }
}
