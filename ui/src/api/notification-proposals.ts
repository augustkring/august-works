import { notificationPreferenceProposalViewSchema, notificationPreferenceProposalConfirmSchema } from "@paperclipai/shared";
import { api } from "./client";
const path=(company:string,principal:string,id:string)=>{
  notificationPreferenceProposalViewSchema.shape.companyId.parse(company);notificationPreferenceProposalViewSchema.shape.id.parse(id);
  return `/companies/${company}/notifications/preference-proposals/${id}?${new URLSearchParams({expectedUserId:principal})}`;
};
function receipt(raw:unknown,company:string,id:string){
  const result=notificationPreferenceProposalViewSchema.parse(raw);
  if(result.companyId!==company||result.id!==id)throw new Error("Notification proposal scope changed");return result;
}
export async function getNotificationProposal(company:string,principal:string,id:string,signal?:AbortSignal){
  const result=receipt(await api.get(path(company,principal,id),{signal,cache:"no-store"}),company,id);signal?.throwIfAborted();return result;
}
export async function applyNotificationProposal(company:string,principal:string,id:string,input:unknown){
  const confirmation=notificationPreferenceProposalConfirmSchema.parse(input);
  const base=path(company,principal,id),[route,query]=base.split("?");
  const result=receipt(await api.post(`${route}/apply?${query}`,confirmation),company,id);
  if(result.confirmationRequestId!==confirmation.requestId||!result.preferenceApplied)throw new Error("Notification confirmation could not be verified");
  return result;
}
