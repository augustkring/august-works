import {z} from "zod";
import {and,eq} from "drizzle-orm";
import {analyticalLineageEdges,analyticalLineageManifests,businessMetricVersions,type Db} from "@paperclipai/db";
import {managementChatToolSchemas,type ManagementChatToolName,type AnalyticalContextAuthorityPin,type DecisionEvidenceReference,type CapturedManagementSource} from "@paperclipai/shared";
import type {AuthorizationActor} from "../authorization.js";
import {HttpError,conflict,forbidden,unprocessable} from "../../errors.js";
import {withNativeAnalyticalReader} from "../analytical-reader.js";
import {withAnalyticalConversationRetention} from "../analytical-context-privacy.js";

const descriptions:Record<ManagementChatToolName,string>={
 list_business_metrics:"Discover a bounded current-authorized page of human-published metric definitions with exact version pins. Definitions are metadata, not measurements; an empty page is not a company census.",
 list_forecasts:"Discover a bounded current-authorized page of human-published Forecast specifications and their original qualification provenance. Preserve current qualification and do not call metadata a predicted actual.",
 query_business_metric:"Observe one exact human-published native metric in a bounded declared window. Cite its observation and original lineage; this is no forecast or causal claim.",
 compare_business_metrics:"Compare two exact native observations. Incompatible or unfinished windows remain unknown; a descriptive change does not establish its cause.",
 explain_metric_lineage:"Read the complete current-authorized original lineage of one exact native observation. Source identifiers grant no access.",
 list_process_findings:"Read a bounded page of human-recorded findings for one exact native Process run. Preserve observed facts and human interpretation separately.",
 analyze_process_scope:"Derive a bounded Process result from one human-published definition and declared window. No arbitrary SQL, people ranking or causal attribution.",
 get_decision_context:"Read one exact native Decision context version with its original citations, assumptions and uncertainty. This cannot prepare, approve or choose an option.",
 review_decision_outcome:"Read the exact native human outcome-review revision. Preserve all separate judgments and actual-execution evidence; this never records a new judgment.",
 compare_scenarios:"Read two to four exact cited scenario outputs side by side. Conditional simulations are not forecasts, actual outcomes or execution authority.",
 get_experiment_result:"Read the complete exact human-interpreted native Experiment evidence, including primary and guardrail results. Never turn a proxy into verified Task impact.",
 propose_management_action:"Prepare an advisory action preview citing current native evidence for explicit human review. This neither publishes nor executes a Decision, Experiment, Task or project change.",
};
export const MANAGEMENT_ANALYTICAL_TOOL_DEFINITIONS=Object.entries(managementChatToolSchemas).map(([name,schema])=>({name,description:descriptions[name as ManagementChatToolName],inputSchema:z.toJSONSchema(schema,{target:"draft-7"})}));
export function isManagementAnalyticalTool(name:string):name is ManagementChatToolName{return Object.hasOwn(managementChatToolSchemas,name);}

/** Catalog availability is server-derived. Execution independently repeats the
 * persisted private conversation, responsible human and source-owner checks. */
export async function nativeManagementToolsAvailable(db:Db,binding:{companyId:string;agentId:string;runId:string},responsibleUserId:string|null){
 try{return await withNativeAnalyticalReader(db,binding.companyId,{type:"agent",source:"agent_jwt",...binding,onBehalfOfUserId:responsibleUserId},async()=>true,"conversation");}
 catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))return false;throw error;}
}

export async function executeManagementAnalyticalTool(db:Db,companyId:string,actor:AuthorizationActor,name:ManagementChatToolName,raw:unknown){
 if(actor.type!=="agent")throw forbidden("Management tools require their native bound conversation");
 // Parse before source access. Unknown identity/prose/value fields are rejected.
 managementChatToolSchemas[name].parse(raw);
 return withAnalyticalConversationRetention<unknown>(db,companyId,actor,async tx=>{
  const {businessMetricService}=await import("../business-metrics/service.js");
  const {captureAnalyticalEvidence}=await import("../analytical-evidence.js");
  let result:unknown,pins:AnalyticalContextAuthorityPin[]=[];
  const evidence=async(sources:DecisionEvidenceReference[])=>{
   pins=sources.map(source=>({kind:"analytical_evidence",source}));
   return captureAnalyticalEvidence(tx,companyId,actor,{sensitivity:"confidential",retentionDays:3650,evidence:sources.map((source,index)=>({key:`source_${index}`,source}))},performance.now()+30000);
  };
  switch(name){
   case "list_business_metrics":{
    const input=managementChatToolSchemas[name].parse(raw),page=await businessMetricService(tx).list(companyId,actor,input.cursor),rows=page.items.slice(0,input.limit);
    if(!rows.length)return {result:[],sourceManifestIds:[],retentionUntil:new Date(),authorityPins:[]};
    const {captureMetricDefinitionDisclosure}=await import("../business-metrics/definition-disclosure.js"),items=[];
    for(const row of rows){if(!row.publishedVersionId)throw conflict("The current native metric publication is unavailable");const source=await captureMetricDefinitionDisclosure(tx,companyId,actor,row.id,row.publishedVersionId);items.push(source.value);pins.push({kind:"metric_definition",metricId:row.id,versionId:row.publishedVersionId,manifestId:source.manifestId});}
    result={items,nextCursor:page.items.length>input.limit?rows.at(-1)!.id:page.nextCursor,coverage:"bounded_current_authorized_page"};break;
   }
   case "list_forecasts":{
    const input=managementChatToolSchemas[name].parse(raw),{businessForecastService}=await import("../business-forecasting/service.js"),page=await businessForecastService(tx).listPublishedForNativeReader(companyId,actor,input.cursor,input.limit);
    if(!page.items.length)return {result:[],sourceManifestIds:[],retentionUntil:new Date(),authorityPins:[]};
    pins=page.items.map(item=>({kind:"forecast_specification",specId:item.value.specId,versionId:item.value.versionId}));result={items:page.items.map(item=>item.value),nextCursor:page.nextCursor,coverage:"bounded_current_authorized_page"};break;
   }
   case "query_business_metric":{
    const input=managementChatToolSchemas[name].parse(raw),value=await businessMetricService(tx).query(companyId,actor,input);
    pins=[{kind:"analytical_evidence",source:{type:"metric_observation",id:value.id,metricId:value.metricId,metricVersionId:value.versionId}}];
    result={grade:"native_observation",observation:value,limitations:["Created-in-window current state; no reconstructed historical period-end state or causal attribution."]};break;
   }
   case "compare_business_metrics":{
    const input=managementChatToolSchemas[name].parse(raw),captured=await evidence([input.before,input.after]);
    const ledger=new Map<string,CapturedManagementSource>();
    for(const [key,source] of [["before",input.before],["after",input.after]] as const){
     const observation=await businessMetricService(tx).inspectCurrentObservation(companyId,actor,source.id);
     const [version]=await tx.select().from(businessMetricVersions).where(and(eq(businessMetricVersions.companyId,companyId),eq(businessMetricVersions.id,source.metricVersionId))).for("share");
     if(!version)throw conflict("Native metric comparison definition is unavailable");
     const item=captured.evidence[key==="before"?0:1]!;
     ledger.set(key,{key,source:{kind:"analytical",reference:source},sourceHash:item.sourceHash,capturedAt:item.capturedAt,expiresAt:item.expiresAt,grade:"native_observation",facts:item.facts,limitations:item.limitations,metric:{observation,unit:version.definition.unit,timeSemantics:version.definition.timeSemantics}});
    }
    const {composeManagementComparisons}=await import("../management-reviews/kernel.js");
    result={claims:composeManagementComparisons({comparisons:[{key:"selected_windows",kind:"metric_change",leftSourceKey:"before",rightSourceKey:"after"}]},ledger,new Date().toISOString())};break;
   }
   case "explain_metric_lineage":{
    const {source}=managementChatToolSchemas[name].parse(raw);await evidence([source]);
    const value=await businessMetricService(tx).inspectCurrentObservation(companyId,actor,source.id);
    const [manifest]=await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId,companyId),eq(analyticalLineageManifests.id,value.lineageManifestId))).for("share");
    const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,value.lineageManifestId))).limit(20066);
    if(!manifest||edges.length>20065)throw conflict("The complete native metric lineage is unavailable");result={source,manifest,edges};break;
   }
   case "list_process_findings":{
    const input=managementChatToolSchemas[name].parse(raw),{processFindingService}=await import("../process-findings.js");
    const page=await processFindingService(tx).list(companyId,actor,input.definitionId,input.runId,input.cursor),items=page.items.slice(0,input.limit);
    pins=[{kind:"process_run",definitionId:input.definitionId,runId:input.runId},...items.map(item=>({kind:"analytical_evidence" as const,source:{type:"process_finding" as const,id:item.id,definitionId:input.definitionId,runId:input.runId}}))];
    result={...page,items,nextCursor:page.items.length>input.limit?items.at(-1)!.id:page.nextCursor,coverage:"bounded_current_authorized_page"};break;
   }
   case "analyze_process_scope":{
    const input=managementChatToolSchemas[name].parse(raw),{processAnalysisService}=await import("../process-analysis.js"),value=await processAnalysisService(tx).run(companyId,actor,input.definitionId,input.analysis);
    pins=[{kind:"process_run",definitionId:input.definitionId,runId:value.id}];result={grade:"native_observation",run:value};break;
   }
   case "get_decision_context":{
    const input=managementChatToolSchemas[name].parse(raw),{decisionIntelligenceService}=await import("../decision-intelligence.js"),view=await decisionIntelligenceService(tx).detail(companyId,actor,input.decisionId),version=view.versions.find(item=>item.id===input.versionId);
    if(!version)throw conflict("The exact native Decision version is unavailable");pins=[{kind:"decision_context",decisionId:input.decisionId,versionId:input.versionId}];result={decisionId:input.decisionId,version,binding:view.binding};break;
   }
   case "review_decision_outcome":{
    const input=managementChatToolSchemas[name].parse(raw),{decisionOutcomeReviewService}=await import("../decision-outcome-reviews.js"),view=await decisionOutcomeReviewService(tx).detail(companyId,actor,input.decisionId);
    if(!view||view.revision!==input.revision)throw conflict("The exact native outcome review revision is unavailable");pins=[{kind:"outcome_review",...input}];result={grade:"native_outcome_review",review:view};break;
   }
   case "compare_scenarios":{
    const input=managementChatToolSchemas[name].parse(raw),captured=await evidence(input.sources);
    result={grade:"conditional_scenario",sources:captured.evidence,limitations:["Side-by-side declared simulation outputs; no implicit weighting, causal effect, optimum or business execution."]};break;
   }
   case "get_experiment_result":{
    const input=managementChatToolSchemas[name].parse(raw),captured=await evidence([input.source]);result={grade:"human_interpreted_experiment",evidence:captured.evidence[0]};break;
   }
   case "propose_management_action":{
    const input=managementChatToolSchemas[name].parse(raw),captured=await evidence(input.sources);
    result={kind:"management_action_preview",action:input.action,rationale:input.rationale,evidence:captured.evidence,humanReviewRequired:true,executionAuthority:"advisory_only",limitations:["Assistant-proposed rationale is not a human decision or validated causal explanation. No business object was created or published."]};break;
   }
  }
  const payload={tool:name,citations:pins,result,executionAuthority:"read_only_or_advisory"};
  if(Buffer.byteLength(JSON.stringify(payload),"utf8")>256000)throw unprocessable("The complete management result exceeds its bounded output budget");
  return {result:payload,retentionUntil:new Date(Date.now()+300000),authorityPins:pins};
 });
}
