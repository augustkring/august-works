import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Navigate,
} from "react-router-dom";
import {
  ACTIVATION_STEPS,
  FEEDBACK_CONTACTS,
  activationWebsiteSchema,
  type ActivationCommand,
  type ActivationView,
} from "@paperclipai/shared";
import { authApi } from "../api/auth";
import { ApiError } from "../api/client";
import { saasApi } from "../api/saas";
import { activationApi } from "../api/activation";
import { useSaasCapabilities } from "../hooks/useSaasCapabilities";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { CustomerFeedbackDialog } from "../components/CustomerFeedbackDialog";
import { SaasWelcomePage } from "./SaasWelcome";

export function SaasWelcomeEntry() {
  const flags = useSaasCapabilities(),
    [params] = useSearchParams();
  if (flags.isPending) return <p role="status">Loading…</p>;
  if (flags.isError)
    return <p role="alert">Getting started could not be loaded.</p>;
  return flags.data?.activationV9 && params.get("legacy") !== "1" ? (
    <ActivationPage />
  ) : (
    <SaasWelcomePage />
  );
}
export function ActivationPage() {
  const { t } = useTranslation("experience"),
    capabilities = useSaasCapabilities();
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    retry: false,
    staleTime: 0,
  });
  const { selectedCompanyId } = useCompany();
  if (session.isPending || capabilities.isPending)
    return <p role="status">{t("activation.loading")}</p>;
  if (session.isError || capabilities.isError)
    return <p role="alert">{t("activation.loadFailed")}</p>;
  if (!session.data)
    return <Navigate to="/auth?next=/saas/activation" replace />;
  return (
    <ActivationScope
      key={`${session.data.user.id}:${selectedCompanyId}`}
      principal={session.data.user.id}
      companyId={selectedCompanyId}
      enabled={capabilities.data?.activationV9 === true}
    />
  );
}
function ActivationScope({
  principal,
  companyId,
  enabled,
}: {
  principal: string;
  companyId: string | null;
  enabled: boolean;
}) {
  const { t } = useTranslation("experience"),
    { reloadCompanies, setSelectedCompanyId } = useCompany(),
    navigate = useNavigate(),
    client = useQueryClient(),
    params = useParams();
  const [name, setName] = useState(""),
    [website, setWebsite] = useState(""),
    [intent, setIntent] = useState(""),
    [purpose, setPurpose] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    error = useRef<HTMLDivElement>(null);
  const alive = useRef(true),
    exitAfterSave = useRef(false),
    creationAttempt = useRef<
      Parameters<typeof saasApi.createCompany>[1] | null
    >(null),
    commandAttempt = useRef<ActivationCommand | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = ["activation", companyId, principal];
  const run = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => activationApi.get(companyId!, principal, signal),
    enabled: !!companyId,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const current = run.isSuccess ? run.data : undefined;
  const step = current?.state.step;
  const canonicalScreen = step ? ACTIVATION_STEPS.indexOf(step) + 3 : 2;
  const requestedScreen = Number(params.screen);
  const screen =
    Number.isInteger(requestedScreen) &&
    requestedScreen >= 2 &&
    requestedScreen <= canonicalScreen
      ? requestedScreen
      : canonicalScreen;
  const isPast = screen < canonicalScreen;
  useEffect(() => {
    if (!current) return;
    setIntent(current.state.intent);
    setPurpose(current.state.companyPurpose);
    if (!params.screen || Number(params.screen) > canonicalScreen)
      navigate(`/saas/activation/${canonicalScreen}`, { replace: true });
  }, [current?.version, current?.runId]);
  useEffect(() => {
    heading.current?.focus();
  }, [screen]);
  const create = useMutation({
    mutationFn: () => {
      creationAttempt.current ??= {
        name,
        idempotencyKey: crypto.randomUUID(),
        activation: { version: 9, website },
      };
      return saasApi.createCompany(principal, creationAttempt.current);
    },
    retry: false,
    onSuccess: async (result) => {
      if (!alive.current) return;
      await reloadCompanies();
      if (alive.current) {
        setSelectedCompanyId(result.companyId);
        navigate("/saas/activation/3", { replace: true });
      }
    },
  });
  const command = useMutation({
    mutationFn: (input: ActivationCommand) => {
      commandAttempt.current ??= input;
      return activationApi.command(
        companyId!,
        principal,
        commandAttempt.current,
      );
    },
    retry: false,
    onSuccess: (result: ActivationView) => {
      if (!alive.current) return;
      commandAttempt.current = null;
      client.setQueryData(key, result);
      if (exitAfterSave.current) {
        exitAfterSave.current = false;
        navigate("/");
        return;
      }
      navigate(
        `/saas/activation/${ACTIVATION_STEPS.indexOf(result.state.step) + 3}`,
      );
    },
  });
  const failed = create.isError || command.isError;
  useEffect(() => {
    if (failed) error.current?.focus();
  }, [failed]);
  const pending = create.isPending || command.isPending,
    frozen = pending || !!creationAttempt.current || !!commandAttempt.current;
  const selected = current?.capabilities.find(
    (c) => c.versionId === current.state.packageVersionId,
  );
  const envelope = () => ({
    requestId: crypto.randomUUID(),
    expectedVersion: current!.version,
  });
  async function saveExit() {
    try {
      if (current?.state.step === "intent") {
        exitAfterSave.current = true;
        await command.mutateAsync({
          ...envelope(),
          operation: "save_draft",
          intent,
        });
        return;
      } else if (current?.state.step === "material_facts") {
        exitAfterSave.current = true;
        await command.mutateAsync({
          ...envelope(),
          operation: "save_draft",
          companyPurpose: purpose,
        });
        return;
      }
      if (alive.current) navigate("/");
    } catch {
      /* mutation alert retains the draft; never navigate on unknown outcome */
    }
  }
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <span className="font-semibold">August Works</span>
        <CustomerFeedbackDialog />
        <a
          href={FEEDBACK_CONTACTS.support}
          className="inline-flex min-h-11 items-center underline"
        >
          {t("help")}
        </a>
      </header>
      <p>{t("activation.stages")}</p>
      <h1 tabIndex={-1} ref={heading} className="text-2xl font-semibold">
        {t(`activation.screen${screen}`, {
          company: current?.companyName ?? name,
        })}
      </h1>
      {companyId && run.isPending ? (
        <p role="status">{t("activation.loading")}</p>
      ) : null}
      {companyId && run.isError ? (
        <div role="alert">
          <p>{t("activation.loadFailed")}</p>
          <Button className="min-h-11" onClick={() => void run.refetch()}>
            {t("tryAgain")}
          </Button>
          {run.error instanceof ApiError && run.error.status === 404 ? (
            <Link
              to="/saas/welcome?legacy=1"
              className="inline-flex min-h-11 items-center underline"
            >
              {t("activation.previousSetup")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <div ref={error} tabIndex={-1} role="alert" className="space-y-2">
          <p>{t("activation.saveFailed")}</p>
          <Button
            className="min-h-11"
            disabled={pending}
            onClick={() => {
              if (companyId && commandAttempt.current)
                command.mutate(commandAttempt.current);
              else create.mutate();
            }}
          >
            {t("tryAgain")}
          </Button>
          {companyId ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={pending}
              onClick={() => void run.refetch()}
            >
              {t("activation.refresh")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!enabled ? <p role="status">{t("activation.disabled")}</p> : null}
      {isPast ? <p>{t("activation.previousStep")}</p> : null}
      {current && screen === 2 ? (
        <dl className="space-y-3">
          <div>
            <dt>{t("activation.companyName")}</dt>
            <dd>{current.companyName}</dd>
          </div>
          <div>
            <dt>{t("activation.website")}</dt>
            <dd>{current.state.website || t("activation.notProvided")}</dd>
          </div>
        </dl>
      ) : null}
      {screen === 2 && !companyId ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label className="block space-y-2">
            <span>{t("activation.companyName")}</span>
            <Input
              className="min-h-11"
              autoComplete="organization"
              required
              maxLength={120}
              value={name}
              disabled={frozen}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-2">
            <span>{t("activation.website")}</span>
            <Input
              className="min-h-11"
              autoComplete="url"
              inputMode="url"
              maxLength={253}
              value={website}
              disabled={frozen}
              onChange={(event) => setWebsite(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {t("activation.websiteHelp")}
            </span>
          </label>
          <Button
            className="min-h-11"
            disabled={
              !enabled ||
              pending ||
              !!creationAttempt.current ||
              !name.trim() ||
              !activationWebsiteSchema.safeParse(website).success
            }
          >
            {t("activation.continue")}
          </Button>
        </form>
      ) : null}
      {current && screen === 3 ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            command.mutate({ ...envelope(), operation: "save_intent", intent });
          }}
        >
          <label className="block space-y-2">
            <span>{t("activation.goal")}</span>
            <Textarea
              required
              maxLength={4000}
              value={intent}
              disabled={frozen || isPast}
              onChange={(event) => setIntent(event.target.value)}
            />
          </label>
          {!isPast ? (
            <Button
              className="min-h-11"
              disabled={!enabled || frozen || !intent.trim()}
            >
              {t("activation.continue")}
            </Button>
          ) : null}
        </form>
      ) : null}
      {current && screen === 4 ? (
        <section className="space-y-4">
          <p>{t("activation.discoveryExplanation")}</p>
          <p>{t("activation.websiteUnused")}</p>
          {!isPast ? (
            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                disabled={!enabled || frozen}
                onClick={() =>
                  command.mutate({
                    ...envelope(),
                    operation: "build_customer_draft",
                  })
                }
              >
                {t("activation.buildDraft")}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!enabled || frozen}
                onClick={() =>
                  command.mutate({
                    ...envelope(),
                    operation: "build_customer_draft",
                  })
                }
              >
                {t("activation.tellInstead")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {current && screen === 5 ? (
        <section className="space-y-4">
          <ul className="space-y-3">
            {current.sources.map((source) => (
              <li key={source.id}>
                {t(`activation.source.${source.id}`)}:{" "}
                {t(`activation.sourceStatus.${source.status}`)}
              </li>
            ))}
          </ul>
          <p>{t("activation.noInferredFacts")}</p>
          {!isPast ? (
            <Button
              className="min-h-11"
              disabled={!enabled || frozen}
              onClick={() =>
                command.mutate({
                  ...envelope(),
                  operation: "continue_discovery",
                })
              }
            >
              {t("activation.continue")}
            </Button>
          ) : null}
        </section>
      ) : null}
      {current && screen === 6 ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            command.mutate({
              ...envelope(),
              operation: "confirm_material_facts",
              companyPurpose: purpose,
            });
          }}
        >
          <p>{t("activation.factExplanation")}</p>
          <label className="block space-y-2">
            <span>{t("activation.companyPurpose")}</span>
            <Textarea
              required
              maxLength={2000}
              value={purpose}
              disabled={frozen || isPast}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {t("activation.factSource")}
            </span>
          </label>
          {!isPast ? (
            <Button
              className="min-h-11"
              disabled={!enabled || frozen || !purpose.trim()}
            >
              {t("activation.looksRight")}
            </Button>
          ) : null}
        </form>
      ) : null}
      {current && screen === 7 ? (
        <section className="space-y-4">
          {!current.capabilities.length ? (
            <p role="status">{t("activation.noCapability")}</p>
          ) : (
            current.capabilities.map((capability) => (
              <article
                key={capability.versionId}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <h2 className="text-lg font-semibold">{capability.name}</h2>
                <p>{capability.purpose}</p>
                <p>{t("activation.automatic")}</p>
                <p>{t("activation.asksFirst")}</p>
                <p>
                  {t("activation.needs")}:{" "}
                  {capability.requiredConnections.join(", ") ||
                    t("activation.noConnections")}
                </p>
                <ul>
                  {capability.knownLimitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
                {!isPast ? (
                  <Button
                    className="min-h-11"
                    disabled={!enabled || frozen}
                    onClick={() =>
                      command.mutate({
                        ...envelope(),
                        operation: "select_capability",
                        packageVersionId: capability.versionId,
                      })
                    }
                  >
                    {t("activation.useAgent")}
                  </Button>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}
      {current && screen === 8 ? (
        <section className="space-y-4">
          <p>
            {selected?.requiredConnections.length
              ? t("activation.accessPending")
              : t("activation.noConnections")}
          </p>
          {selected?.requiredConnections.length ? (
            <ul>
              {selected.requiredConnections.map((connection) => (
                <li key={connection}>{connection}</li>
              ))}
            </ul>
          ) : null}
          <p>{t("activation.noGrants")}</p>
          {!isPast ? (
            <Button
              className="min-h-11"
              disabled={
                !enabled ||
                frozen ||
                !selected ||
                !!selected.requiredConnections.length
              }
              onClick={() =>
                command.mutate({ ...envelope(), operation: "continue_access" })
              }
            >
              {t("activation.continue")}
            </Button>
          ) : null}
        </section>
      ) : null}
      {current && screen >= 9 ? (
        <section className="space-y-4">
          <dl className="space-y-3">
            <div>
              <dt className="font-medium">{t("activation.goal")}</dt>
              <dd>{current.state.intent}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("activation.agent")}</dt>
              <dd>{selected?.name ?? t("activation.noCapability")}</dd>
            </div>
          </dl>
          <p>{t("activation.executionPending")}</p>
          <p>{t("activation.noRunStarted")}</p>
        </section>
      ) : null}
      {companyId ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-3">
            {screen > 2 ? (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => navigate(`/saas/activation/${screen - 1}`)}
              >
                {t("activation.back")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="min-h-11"
              disabled={pending || failed || !current}
              onClick={() => void saveExit()}
            >
              {t("activation.saveExit")}
            </Button>
          </div>
          {isPast ? (
            <Button
              className="min-h-11"
              disabled={pending}
              onClick={() => navigate(`/saas/activation/${canonicalScreen}`)}
            >
              {t("activation.resume")}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </main>
  );
}
