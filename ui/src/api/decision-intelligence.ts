import type {DecisionContextView,ProposeDecisionContext,PrepareDecisionContext,WithdrawPreparedDecisionContext,ManagementSourceOptions} from "@paperclipai/shared";
import {api} from "./client";
const path=(companyId:string,decisionId:string,suffix:string,userId?:string)=>`/companies/${encodeURIComponent(companyId)}/decisions/${encodeURIComponent(decisionId)}/context${suffix}${userId?`?${new URLSearchParams({expectedUserId:userId})}`:""}`;
export const decisionIntelligenceApi={
  scopeSources:(companyId:string,kind:"project"|"issue",userId?:string)=>api.get<ManagementSourceOptions>(`/companies/${encodeURIComponent(companyId)}/decision-context-source-options?${new URLSearchParams({kind,...(userId?{expectedUserId:userId}:{})})}`,{cache:"no-store"}),
  detail:(companyId:string,decisionId:string,userId?:string)=>api.get<DecisionContextView>(path(companyId,decisionId,"",userId),{cache:"no-store"}),
  propose:(companyId:string,decisionId:string,input:ProposeDecisionContext,userId?:string)=>api.post<DecisionContextView>(path(companyId,decisionId,"/versions",userId),input),
  prepare:(companyId:string,decisionId:string,input:PrepareDecisionContext,userId?:string)=>api.post<DecisionContextView>(path(companyId,decisionId,"/prepare",userId),input),
  withdraw:(companyId:string,decisionId:string,input:WithdrawPreparedDecisionContext,userId?:string)=>api.post<{revision:number;preparedVersionId:null}>(path(companyId,decisionId,"/withdraw",userId),input),
};
