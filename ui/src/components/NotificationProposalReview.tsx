import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotificationProposal, applyNotificationProposal } from "@/api/notification-proposals";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";

/** Review the actual account owner. A lost write response permits only a fresh
 * read; it never automatically resubmits a preference change. */
const time=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
export function NotificationProposalReview({company,principal,id}:{company:string;principal:string;id:string}){
  const {t}=useTranslation("experience"),authority=useV9PrivateReadAuthority(principal),client=useQueryClient();
  const {selectedCompanyId}=useCompany(),[open,setOpen]=useState(false),[epoch,setEpoch]=useState(0),source=useRef(0);
  const [sending,setSending]=useState(false),[unknown,setUnknown]=useState(false),attempt=useRef<string|null>(null);
  const scope=useRef({company,principal,id,selectedCompanyId});scope.current={company,principal,id,selectedCompanyId};
  const current=()=>authority.canRead()&&scope.current.company===company&&scope.current.principal===principal&&scope.current.id===id&&scope.current.selectedCompanyId===company&&source.current===epoch;
  const prefix=["notification-proposal",company,principal,id],key=[...prefix,authority.epoch,epoch];
  const query=useQuery({queryKey:key,enabled:open&&authority.readReady&&selectedCompanyId===company,retry:false,gcTime:0,staleTime:0,
    queryFn:({signal})=>authority.read(async()=>{if(!current())throw new Error("Notification source changed");
      const result=await getNotificationProposal(company,principal,id,signal);if(!current())throw new Error("Notification source changed");return result;})});
  useCompanyLiveEvent(event=>{if(event.companyId===company&&/notification|permission|membership|erased|deleted|withdraw|conversation|issue/i.test(`${event.payload.entityType}:${event.payload.action}`)){
    source.current++;setEpoch(source.current);void client.cancelQueries({queryKey:prefix});void client.invalidateQueries({queryKey:prefix,refetchType:"none"});
  }});
  const state=client.getQueryState(key),fresh=current()&&query.isSuccess&&!query.isFetching&&!state?.isInvalidated;
  async function apply(){
    if(!fresh||!query.data.requiresHumanReview||sending||unknown)return;
    const requestId=crypto.randomUUID();attempt.current=requestId;setSending(true);
    try{await authority.write(()=>applyNotificationProposal(company,principal,id,{requestId,expectedProposalVersion:query.data.version,expectedBaselineHash:query.data.baselineHash}));
      if(current())await query.refetch();
    }catch{if(current())setUnknown(true);}finally{setSending(false);}
  }
  if(!current())return null;
  if(!open)return <Button variant="outline" className="min-h-11" onClick={()=>setOpen(true)}>{t("notificationProposal.review")}</Button>;
  return <div className="space-y-3">
    {!fresh?<p role="status">{t(query.isError?"notificationProposal.unavailable":"notificationProposal.checking")}</p>:<>
      <p>{t(`notifications.category.${query.data.category}`)}</p>
      <p>{t(query.data.preference.emailEnabled?"notificationProposal.emailEnabled":"notificationProposal.emailDisabled")}</p>
      {query.data.preference.policy&&<><p>{t(`notifications.delivery.${query.data.preference.policy.cadence}`)}</p><p>{query.data.preference.policy.timezone}</p>
        {query.data.preference.policy.cadence==="digest"&&<p>{t("notificationProposal.digestTime",{time:time(query.data.preference.policy.digestMinute)})}</p>}
        {query.data.preference.policy.quietHours&&<p>{t("notificationProposal.quietHours",{start:time(query.data.preference.policy.quietHours.startMinute),end:time(query.data.preference.policy.quietHours.endMinute)})}</p>}</>}
      <p>{t(query.data.preferenceApplied?"notificationProposal.applied":"notificationProposal.consequence")}</p>
      {query.data.baselineChanged&&!query.data.preferenceApplied&&<p>{t("notificationProposal.baselineChanged")}</p>}
      {unknown&&<p role="status">{t(query.data.confirmationRequestId===attempt.current?"notificationProposal.confirmed":"notificationProposal.unknown")}</p>}
      {query.data.requiresHumanReview&&!unknown&&<Button className="min-h-11" disabled={sending} onClick={()=>void apply()}>{t(sending?"notificationProposal.applying":"notificationProposal.apply")}</Button>}
    </>}
    <Button variant="outline" className="min-h-11" disabled={sending} onClick={()=>{if(current())void query.refetch();}}>{t("notificationProposal.refresh")}</Button>
  </div>;
}
