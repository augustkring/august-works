import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { V5Error } from "@/components/V5Gate";

export function NewGovernedSkill() {
  const { selectedCompanyId } = useCompany(), { setBreadcrumbs } = useBreadcrumbs(), navigate = useNavigate();
  const [key, setKey] = useState(""), [name, setName] = useState(""), [description, setDescription] = useState(""), [markdown, setMarkdown] = useState(""), [triggers, setTriggers] = useState(""), [excludes, setExcludes] = useState(""), [shared, setShared] = useState(false);
  const terms = (text: string) => [...new Set(text.split(",").map((term) => term.trim()).filter(Boolean))];
  const create = useMutation({ mutationFn: () => api.post<{ skillId: string }>(`/companies/${selectedCompanyId}/skills/governed-drafts`, { slug: key, name, description, markdown, triggerTerms: terms(triggers), excludeTerms: terms(excludes), sharing: shared ? "company_proposed" : "private_draft" }), onSuccess: (result) => navigate(`/skills/${result.skillId}/governance`) });
  useEffect(() => { setBreadcrumbs([{ label: "Skills", href: "/skills/studio" }, { label: "New governed procedure" }]); }, [setBreadcrumbs]);
  return <main className="mx-auto max-w-4xl space-y-6 p-6"><div><h1 className="text-2xl font-semibold">New governed Skill</h1><p className="text-sm text-muted-foreground">Define a procedure and its task triggers. Evaluation and review are required before it becomes active.</p></div><V5Error error={create.error} /><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm"><span className="block">Stable local key</span><Input value={key} onChange={(event) => setKey(event.target.value)} pattern="[a-z0-9][a-z0-9_-]*" maxLength={100} required /></label><label className="space-y-1 text-sm"><span className="block">Name</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required /></label></div><label className="block space-y-1 text-sm"><span>Description</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label><label className="block space-y-1 text-sm"><span>Procedure (SKILL.md)</span><Textarea rows={14} value={markdown} onChange={(event) => setMarkdown(event.target.value)} maxLength={100000} required /></label><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm"><span className="block">Task trigger phrases, comma separated</span><Input value={triggers} onChange={(event) => setTriggers(event.target.value)} placeholder="database migration, schema change" required /></label><label className="space-y-1 text-sm"><span className="block">Excluded task phrases, comma separated</span><Input value={excludes} onChange={(event) => setExcludes(event.target.value)} placeholder="explain only, no changes" /></label></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />Propose this draft to the current company</label><div className="flex justify-end"><Button disabled={create.isPending || terms(triggers).length === 0}>Create draft for evaluation</Button></div></form></main>;
}
