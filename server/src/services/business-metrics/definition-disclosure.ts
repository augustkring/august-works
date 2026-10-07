import {randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {analyticalLineageEdges,analyticalLineageManifests,type Db} from "@paperclipai/db";
import type {AuthorizationActor} from "../authorization.js";
import {businessMetricService} from "./service.js";
import {currentMetricPurpose} from "./purpose.js";
import {nativeSha256} from "../native-runtime/canonical.js";
import {analyticalRequesterId} from "../analytical-reader.js";
import {assertMemorySourcesRetained} from "../memory/memory-privacy.js";
import {conflict} from "../../errors.js";

type Edge=Pick<typeof analyticalLineageEdges.$inferInsert,"inputType"|"inputRef"|"inputHash"|"relationship">;
const ENGINE="aw-native-metric-definition-disclosure-v1";
/** Private native metadata disclosure, not an observation or population. The
 * caller holds company then Memory and the current retained-reader permit. */
async function material(tx:Db,companyId:string,actor:AuthorizationActor,metricId:string,versionId:string){
 const view=await businessMetricService(tx).inspectPublishedDefinition(companyId,actor,metricId,versionId),policies=await currentMetricPurpose(tx,companyId,view.version.definition);
 await assertMemorySourcesRetained(tx,companyId,[{sourceProvider:"august_works_analytical_input",sourceRef:`metric_version://${versionId}`},...policies.map(policy=>({sourceProvider:"august_works_analytical_input",sourceRef:`governance_obligation://${policy.id}`}))]);
 const calculation=view.version.definition.calculation,population=calculation.kind==="native_count"?calculation.population:calculation.kind==="native_ratio"?calculation.denominator:null;
 const edges:Edge[]=[{inputType:"metric_version",inputRef:versionId,inputHash:view.version.contentHash,relationship:"definition"},...policies.map(policy=>({inputType:"governance_obligation" as const,inputRef:policy.id,inputHash:policy.obligationHash,relationship:"policy" as const})),...(population?.entity==="issue"&&population.projectId?[{inputType:"project" as const,inputRef:population.projectId,inputHash:nativeSha256({type:"project",id:population.projectId}),relationship:"source" as const}]:[])];
 edges.sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
 const value={metricId,key:view.metric.key,versionId,definition:view.version.definition,grade:"native_definition" as const,measurement:null};
 const expiresAt=new Date(Math.min(Date.now()+view.version.definition.retentionDays*86400000,view.version.createdAt.getTime()+view.version.definition.reviewFrequencyDays*86400000,...policies.flatMap(p=>[p.nextReviewAt.getTime(),Date.parse(p.obligation.nextReviewAt),p.obligation.effectiveUntil?Date.parse(p.obligation.effectiveUntil):Infinity])));
 if(expiresAt<=new Date())throw conflict("Native metric metadata retention is unavailable");
 return {value,version:view.version,edges,expiresAt};
}
export async function captureMetricDefinitionDisclosure(tx:Db,companyId:string,actor:AuthorizationActor,metricId:string,versionId:string){
 const current=await material(tx,companyId,actor,metricId,versionId),id=randomUUID(),createdAt=new Date();
 await tx.insert(analyticalLineageManifests).values({id,companyId,analysisType:"metric_definition_disclosure",analysisRef:versionId,engineVersion:ENGINE,inputHash:nativeSha256(current.value),definitionHash:current.version.contentHash,requestedBy:analyticalRequesterId(actor),sourceWatermark:createdAt.toISOString(),sourceCount:0,parameters:{metricId,versionId,lineageHash:nativeSha256(current.edges)},createdAt,expiresAt:current.expiresAt});
 await tx.insert(analyticalLineageEdges).values(current.edges.map(edge=>({...edge,companyId,manifestId:id})));
 return {...current,manifestId:id};
}
export async function inspectMetricDefinitionDisclosure(tx:Db,companyId:string,actor:AuthorizationActor,pin:{metricId:string;versionId:string;manifestId:string}){
 const current=await material(tx,companyId,actor,pin.metricId,pin.versionId);
 const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,pin.manifestId))).for("share");
 const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,pin.manifestId))).limit(19);
 const sourceEdges=edges.map(({inputType,inputRef,inputHash,relationship})=>({inputType,inputRef,inputHash,relationship})).sort((a,b)=>`${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
 if(!manifest||manifest.expiresAt<=new Date()||manifest.analysisType!=="metric_definition_disclosure"||manifest.analysisRef!==pin.versionId||manifest.engineVersion!==ENGINE||manifest.sourceCount!==0||manifest.definitionHash!==current.version.contentHash||manifest.inputHash!==nativeSha256(current.value)||manifest.parameters.metricId!==pin.metricId||manifest.parameters.versionId!==pin.versionId||manifest.parameters.lineageHash!==nativeSha256(current.edges)||nativeSha256(sourceEdges)!==nativeSha256(current.edges))throw conflict("Exact native metric metadata provenance is unavailable");
 return {manifestId:manifest.id,expiresAt:new Date(Math.min(manifest.expiresAt.getTime(),current.expiresAt.getTime()))};
}
