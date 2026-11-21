import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PEOPLE_DOMAINS,
  GOVERNANCE_FRAMEWORKS,
  v7FeatureEnabled,
  createUseCaseSchema,
  updateUseCaseSchema,
  useCaseAssessmentSchema,
  type UseCasePurpose,
  type UseCaseAssessment,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { GovernanceObligations } from "@/components/GovernanceObligations";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
const lines = (value: string) =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
const emptyPurpose = (prohibitedUse = "Employee scoring, emotion inference and automatic person decisions"): UseCasePurpose => ({
  name: "",
  description: "",
  intendedPurpose: "",
  prohibitedUses: [
    prohibitedUse,
  ],
  affectedPersonCategories: [],
  dataCategories: [],
  specialCategoryDataExpected: false,
  peopleDomain: "none",
  customerFacing: false,
  externalCommunication: false,
  makesRecommendationsAboutPeople: false,
  makesDecisionsAboutPeople: false,
  materialLegalOrSimilarEffect: false,
  foreseeableMisuse: [],
  providerInstructionsRefs: [],
  providerRoleFacts: {
    madeAvailableBy: "",
    trademarkOwner: "",
    purposeDefinedBy: "",
    integratedBy: "",
    rebranded: false,
    substantiallyModified: false,
    contractualCooperationRefs: [],
  },
  criticality: "medium",
  riskClass: "C0",
  oversightProfileId: "",
  retentionPurpose: "",
  retentionDays: 30,
  nextReviewAt: new Date(Date.now() + 90 * 86400000).toISOString(),
});
const emptyReview = (): UseCaseAssessment => ({
  expectedVersion: 1,
  framework: "eu_ai_act",
  frameworkVersionOrDate: "",
  classification: "uncertain",
  applicableRequirements: [],
  facts: "",
  evidenceRefs: [],
  assessmentMethod: "",
  reviewRequired: true,
  reviewerAttestation: "",
  friaApplicability: "review_required",
  friaApplicabilityReason: "",
});
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function AIGovernance() {
  const { t } = useTranslation("experience");
  const identity = useAccountIdentity();
  const userId = identity.userId ?? undefined;
  const { selectedCompanyId: companyId } = useCompany(),
    cache = useQueryClient(),
    { setBreadcrumbs } = useBreadcrumbs();
  const [selectedId, setSelectedId] = useState(""),
    [draft, setDraft] = useState(() => emptyPurpose(t("aiGovernance.defaultProhibitedUse"))),
    [key, setKey] = useState(""),
    [rationale, setRationale] = useState(""),
    [review, setReview] = useState(emptyReview),
    [issueId, setIssueId] = useState("");
  useEffect(() => {
    setBreadcrumbs([{ label: t("aiGovernance.title") }]);
  }, [setBreadcrumbs, t]);
  useEffect(() => {
    setSelectedId("");
    setDraft(emptyPurpose(t("aiGovernance.defaultProhibitedUse")));
    setKey("");
    setRationale("");
    setReview(emptyReview());
    setIssueId("");
  }, [companyId, userId, t]);
  const settings = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const evidenceEnabled = v7FeatureEnabled(
    settings.data ?? {},
    "governance_evidence_v7",
  );
  const cases = useQuery({
    queryKey: ["ai-use-cases", companyId, userId],
    queryFn: () => aiGovernanceApi.list(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const profiles = useQuery({
    queryKey: ["ai-oversight-profiles", companyId, userId],
    queryFn: () => aiGovernanceApi.profiles(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const detail = useQuery({
    queryKey: ["ai-use-case", companyId, userId, selectedId],
    queryFn: () => aiGovernanceApi.detail(companyId!, selectedId, userId),
    enabled: !!companyId && !!userId && !!selectedId,
  });
  const tasks = useQuery({
    queryKey: ["ai-use-case-tasks", companyId, userId],
    queryFn: () => aiGovernanceApi.targets(companyId!, userId),
    enabled: !!companyId && !!userId,
  });
  const selected = cases.data?.find((row) => row.id === selectedId);
  useEffect(() => {
    if (selected) setDraft(selected.purpose);
  }, [selected?.id, selected?.purposeHash]);
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => {
      const requestedCompany = companyId;
      await operation();
      return requestedCompany;
    },
    onSuccess: (requestedCompany) => {
      void cache.invalidateQueries({
        queryKey: ["ai-use-cases", requestedCompany],
      });
      void cache.invalidateQueries({
        queryKey: ["ai-use-case", requestedCompany],
      });
      void cache.invalidateQueries({
        queryKey: ["ai-oversight-profiles", requestedCompany],
      });
    },
  });
  const set = <K extends keyof UseCasePurpose>(
    field: K,
    value: UseCasePurpose[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));
  const reviewSet = <K extends keyof UseCaseAssessment>(
    field: K,
    value: UseCaseAssessment[K],
  ) => setReview((current) => ({ ...current, [field]: value }));
  const text = (
    label: string,
    field: "name" | "description" | "intendedPurpose" | "retentionPurpose",
  ) => (
    <Field label={label}>
      <Textarea
        value={draft[field]}
        onChange={(event) => set(field, event.target.value)}
        maxLength={4000}
      />
    </Field>
  );
  const list = (
    label: string,
    field:
      | "prohibitedUses"
      | "affectedPersonCategories"
      | "dataCategories"
      | "foreseeableMisuse"
      | "providerInstructionsRefs",
  ) => (
    <Field label={label}>
      <Textarea
        value={draft[field].join("\n")}
        onChange={(event) => set(field, lines(event.target.value))}
      />
    </Field>
  );
  if (!identity.settled || !userId)
    return <p>{t("aiGovernance.signInRequired")}</p>;
  if (!companyId) return <p>{t("aiGovernance.selectCompany")}</p>;
  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">{t("aiGovernance.title")}</h1>
      <p className="text-muted-foreground">
        {t("aiGovernance.intro")}
      </p>
      {(cases.error || profiles.error || mutation.error) && (
        <p role="alert">
          {(cases.error ?? profiles.error ?? mutation.error)?.message}
        </p>
      )}
      <Field label={t("aiGovernance.useCase")}>
        <select
          className="rounded-md border bg-background p-2"
          value={selectedId}
          onChange={(event) => {
            setSelectedId(event.target.value);
            setRationale("");
            setReview(emptyReview());
            if (!event.target.value) setDraft(emptyPurpose(t("aiGovernance.defaultProhibitedUse")));
          }}
        >
          <option value="">{t("aiGovernance.newUseCase")}</option>
          {cases.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.purpose.name} · {t(`aiGovernance.enums.useCaseStatus.${row.status}`, { defaultValue: row.status })}
            </option>
          ))}
        </select>
      </Field>
      {selected && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{t(`aiGovernance.enums.useCaseStatus.${selected.status}`, { defaultValue: selected.status })}</Badge>
          <Badge variant="outline">
            {t("aiGovernance.purposeVersion", { version: selected.purposeVersion })}
          </Badge>
          <Badge variant="outline">{selected.purpose.riskClass}</Badge>
        </div>
      )}
      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="font-semibold">{t("aiGovernance.intendedPurposeHeading")}</h2>
        {!selected && (
          <Field label={t("aiGovernance.useCaseKey")}>
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={t("aiGovernance.useCaseKeyExample")}
            />
          </Field>
        )}
        {text(t("aiGovernance.fields.name"), "name")}
        {text(t("aiGovernance.fields.description"), "description")}
        {text(t("aiGovernance.fields.allowedPurpose"), "intendedPurpose")}
        {list(t("aiGovernance.fields.prohibitedUses"), "prohibitedUses")}
        {list(t("aiGovernance.fields.affectedPeople"), "affectedPersonCategories")}
        {list(t("aiGovernance.fields.dataCategories"), "dataCategories")}
        {list(t("aiGovernance.fields.foreseeableMisuse"), "foreseeableMisuse")}
        {list(t("aiGovernance.fields.providerInstructions"), "providerInstructionsRefs")}
        <Field label={t("aiGovernance.fields.peopleDomain")}>
          <select
            className="rounded-md border bg-background p-2"
            value={draft.peopleDomain}
            onChange={(event) =>
              set(
                "peopleDomain",
                event.target.value as UseCasePurpose["peopleDomain"],
              )
            }
          >
            {PEOPLE_DOMAINS.map((value) => (
              <option key={value} value={value}>
                {t(`aiGovernance.enums.peopleDomain.${value}`, { defaultValue: value.replaceAll("_", " ") })}
              </option>
            ))}
          </select>
        </Field>
        {(
          [
            ["specialCategoryDataExpected", t("aiGovernance.fields.specialCategoryDataExpected")],
            ["customerFacing", t("aiGovernance.fields.customerFacing")],
            ["externalCommunication", t("aiGovernance.fields.externalCommunication")],
            [
              "makesRecommendationsAboutPeople",
              t("aiGovernance.fields.recommendationsAboutPeople"),
            ],
            ["makesDecisionsAboutPeople", t("aiGovernance.fields.decisionsAboutPeople")],
            [
              "materialLegalOrSimilarEffect",
              t("aiGovernance.fields.materialEffect"),
            ],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft[field]}
              onChange={(event) => set(field, event.target.checked)}
            />
            {label}
          </label>
        ))}
        <Field label={t("aiGovernance.fields.riskClass")}>
          <select
            className="rounded-md border bg-background p-2"
            value={draft.riskClass}
            onChange={(event) =>
              set(
                "riskClass",
                event.target.value as UseCasePurpose["riskClass"],
              )
            }
          >
            {["C0", "C1", "C2", "C3", "C4"].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label={t("aiGovernance.fields.criticality")}>
          <select
            className="rounded-md border bg-background p-2"
            value={draft.criticality}
            onChange={(event) =>
              set(
                "criticality",
                event.target.value as UseCasePurpose["criticality"],
              )
            }
          >
            {["low", "medium", "high", "critical"].map((value) => (
              <option key={value} value={value}>{t(`aiGovernance.enums.criticality.${value}`)}</option>
            ))}
          </select>
        </Field>
        <h3 className="font-medium">{t("aiGovernance.valueChainHeading")}</h3>
        {(
          [
            ["madeAvailableBy", t("aiGovernance.fields.madeAvailableBy")],
            ["trademarkOwner", t("aiGovernance.fields.trademarkOwner")],
            ["purposeDefinedBy", t("aiGovernance.fields.purposeDefinedBy")],
            ["integratedBy", t("aiGovernance.fields.integratedBy")],
          ] as const
        ).map(([field, label]) => (
          <Field key={field} label={label}>
            <Input
              value={draft.providerRoleFacts[field]}
              onChange={(event) =>
                set("providerRoleFacts", {
                  ...draft.providerRoleFacts,
                  [field]: event.target.value,
                })
              }
            />
          </Field>
        ))}
        {(
          [
            ["rebranded", t("aiGovernance.fields.rebranded")],
            ["substantiallyModified", t("aiGovernance.fields.substantiallyModified")],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.providerRoleFacts[field]}
              onChange={(event) =>
                set("providerRoleFacts", {
                  ...draft.providerRoleFacts,
                  [field]: event.target.checked,
                })
              }
            />
            {label}
          </label>
        ))}
        <Field label={t("aiGovernance.fields.cooperationRefs")}>
          <Textarea
            value={draft.providerRoleFacts.contractualCooperationRefs.join(
              "\n",
            )}
            onChange={(event) =>
              set("providerRoleFacts", {
                ...draft.providerRoleFacts,
                contractualCooperationRefs: lines(event.target.value),
              })
            }
          />
        </Field>
        <Field label={t("aiGovernance.fields.oversightProfile")}>
          <select
            className="rounded-md border bg-background p-2"
            value={draft.oversightProfileId}
            onChange={(event) => set("oversightProfileId", event.target.value)}
          >
            <option value="">{t("aiGovernance.chooseActiveProfile")}</option>
            {profiles.data
              ?.filter((row) => row.status === "active")
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.profile.name} · {t(`aiGovernance.enums.oversightMode.${row.profile.mode}`, { defaultValue: row.profile.mode.replaceAll("_", " ") })}
                </option>
              ))}
          </select>
        </Field>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(() =>
              aiGovernanceApi.oversight(
                companyId,
                {
                  name: t("aiGovernance.mandatoryProfileName"),
                  riskClass: "C3",
                  mode: "mandatory_human_decision",
                  requiredReviewActions: [
                    t("aiGovernance.mandatoryProfileAction"),
                  ],
                  escalationRoles: ["owner", "admin"],
                  responseDeadlineSeconds: 3600,
                  overrideAllowed: false,
                  stopAuthority: ["owner", "admin"],
                },
                userId,
              ),
            )
          }
        >
          {t("aiGovernance.createMandatoryProfile")}
        </Button>
        {text(t("aiGovernance.fields.retentionPurpose"), "retentionPurpose")}
        <Field label={t("aiGovernance.fields.retentionDays")}>
          <Input
            type="number"
            min={1}
            max={3650}
            value={draft.retentionDays}
            onChange={(event) =>
              set("retentionDays", Number(event.target.value))
            }
          />
        </Field>
        <Field label={t("aiGovernance.fields.nextReviewDate")}>
          <Input
            type="date"
            value={draft.nextReviewAt.slice(0, 10)}
            onChange={(event) => {
              if (event.target.value)
                set("nextReviewAt", `${event.target.value}T00:00:00.000Z`);
            }}
          />
        </Field>
        <Field label={t("aiGovernance.fields.changeReason")}>
          <Textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            minLength={10}
            maxLength={4000}
          />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedId("");
              setDraft(emptyPurpose(t("aiGovernance.defaultProhibitedUse")));
              setRationale("");
            }}
          >
            {t("aiGovernance.cancel")}
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !(selected
                ? updateUseCaseSchema.safeParse({
                    expectedVersion: selected.version,
                    purpose: draft,
                    changeReason: rationale,
                  }).success
                : createUseCaseSchema.safeParse({ key, purpose: draft })
                    .success)
            }
            onClick={() =>
              mutation.mutate(() =>
                selected
                  ? aiGovernanceApi.update(selected, draft, rationale, userId)
                  : aiGovernanceApi.create(companyId, key, draft, userId),
              )
            }
          >
            {selected ? t("aiGovernance.savePurposeVersion") : t("aiGovernance.registerDraft")}
          </Button>
        </div>
      </section>
      {selected && (
        <section className="space-y-4 rounded-lg border p-4">
          <h2 className="font-semibold">{t("aiGovernance.assessmentHeading")}</h2>
          <p className="text-muted-foreground">
            {t("aiGovernance.assessmentIntro")}
          </p>
          <Field label={t("aiGovernance.fields.framework")}>
            <select
              className="rounded-md border bg-background p-2"
              value={review.framework}
              onChange={(event) =>
                reviewSet(
                  "framework",
                  event.target.value as UseCaseAssessment["framework"],
                )
              }
            >
              {GOVERNANCE_FRAMEWORKS.map((value) => (
                <option key={value} value={value}>
                  {t(`aiGovernance.enums.framework.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("aiGovernance.fields.frameworkVersion")}>
            <Input
              value={review.frameworkVersionOrDate}
              onChange={(event) =>
                reviewSet("frameworkVersionOrDate", event.target.value)
              }
            />
          </Field>
          <Field label={t("aiGovernance.fields.classification")}>
            <select
              className="rounded-md border bg-background p-2"
              value={review.classification}
              onChange={(event) =>
                reviewSet(
                  "classification",
                  event.target.value as UseCaseAssessment["classification"],
                )
              }
            >
              {[
                "uncertain",
                "reviewed",
                "not_applicable",
                "limited_risk",
                "high_risk",
                "prohibited",
              ].map((value) => (
                <option key={value} value={value}>
                  {t(`aiGovernance.enums.classification.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["facts", t("aiGovernance.fields.deploymentFacts")],
              ["assessmentMethod", t("aiGovernance.fields.assessmentMethod")],
              ["reviewerAttestation", t("aiGovernance.fields.reviewerAttestation")],
              ["friaApplicabilityReason", t("aiGovernance.fields.friaReason")],
            ] as const
          ).map(([field, label]) => (
            <Field key={field} label={label}>
              <Textarea
                value={review[field]}
                onChange={(event) => reviewSet(field, event.target.value)}
                minLength={10}
                maxLength={4000}
              />
            </Field>
          ))}
          <Field label={t("aiGovernance.fields.applicableRequirements")}>
            <Textarea
              value={review.applicableRequirements.join("\n")}
              onChange={(event) =>
                reviewSet("applicableRequirements", lines(event.target.value))
              }
            />
          </Field>
          <Field label={t("aiGovernance.fields.evidenceRefs")}>
            <Textarea
              value={review.evidenceRefs.join("\n")}
              onChange={(event) =>
                reviewSet("evidenceRefs", lines(event.target.value))
              }
            />
          </Field>
          <Field label={t("aiGovernance.fields.friaApplicability")}>
            <select
              className="rounded-md border bg-background p-2"
              value={review.friaApplicability}
              onChange={(event) =>
                reviewSet(
                  "friaApplicability",
                  event.target.value as UseCaseAssessment["friaApplicability"],
                )
              }
            >
              {["yes", "no", "uncertain", "review_required"].map((value) => (
                <option key={value} value={value}>
                  {t(`aiGovernance.enums.friaApplicability.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={review.reviewRequired}
              onChange={(event) =>
                reviewSet("reviewRequired", event.target.checked)
              }
            />
            {t("aiGovernance.furtherReviewRequired")}
          </label>
          <Button
            disabled={
              mutation.isPending ||
              !useCaseAssessmentSchema.safeParse(review).success
            }
            onClick={() =>
              mutation.mutate(() =>
                aiGovernanceApi.assess(selected, review, userId),
              )
            }
          >
            {t("aiGovernance.recordAssessment")}
          </Button>
          <div className="flex flex-wrap gap-2">
            {(["approve", "suspend", "retire"] as const).map((action) => (
              <Button
                key={action}
                variant={action === "approve" ? "default" : "outline"}
                disabled={
                  mutation.isPending ||
                  rationale.trim().length < 10 ||
                  selected.status === "retired"
                }
                onClick={() =>
                  mutation.mutate(() =>
                    aiGovernanceApi.decide(selected, action, rationale, userId),
                  )
                }
              >
                {action === "approve"
                  ? t("aiGovernance.actions.approve")
                  : action === "suspend"
                    ? t("aiGovernance.actions.suspend")
                    : t("aiGovernance.actions.retire")}
              </Button>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <section className="space-y-4 rounded-lg border p-4">
          <h2 className="font-semibold">{t("aiGovernance.deploymentHeading")}</h2>
          <p className="text-muted-foreground">
            {t("aiGovernance.deploymentIntro")}
          </p>
          <Field label={t("aiGovernance.fields.ownedTask")}>
            <select
              className="rounded-md border bg-background p-2"
              value={issueId}
              onChange={(event) => setIssueId(event.target.value)}
            >
              <option value="">{t("aiGovernance.chooseAssignedTask")}</option>
              {tasks.data
                ?.filter((task) => !!task.assigneeAgentId)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.identifier} · {task.title}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            disabled={
              mutation.isPending || selected.status !== "approved" || !issueId
            }
            onClick={() => {
              const task = tasks.data?.find((row) => row.id === issueId);
              if (task?.assigneeAgentId)
                mutation.mutate(() =>
                  aiGovernanceApi.bind(
                    selected,
                    task.id,
                    task.assigneeAgentId!,
                    userId,
                  ),
                );
            }}
          >
              {t("aiGovernance.bindPurpose")}
          </Button>
          {evidenceEnabled && (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate(async () => {
                  const pack = await aiGovernanceApi.evidencePack(
                    selected.companyId,
                    selected.id,
                    userId,
                  );
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(pack, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  try {
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `ai-governance-${selected.key}-v${selected.purposeVersion}.json`;
                    anchor.click();
                  } finally {
                    URL.revokeObjectURL(url);
                  }
                })
              }
            >
              {t("aiGovernance.exportEvidence")}
            </Button>
          )}
          {detail.error && <p role="alert">{detail.error.message}</p>}
          {detail.data?.assessments.map((record) => (
            <p key={record.id}>
              {t(`aiGovernance.enums.framework.${record.assessment.framework}`)} ·{" "}
              {t(`aiGovernance.enums.classification.${record.assessment.classification}`)} ·{" "}
              {t("aiGovernance.purposeVersion", { version: record.purposeVersion })}
            </p>
          ))}
          {detail.data?.deployments.map((deployment) => (
            <p key={deployment.id}>
              <Link
                className="text-primary underline"
                to={`/issues/${deployment.issueId}`}
              >
                {t("aiGovernance.openGovernedTask")}
              </Link>{" "}
              · {t(`aiGovernance.enums.deploymentStatus.${deployment.status}`, { defaultValue: deployment.status.replaceAll("_", " ") })} · {t("aiGovernance.purposeVersion", { version: deployment.purposeVersion })}
            </p>
          ))}
          {detail.data?.stopRequests.map((request) => (
            <p key={request.id}>
              {request.status === "delivered"
                ? t("aiGovernance.stopDelivered")
                : request.attempts >= 5
                  ? t("aiGovernance.stopNeedsAttention")
                  : t("aiGovernance.stopQueued")}
            </p>
          ))}
        </section>
      )}
      {evidenceEnabled && (
        <GovernanceObligations
          key={`${companyId}:${userId}`}
          companyId={companyId}
          userId={userId}
        />
      )}
    </main>
  );
}
