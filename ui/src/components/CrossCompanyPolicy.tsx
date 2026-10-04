import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CrossCompanyPolicy as Policy } from "@paperclipai/shared";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { V5Error } from "@/components/V5Gate";

export function CrossCompanyPolicy({ companyId }: { companyId: string }) {
  const cache = useQueryClient(), key = ["v5-cross-company-policy", companyId];
  const query = useQuery({ queryKey: key, queryFn: () => api.get<Policy>(`/companies/${companyId}/cross-company/policy`) });
  const save = useMutation({ mutationFn: (policy: Policy) => api.put(`/companies/${companyId}/cross-company/policy`, policy), onSuccess: () => cache.invalidateQueries({ queryKey: key }) });
  return <Card><CardHeader><CardTitle>Current company delegation policy</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">A company administrator can permit guest scopes here. Each run still requires explicit scope, current local agent permissions and the represented human’s permissions. Restricted and private evidence stays excluded.</p><V5Error error={query.error ?? save.error} />{query.data && <PolicyForm key={JSON.stringify(query.data)} policy={query.data} busy={save.isPending} onSave={(policy) => save.mutate(policy)} />}{save.isSuccess && <p role="status" className="text-sm">Company delegation policy saved.</p>}</CardContent></Card>;
}

function PolicyForm({ policy, busy, onSave }: { policy: Policy; busy: boolean; onSave: (policy: Policy) => void }) {
  const [value, setValue] = useState(policy);
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(value); }}><div className="flex flex-wrap gap-4">{(["allowRead", "allowContribute", "allowAct"] as const).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value[key]} onChange={(event) => setValue({ ...value, [key]: event.target.checked })} />{key === "allowRead" ? "Allow delegated read" : key === "allowContribute" ? "Allow reviewed contributions" : "Allow explicitly scoped actions"}</label>)}</div><fieldset className="space-y-2"><legend className="text-sm font-medium">Evidence classifications permitted in delegated context</legend><div className="flex flex-wrap gap-4">{(["public", "internal", "confidential"] as const).map((classification) => <label key={classification} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.allowedSensitivities.includes(classification)} onChange={(event) => setValue({ ...value, allowedSensitivities: event.target.checked ? [...value.allowedSensitivities, classification] : value.allowedSensitivities.filter((item) => item !== classification) })} />{classification}</label>)}</div></fieldset><div className="flex justify-end"><Button disabled={busy}>Save company delegation policy</Button></div></form>;
}
