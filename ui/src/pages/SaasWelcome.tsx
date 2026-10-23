import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { api } from "@/api/client";
import { saasApi, saasAuthAction } from "@/api/saas";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import { Button } from "@/components/ui/button";
import { ExperienceLanguageSelect } from "@/components/ExperienceLanguageSelect";
import { useTranslation } from "@/i18n";
import { Link, useNavigate } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";

const STAGES = [
  "organization",
  "plan",
  "runtime",
  "model_provider",
  "agent",
  "first_task",
  "complete",
];
const LABEL_KEYS = [
  "stageOrganization",
  "stagePlan",
  "stageRuntime",
  "stageProvider",
  "stageAgent",
  "stageTask",
  "stageComplete",
];
export function SaasWelcomePage() {
  const { t, i18n } = useTranslation("experience");
  const getDefaultAgentName = () => i18n.t("saasWelcome.firstAgentDefault", { ns: "experience" });
  const {
    selectedCompanyId,
    reloadCompanies,
    setSelectedCompanyId,
    companies,
  } = useCompany();
  const capabilities = useSaasCapabilities();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [runtimeChoice, setRuntimeChoice] = useState("byo");
  const [agentId, setAgentId] = useState("");
  const [firstAgentName, setFirstAgentName] = useState(getDefaultAgentName);
  const [firstTaskId, setFirstTaskId] = useState("");
  const [providerSecretId, setProviderSecretId] = useState(""),
    [rolePackId, setRolePackId] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    retry: false,
  });
  const scopeRef = useRef({
    userId: session.data?.user.id,
    companyId: selectedCompanyId,
  });
  scopeRef.current = {
    userId: session.data?.user.id,
    companyId: selectedCompanyId,
  };
  useEffect(() => {
    setRequestKey(crypto.randomUUID());
    setName("");
    setMission("");
    setAgentId("");
    setFirstAgentName(getDefaultAgentName());
    setFirstTaskId("");
    setProviderSecretId("");
    setRolePackId("");
    setRuntimeChoice("byo");
  }, [session.data?.user.id, selectedCompanyId]);
  const run = useQuery({
    queryKey: ["saas-onboarding", session.data?.user.id, selectedCompanyId],
    queryFn: () =>
      saasApi.onboarding(selectedCompanyId!, session.data!.user.id),
    enabled: Boolean(
      session.data && selectedCompanyId && capabilities.data?.onboarding,
    ),
  });
  const agentOptions = useQuery({
    queryKey: [
      "saas-onboarding-agents",
      session.data?.user.id,
      selectedCompanyId,
    ],
    queryFn: () =>
      api.get<{ id: string; name: string }[]>(
        `/companies/${selectedCompanyId}/agents?expectedUserId=${encodeURIComponent(session.data!.user.id)}`,
      ),
    enabled: Boolean(session.data && selectedCompanyId),
  });
  const secretOptions = useQuery({
    queryKey: [
      "saas-onboarding-secrets",
      session.data?.user.id,
      selectedCompanyId,
    ],
    queryFn: () =>
      api.get<{ id: string; name: string; ownerUserId?: string | null }[]>(
        `/companies/${selectedCompanyId}/secrets?expectedUserId=${encodeURIComponent(session.data!.user.id)}`,
      ),
    enabled: Boolean(
      session.data &&
        selectedCompanyId &&
        run.data?.currentStage === "model_provider",
    ),
  });
  const roleOptions = useQuery({
    queryKey: [
      "saas-onboarding-roles",
      session.data?.user.id,
      selectedCompanyId,
    ],
    queryFn: () =>
      api.get<
        { id: string; name: string; publishedVersionId: string | null }[]
      >(
        `/companies/${selectedCompanyId}/role-packs?expectedUserId=${encodeURIComponent(session.data!.user.id)}`,
      ),
    enabled: Boolean(
      session.data && selectedCompanyId && run.data?.currentStage === "agent",
    ),
    retry: false,
  });
  const taskOptions = useQuery({
    queryKey: [
      "saas-onboarding-tasks",
      session.data?.user.id,
      selectedCompanyId,
    ],
    queryFn: () =>
      api.get<{ id: string; title: string }[]>(
        `/companies/${selectedCompanyId}/issues?expectedUserId=${encodeURIComponent(session.data!.user.id)}`,
      ),
    enabled: Boolean(session.data && selectedCompanyId),
  });
  useEffect(() => {
    if (session.isSuccess && !session.data)
      navigate("/auth?next=/saas/welcome", { replace: true });
  }, [session.isSuccess, session.data, navigate]);
  useEffect(() => {
    if (!run.data) return;
    setMission(
      typeof run.data.answers.mission === "string"
        ? run.data.answers.mission
        : "",
    );
    setRuntimeChoice(
      typeof run.data.answers.runtimeChoice === "string"
        ? run.data.answers.runtimeChoice
        : "byo",
    );
    setAgentId(
      typeof run.data.answers.agentId === "string"
        ? run.data.answers.agentId
        : "",
    );
    setProviderSecretId(
      typeof run.data.answers.providerSecretId === "string"
        ? run.data.answers.providerSecretId
        : "",
    );
    setRolePackId(
      typeof run.data.answers.rolePackId === "string"
        ? run.data.answers.rolePackId
        : "",
    );
    setFirstTaskId(
      typeof run.data.answers.firstTaskId === "string"
        ? run.data.answers.firstTaskId
        : "",
    );
  }, [run.data?.version, run.data?.id]);
  const create = useMutation({
    mutationFn: async () => {
      const userId = session.data!.user.id;
      return {
        userId,
        result: await saasApi.createCompany(userId, {
          name,
          idempotencyKey: requestKey,
        }),
      };
    },
    onSuccess: async ({ userId, result }) => {
      if (scopeRef.current.userId !== userId) return;
      await reloadCompanies();
      if (scopeRef.current.userId === userId)
        setSelectedCompanyId(result.companyId);
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      saasAuthAction("send-verification-email", {
        email: session.data?.user.email ?? "",
        callbackURL: window.location.origin + "/saas/welcome",
      }),
  });
  const update = useMutation({
    mutationFn: async (next: boolean) => {
      if (!run.data) throw new Error("Onboarding is not loaded.");
      const current = STAGES.indexOf(run.data.currentStage);
      const scope = { ...scopeRef.current };
      const result = await saasApi.updateOnboarding(
        selectedCompanyId!,
        session.data!.user.id,
        {
          expectedVersion: run.data.version,
          stage: STAGES[next ? Math.min(current + 1, 6) : current]!,
          answers: {
            mission,
            runtimeChoice,
            ...(providerSecretId ? { providerSecretId } : {}),
            ...(rolePackId ? { rolePackId } : {}),
            ...(agentId ? { agentId } : {}),
            ...(firstTaskId ? { firstTaskId } : {}),
          },
        },
      );
      return { scope, result };
    },
    onSuccess: ({ scope }) => {
      if (
        scopeRef.current.userId === scope.userId &&
        scopeRef.current.companyId === scope.companyId
      )
        void run.refetch();
    },
  });
  const firstAgent = useMutation({
    mutationFn: async () => {
      const scope = { ...scopeRef.current };
      const result = await saasApi.firstAgent(
        selectedCompanyId!,
        session.data!.user.id,
        { expectedVersion: run.data!.version, name: firstAgentName },
      );
      return { scope, result };
    },
    onSuccess: ({ scope, result }) => {
      if (
        scopeRef.current.userId !== scope.userId ||
        scopeRef.current.companyId !== scope.companyId
      )
        return;
      setAgentId(result.agentId);
      void run.refetch();
      void agentOptions.refetch();
    },
  });
  const starter = useMutation({
    mutationFn: async () => {
      const scope = { ...scopeRef.current };
      const result = await saasApi.starterTask(
        selectedCompanyId!,
        session.data!.user.id,
        run.data!.version,
      );
      return { scope, result };
    },
    onSuccess: ({ scope }) => {
      if (
        scopeRef.current.userId !== scope.userId ||
        scopeRef.current.companyId !== scope.companyId
      )
        return;
      void run.refetch();
      void taskOptions.refetch();
    },
  });
  const error =
    firstAgent.error ??
    starter.error ??
    capabilities.error ??
    create.error ??
    run.error ??
    update.error ??
    verify.error;
  if (capabilities.isPending || session.isPending)
    return <p role="status">{t("saasWelcome.loading")}</p>;
  if (!capabilities.data?.onboarding)
    return (
      <main className="saas-page">
        <h1 className="saas-title">{t("saasWelcome.organizationSetup")}</h1>
        <p>{t("saasWelcome.unavailable")}</p>
      </main>
    );
  const stage = run.data?.currentStage;
  const prefix = companies.find(
    (company) => company.id === selectedCompanyId,
  )?.issuePrefix;
  const companyLink = (path: string) =>
    prefix ? `/${prefix}/${path}` : `/${path}`;
  return (
    <main className="saas-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="saas-title">{t("saasWelcome.title")}</h1>
        <ExperienceLanguageSelect />
      </header>
      <p className="saas-muted">{t("saasWelcome.intro")}</p>
      {error && <p role="alert" className="saas-error">{t("saasWelcome.requestUnconfirmed")}</p>}
      {verify.isSuccess && (
        <p role="status">
          {t("saasWelcome.verificationRequested")}
        </p>
      )}
      {!selectedCompanyId ? (
        <form
          className="saas-section"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="saas-label">
            {t("saasWelcome.organizationName")}
            <input
              className="saas-input"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="saas-footer">
            <Button
              variant="ghost"
              type="button"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              {t("saasWelcome.resendVerification")}
            </Button>
            <Button disabled={create.isPending || !name.trim()} type="submit">
              {t("saasWelcome.createOrganization")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <ol className="saas-steps" aria-label={t("saasWelcome.progress")}>
            {STAGES.map((step, index) => (
              <li key={step} aria-current={stage === step ? "step" : undefined}>
                {t(`saasWelcome.${LABEL_KEYS[index]}`)}
              </li>
            ))}
          </ol>
          {run.isPending && <p role="status">{t("saasWelcome.loadingProgress")}</p>}
          {run.data && (
            <section className="saas-section">
              {stage === "organization" && (
                <label className="saas-label">
                  {t("saasWelcome.mission")}
                  <textarea
                    className="saas-input"
                    value={mission}
                    maxLength={2000}
                    onChange={(event) => setMission(event.target.value)}
                  />
                </label>
              )}
              {stage === "plan" && (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.choosePlan")}</h2>
                  <p>
                    {t("saasWelcome.checkoutHelp")}
                  </p>
                  <Link
                    className="saas-link"
                    to={companyLink("company/settings/billing")}
                  >
                    {t("saasWelcome.viewBilling")}
                  </Link>
                </>
              )}
              {stage === "runtime" && (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.runtimeQuestion")}</h2>
                  <label className="saas-label">
                    {t("saasWelcome.runtime")}
                    <select
                      className="saas-input"
                      value={runtimeChoice}
                      onChange={(event) => setRuntimeChoice(event.target.value)}
                    >
                      <option value="byo">{t("saasWelcome.byoGateway")}</option>
                      {capabilities.data.runtime && (
                        <option value="hosted">
                          {t("saasWelcome.managedRuntime", { productName: PRODUCT_IDENTITY.productName })}
                        </option>
                      )}
                      <option value="skip">{t("saasWelcome.decideLater")}</option>
                    </select>
                  </label>
                  <Link
                    className="saas-link"
                    to={companyLink(
                      runtimeChoice === "hosted"
                        ? "company/settings/runtime"
                        : "apps",
                    )}
                  >
                    {t("saasWelcome.configureRuntime")}
                  </Link>
                </>
              )}
              {stage === "model_provider" && (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.connectProvider")}</h2>
                  <p>
                    {t("saasWelcome.providerHelp")}
                  </p>
                  <label className="saas-label">
                    {t("saasWelcome.vaultCredential")}
                    <select
                      className="saas-input"
                      value={providerSecretId}
                      onChange={(event) =>
                        setProviderSecretId(event.target.value)
                      }
                    >
                      <option value="">{t("saasWelcome.chooseCredential")}</option>
                      {secretOptions.data
                        ?.filter(
                          (secret) =>
                            !secret.ownerUserId ||
                            secret.ownerUserId === session.data?.user.id,
                        )
                        .map((secret) => (
                          <option key={secret.id} value={secret.id}>
                            {secret.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {secretOptions.error && (
                    <p role="alert">{t("saasWelcome.credentialLoadFailed")}</p>
                  )}
                  <Link
                    className="saas-link"
                    to={companyLink("company/settings/secrets")}
                  >
                    {t("saasWelcome.addCredential")}
                  </Link>
                </>
              )}
              {stage === "agent" && (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.chooseFirstAgent")}</h2>
                  {!run.data?.answers.createdFirstAgentId && (
                    <>
                      <label className="saas-label">
                        {t("saasWelcome.firstAgentName")}
                        <input
                          className="saas-input"
                          value={firstAgentName}
                          maxLength={100}
                          onChange={(event) =>
                            setFirstAgentName(event.target.value)
                          }
                        />
                      </label>
                      <Button
                        disabled={
                          firstAgent.isPending || !firstAgentName.trim()
                        }
                        onClick={() => firstAgent.mutate()}
                      >
                        {t("saasWelcome.createFirstAgent")}
                      </Button>
                    </>
                  )}
                  <p>
                    {t("saasWelcome.agentHelp")}
                  </p>
                  <Link className="saas-link" to={companyLink("agents")}>
                    {t("saasWelcome.configureAgent")}
                  </Link>
                  <label className="saas-label">
                    {t("saasWelcome.agent")}
                    <select
                      className="saas-input"
                      value={agentId}
                      onChange={(event) => setAgentId(event.target.value)}
                    >
                      <option value="">{t("saasWelcome.selectAgent")}</option>
                      {agentOptions.data?.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {Boolean(
                    roleOptions.data?.some((pack) => pack.publishedVersionId),
                  ) && (
                    <label className="saas-label">
                      {t("saasWelcome.publishedRolePack")}
                      <select
                        className="saas-input"
                        value={rolePackId}
                        onChange={(event) => setRolePackId(event.target.value)}
                      >
                        <option value="">{t("saasWelcome.defaultRole")}</option>
                        {roleOptions.data
                          ?.filter((pack) => pack.publishedVersionId)
                          .map((pack) => (
                            <option key={pack.id} value={pack.id}>
                              {pack.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {stage === "first_task" && (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.createFirstTask")}</h2>
                  <Button
                    variant="outline"
                    disabled={
                      starter.isPending || !agentId || Boolean(firstTaskId)
                    }
                    onClick={() => starter.mutate()}
                  >
                    {t("saasWelcome.createStarterTask")}
                  </Button>
                  <p className="saas-muted">
                    {t("saasWelcome.starterHelp")}
                  </p>
                  <Link
                    className="saas-link"
                    to={companyLink(
                      firstTaskId ? "issues/" + firstTaskId : "issues",
                    )}
                  >
                    {t("saasWelcome.openTask")}
                  </Link>
                  <label className="saas-label">
                    {t("saasWelcome.task")}
                    <select
                      className="saas-input"
                      value={firstTaskId}
                      onChange={(event) => setFirstTaskId(event.target.value)}
                    >
                      <option value="">{t("saasWelcome.selectTask")}</option>
                      {taskOptions.data?.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {stage === "complete" ? (
                <>
                  <h2 className="saas-subtitle">{t("saasWelcome.ready")}</h2>
                  <Link className="saas-link" to={companyLink("dashboard")}>
                    {t("saasWelcome.openDashboard")}
                  </Link>
                </>
              ) : (
                <div className="saas-footer">
                  <Button
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate(false)}
                  >
                    {t("saasWelcome.saveProgress")}
                  </Button>
                  <Button
                    disabled={
                      update.isPending ||
                      (stage === "agent" && !agentId) ||
                      (stage === "first_task" && !firstTaskId)
                    }
                    onClick={() => update.mutate(true)}
                  >
                    {t("saasWelcome.continue")}
                  </Button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
