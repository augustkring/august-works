import type {Db} from "@paperclipai/db";
import {managementReviewDefinitionSchema,type DecisionEvidenceReference} from "@paperclipai/shared";
import {aiGovernanceService} from "../../services/ai-governance/governance-service.js";
import {instanceSettingsService} from "../../services/instance-settings.js";
import {managementReviewService} from "../../services/management-reviews/service.js";
import {analyticalPurpose} from "./business-metric-fixture.js";
/** Real native owner capture around already-qualified synthetic source fixtures.
 * No copied results, source hashes, fake task outcomes or operational claims. */
export async function managementAnalyticalFixture(db:Db,companyId:string,references:DecisionEvidenceReference[]) {
 const actor={type:"board" as const,source:"local_implicit" as const};await instanceSettingsService(db,{runtimeEnv:{}}).updateExperimental({management_reviews_v8:true});
 const purpose=analyticalPurpose();purpose.citation="Synthetic native management evidence review";purpose.analyticalPurpose!.capabilities=["reviews"];const policy=(await aiGovernanceService(db).obligation(actor,companyId,purpose)).id,now=new Date();
 const definition=managementReviewDefinitionSchema.parse({name:"Human review of exact synthetic native analysis",reviewType:"weekly_leadership",period:{from:new Date(now.getTime()-86400000).toISOString(),until:now.toISOString()},purpose:"management_intelligence",sensitivity:"internal",retentionDays:1,governanceObligationRefs:[policy],sources:references.map((reference,index)=>({key:`source_${index}`,source:{kind:"analytical",reference}})),agenda:[{key:"inspect",category:"INVESTIGATE",ownerUserId:"local-board",dueAt:new Date(now.getTime()+86400000).toISOString(),sourceKeys:references.map((_,index)=>`source_${index}`),nextAction:"Human inspects exact evidence and limitations before any native action",hypothesis:null}]});
 const owner=managementReviewService(db),created=await owner.create(companyId,actor,definition),original=await owner.detail(companyId,actor,created.id);
 return {owner,created,original,definition,read:()=>owner.detail(companyId,actor,created.id),recapture:()=>owner.create(companyId,actor,definition),publish:()=>owner.publish(companyId,actor,created.id,{expectedContentHash:created.contentHash,rationale:"Human explicitly acknowledges every source limitation before publication",evidenceAndUncertaintyAcknowledged:true,supersedesId:null})};
}
