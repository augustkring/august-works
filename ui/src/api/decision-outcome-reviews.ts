import type {DecisionOutcomeReviewView,ScheduleDecisionOutcomeReview,TransitionDecisionOutcomeReview,FinishDecisionOutcomeReview} from "@paperclipai/shared";
import {api} from "./client";
const path=(companyId:string,decisionId:string,suffix:string,userId?:string)=>`/companies/${encodeURIComponent(companyId)}/decisions/${encodeURIComponent(decisionId)}/context/outcome-review${suffix}${userId?`?${new URLSearchParams({expectedUserId:userId})}`:""}`;
export const decisionOutcomeReviewsApi={
  detail:(companyId:string,decisionId:string,userId?:string)=>api.get<DecisionOutcomeReviewView|null>(path(companyId,decisionId,"",userId),{cache:"no-store"}),
  schedule:(companyId:string,decisionId:string,input:ScheduleDecisionOutcomeReview,userId?:string)=>api.post<DecisionOutcomeReviewView>(path(companyId,decisionId,"",userId),input),
  transition:(companyId:string,decisionId:string,input:TransitionDecisionOutcomeReview,userId?:string)=>api.post<DecisionOutcomeReviewView>(path(companyId,decisionId,"/transition",userId),input),
  finish:(companyId:string,decisionId:string,input:FinishDecisionOutcomeReview,userId?:string)=>api.post<DecisionOutcomeReviewView>(path(companyId,decisionId,"/finish",userId),input),
};
