import {assertAnalyticalReader,analyticalPrincipalId} from "../analytical-reader.js";
import {randomUUID} from "node:crypto";
import {and,asc,desc,eq,sql} from "drizzle-orm";
import {causalClaims,causalClaimVersions,causalClaimReviews,causalAnalysisRuns,analyticalLineageManifests,analyticalLineageEdges,companyMemberships,type Db} from "@paperclipai/db";
import {causalClaimDefinitionSchema,createCausalClaimSchema,reviseCausalClaimSchema,reviewCausalClaimSchema,analyzeCausalClaimSchema,revokeCausalClaimSchema,v7FeatureEnabled,v8FeatureEnabled,type CausalClaimDefinition,type CausalClaimView,type CausalClaimVersionView,type CausalAnalysisRunView,type NativeCausalSource,type CreateCausalClaim,type ReviseCausalClaim,type ReviewCausalClaim,type AnalyzeCausalClaim,type RevokeCausalClaim} from "@paperclipai/shared";
import type {AuthorizationActor} from "../authorization.js";
import {conflict,forbidden,notFound,unprocessable} from "../../errors.js";
import {assertV7Authorization,v7HumanActorId} from "../v7-authorization.js";
import {companyService} from "../companies.js";
import {instanceSettingsService} from "../instance-settings.js";
import {lockAnalyticalCompany} from "../analytical-privacy.js";
import {lockMemoryPrivacy} from "../memory/memory-privacy.js";
import {currentAnalyticalPurpose} from "../analytical-purpose.js";
import {businessMetricService} from "../business-metrics/service.js";
import {authorizeStrategyReference} from "../strategy-execution/references.js";
import {inspectDecisionSourceAuthority} from "../decision-intelligence.js";
import {inspectBusinessExperimentEvidence} from "../business-experiments/evidence.js";
import {causalAnalysisEvidenceReferenceSchema,type CausalAnalysisEvidenceReference} from "@paperclipai/shared";
import {nativeSha256} from "../native-runtime/canonical.js";
import {signDecisionSpec,verifyDecisionSpec} from "../decision-signing.js";
import {logActivity,withV7ActivityTransaction} from "../v7-mutations.js";
import {evaluateNativeCausalClaim} from "./kernel.js";
import {currentDoWhyCausalProfile,evaluateDoWhyCausalClaim,replayDoWhyCausalClaim} from "./dowhy-provider.js";
type Root=typeof causalClaims.$inferSelect;
type Version=typeof causalClaimVersions.$inferSelect;
type Review=typeof causalClaimReviews.$inferSelect;
type Run=typeof causalAnalysisRuns.$inferSelect;
type Edge=Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
const ENGINE="aw-native-causal-owner-v1",DAY=86400000,MAX_EDGES=20065;
function budget(deadline:number){if(performance.now()>deadline)throw unprocessable("Causal source inspection exceeded its bounded time budget");}
function mergeEdges(raw:Edge[]){const edges=new Map<string,Edge>();for(const e of raw){const key=`${e.inputType}:${e.inputRef}`,old=edges.get(key);if(old&&old.inputHash!==e.inputHash)throw conflict("Causal source pins disagree");edges.set(key,{inputType:e.inputType,inputRef:e.inputRef,inputHash:e.inputHash,relationship:e.relationship});if(edges.size>MAX_EDGES)throw unprocessable("Causal source population exceeds its bounded budget");}return [...edges.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));}
async function time(tx:Db){const [row]=await tx.execute<{at:Date|string}>(sql`select statement_timestamp() as at`);return new Date(row.at);}
async function admit(tx:Db,companyId:string,actor:AuthorizationActor,write=false,flagsRequired=true){if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor);await assertV7Authorization(tx,actor,companyId,write?"users:manage_permissions":"company_scope:read");if(!await companyService(tx).getById(companyId))throw notFound("Analytical company is unavailable");const flags=await instanceSettingsService(tx).getExperimental();if(flagsRequired&&(!v8FeatureEnabled(flags,"causal_claims_v8")||!v7FeatureEnabled(flags,"governance_evidence_v7")))throw notFound("Governed causal claims are not enabled");await lockAnalyticalCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await tx.execute(sql`set local statement_timeout='8s'`);}
async function root(tx:Db,companyId:string,id:string){const [row]=await tx.select().from(causalClaims).where(and(eq(causalClaims.companyId,companyId),eq(causalClaims.id,id))).for("update");if(!row)throw notFound("Causal claim is unavailable");return row;}
function rootView(row:Root):CausalClaimView{return {...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};}
function versionView(row:Version,current:boolean):CausalClaimVersionView{return {id:row.id,companyId:row.companyId,claimId:row.claimId,revision:row.revision,definition:row.definition,contentHash:row.contentHash,sourceHash:row.sourceHash,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),currentQualification:current?"current":"needs_revalidation"};}
function signed(domain:string,material:unknown){const receiptHash=nativeSha256(material);return {receiptHash,signature:signDecisionSpec({domain:`aw-causal:${domain}:v1`,receiptHash})};}
function verify(domain:string,material:unknown,row:{receiptHash:string;signature:string}){if(nativeSha256(material)!==row.receiptHash||!verifyDecisionSpec({domain:`aw-causal:${domain}:v1`,receiptHash:row.receiptHash},row.signature))throw notFound("Causal signed receipt integrity is unavailable");}
function reviewMaterial(row:Review){const {receiptHash:_hash,signature:_sig,...rest}=row;return {...rest,reviewedAt:row.reviewedAt.toISOString(),graphAndAssumptionsAcknowledged:true};}
function runMaterial(row:Run,reviewHash:string){const {receiptHash:_hash,signature:_sig,...rest}=row;return {...rest,startedAt:row.startedAt.toISOString(),completedAt:row.completedAt.toISOString(),reviewHash};}
function providerPins(definition:CausalClaimDefinition){return definition.providerProfile?{providerKey:"dowhy" as const,providerVersion:"0.14" as const,methodKey:"backdoor.linear_regression" as const}:{providerKey:"aw_native_registered_randomization" as const,providerVersion:"1" as const,methodKey:"registered_primary_itt" as const};}
function planHash(definition:CausalClaimDefinition,sourceHash:string|null){return nativeSha256({definition,sourceHash,...providerPins(definition),engineVersion:"aw-native-causal-registered-primary-v1"});}
async function providerCurrent(tx:Db,definition:CausalClaimDefinition,required:boolean){
 if(!definition.providerProfile)return true;
 let current=false;const flags=await instanceSettingsService(tx).getExperimental();
 if(v8FeatureEnabled(flags,"causal_provider_dowhy_v8")){try{current=nativeSha256(await currentDoWhyCausalProfile())===nativeSha256(definition.providerProfile);}catch{current=false;}}
 if(required&&!current)throw conflict("Optional causal runtime requires its exact currently qualified profile");return current;
}
async function capture(tx:Db,companyId:string,actor:AuthorizationActor,definition:CausalClaimDefinition,requireCurrent:boolean,deadline:number){
 const policies=await currentAnalyticalPurpose(tx,companyId,definition,"causal");
 let ownerCurrent=true;
 if(definition.ownerUserId!==analyticalPrincipalId(actor)){const [member]=await tx.select({id:companyMemberships.id}).from(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,definition.ownerUserId),eq(companyMemberships.status,"active"))).for("share");ownerCurrent=!!member;if(requireCurrent&&!ownerCurrent)throw conflict("Causal claim owner must be a current company human");}
 const metric=await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,definition.outcomeMetricId,definition.outcomeMetricVersionId),metricPolicies=await currentAnalyticalPurpose(tx,companyId,metric.version.definition,"metrics");
 if(metric.version.definition.sensitivity==="confidential"&&definition.sensitivity!=="confidential")throw forbidden("Causal sensitivity cannot downgrade native outcome evidence");
 const calculation=metric.version.definition.calculation;
 if(metric.version.definition.authorityMode!=="aw_native"||calculation.kind!=="native_ratio"||metric.version.definition.grain!==definition.population.unit)throw conflict("Native causal outcomes require an exact native binary unit ratio definition");
 if(calculation.denominator.entity==="issue"&&calculation.denominator.projectId!==(definition.population.scope.type==="project"?definition.population.scope.id:null)||definition.population.unit==="project"&&definition.population.scope.type==="project")throw conflict("Causal population and native outcome metric scopes differ");
 let current=ownerCurrent&&metric.metric.publishedVersionId===metric.version.id;
 let expiresAt=new Date(Math.min(Date.now()+definition.retentionDays*DAY,metric.version.createdAt.getTime()+metric.version.definition.reviewFrequencyDays*DAY,...policies.map(p=>p.nextReviewAt.getTime()),...metricPolicies.map(p=>p.nextReviewAt.getTime())));
 let edges:Edge[]=[...policies,...metricPolicies].map(p=>({inputType:"governance_obligation",inputRef:p.id,inputHash:p.obligationHash,relationship:"policy"}));edges.push({inputType:"metric_version",inputRef:metric.version.id,inputHash:metric.version.contentHash,relationship:"definition"});
 if(definition.population.scope.type==="project"){const ancestry=await authorizeStrategyReference(tx,companyId,actor,{type:"project",id:definition.population.scope.id},definition.sensitivity);edges.push(...ancestry.projectIds.map(id=>({inputType:"project" as const,inputRef:id,inputHash:nativeSha256({type:"project",id}),relationship:"source" as const})));}
 let source:NativeCausalSource|null=null;const manifestIds:string[]=[];
 if(definition.experimentEvidence){const inherited=await inspectBusinessExperimentEvidence(tx,companyId,actor,definition.experimentEvidence,requireCurrent,deadline);manifestIds.push(...inherited.manifestIds);if(inherited.definition.sensitivity==="confidential"&&definition.sensitivity!=="confidential")throw forbidden("Causal sensitivity cannot downgrade experiment evidence");source={definition:inherited.definition,analysis:inherited.view,sourceHash:inherited.sourceHash,interpretationId:inherited.interpretation.id};current=current&&inherited.view.currentQualification==="current";expiresAt=new Date(Math.min(expiresAt.getTime(),inherited.expiresAt.getTime()));edges.push(...inherited.edges);}
 if(requireCurrent&&!current)throw conflict("Causal evidence requires current published source versions");
 edges=mergeEdges(edges);await inspectDecisionSourceAuthority(tx,companyId,actor,edges,deadline);budget(deadline);current=(await providerCurrent(tx,definition,requireCurrent))&&current;budget(deadline);if(expiresAt<=new Date())throw conflict("Causal source evidence expired during admission");return {source,sourceHash:source?.sourceHash??null,manifestIds,edges,expiresAt,current};
}
async function appendVersion(tx:Db,row:Root,actor:AuthorizationActor,definition:CausalClaimDefinition,rationale:string,deadline:number){
 const captured=await capture(tx,row.companyId,actor,definition,true,deadline),id=randomUUID(),manifestId=randomUUID(),contentHash=nativeSha256(definition),sourceHash=captured.sourceHash,createdAt=row.updatedAt,createdBy=v7HumanActorId(actor);
 const proof=signed("version",{companyId:row.companyId,claimId:row.id,id,contentHash,sourceHash,createdAt:createdAt.toISOString(),createdBy,rationale,expiresAt:captured.expiresAt.toISOString(),edges:captured.edges});
 await tx.insert(analyticalLineageManifests).values({id:manifestId,companyId:row.companyId,analysisType:"causal_claim_version",analysisRef:id,engineVersion:ENGINE,definitionHash:contentHash,inputHash:nativeSha256({sourceHash}),requestedBy:createdBy,sourceWatermark:createdAt.toISOString(),sourceCount:captured.edges.length,parameters:{lineageHash:nativeSha256(captured.edges),...proof},createdAt,expiresAt:captured.expiresAt});
 for(let offset=0;offset<captured.edges.length;offset+=500)await tx.insert(analyticalLineageEdges).values(captured.edges.slice(offset,offset+500).map(e=>({...e,companyId:row.companyId,manifestId})));
 const reference=definition.experimentEvidence;
 const [value]=await tx.insert(causalClaimVersions).values({id,companyId:row.companyId,claimId:row.id,revision:row.revision,definition,contentHash,sourceHash,outcomeMetricId:definition.outcomeMetricId,outcomeMetricVersionId:definition.outcomeMetricVersionId,experimentId:reference?.experimentId??null,experimentVersionId:reference?.versionId??null,analysisId:reference?.id??null,interpretationId:reference?.interpretationId??null,lineageManifestId:manifestId,rationale,createdBy,createdAt,expiresAt:captured.expiresAt}).returning();return value;
}
async function inspectVersion(tx:Db,row:Root,actor:AuthorizationActor,id:string,requireCurrent:boolean,deadline:number){
 const [value]=await tx.select().from(causalClaimVersions).where(and(eq(causalClaimVersions.companyId,row.companyId),eq(causalClaimVersions.claimId,row.id),eq(causalClaimVersions.id,id))).for("share");
 if(!value||value.expiresAt<=new Date()||!causalClaimDefinitionSchema.safeParse(value.definition).success||nativeSha256(value.definition)!==value.contentHash)throw notFound("Causal version is erased, expired or unavailable");
 const source=await capture(tx,row.companyId,actor,value.definition,requireCurrent,deadline);
 if(source.sourceHash!==value.sourceHash)throw notFound("Causal exact source analysis/interpretation is unavailable");
 const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,row.companyId),eq(analyticalLineageManifests.id,value.lineageManifestId))).for("share");
 const rawEdges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,row.companyId),eq(analyticalLineageEdges.manifestId,value.lineageManifestId))).limit(MAX_EDGES+1),edges=mergeEdges(rawEdges);
 if(!manifest||manifest.engineVersion!==ENGINE||manifest.analysisType!=="causal_claim_version"||manifest.analysisRef!==value.id||manifest.definitionHash!==value.contentHash||manifest.inputHash!==nativeSha256({sourceHash:value.sourceHash})||manifest.createdAt.getTime()!==value.createdAt.getTime()||manifest.expiresAt.getTime()!==value.expiresAt.getTime()||manifest.sourceCount!==rawEdges.length||manifest.parameters.lineageHash!==nativeSha256(edges)||typeof manifest.parameters.receiptHash!=="string"||typeof manifest.parameters.signature!=="string")throw notFound("Causal native lineage is unavailable");
 verify("version",{companyId:row.companyId,claimId:row.id,id:value.id,contentHash:value.contentHash,sourceHash:value.sourceHash,createdAt:value.createdAt.toISOString(),createdBy:value.createdBy,rationale:value.rationale,expiresAt:value.expiresAt.toISOString(),edges},{receiptHash:manifest.parameters.receiptHash,signature:manifest.parameters.signature});
 await inspectDecisionSourceAuthority(tx,row.companyId,actor,edges,deadline);
 const [review]=await tx.select().from(causalClaimReviews).where(and(eq(causalClaimReviews.companyId,row.companyId),eq(causalClaimReviews.claimId,row.id),eq(causalClaimReviews.versionId,id))).for("share");if(review)verify("review",reviewMaterial(review),review);
 const [run]=await tx.select().from(causalAnalysisRuns).where(and(eq(causalAnalysisRuns.companyId,row.companyId),eq(causalAnalysisRuns.claimId,row.id),eq(causalAnalysisRuns.versionId,id))).for("share");
 if(run){
  if(!review||run.reviewId!==review.id||run.sourceHash!==value.sourceHash||run.analysisPlanHash!==planHash(value.definition,value.sourceHash)||run.assumptionsSnapshotHash!==nativeSha256(value.definition.assumptions))throw notFound("Causal run exact review/protocol proof is unavailable");
  verify("run",runMaterial(run,review.receiptHash),run);
  // The original capture was current. Later publications mark reliance stale;
  // replay the unchanged original result, preserving historical bytes.
  const original=source.source?{...source.source,analysis:{...source.source.analysis,currentQualification:"current" as const,causalAuthority:source.source.analysis.result.numericallyQualified?"conditional_on_registered_randomization_and_human_attestations" as const:"withheld" as const}}:null;
  let replay;try{replay=value.definition.providerProfile?replayDoWhyCausalClaim(value.definition,original,run.result.providerAnalysis):evaluateNativeCausalClaim(value.definition,original);}catch{throw notFound("Causal retained provider replay is unavailable");}
  const pins=providerPins(value.definition);if(run.providerKey!==pins.providerKey||run.providerVersion!==pins.providerVersion||run.methodKey!==pins.methodKey||nativeSha256(replay)!==nativeSha256(run.result))throw notFound("Causal retained numerical/identification replay is unavailable");
 }
 budget(deadline);return {value,source,edges,review:review??null,run:run??null};
}
function runView(row:Run,current:boolean):CausalAnalysisRunView{return {id:row.id,companyId:row.companyId,claimId:row.claimId,versionId:row.versionId,providerKey:row.providerKey,providerVersion:row.providerVersion as CausalAnalysisRunView["providerVersion"],methodKey:row.methodKey as CausalAnalysisRunView["methodKey"],analysisPlanHash:row.analysisPlanHash,assumptionsSnapshotHash:row.assumptionsSnapshotHash,sourceHash:row.sourceHash,result:row.result,receiptHash:row.receiptHash,startedAt:row.startedAt.toISOString(),completedAt:row.completedAt.toISOString(),currentQualification:current?"current":"needs_revalidation"};}
async function inspect(tx:Db,row:Root,actor:AuthorizationActor,deadline:number){
 const versions=await tx.select({id:causalClaimVersions.id}).from(causalClaimVersions).where(and(eq(causalClaimVersions.companyId,row.companyId),eq(causalClaimVersions.claimId,row.id))).orderBy(desc(causalClaimVersions.revision)).limit(6);
 const items=[];for(const version of versions.slice(0,5)){const pin=await inspectVersion(tx,row,actor,version.id,false,deadline);items.push({version:versionView(pin.value,pin.source.current),review:pin.review?{id:pin.review.id,versionId:pin.review.versionId,rationale:pin.review.rationale,reviewedBy:pin.review.reviewedBy,reviewedAt:pin.review.reviewedAt.toISOString(),receiptHash:pin.review.receiptHash}:null,run:pin.run?runView(pin.run,pin.source.current):null});}
 return {claim:rootView(row),versions:items,coverage:"bounded_recent_native_versions" as const};
}
async function audit(tx:Db,publications:Parameters<typeof logActivity>[2],companyId:string,actor:AuthorizationActor,id:string,action:string,details:Record<string,unknown>){await logActivity(tx,{companyId,actorType:"user",actorId:v7HumanActorId(actor),entityType:"causal_claim",entityId:id,action:`causal_claim.${action}`,details},publications);}
/** Internal native consumer admission; public commands cannot supply captured
 * graph/results, source hashes, confidence or execution authority. */
export async function inspectCausalClaimEvidence(tx:Db,companyId:string,actor:AuthorizationActor,raw:CausalAnalysisEvidenceReference,requireCurrent:boolean,deadline=performance.now()+30000){
 const ref=causalAnalysisEvidenceReferenceSchema.parse(raw);await admit(tx,companyId,actor);const row=await root(tx,companyId,ref.claimId);
 if(requireCurrent&&row.status==="revoked")throw notFound("Causal claim is revoked; new downstream reliance is unavailable");
 const pin=await inspectVersion(tx,row,actor,ref.versionId,requireCurrent,deadline);
 if(!pin.review||!pin.run||pin.review.id!==ref.reviewId||pin.run.id!==ref.id)throw notFound("Exact signed causal analysis and human model review are unavailable");
 const current=pin.source.current&&row.currentVersionId===ref.versionId&&row.reviewedVersionId===ref.versionId&&row.latestRunId===ref.id&&row.status===pin.run.result.status;
 if(requireCurrent&&!current)throw conflict("Causal model or source changed; review current evidence before new reliance");
 const review={id:pin.review.id,versionId:pin.review.versionId,rationale:pin.review.rationale,reviewedBy:pin.review.reviewedBy,reviewedAt:pin.review.reviewedAt.toISOString(),receiptHash:pin.review.receiptHash};
 return {definition:pin.value.definition,view:runView(pin.run,current),review,sourceHash:nativeSha256({definitionHash:pin.value.contentHash,reviewHash:pin.review.receiptHash,runHash:pin.run.receiptHash}),expiresAt:pin.value.expiresAt,manifestIds:[...new Set([pin.value.lineageManifestId,...pin.source.manifestIds])],edges:mergeEdges([...pin.edges,...pin.source.edges])};
}
export function causalClaimService(db:Db){return {
 async providerProfile(companyId:string,actor:AuthorizationActor){return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor,true);const flags=await instanceSettingsService(tx).getExperimental();if(!v8FeatureEnabled(flags,"causal_provider_dowhy_v8"))throw notFound("Optional causal provider is not enabled");try{return await currentDoWhyCausalProfile();}catch{throw conflict("Optional causal provider is unavailable or unqualified");}});},
 async controls(companyId:string,actor:AuthorizationActor,cursor?:string){return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor,true,false);const rows=await tx.select({id:causalClaims.id,companyId:causalClaims.companyId,revision:causalClaims.revision,status:causalClaims.status}).from(causalClaims).where(and(eq(causalClaims.companyId,companyId),sql`${causalClaims.status}<>'revoked'`,cursor?sql`${causalClaims.id}>${cursor}::uuid`:undefined)).orderBy(asc(causalClaims.id)).limit(21);return {items:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null,coverage:"bounded_native_revocation_metadata" as const};});},
 async create(companyId:string,actor:AuthorizationActor,raw:CreateCausalClaim){const input=createCausalClaimSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{
  await admit(tx,companyId,actor,true);const at=await time(tx),[row]=await tx.insert(causalClaims).values({companyId,key:input.key,createdBy:v7HumanActorId(actor),createdAt:at,updatedAt:at}).returning();
  const version=await appendVersion(tx,row,actor,input.definition,"Initial explicit human causal question and model",performance.now()+30000),[updated]=await tx.update(causalClaims).set({currentVersionId:version.id}).where(eq(causalClaims.id,row.id)).returning();await audit(tx,publications,companyId,actor,row.id,"created",{versionId:version.id,contentHash:version.contentHash});return {claim:rootView(updated),version:versionView(version,true)};
 });},
 async revise(companyId:string,actor:AuthorizationActor,id:string,raw:ReviseCausalClaim){const input=reviseCausalClaimSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{
  await admit(tx,companyId,actor,true);const prior=await root(tx,companyId,id);if(prior.revision!==input.expectedRevision||prior.status==="revoked")throw conflict("Causal claim changed or is revoked; reload before revising");const at=await time(tx),next={...prior,revision:prior.revision+1,updatedAt:at},version=await appendVersion(tx,next,actor,input.definition,input.rationale,performance.now()+30000);
  const [updated]=await tx.update(causalClaims).set({revision:next.revision,currentVersionId:version.id,reviewedVersionId:null,latestRunId:null,status:"hypothesis",updatedAt:at}).where(and(eq(causalClaims.companyId,companyId),eq(causalClaims.id,id),eq(causalClaims.revision,prior.revision))).returning();await audit(tx,publications,companyId,actor,id,"revised",{versionId:version.id,revision:updated.revision,contentHash:version.contentHash});return {claim:rootView(updated),version:versionView(version,true)};
 });},
 async review(companyId:string,actor:AuthorizationActor,id:string,raw:ReviewCausalClaim){const input=reviewCausalClaimSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{
  await admit(tx,companyId,actor,true);const row=await root(tx,companyId,id),deadline=performance.now()+30000;if(row.revision!==input.expectedRevision||row.currentVersionId!==input.versionId||row.status!=="hypothesis"||row.reviewedVersionId)throw conflict("Review requires the exact unreviewed current human causal model");const pin=await inspectVersion(tx,row,actor,input.versionId,true,deadline);if(pin.review||pin.run)throw conflict("This exact causal model already has a review or run");
  const at=await time(tx),review:Review={id:randomUUID(),companyId,claimId:id,versionId:input.versionId,definitionHash:pin.value.contentHash,sourceHash:pin.value.sourceHash,rationale:input.rationale,receiptHash:"",signature:"",reviewedBy:v7HumanActorId(actor),reviewedAt:at};Object.assign(review,signed("review",reviewMaterial(review)));await tx.insert(causalClaimReviews).values(review);
  const [updated]=await tx.update(causalClaims).set({reviewedVersionId:input.versionId,revision:row.revision+1,updatedAt:at}).where(and(eq(causalClaims.companyId,companyId),eq(causalClaims.id,id),eq(causalClaims.revision,row.revision))).returning();await audit(tx,publications,companyId,actor,id,"model_reviewed",{versionId:input.versionId,reviewId:review.id,receiptHash:review.receiptHash});return rootView(updated);
 });},
 async analyze(companyId:string,actor:AuthorizationActor,id:string,raw:AnalyzeCausalClaim,options:{signal?:AbortSignal}={}){const input=analyzeCausalClaimSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{
  await admit(tx,companyId,actor,true);const row=await root(tx,companyId,id),deadline=performance.now()+30000;if(row.revision!==input.expectedRevision||row.currentVersionId!==input.versionId||row.reviewedVersionId!==input.versionId||row.status!=="hypothesis"||row.latestRunId)throw conflict("Analysis requires the exact current separately reviewed causal model");const startedAt=await time(tx),pin=await inspectVersion(tx,row,actor,input.versionId,true,deadline);if(!pin.review||pin.run)throw conflict("Causal review is unavailable or this exact model already ran");
  if(options.signal?.aborted)throw conflict("Causal analysis was cancelled");
  let result;try{result=pin.value.definition.providerProfile?await evaluateDoWhyCausalClaim(pin.value.definition,pin.source.source,options):evaluateNativeCausalClaim(pin.value.definition,pin.source.source);}catch{throw conflict("Optional causal analysis is unavailable or changed; no result was retained");}
  const fresh=await inspectVersion(tx,row,actor,input.versionId,true,deadline);if(options.signal?.aborted||fresh.value.expiresAt<=new Date()||nativeSha256(evaluateNativeCausalClaim(pin.value.definition,pin.source.source))!==nativeSha256(evaluateNativeCausalClaim(fresh.value.definition,fresh.source.source)))throw conflict("Causal Source or cancellation changed during analysis");
  const completedAt=await time(tx);budget(deadline);if(options.signal?.aborted)throw conflict("Causal analysis was cancelled");const run:Run={id:randomUUID(),companyId,claimId:id,versionId:input.versionId,reviewId:pin.review.id,...providerPins(pin.value.definition),analysisPlanHash:planHash(pin.value.definition,pin.value.sourceHash),assumptionsSnapshotHash:nativeSha256(pin.value.definition.assumptions),sourceHash:pin.value.sourceHash,result,receiptHash:"",signature:"",createdBy:v7HumanActorId(actor),startedAt,completedAt};Object.assign(run,signed("run",runMaterial(run,pin.review.receiptHash)));await tx.insert(causalAnalysisRuns).values(run);
  const [updated]=await tx.update(causalClaims).set({revision:row.revision+1,latestRunId:run.id,status:result.status,updatedAt:completedAt}).where(and(eq(causalClaims.companyId,companyId),eq(causalClaims.id,id),eq(causalClaims.revision,row.revision))).returning();await audit(tx,publications,companyId,actor,id,"analyzed",{versionId:input.versionId,runId:run.id,status:result.status,receiptHash:run.receiptHash});return {claim:rootView(updated),run:runView(run,true)};
 });},
 async revoke(companyId:string,actor:AuthorizationActor,id:string,raw:RevokeCausalClaim){const input=revokeCausalClaimSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{
  await admit(tx,companyId,actor,true,false);const row=await root(tx,companyId,id);if(row.revision!==input.expectedRevision||row.status==="revoked")throw conflict("Causal claim changed or is already revoked");const at=await time(tx),[updated]=await tx.update(causalClaims).set({status:"revoked",revision:row.revision+1,updatedAt:at}).where(and(eq(causalClaims.companyId,companyId),eq(causalClaims.id,id),eq(causalClaims.revision,row.revision))).returning();await audit(tx,publications,companyId,actor,id,"revoked",{revision:updated.revision,rationaleHash:nativeSha256(input.rationale)});return rootView(updated);
 });},
 async detail(companyId:string,actor:AuthorizationActor,id:string){return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);return inspect(tx,await root(tx,companyId,id),actor,performance.now()+30000);});},
 async list(companyId:string,actor:AuthorizationActor,cursor?:string){return db.transaction(async raw=>{
  const tx=raw as unknown as Db;await admit(tx,companyId,actor);const deadline=performance.now()+30000,rows=await tx.select().from(causalClaims).where(and(eq(causalClaims.companyId,companyId),cursor?sql`${causalClaims.id}>${cursor}::uuid`:undefined)).orderBy(asc(causalClaims.id)).limit(21),items=[];
  for(const row of rows.slice(0,20)){budget(deadline);if(!row.currentVersionId)continue;try{const pin=await inspectVersion(tx,row,actor,row.currentVersionId,false,deadline);items.push({claim:rootView(row),version:versionView(pin.value,pin.source.current),run:pin.run?runView(pin.run,pin.source.current):null});}catch(error){if(!error||typeof error!=="object"||!("status" in error)||![403,404,409].includes(Number(error.status)))throw error;}}
  return {items,nextCursor:rows.length>20?rows[19].id:null,coverage:"bounded_current_authorized_page" as const};
 });},
};}
