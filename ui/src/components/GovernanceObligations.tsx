import { useState } from "react";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GOVERNANCE_FRAMEWORKS,
  governanceObligationSchema,
  type GovernanceObligation,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const blank = (): GovernanceObligation => ({
  framework: "eu_ai_act",
  authority: "",
  citation: "",
  jurisdictionOrScope: "",
  applicabilityFacts: "",
  applicabilityState: "review_required",
  effectiveFrom: new Date().toISOString(),
  effectiveUntil: null,
  requiredControl: "",
  evidenceRequired: [],
  controlRefs: [],
  nextReviewAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  reviewTrigger: "",
  sourceVersionOrDate: "",
  sourceUrl: "",
});
export function GovernanceObligations({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const { t } = useTranslation("experience");
  const [draft, setDraft] = useState(blank),
    cache = useQueryClient();
  const records = useQuery({
    queryKey: ["governance-obligations", companyId, userId],
    queryFn: () => aiGovernanceApi.obligations(companyId, userId),
  });
  const mutation = useMutation({
    mutationFn: () => aiGovernanceApi.obligation(companyId, draft, userId),
    onSuccess: () => {
      setDraft(blank());
      void cache.invalidateQueries({
        queryKey: ["governance-obligations", companyId, userId],
      });
    },
  });
  const set = <K extends keyof GovernanceObligation>(
    key: K,
    value: GovernanceObligation[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">{t("aiGovernance.obligations.heading")}</h2>
      <p className="text-muted-foreground">
        {t("aiGovernance.obligations.intro")}
      </p>
      {(records.error || mutation.error) && (
        <p role="alert">{(records.error ?? mutation.error)?.message}</p>
      )}
      {records.data?.map((row) => (
        <p key={row.id}>
          {row.obligation.authority} · {row.obligation.citation} ·{" "}
          {t(`aiGovernance.obligations.enums.applicability.${row.obligation.applicabilityState}`)} · {t("aiGovernance.obligations.reviewDate")} {" "}
          {row.nextReviewAt.slice(0, 10)}
          {row.obligation.analyticalPurpose && <> · {t("aiGovernance.obligations.analyticalPurpose")} {t(`aiGovernance.obligations.enums.analyticalStatus.${row.obligation.analyticalPurpose.status}`)} · {row.obligation.analyticalPurpose.capabilities.map(value => t(`aiGovernance.obligations.enums.capability.${value}`)).join(", ")}</>}
        </p>
      ))}
      <label className="block space-y-2">
        {t("aiGovernance.fields.framework")}
        <select
          className="block rounded-md border bg-background p-2"
          value={draft.framework}
          onChange={(event) =>
            set(
              "framework",
              event.target.value as GovernanceObligation["framework"],
            )
          }
        >
          {GOVERNANCE_FRAMEWORKS.map((value) => (
            <option key={value} value={value}>
              {t(`aiGovernance.enums.framework.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["authority", t("aiGovernance.obligations.fields.authority")],
          ["citation", t("aiGovernance.obligations.fields.citation")],
          ["jurisdictionOrScope", t("aiGovernance.obligations.fields.scope")],
          ["applicabilityFacts", t("aiGovernance.obligations.fields.applicabilityFacts")],
          ["requiredControl", t("aiGovernance.obligations.fields.requiredControl")],
          ["reviewTrigger", t("aiGovernance.obligations.fields.reviewTrigger")],
          ["sourceVersionOrDate", t("aiGovernance.obligations.fields.sourceVersion")],
          ["sourceUrl", t("aiGovernance.obligations.fields.sourceUrl")],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label}
          <Textarea
            value={draft[field]}
            onChange={(event) => set(field, event.target.value)}
          />
        </label>
      ))}
      <label className="block space-y-2">
        {t("aiGovernance.obligations.fields.applicability")}
        <select
          className="block rounded-md border bg-background p-2"
          value={draft.applicabilityState}
          onChange={(event) =>
            set(
              "applicabilityState",
              event.target.value as GovernanceObligation["applicabilityState"],
            )
          }
        >
          {["review_required", "uncertain", "applicable", "not_applicable"].map(
            (value) => (
              <option key={value} value={value}>
                {t(`aiGovernance.obligations.enums.applicability.${value}`)}
              </option>
            ),
          )}
        </select>
      </label>
      {(
        [
          ["evidenceRequired", t("aiGovernance.obligations.fields.evidenceRequired")],
          ["controlRefs", t("aiGovernance.obligations.fields.controlRefs")],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label} {t("aiGovernance.onePerLine")}
          <Textarea
            value={draft[field].join("\n")}
            onChange={(event) =>
              set(
                field,
                event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
      ))}
      {(
        [
          ["effectiveFrom", t("aiGovernance.obligations.fields.effectiveFrom")],
          ["effectiveUntil", t("aiGovernance.obligations.fields.effectiveUntil")],
          ["nextReviewAt", t("aiGovernance.obligations.fields.nextReview")],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="block space-y-2">
          {label} {t("aiGovernance.obligations.utcSuffix")}
          <Input
            type="date"
            value={draft[field]?.slice(0, 10) ?? ""}
            onChange={(event) => {
              if (event.target.value)
                set(field, `${event.target.value}T00:00:00.000Z`);
              else if (field === "effectiveUntil") set(field, null);
            }}
          />
        </label>
      ))}
      {draft.framework === "company_policy" && <fieldset className="space-y-4">
        <legend className="font-medium">{t("aiGovernance.obligations.analyticalPurpose")}</legend>
        <p className="text-muted-foreground">{t("aiGovernance.obligations.analyticalPurposeIntro")}</p>
        {!draft.analyticalPurpose ? <Button variant="outline" onClick={() => set("analyticalPurpose", { status: "suspended", purpose: "management_intelligence", capabilities: ["metrics"], populationUnits: "business_objects", peopleImpact: "none", decisionBoundary: "advisory_only", maxRetentionDays: 30, permittedSensitivity: ["internal"], prohibitedUses: [], approvalRationale: "" })}>{t("aiGovernance.obligations.addAnalyticalPurpose")}</Button> : <>
          <label className="block space-y-2">{t("aiGovernance.obligations.fields.purposeStatus")}<select className="block rounded-md border bg-background p-2" value={draft.analyticalPurpose.status} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, status: event.target.value as "approved" | "suspended" })}><option value="suspended">{t("aiGovernance.obligations.enums.analyticalStatus.suspended")}</option><option value="approved">{t("aiGovernance.obligations.enums.analyticalStatus.approved")}</option></select></label>
          <label className="block space-y-2">{t("aiGovernance.obligations.fields.intendedAnalyticalPurpose")}<select className="block rounded-md border bg-background p-2" value={draft.analyticalPurpose.purpose} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, purpose: event.target.value as "management_intelligence" | "process_intelligence" })}><option value="management_intelligence">{t("aiGovernance.obligations.enums.analyticalPurpose.management_intelligence")}</option><option value="process_intelligence">{t("aiGovernance.obligations.enums.analyticalPurpose.process_intelligence")}</option></select></label>
          <fieldset className="space-y-2"><legend>{t("aiGovernance.obligations.fields.permittedCapabilities")}</legend><div className="flex flex-wrap gap-4">{(["metrics", "strategy", "process", "forecast", "scenario", "experiment", "causal", "planning", "reviews"] as const).map(capability => <label key={capability} className="flex items-center gap-2"><input type="checkbox" checked={draft.analyticalPurpose!.capabilities.includes(capability)} onChange={() => { const current = draft.analyticalPurpose!; set("analyticalPurpose", { ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter(c => c !== capability) : [...current.capabilities, capability] }); }} />{t(`aiGovernance.obligations.enums.capability.${capability}`)}</label>)}</div></fieldset>
          <fieldset className="space-y-2"><legend>{t("aiGovernance.obligations.fields.permittedSensitivity")}</legend><div className="flex flex-wrap gap-4">{(["internal", "confidential"] as const).map(level => <label key={level} className="flex items-center gap-2"><input type="checkbox" checked={draft.analyticalPurpose!.permittedSensitivity.includes(level)} onChange={() => { const current = draft.analyticalPurpose!; set("analyticalPurpose", { ...current, permittedSensitivity: current.permittedSensitivity.includes(level) ? current.permittedSensitivity.filter(c => c !== level) : [...current.permittedSensitivity, level] }); }} />{t(`aiGovernance.obligations.enums.sensitivity.${level}`)}</label>)}</div></fieldset>
          <label className="block space-y-2">{t("aiGovernance.obligations.fields.maxRetentionDays")}<Input type="number" min={1} max={3650} value={draft.analyticalPurpose.maxRetentionDays} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, maxRetentionDays: Number(event.target.value) })} /></label>
          <label className="block space-y-2">{t("aiGovernance.obligations.fields.approvalRationale")}<Textarea value={draft.analyticalPurpose.approvalRationale} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, approvalRationale: event.target.value })} /></label>
          <label className="block space-y-2">{t("aiGovernance.obligations.fields.prohibitedUses")} {t("aiGovernance.onePerLine")}<Textarea value={draft.analyticalPurpose.prohibitedUses.join("\n")} onChange={event => set("analyticalPurpose", { ...draft.analyticalPurpose!, prohibitedUses: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) })} /></label>
          <Button variant="ghost" onClick={() => set("analyticalPurpose", undefined)}>{t("aiGovernance.obligations.removeAnalyticalPurpose")}</Button>
        </>}
      </fieldset>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setDraft(blank())}>
          {t("aiGovernance.cancel")}
        </Button>
        <Button
          disabled={
            mutation.isPending ||
            !governanceObligationSchema.safeParse(draft).success
          }
          onClick={() => mutation.mutate()}
        >
          {t("aiGovernance.obligations.recordReview")}
        </Button>
      </div>
    </section>
  );
}
