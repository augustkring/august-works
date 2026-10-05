import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { api } from "@/api/client";
import { saasApi, saasAuthAction } from "@/api/saas";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
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
const LABELS = [
  "Organization",
  "Plan",
  "Runtime",
  "Model provider",
  "Agent",
  "First task",
  "Complete",
];
export function SaasWelcomePage() {
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
  const [firstAgentName, setFirstAgentName] = useState("Chief of staff");
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
    setFirstAgentName("Chief of staff");
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
    return <p role="status">Loading setup…</p>;
  if (!capabilities.data?.onboarding)
    return (
      <main className="saas-page">
        <h1 className="saas-title">Organization setup</h1>
        <p>Setup is not available in this deployment.</p>
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
      <h1 className="saas-title">Set up your organization</h1>
      <p className="saas-muted">
        Your progress is saved with your organization. Model credentials stay in
        your company vault.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {verify.isSuccess && (
        <p role="status">
          A verification link has been requested. Check your email.
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
            Organization name
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
              Resend verification
            </Button>
            <Button disabled={create.isPending || !name.trim()} type="submit">
              Create organization
            </Button>
          </div>
        </form>
      ) : (
        <>
          <ol className="saas-steps" aria-label="Setup progress">
            {STAGES.map((step, index) => (
              <li key={step} aria-current={stage === step ? "step" : undefined}>
                {LABELS[index]}
              </li>
            ))}
          </ol>
          {run.isPending && <p role="status">Loading saved progress…</p>}
          {run.data && (
            <section className="saas-section">
              {stage === "organization" && (
                <label className="saas-label">
                  What should your organization achieve? (saved as a Foundation
                  draft)
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
                  <h2 className="saas-subtitle">Choose a plan</h2>
                  <p>
                    Complete checkout, then return here. Your payment must be
                    confirmed before setup continues.
                  </p>
                  <Link
                    className="saas-link"
                    to={companyLink("company/settings/billing")}
                  >
                    View plans and billing
                  </Link>
                </>
              )}
              {stage === "runtime" && (
                <>
                  <h2 className="saas-subtitle">Where should agents run?</h2>
                  <label className="saas-label">
                    Runtime
                    <select
                      className="saas-input"
                      value={runtimeChoice}
                      onChange={(event) => setRuntimeChoice(event.target.value)}
                    >
                      <option value="byo">Bring your own Gateway</option>
                      {capabilities.data.runtime && (
                        <option value="hosted">
                          August Works managed runtime
                        </option>
                      )}
                      <option value="skip">Decide later</option>
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
                    Configure runtime
                  </Link>
                </>
              )}
              {stage === "model_provider" && (
                <>
                  <h2 className="saas-subtitle">Connect your model provider</h2>
                  <p>
                    Use your own API key. Your provider bills model usage
                    directly.
                  </p>
                  <label className="saas-label">
                    Vault credential
                    <select
                      className="saas-input"
                      value={providerSecretId}
                      onChange={(event) =>
                        setProviderSecretId(event.target.value)
                      }
                    >
                      <option value="">Choose a credential</option>
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
                    <p role="alert">{secretOptions.error.message}</p>
                  )}
                  <Link
                    className="saas-link"
                    to={companyLink("company/settings/secrets")}
                  >
                    Add a vault credential
                  </Link>
                </>
              )}
              {stage === "agent" && (
                <>
                  <h2 className="saas-subtitle">Choose your first agent</h2>
                  {!run.data?.answers.createdFirstAgentId && (
                    <>
                      <label className="saas-label">
                        First agent name
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
                        Create first agent
                      </Button>
                    </>
                  )}
                  <p>
                    Creation preserves company approval rules. Approve the hire,
                    bind its runtime and provider credential, then start the
                    agent when you are ready. Creation sends no task and starts
                    no model call.
                  </p>
                  <Link className="saas-link" to={companyLink("agents")}>
                    Create or configure an agent
                  </Link>
                  <label className="saas-label">
                    Agent
                    <select
                      className="saas-input"
                      value={agentId}
                      onChange={(event) => setAgentId(event.target.value)}
                    >
                      <option value="">Select an agent</option>
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
                      Published Role Pack
                      <select
                        className="saas-input"
                        value={rolePackId}
                        onChange={(event) => setRolePackId(event.target.value)}
                      >
                        <option value="">Use the agent’s default role</option>
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
                  <h2 className="saas-subtitle">Create your first task</h2>
                  <Button
                    variant="outline"
                    disabled={
                      starter.isPending || !agentId || Boolean(firstTaskId)
                    }
                    onClick={() => starter.mutate()}
                  >
                    Create a safe starter task
                  </Button>
                  <p className="saas-muted">
                    Open the task and run it after configuring and qualifying
                    your agent. Setup completes after a successful run.
                  </p>
                  <Link
                    className="saas-link"
                    to={companyLink(
                      firstTaskId ? "issues/" + firstTaskId : "issues",
                    )}
                  >
                    Open task
                  </Link>
                  <label className="saas-label">
                    Task
                    <select
                      className="saas-input"
                      value={firstTaskId}
                      onChange={(event) => setFirstTaskId(event.target.value)}
                    >
                      <option value="">Select a task</option>
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
                  <h2 className="saas-subtitle">Your organization is ready</h2>
                  <Link className="saas-link" to={companyLink("dashboard")}>
                    Open dashboard
                  </Link>
                </>
              ) : (
                <div className="saas-footer">
                  <Button
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate(false)}
                  >
                    Save progress
                  </Button>
                  <Button
                    disabled={
                      update.isPending ||
                      (stage === "agent" && !agentId) ||
                      (stage === "first_task" && !firstTaskId)
                    }
                    onClick={() => update.mutate(true)}
                  >
                    Continue
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
