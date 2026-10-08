import {assertAnalyticalReader,analyticalPrincipalId} from "../analytical-reader.js";
import {randomUUID} from "node:crypto";
import {and,asc,desc,eq,sql} from "drizzle-orm";
import {forecastSpecs,forecastSpecVersions,forecastBacktests,forecastPublications,forecastRuns,analyticalLineageEdges,analyticalLineageManifests,businessMetricObservations,businessMetricPublications,companyMemberships,type Db} from "@paperclipai/db";
import {businessForecastDefinitionSchema,createBusinessForecastSpecSchema,reviseBusinessForecastSpecSchema,backtestBusinessForecastSchema,publishBusinessForecastSpecSchema,retireBusinessForecastSpecSchema,v8FeatureEnabled,v7FeatureEnabled,
 type BusinessForecastDefinition,type CreateBusinessForecastSpec,type ReviseBusinessForecastSpec,type BacktestBusinessForecast,type PublishBusinessForecastSpec,type RetireBusinessForecastSpec,type BusinessForecastSeriesPoint,type BusinessForecastArtifactView,type BusinessForecastVersionView,type BusinessForecastSpecView} from "@paperclipai/shared";
import {conflict,notFound,unprocessable} from "../../errors.js";
import type {AuthorizationActor} from "../authorization.js";
import {assertV7Authorization,v7HumanActorId} from "../v7-authorization.js";
import {instanceSettingsService} from "../instance-settings.js";
import {lockBusinessEventCompany} from "../business-event-privacy.js";
import {lockMemoryPrivacy} from "../memory/memory-privacy.js";
import {currentAnalyticalPurpose} from "../analytical-purpose.js";
import {authorizeStrategyReference} from "../strategy-execution/references.js";
import {inspectDecisionSourceAuthority} from "../decision-intelligence.js";
import {businessMetricService} from "../business-metrics/service.js";
import {nativeSha256} from "../native-runtime/canonical.js";
import {logActivity,withV7ActivityTransaction} from "../v7-mutations.js";
import {currentStatisticalForecastProfile,evaluateStatisticalBusinessForecast} from "./statistical-provider.js";
import {StatisticalWorkerError} from "./statistical-worker.js";
import {evaluateNativeBusinessForecast} from "./kernel.js";

type Root=typeof forecastSpecs.$inferSelect;
type Version=typeof forecastSpecVersions.$inferSelect;
type Artifact=typeof forecastBacktests.$inferSelect;
type Edge=Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
const DAY=86_400_000,BUDGET=20_065;
function timeBudget(deadline:number) {if(performance.now()>deadline) throw unprocessable("Forecast exceeds the native source time budget");}
function rootView(row:Root):BusinessForecastSpecView {return {...row,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};}
function versionView(row:Version):BusinessForecastVersionView {return {...row,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString()};}
function artifactHash(row:Pick<Artifact,"series"|"result"|"cutoff"|"definitionHash">) {return nativeSha256({series:row.series,result:row.result,cutoff:row.cutoff.toISOString(),definitionHash:row.definitionHash});}
function mergeEdges(groups:Edge[][]) {
 const entries=new Map<string,Edge>();
 for(const group of groups) for(const edge of group) {
  const value:Edge={inputType:edge.inputType,inputRef:edge.inputRef,inputHash:edge.inputType==="issue"||edge.inputType==="project"?nativeSha256({type:edge.inputType,id:edge.inputRef}):edge.inputHash,relationship:edge.relationship};
  const key=`${value.inputType}:${value.inputRef}`,old=entries.get(key);
  if(old && old.inputHash!==value.inputHash) throw conflict("Forecast lineage has conflicting source definition pins");
  entries.set(key,value);if(entries.size>BUDGET) throw unprocessable("Forecast exceeds its bounded native source population");
 }
 return [...entries.values()].sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
}
async function lineage(tx:Db,companyId:string,id:string) {
 const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,id))).for("share");
 const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,id))).limit(BUDGET+1);
 if(!manifest || manifest.expiresAt<=new Date() || edges.length>BUDGET) throw notFound("Forecast source lineage is erased or expired");
 return {manifest,edges:mergeEdges([edges])};
}
async function admit(tx:Db,companyId:string,actor:AuthorizationActor,write=false,checkFlags=true) {
 if(write)v7HumanActorId(actor);else await assertAnalyticalReader(tx,companyId,actor);await assertV7Authorization(tx,actor,companyId,write?"users:manage_permissions":"company_scope:read");
 const flags=await instanceSettingsService(tx).getExperimental();
 if(checkFlags&&(!v8FeatureEnabled(flags,"business_forecasting_v8") || !v7FeatureEnabled(flags,"governance_evidence_v7"))) throw notFound("Governed business forecasting is not enabled");
 await lockBusinessEventCompany(tx,companyId);await lockMemoryPrivacy(tx,companyId);await tx.execute(sql`set local statement_timeout='8s'`);
}
async function root(tx:Db,companyId:string,id:string) {
 const [row]=await tx.select().from(forecastSpecs).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.id,id))).for("update");
 if(!row) throw notFound("Forecast specification is unavailable");return row;
}
async function statisticalAuthority(tx:Db,definition:BusinessForecastDefinition,requireCurrent=false) {
 if(definition.provider!=="statsforecast") return true;
 const flags=await instanceSettingsService(tx).getExperimental();
 if(!v8FeatureEnabled(flags,"forecast_provider_statsforecast_v8")) {if(requireCurrent) throw notFound("Statistical forecast provider is not enabled");return false;}
 try {
  const profile=await currentStatisticalForecastProfile(),current=nativeSha256(profile)===nativeSha256(definition.providerProfile);
  if(!current&&requireCurrent) throw conflict("Statistical profile changed; inspect the current profile and create a new forecast version");return current;
 } catch(error) {if(error instanceof StatisticalWorkerError){if(!requireCurrent)return false;throw unprocessable("The exact qualified statistical runtime is unavailable");}throw error;}
}
async function definitionAuthority(tx:Db,companyId:string,actor:AuthorizationActor,definition:BusinessForecastDefinition,requireCurrent=false) {
 const policies=await currentAnalyticalPurpose(tx,companyId,definition,"forecast");
 if(definition.ownerUserId!==analyticalPrincipalId(actor)) {
  const [owner]=await tx.select({id:companyMemberships.id}).from(companyMemberships).where(and(eq(companyMemberships.companyId,companyId),eq(companyMemberships.principalType,"user"),eq(companyMemberships.principalId,definition.ownerUserId),eq(companyMemberships.status,"active"))).for("share");
  if(!owner) throw conflict("Forecast owner must be a current company human principal");
 }
 const metric=await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,definition.metricId,definition.metricVersionId);
 if(requireCurrent && metric.metric.publishedVersionId!==definition.metricVersionId) throw conflict("Forecast requires the current published native metric definition");
 if(definition.sensitivity==="internal" && metric.version.definition.sensitivity==="confidential") throw conflict("Forecast sensitivity cannot weaken its metric source");
 if(metric.version.definition.authorityMode!=="aw_native" || !["count","ratio"].includes(metric.version.definition.valueType)) throw unprocessable("This forecast requires a qualified native metric authority");
 const [publication]=await tx.select().from(businessMetricPublications).where(and(eq(businessMetricPublications.companyId,companyId),eq(businessMetricPublications.metricId,definition.metricId),eq(businessMetricPublications.versionId,definition.metricVersionId))).for("share");
 if(!publication) throw conflict("The metric definition has no native human publication");
 const population=metric.version.definition.calculation.kind==="native_count"?metric.version.definition.calculation.population:metric.version.definition.calculation.kind==="native_ratio"?metric.version.definition.calculation.denominator:null;
 const projectIds=new Set<string>();
 if(population?.entity==="issue"&&population.projectId) projectIds.add(population.projectId);
 if(definition.scope.type==="project") projectIds.add(definition.scope.id);
 for(const id of projectIds) await authorizeStrategyReference(tx,companyId,actor,{type:"project",id},definition.sensitivity);
 const edges:Edge[]=[{inputType:"metric_version",inputRef:metric.version.id,inputHash:metric.version.contentHash,relationship:"definition"},
 ...policies.map(policy=>({inputType:"governance_obligation" as const,inputRef:policy.id,inputHash:policy.obligationHash,relationship:"policy" as const})),
 ...[...projectIds].map(id=>({inputType:"project" as const,inputRef:id,inputHash:nativeSha256({type:"project",id}),relationship:"source" as const}))];
 return {metric,publication,statisticalProfileCurrent:await statisticalAuthority(tx,definition,requireCurrent),edges:mergeEdges([edges]),expiresAt:new Date(Math.min(Date.now()+definition.retentionDays*DAY,metric.version.createdAt.getTime()+metric.version.definition.reviewFrequencyDays*DAY))};
}
async function version(tx:Db,row:Root,actor:AuthorizationActor,id:string,current=false) {
 const [value]=await tx.select().from(forecastSpecVersions).where(and(eq(forecastSpecVersions.companyId,row.companyId),eq(forecastSpecVersions.specId,row.id),eq(forecastSpecVersions.id,id))).for("share");
 if(!value || value.expiresAt<=new Date() || !businessForecastDefinitionSchema.safeParse(value.definition).success || nativeSha256(value.definition)!==value.contentHash) throw notFound("Forecast definition is erased or expired");
 const authority=await definitionAuthority(tx,row.companyId,actor,value.definition,current),source=await lineage(tx,row.companyId,value.lineageManifestId);
 if(source.manifest.engineVersion!=="aw-native-business-forecast-owner-v1" || source.manifest.inputHash!==nativeSha256(source.edges) || source.manifest.sourceCount!==source.edges.length || source.manifest.createdAt.getTime()!==value.createdAt.getTime() || source.manifest.expiresAt.getTime()!==value.expiresAt.getTime() || source.manifest.analysisType!=="forecast_specification" || source.manifest.analysisRef!==value.id || source.manifest.definitionHash!==value.contentHash || source.manifest.parameters.lineageHash!==nativeSha256(source.edges)) throw conflict("Forecast definition lineage integrity is unavailable");
 await inspectDecisionSourceAuthority(tx,row.companyId,actor,source.edges,performance.now()+30_000);
 return {value,authority,source};
}
async function appendManifest(tx:Db,companyId:string,id:string,type:string,actor:AuthorizationActor,definitionHash:string,inputHash:string,createdAt:Date,expiresAt:Date,edges:Edge[],parameters:Record<string,unknown>) {
 const manifestId=randomUUID();
 await tx.insert(analyticalLineageManifests).values({id:manifestId,companyId,analysisRef:id,analysisType:type,engineVersion:"aw-native-business-forecast-owner-v1",inputHash,definitionHash,requestedBy:v7HumanActorId(actor),sourceWatermark:createdAt.toISOString(),sourceCount:edges.length,parameters:{...parameters,lineageHash:nativeSha256(edges)},createdAt,expiresAt});
 for(let start=0;start<edges.length;start+=500) await tx.insert(analyticalLineageEdges).values(edges.slice(start,start+500).map(edge=>({...edge,companyId,manifestId})));
 return manifestId;
}
async function appendVersion(tx:Db,row:Root,actor:AuthorizationActor,definition:BusinessForecastDefinition) {
 const authority=await definitionAuthority(tx,row.companyId,actor,definition,true),id=randomUUID(),contentHash=nativeSha256(definition);
 const manifestId=await appendManifest(tx,row.companyId,id,"forecast_specification",actor,contentHash,nativeSha256(authority.edges),row.updatedAt,authority.expiresAt,authority.edges,{revision:row.revision});
 const [value]=await tx.insert(forecastSpecVersions).values({id,companyId:row.companyId,specId:row.id,revision:row.revision,definition,contentHash,lineageManifestId:manifestId,createdBy:v7HumanActorId(actor),createdAt:row.updatedAt,expiresAt:authority.expiresAt}).returning();return value;
}
async function capture(tx:Db,row:Root,actor:AuthorizationActor,pin:Awaited<ReturnType<typeof version>>,observationIds:string[],cutoff:Date) {
 if(cutoff>new Date()) throw conflict("Forecast cutoff cannot be in the future");
 const series:BusinessForecastSeriesPoint[]=[],deadline=performance.now()+30_000;
 let expiresAt=pin.value.expiresAt,edges=pin.source.edges;
 for(const id of observationIds) {
  timeBudget(deadline);const value=await businessMetricService(tx).inspectCurrentObservation(row.companyId,actor,id);timeBudget(deadline);
  if(value.metricId!==pin.value.definition.metricId || value.versionId!==pin.value.definition.metricVersionId || Date.parse(value.asOf)>cutoff.getTime() || Date.parse(value.asOf)<Math.max(pin.authority.metric.version.createdAt.getTime(),pin.authority.publication.publishedAt.getTime())) throw conflict("Forecast observations require exact known-at-cutoff native definition pins");
  const domain=pin.authority.metric.version.definition.valueType;
  if(value.value!==null && (!Number.isFinite(value.value) || value.value<0 || domain==="ratio"&&value.value>1 || domain==="count"&&!Number.isInteger(value.value))) throw conflict("The native observation is outside its exact metric value domain");
  const [observation]=await tx.select().from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId,row.companyId),eq(businessMetricObservations.id,id))).for("share");
  if(!observation) throw notFound("Forecast measurement was erased");
  const source=await lineage(tx,row.companyId,observation.lineageManifestId);timeBudget(deadline);edges=mergeEdges([edges,source.edges]);
  expiresAt=new Date(Math.min(expiresAt.getTime(),observation.expiresAt.getTime(),source.manifest.expiresAt.getTime()));
  series.push({observationId:id,metricId:value.metricId,metricVersionId:value.versionId,sourceHash:nativeSha256(value),from:value.from,until:value.until,asOf:value.asOf,value:value.value,status:value.status,unit:pin.authority.metric.version.definition.unit});
 }
 timeBudget(deadline);await inspectDecisionSourceAuthority(tx,row.companyId,actor,edges,deadline);
 if(expiresAt<=new Date()) throw conflict("Forecast evidence expired before capture completed");
 return {series,edges,expiresAt};
}
/** A later correction or newly captured completed period invalidates prior
 * qualification, without rewriting a retained historical forecast. */
async function historyChanged(tx:Db,row:Root,pin:Version,series:BusinessForecastSeriesPoint[],cutoff:Date) {
 const ids=new Set(series.map(point=>point.observationId));
 const retained=await tx.select({id:businessMetricObservations.id,observedAt:businessMetricObservations.observedAt,result:businessMetricObservations.result}).from(businessMetricObservations).where(and(eq(businessMetricObservations.companyId,row.companyId),eq(businessMetricObservations.metricId,pin.definition.metricId),eq(businessMetricObservations.versionId,pin.definition.metricVersionId),sql`${businessMetricObservations.expiresAt}>now()`,sql`(${businessMetricObservations.result}->>'until')::timestamptz<=now()`)).orderBy(desc(businessMetricObservations.observedAt),desc(businessMetricObservations.id)).limit(1001);
 if(retained.length>1000) return true;
 const first=series[0];
 return retained.some(item=>!ids.has(item.id) && (item.observedAt>cutoff || series.some(point=>Date.parse(point.from)===Date.parse(item.result.from)&&Date.parse(point.until)===Date.parse(item.result.until)&&Date.parse(item.result.asOf)>=Date.parse(point.asOf))) && (!first || Date.parse(item.result.until)>Date.parse(first.from)));
}
async function inspectArtifact(tx:Db,row:Root,actor:AuthorizationActor,pin:Awaited<ReturnType<typeof version>>,value:Artifact,kind:"backtest"|"run"):Promise<BusinessForecastArtifactView> {
 if(value.expiresAt<=new Date()) throw notFound("Forecast artifact is erased or expired");
 const source=await lineage(tx,row.companyId,value.lineageManifestId);
 if(source.manifest.engineVersion!=="aw-native-business-forecast-owner-v1" || source.manifest.sourceCount!==source.edges.length || source.manifest.createdAt.getTime()!==value.createdAt.getTime() || source.manifest.expiresAt.getTime()!==value.expiresAt.getTime() || value.definitionHash!==pin.value.contentHash || value.contentHash!==artifactHash(value) || value.inputHash!==nativeSha256(value.series) || source.manifest.analysisType!==`forecast_${kind}` || source.manifest.analysisRef!==value.id
  || source.manifest.definitionHash!==value.definitionHash || source.manifest.inputHash!==value.inputHash || source.manifest.parameters.artifactHash!==value.contentHash || source.manifest.parameters.lineageHash!==nativeSha256(source.edges)) throw conflict("Forecast artifact lineage integrity is unavailable");
 const deadline=performance.now()+30_000;
 for(const point of value.series) {
  timeBudget(deadline);const current=await businessMetricService(tx).inspectCurrentObservation(row.companyId,actor,point.observationId);
  if(nativeSha256(current)!==point.sourceHash) throw conflict("Forecast measurement receipt integrity is unavailable");
 }
 await inspectDecisionSourceAuthority(tx,row.companyId,actor,source.edges,deadline);
 const stale=!pin.authority.statisticalProfileCurrent || row.status==="retired" || kind==="run"&&row.publishedVersionId!==value.versionId || pin.authority.metric.metric.publishedVersionId!==pin.value.definition.metricVersionId || await historyChanged(tx,row,pin.value,value.series,value.cutoff);
 return {id:value.id,companyId:value.companyId,specId:value.specId,versionId:value.versionId,kind,result:value.result,series:value.series,contentHash:value.contentHash,cutoff:value.cutoff.toISOString(),createdAt:value.createdAt.toISOString(),expiresAt:value.expiresAt.toISOString(),currentQualification:stale?"needs_revalidation":value.result.status==="qualified"?"qualified":"inconclusive",reviewReason:stale?"The published metric definition or available measurement history changed; a new backtest and human publication are required.":null};
}
async function appendArtifact(tx:Db,row:Root,actor:AuthorizationActor,pin:Awaited<ReturnType<typeof version>>,input:BacktestBusinessForecast,kind:"backtest"|"run",options:{signal?:AbortSignal}={}) {
 const cutoff=new Date(input.cutoff),captured=await capture(tx,row,actor,pin,input.observationIds,cutoff),createdAt=new Date(),id=randomUUID();
 if(await historyChanged(tx,row,pin.value,captured.series,cutoff)) throw conflict("Forecast history contains a newer measurement or correction; refresh native observation pins");
 const result=pin.value.definition.provider==="statsforecast"?await evaluateStatisticalBusinessForecast(pin.value.definition,captured.series,cutoff.toISOString(),options):evaluateNativeBusinessForecast(pin.value.definition,captured.series,cutoff.toISOString()),valueType=pin.authority.metric.version.definition.valueType;
 if(result.status==="qualified" && result.points.some(point=>point.value<0 || valueType==="ratio"&&point.value>1 || point.interval&&(point.interval.lower<0 || valueType==="ratio"&&point.interval.upper>1))) {
  result.status="not_qualified";result.reasons=["prediction_outside_native_metric_value_domain"];result.points=[];result.selectedReason=null;
 }
 if(options.signal?.aborted) throw conflict("Statistical forecast was cancelled before persistence");
 await statisticalAuthority(tx,pin.value.definition,true);
 await inspectDecisionSourceAuthority(tx,row.companyId,actor,captured.edges,performance.now()+30000);
 if(captured.expiresAt<=new Date()) throw conflict("Forecast Sources expired before persistence");
 if(options.signal?.aborted) throw conflict("Statistical forecast was cancelled before persistence");
 const material={series:captured.series,result,cutoff,definitionHash:pin.value.contentHash},contentHash=artifactHash(material);
 const lineageManifestId=await appendManifest(tx,row.companyId,id,`forecast_${kind}`,actor,pin.value.contentHash,result.inputHash,createdAt,captured.expiresAt,captured.edges,{artifactHash:contentHash,metricVersionId:pin.value.definition.metricVersionId,kernelVersion:result.engineVersion,...(result.providerProvenance?{providerProfile:result.providerProvenance}:{})});
 const table=kind==="backtest"?forecastBacktests:forecastRuns;
 const [value]=await tx.insert(table).values({id,companyId:row.companyId,specId:row.id,versionId:pin.value.id,lineageManifestId,...material,inputHash:result.inputHash,contentHash,createdBy:v7HumanActorId(actor),createdAt,expiresAt:captured.expiresAt}).returning();
 const inspected=await inspectArtifact(tx,row,actor,pin,value,kind);
 if(options.signal?.aborted) throw conflict("Statistical forecast was cancelled before persistence");
 return inspected;
}
/** Pinned consumers invoke inside their native company/Memory transaction;
 * owner admission is preserved without nested activity-publication writes. */
export async function inspectBusinessForecastRun(tx:Db,companyId:string,actor:AuthorizationActor,specId:string,versionId:string,runId:string,requireQualified=true) {
 await admit(tx,companyId,actor);const row=await root(tx,companyId,specId);
 const [value]=await tx.select().from(forecastRuns).where(and(eq(forecastRuns.companyId,companyId),eq(forecastRuns.specId,specId),eq(forecastRuns.versionId,versionId),eq(forecastRuns.id,runId))).for("share");
 if(!value) throw notFound("Pinned native forecast run is unavailable");
 const pin=await version(tx,row,actor,versionId),view=await inspectArtifact(tx,row,actor,pin,value,"run");
 if(requireQualified && view.currentQualification!=="qualified") throw conflict("A currently qualified native forecast run is required");
 return {view,metricDefinition:pin.authority.metric.version.definition,forecastDefinition:pin.value.definition,lineageManifestId:value.lineageManifestId};
}
export function businessForecastService(db:Db) {
 const audit=(tx:Db,companyId:string,actor:AuthorizationActor,id:string,action:string,details:Record<string,unknown>,publications:Parameters<typeof logActivity>[2])=>logActivity(tx,{companyId,actorType:"user",actorId:v7HumanActorId(actor),action:`business_forecast.${action}`,entityType:"forecast_spec",entityId:id,details},publications);
 return {
  async statisticalProfile(companyId:string,actor:AuthorizationActor) {
   return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);const flags=await instanceSettingsService(tx).getExperimental();if(!v8FeatureEnabled(flags,"forecast_provider_statsforecast_v8")) throw notFound("Statistical forecast provider is not enabled");
    try {return {companyId,profile:await currentStatisticalForecastProfile(),models:["auto_ets","auto_arima"] as const,qualification:"synthetic_software_conformance" as const,limitations:["Runtime conformance does not qualify this company's forecast. Exact retained observations, time-safe baseline improvement and separate Human publication are required.","AutoTheta remains unqualified on the pinned point/interval conformance case."]};} catch(error){if(error instanceof StatisticalWorkerError)throw unprocessable("The exact qualified statistical runtime is unavailable");throw error;}
   });
  },
  async listPublishedForNativeReader(companyId:string,actor:AuthorizationActor,cursor?:string,limit=5){
   await admit(db,companyId,actor);
   const rows=await db.select({id:forecastSpecs.id,versionId:forecastSpecs.publishedVersionId}).from(forecastSpecs).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.status,"published"),cursor?sql`${forecastSpecs.id}>${cursor}::uuid`:undefined)).orderBy(asc(forecastSpecs.id)).limit(limit+1);
   const items:Awaited<ReturnType<typeof inspectPublishedForecastDefinition>>[]=[];
   for(const row of rows.slice(0,limit))if(row.versionId)try{items.push(await inspectPublishedForecastDefinition(db,companyId,actor,row.id,row.versionId));}catch(error){if(!(error&&typeof error==="object"&&"status"in error&&[403,404,409].includes(Number(error.status))))throw error;}
   return {items,nextCursor:rows.length>limit?rows[limit-1]!.id:null};
  },
  async list(companyId:string,actor:AuthorizationActor,cursor?:string) {
   return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);const rows=await tx.select({id:forecastSpecs.id}).from(forecastSpecs).where(and(eq(forecastSpecs.companyId,companyId),cursor?sql`${forecastSpecs.id}>${cursor}::uuid`:undefined)).orderBy(asc(forecastSpecs.id)).limit(21);
    const items:BusinessForecastSpecView[]=[];
    for(const item of rows.slice(0,20)) {const row=await root(tx,companyId,item.id);const [latest]=await tx.select().from(forecastSpecVersions).where(and(eq(forecastSpecVersions.companyId,companyId),eq(forecastSpecVersions.specId,row.id))).orderBy(desc(forecastSpecVersions.revision)).limit(1);if(latest) {await version(tx,row,actor,latest.id);items.push(rootView(row));}}
    return {items,nextCursor:rows.length>20?rows[19].id:null,coverage:"bounded_current_authorized_page" as const};});
  },
  async detail(companyId:string,actor:AuthorizationActor,id:string) {
   return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);const row=await root(tx,companyId,id),versions=await tx.select().from(forecastSpecVersions).where(and(eq(forecastSpecVersions.companyId,companyId),eq(forecastSpecVersions.specId,id))).orderBy(desc(forecastSpecVersions.revision)).limit(5);
    if(!versions.length) throw notFound("Forecast definition has been erased");
    const admitted=[];for(const item of versions) {await version(tx,row,actor,item.id);admitted.push(versionView(item));}return {spec:rootView(row),versions:admitted};});
  },
  async create(companyId:string,actor:AuthorizationActor,raw:CreateBusinessForecastSpec) {
   const input=createBusinessForecastSpecSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true);const now=new Date();
    if((await tx.select({id:forecastSpecs.id}).from(forecastSpecs).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.key,input.key)))).length) throw conflict("Forecast key already exists");
    const [row]=await tx.insert(forecastSpecs).values({companyId,key:input.key,createdBy:v7HumanActorId(actor),createdAt:now,updatedAt:now}).returning();const pin=await appendVersion(tx,row,actor,input.definition);await audit(tx,companyId,actor,row.id,"created",{versionId:pin.id,definitionHash:pin.contentHash},publications);return {spec:rootView(row),version:versionView(pin)};});
  },
  async revise(companyId:string,actor:AuthorizationActor,id:string,raw:ReviseBusinessForecastSpec) {
   const input=reviseBusinessForecastSpecSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true);const prior=await root(tx,companyId,id);if(prior.revision!==input.expectedRevision||prior.status==="retired") throw conflict("Forecast changed or was retired");
    const [row]=await tx.update(forecastSpecs).set({revision:prior.revision+1,updatedAt:new Date()}).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.id,id),eq(forecastSpecs.revision,prior.revision))).returning();const pin=await appendVersion(tx,row,actor,input.definition);await audit(tx,companyId,actor,id,"version_created",{versionId:pin.id,definitionHash:pin.contentHash},publications);return {spec:rootView(row),version:versionView(pin)};});
  },
  async backtest(companyId:string,actor:AuthorizationActor,id:string,raw:BacktestBusinessForecast,options:{signal?:AbortSignal}={}) {
   const input=backtestBusinessForecastSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true);const row=await root(tx,companyId,id);if(row.revision!==input.expectedRevision||row.status==="retired") throw conflict("Forecast changed or was retired");const pin=await version(tx,row,actor,input.versionId,true);if(pin.value.revision!==row.revision) throw conflict("Backtest requires the latest proposed definition");const result=await appendArtifact(tx,row,actor,pin,input,"backtest",options);await audit(tx,companyId,actor,id,"backtested",{backtestId:result.id,contentHash:result.contentHash,status:result.result.status},publications);return result;});
  },
  async publish(companyId:string,actor:AuthorizationActor,id:string,raw:PublishBusinessForecastSpec) {
   const input=publishBusinessForecastSpecSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true);const prior=await root(tx,companyId,id);if(prior.revision!==input.expectedRevision||prior.status==="retired") throw conflict("Forecast changed or was retired");const pin=await version(tx,prior,actor,input.versionId,true);
    const [backtest]=await tx.select().from(forecastBacktests).where(and(eq(forecastBacktests.companyId,companyId),eq(forecastBacktests.specId,id),eq(forecastBacktests.versionId,input.versionId),eq(forecastBacktests.id,input.backtestId))).for("share");
    if(!backtest||pin.value.revision!==prior.revision) throw conflict("Publication requires the latest exact native backtest");const view=await inspectArtifact(tx,prior,actor,pin,backtest,"backtest");if(view.currentQualification!=="qualified") throw conflict("Forecast publication requires a retained qualified backtest and current history");
    const now=new Date();await tx.insert(forecastPublications).values({companyId,specId:id,versionId:pin.value.id,backtestId:backtest.id,publishedBy:v7HumanActorId(actor),rationale:input.rationale,publishedAt:now});const [row]=await tx.update(forecastSpecs).set({revision:prior.revision+1,status:"published",publishedVersionId:pin.value.id,updatedAt:now}).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.id,id),eq(forecastSpecs.revision,prior.revision))).returning();await audit(tx,companyId,actor,id,"published",{versionId:pin.value.id,backtestId:backtest.id,revision:row.revision},publications);return rootView(row);});
  },
  async run(companyId:string,actor:AuthorizationActor,id:string,raw:BacktestBusinessForecast,options:{signal?:AbortSignal}={}) {
   const input=backtestBusinessForecastSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true);const row=await root(tx,companyId,id);if(row.revision!==input.expectedRevision||row.status!=="published"||row.publishedVersionId!==input.versionId) throw conflict("Run requires the current human-published forecast specification");const pin=await version(tx,row,actor,input.versionId,true);
    const [publication]=await tx.select().from(forecastPublications).where(and(eq(forecastPublications.companyId,companyId),eq(forecastPublications.specId,id),eq(forecastPublications.versionId,input.versionId))).for("share");
    const [backtest]=publication?await tx.select().from(forecastBacktests).where(and(eq(forecastBacktests.companyId,companyId),eq(forecastBacktests.id,publication.backtestId))).for("share"):[];
    if(!backtest||(await inspectArtifact(tx,row,actor,pin,backtest,"backtest")).currentQualification!=="qualified") throw conflict("Forecast must be revalidated and human-published against its changed history before running");
    const result=await appendArtifact(tx,row,actor,pin,input,"run",options);await audit(tx,companyId,actor,id,"run",{runId:result.id,contentHash:result.contentHash,status:result.result.status},publications);return result;});
  },
  async listArtifacts(companyId:string,actor:AuthorizationActor,id:string,kind:"backtest"|"run",cursor?:string) {
   return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);const row=await root(tx,companyId,id),table=kind==="backtest"?forecastBacktests:forecastRuns;
    const rows=await tx.select().from(table).where(and(eq(table.companyId,companyId),eq(table.specId,id),sql`${table.expiresAt}>now()`,cursor?sql`${table.id}>${cursor}::uuid`:undefined)).orderBy(asc(table.id)).limit(21);
    const items:BusinessForecastArtifactView[]=[],deadline=performance.now()+30_000;
    for(const value of rows.slice(0,20)) {timeBudget(deadline);try {const pin=await version(tx,row,actor,value.versionId);items.push(await inspectArtifact(tx,row,actor,pin,value,kind));}
     catch(error) {if(!error||typeof error!=="object"||!("status" in error)||![403,404,409].includes(Number(error.status))) throw error;}}
    timeBudget(deadline);return {items,nextCursor:rows.length>20?rows[19].id:null,coverage:"bounded_current_authorized_page" as const};});
  },
  async artifact(companyId:string,actor:AuthorizationActor,id:string,artifactId:string,kind:"backtest"|"run") {
   return db.transaction(async raw=>{const tx=raw as unknown as Db;await admit(tx,companyId,actor);const row=await root(tx,companyId,id),table=kind==="backtest"?forecastBacktests:forecastRuns;const [value]=await tx.select().from(table).where(and(eq(table.companyId,companyId),eq(table.specId,id),eq(table.id,artifactId))).for("share");if(!value) throw notFound("Forecast artifact is unavailable");const pin=await version(tx,row,actor,value.versionId);return inspectArtifact(tx,row,actor,pin,value,kind);});
  },
  async retire(companyId:string,actor:AuthorizationActor,id:string,raw:RetireBusinessForecastSpec) {
   const input=retireBusinessForecastSpecSchema.parse(raw);return withV7ActivityTransaction(db,async(tx,publications)=>{await admit(tx,companyId,actor,true,false);const prior=await root(tx,companyId,id);if(prior.revision!==input.expectedRevision||prior.status==="retired") throw conflict("Forecast changed or was retired");const [row]=await tx.update(forecastSpecs).set({status:"retired",publishedVersionId:null,revision:prior.revision+1,updatedAt:new Date()}).where(and(eq(forecastSpecs.companyId,companyId),eq(forecastSpecs.id,id),eq(forecastSpecs.revision,prior.revision))).returning();await audit(tx,companyId,actor,id,"retired",{revision:row.revision,rationaleHash:nativeSha256(input.rationale)},publications);return rootView(row);});
  },
 };
}

/** Retain the original human publication and every measurement supporting its
 * qualification; a definition is metadata and never a predicted actual. */
export async function inspectPublishedForecastDefinition(tx:Db,companyId:string,actor:AuthorizationActor,specId:string,versionId:string){
 await admit(tx,companyId,actor);const row=await root(tx,companyId,specId);
 if(row.status!=="published")throw notFound("A current human-published Forecast specification is required");
 const pin=await version(tx,row,actor,versionId);
 const [publication]=await tx.select().from(forecastPublications).where(and(eq(forecastPublications.companyId,companyId),eq(forecastPublications.specId,specId),eq(forecastPublications.versionId,versionId))).for("share");
 const [backtest]=publication?await tx.select().from(forecastBacktests).where(and(eq(forecastBacktests.companyId,companyId),eq(forecastBacktests.specId,specId),eq(forecastBacktests.versionId,versionId),eq(forecastBacktests.id,publication.backtestId))).for("share"):[];
 if(!publication||!backtest)throw notFound("The original human Forecast publication is unavailable");
 const qualification=await inspectArtifact(tx,row,actor,pin,backtest,"backtest"),ids=new Set([pin.value.lineageManifestId,backtest.lineageManifestId]);let expiry=Math.min(pin.value.expiresAt.getTime(),backtest.expiresAt.getTime());
 for(const point of backtest.series){const observation=await businessMetricService(tx).inspectCurrentObservation(companyId,actor,point.observationId);ids.add(observation.lineageManifestId);expiry=Math.min(expiry,Date.parse(observation.expiresAt));}
 return {value:{specId,key:row.key,versionId,definition:pin.value.definition,grade:"native_definition" as const,currentQualification:qualification.currentQualification,publishedAt:publication.publishedAt.toISOString(),measurement:null},manifestIds:[...ids].sort(),expiresAt:new Date(expiry)};
}
