import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { Button } from "@/components/ui/button";

export function SaasRuntimeBackupSchedule({companyId,userId,cellId}:{companyId:string;userId:string;cellId:string}) {
  const policy=useQuery({queryKey:["saas-backup-policy",userId,companyId,cellId],queryFn:()=>saasApi.backupPolicy(companyId,userId,cellId),refetchInterval:15000});
  const [enabled,setEnabled]=useState(false),[pause,setPause]=useState(false),[hours,setHours]=useState(24);
  useEffect(()=>{setEnabled(policy.data?.enabled??false);setPause(policy.data?.allowBriefPause??false);setHours(policy.data?.intervalHours??24);},[policy.data?.version]);
  const save=useMutation({mutationFn:()=>saasApi.configureBackupPolicy(companyId,userId,cellId,{enabled,allowBriefPause:pause,intervalHours:hours,expectedVersion:policy.data?.version??0}),onSuccess:()=>policy.refetch()});
  const error=policy.error??save.error;
  return <section className="saas-section"><h3 className="saas-subtitle">Scheduled safety backups</h3>
    <p className="saas-muted">Backups are encrypted and kept for the retention period. They do not use your application storage allowance. Restoring a backup requires reconnecting credentials and qualifying the agent again.</p>
    {error&&<p role="alert" className="saas-error">{error.message}</p>}
    {policy.data&&<p>Last verified backup: {policy.data.lastSuccessAt?new Date(policy.data.lastSuccessAt).toLocaleString():"None from this schedule yet"}. {policy.data.phase!=="idle"?"A backup window is in progress.":"Next check: "+new Date(policy.data.nextDueAt).toLocaleString()}</p>}
    {policy.data?.errorCode&&<p role="status">This schedule needs attention. Check runtime and backup status before starting another window.</p>}
    <form onSubmit={event=>{event.preventDefault();save.mutate();}}>
      <label className="saas-label"><input type="checkbox" checked={enabled} disabled={save.isPending} onChange={event=>setEnabled(event.target.checked)}/> Enable scheduled backups</label>
      <label className="saas-label">Frequency<select className="saas-input" value={hours} disabled={save.isPending} onChange={event=>setHours(Number(event.target.value))}><option value={24}>Daily</option><option value={168}>Weekly</option></select></label>
      <label className="saas-label"><input type="checkbox" checked={pause} disabled={save.isPending} onChange={event=>setPause(event.target.checked)}/> Allow a brief runtime pause and resume after verification</label>
      <p className="saas-muted">Without this approval, backups wait until you stop the runtime. Automatic resume applies only to a runtime this schedule stopped, with current billing access. Agent budget pauses remain in place. Disabling a schedule prevents further steps; an already accepted stop may still finish.</p>
      <div className="saas-footer"><Button type="button" variant="ghost" disabled={save.isPending} onClick={()=>{setEnabled(policy.data?.enabled??false);setPause(policy.data?.allowBriefPause??false);setHours(policy.data?.intervalHours??24);save.reset();}}>Cancel</Button><Button type="submit" disabled={policy.isPending||Boolean(policy.error)||save.isPending}>Save backup schedule</Button></div>
      {save.isSuccess&&<p role="status">Backup schedule saved.</p>}
    </form>
  </section>;
}
