import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, ToggleField } from "./agent-config-primitives";
import { Button } from "./ui/button";
import { jevDecisionApi } from "../api/jev-decisions";
import type { JevDecisionMode, JevDecisionSettingsUpdate } from "@paperclipai/shared";

export function JevSkillSuggestionSettings({ companyId }: { companyId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["jev-skill-decisions", companyId], queryFn: () => jevDecisionApi.get(companyId) });
  const [mode, setMode] = useState<JevDecisionMode>("off"), [allowBackground, setAllowBackground] = useState(false);
  const [connectionId, setConnectionId] = useState(""), [grantId, setGrantId] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setMode(query.data.settings.mode); setAllowBackground(query.data.settings.allowBackground);
    setConnectionId(query.data.settings.connectionId ?? ""); setGrantId(query.data.settings.grantId ?? "");
  }, [query.data]);
  const mutation = useMutation({ mutationFn: (input: JevDecisionSettingsUpdate) => jevDecisionApi.update(companyId, input),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["jev-skill-decisions", companyId] }); } });
  const selected = query.data?.choices.find(item => item.id === connectionId && item.grantId === grantId);
  const next = { mode, allowBackground, connectionId: connectionId || null, grantId: grantId || null } satisfies JevDecisionSettingsUpdate;
  return <section className="max-w-2xl space-y-4" aria-labelledby="jev-skill-suggestions-title">
    <div className="space-y-1"><h2 id="jev-skill-suggestions-title" className="text-sm font-medium">Optional Skill suggestions</h2>
      <p className="text-xs text-muted-foreground">Jev 1.13 can compare permission-filtered Skill candidates in shadow mode. Native deterministic resolution remains authoritative; required Skills never change. Task intent and short Skill descriptors are sent to OpenRouter using the selected company account. Nothing is sent while this setting is off.</p></div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading decision settings…</p> : query.isError ? <p className="text-sm text-destructive">Could not load decision settings.</p> : <>
      <Field label="Mode" hint="User-visible suggestions stay unavailable until a separate evaluation profile is qualified.">
        <select className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm" value={mode} onChange={event => setMode(event.target.value as JevDecisionMode)}>
          <option value="off">Off</option><option value="shadow">Shadow evaluation</option><option value="suggestions" disabled>Suggestions (not qualified)</option>
        </select>
      </Field>
      <Field label="Company OpenRouter account" hint="A shared API-key connection installed for this company or Co-worker is required.">
        <select className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm" value={connectionId} onChange={event => {
          const option = query.data?.choices.find(item => item.id === event.target.value); setConnectionId(option?.id ?? ""); setGrantId(option?.grantId ?? "");
        }}>
          <option value="">No account selected</option>{query.data?.choices.map(item => <option key={`${item.id}:${item.grantId}`} value={item.id}>{item.name} · {item.model}</option>)}
        </select>
      </Field>
      <ToggleField label="Allow background shadow checks" hint="This must be explicitly enabled. Turning it off prevents new calls; an already-dispatched request may still settle." checked={allowBackground} onChange={setAllowBackground} />
      <p className="text-xs text-muted-foreground">No operator-qualified Jev profile is active here, so enabling these settings alone cannot dispatch a paid request. A qualified company processing policy must explicitly allow this route’s US processing region; EU-only company policies are blocked.</p>
      <div className="flex items-center gap-3"><Button size="sm" disabled={mutation.isPending || !selected && mode !== "off"} onClick={() => mutation.mutate(next)}>{mutation.isPending ? "Saving…" : "Save Skill decision settings"}</Button>
        {mutation.isSuccess && <span className="text-xs text-muted-foreground">Saved</span>}{mutation.isError && <span className="text-xs text-destructive">{mutation.error instanceof Error ? mutation.error.message : "Could not save settings"}</span>}</div>
    </>}
  </section>;
}
