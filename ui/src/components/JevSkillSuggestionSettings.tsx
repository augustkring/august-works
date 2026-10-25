import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, ToggleField } from "./agent-config-primitives";
import { Button } from "./ui/button";
import { jevDecisionApi } from "../api/jev-decisions";
import type { JevDecisionMode, JevDecisionSettingsUpdate } from "@paperclipai/shared";

export function JevSkillSuggestionSettings({ companyId }: { companyId: string }) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["jev-skill-decisions", companyId], queryFn: () => jevDecisionApi.get(companyId) });
  const history = useQuery({ queryKey: ["jev-skill-decisions-history", companyId], queryFn: () => jevDecisionApi.history(companyId) });
  const [mode, setMode] = useState<JevDecisionMode>("off"), [allowBackground, setAllowBackground] = useState(false);
  const [connectionId, setConnectionId] = useState(""), [grantId, setGrantId] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setMode(query.data.settings.mode); setAllowBackground(query.data.settings.allowBackground);
    setConnectionId(query.data.settings.connectionId ?? ""); setGrantId(query.data.settings.grantId ?? "");
  }, [query.data]);
  const mutation = useMutation({ mutationFn: (input: JevDecisionSettingsUpdate) => jevDecisionApi.update(companyId, input),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["jev-skill-decisions", companyId] }); } });
  const [consentedScope, setConsentedScope] = useState("");
  const setupRequestId = useRef<string | null>(null);
  const selected = query.data?.choices.find(item => item.id === connectionId && item.grantId === grantId);
  const testProfile = query.data?.testProfile ?? null;
  const selectedSaved = Boolean(selected && query.data?.settings.connectionId === selected.id && query.data?.settings.grantId === selected.grantId);
  const consentScope = `${companyId}:${connectionId}:${grantId}:${testProfile?.profileHash ?? "unqualified"}`;
  const consent = consentedScope === consentScope;
  const setupTest = useMutation({ mutationFn: () => {
    if (!selected || !selectedSaved || !testProfile) throw new Error("The displayed company account or Jev profile changed.");
    setupRequestId.current ??= crypto.randomUUID();
    return jevDecisionApi.setupTest(companyId, { connectionId: selected.id, grantId: selected.grantId, profileHash: testProfile.profileHash, requestId: setupRequestId.current });
  }, onSuccess: async result => {
    if (!["unknown", "dispatched", "reserved"].includes(result.status)) {
      setupRequestId.current = null;
      setConsentedScope("");
    }
    await client.invalidateQueries({ queryKey: ["jev-skill-decisions-history", companyId] });
  } });
  useEffect(() => { setupRequestId.current = null; setConsentedScope(""); setupTest.reset(); }, [companyId, connectionId, grantId, testProfile?.profileHash]);
  const next = { mode, allowBackground, connectionId: connectionId || null, grantId: grantId || null } satisfies JevDecisionSettingsUpdate;
  return <section className="max-w-2xl space-y-4" aria-labelledby="jev-skill-suggestions-title">
    <div className="space-y-1"><h2 id="jev-skill-suggestions-title" className="text-sm font-medium">{t("jevDecisions.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("jevDecisions.scope")}</p></div>
    {query.isLoading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : query.isError ? <p className="text-sm text-destructive">{t("jevDecisions.loadError")}</p> : <>
      <Field label={t("jevDecisions.mode")} hint={t("jevDecisions.modeHint")}>
        <select className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm" value={mode} onChange={event => setMode(event.target.value as JevDecisionMode)}>
          <option value="off">{t("jevDecisions.off")}</option><option value="shadow">{t("jevDecisions.shadow")}</option><option value="suggestions" disabled>{t("jevDecisions.suggestions")}</option>
        </select>
      </Field>
      <Field label={t("jevDecisions.account")} hint={t("jevDecisions.accountHint")}>
        <select className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm" value={connectionId} onChange={event => {
          const option = query.data?.choices.find(item => item.id === event.target.value); setConnectionId(option?.id ?? ""); setGrantId(option?.grantId ?? "");
        }}>
          <option value="">{t("jevDecisions.none")}</option>{query.data?.choices.map(item => <option key={`${item.id}:${item.grantId}`} value={item.id}>{item.name} · {item.model}</option>)}
        </select>
      </Field>
      <ToggleField label={t("jevDecisions.background")} hint={t("jevDecisions.backgroundHint")} checked={allowBackground} onChange={setAllowBackground} />
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">{t("jevDecisions.disclosure", { cap: testProfile ? (testProfile.costCapMinor / 100).toFixed(2) : "—", currency: testProfile?.currency ?? "USD" })}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsentedScope(event.target.checked ? consentScope : "")} />{t("jevDecisions.consent", { cap: testProfile ? (testProfile.costCapMinor / 100).toFixed(2) : "—", currency: testProfile?.currency ?? "USD" })}</label>
        <Button size="sm" disabled={!consent || !selectedSaved || !testProfile || setupTest.isPending} onClick={() => setupTest.mutate()}>{setupTest.isPending ? t("jevDecisions.testing") : t("jevDecisions.test")}</Button>
        {setupTest.isSuccess && <p role="status" className="text-xs text-muted-foreground">{setupTest.data.status === "completed" ? t("jevDecisions.testSuccess") : setupTest.data.status === "unknown" ? t("jevDecisions.testUnknown") : t("jevDecisions.testFailed")}</p>}
        {setupTest.isError && <p role="alert" className="text-xs text-destructive">{t("jevDecisions.testFailed")}</p>}
      </div>
      <div className="space-y-2"><h3 className="text-sm font-medium">{t("jevDecisions.history")}</h3>
        {history.isError ? <p className="text-xs text-destructive">{t("jevDecisions.historyError")}</p> : history.data?.length ? <ul className="space-y-1">{history.data.map(item =>
          <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1 text-xs"><span>{item.status} · {item.model} · {new Date(item.createdAt).toLocaleString()}</span><span>{t("jevDecisions.reservedCeiling")}: {item.reservedCostCents} {item.currency}{item.actualCostCents !== null && <> · {t("jevDecisions.actualCost", { amount: item.actualCostCents, currency: item.currency, status: item.costStatus })}</>}</span></li>)}</ul>
          : <p className="text-xs text-muted-foreground">{t("jevDecisions.historyEmpty")}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{t("jevDecisions.profile")}</p>
      <div className="flex items-center gap-3"><Button size="sm" disabled={mutation.isPending || !selected && mode !== "off"} onClick={() => mutation.mutate(next)}>{mutation.isPending ? t("jevDecisions.saving") : t("jevDecisions.save")}</Button>
        {mutation.isSuccess && <span className="text-xs text-muted-foreground">{t("jevDecisions.saved")}</span>}{mutation.isError && <span className="text-xs text-destructive">{mutation.error instanceof Error ? mutation.error.message : t("jevDecisions.saveError")}</span>}</div>
    </>}
  </section>;
}
