import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "@/i18n";
import { ExperienceLanguageSelect } from "../components/ExperienceLanguageSelect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Link } from "@/lib/router";

type AuthMode = "sign_in" | "sign_up";

export function AuthPage() {
  const { t } = useTranslation("experience");
  const saas = useSaasCapabilities();
  const [verificationSent, setVerificationSent] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = "auth-error";
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  const nextPath = useMemo(
    () => {
      const path = searchParams.get("next") || getRememberedInvitePath() || (saas.data ? "/saas/welcome" : "/");
      return /^\/(?!\/)/.test(path) && !/[\\\r\n]/.test(path) ? path : "/";
    },
    [searchParams, saas.data],
  );
  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  useEffect(() => {
    if (session) {
      navigate(nextPath, { replace: true });
    }
  }, [session, navigate, nextPath]);

  const ssoMutation = useMutation({mutationFn:()=>authApi.signInSso(email,nextPath,searchParams.get("ssoProvider")??undefined),onSuccess:(url)=>window.location.assign(url),onError:()=>setError("authFlow.companyFailed")});
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        await authApi.signInEmail({ email: email.trim(), password });
        return;
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    },
    onSuccess: async () => {
      setError(null);
      if (mode === "sign_up" && saas.data?.emailVerification) { setVerificationSent(true); return; }
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
      // Reset rather than invalidate: the `["companies"]` entry is shared app-wide and
      // is not account-scoped, so invalidating leaves the previous account's list
      // readable (and any fetch for that session in flight) until the refetch lands.
      // Sign-in can change accounts, so drop the list outright.
      await queryClient.resetQueries({ queryKey: queryKeys.companies.all });
      navigate(nextPath, { replace: true });
    },
    onError: (err) => {
      const code = err && typeof err === "object" && "code" in err ? err.code : null;
      setError(code === "INVALID_EMAIL_OR_PASSWORD" || (err instanceof Error && err.message === "Invalid email or password")
        ? "authFlow.credentialsInvalid" : "authFlow.failed");
    },
  });

  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (mode === "sign_in" || (name.trim().length > 0 && password.trim().length >= (saas.data ? 12 : 8)));

  if (isSessionLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PaperclipLoading className="min-h-0" />
      </div>
    );
  }

  return (
    <main className="fixed inset-0 flex bg-background">
      <div className="absolute top-4 right-4 z-10 flex flex-wrap items-center justify-end gap-3">
        {saas.data && <ExperienceLanguageSelect />}
        <ThemeToggle />
      </div>
      {/* Left half — form */}
      <div className="w-full md:w-1/2 flex flex-col overflow-y-auto">
        <div className="w-full max-w-md mx-auto my-auto px-8 py-12">
          <div className="mb-8">
            <p className="text-xl font-semibold">Blentera</p>
          </div>

          <h1 className="text-xl font-semibold">
            {mode === "sign_in" ? (saas.data ? t("authFlow.signInTitle") : t("authFlow.legacySignInTitle")) : (saas.data ? t("authFlow.createTitle") : t("authFlow.legacyCreateTitle"))}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "sign_in"
              ? t("authFlow.signInHelp")
              : saas.data?.emailVerification ? t("authFlow.verifyHelp") : t("authFlow.legacyCreateHelp")}
          </p>
          {verificationSent && <p role="status" className="saas-muted">{t("authFlow.verificationSent")}</p>}
          {searchParams.get("accountDeletion") === "requested" && <p role="status" className="saas-muted">{t("authFlow.deletionRequested")}</p>}

          <form
            className="mt-6 space-y-4"
            method="post"
            action={mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError(mode === "sign_up" && name.trim() && email.trim() && password.trim()
                  ? "authFlow.passwordTooShort" : "authFlow.requiredFields");
                return;
              }
              mutation.mutate();
            }}
          >
            {mode === "sign_up" && (
              <div>
                <label htmlFor="name" className="text-xs text-muted-foreground mb-1 block">{t("authFlow.name")}</label>
                <input
                  id="name"
                  name="name"
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  aria-required="true"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  autoFocus
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="text-xs text-muted-foreground mb-1 block">{t("authFlow.email")}</label>
              <input
                id="email"
                name="email"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                autoFocus={mode === "sign_in"}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-xs text-muted-foreground mb-1 block">{t("authFlow.password")}</label>
              <input
                id="password"
                name="password"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                minLength={mode === "sign_up" ? (saas.data ? 12 : 8) : undefined}
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            {mode === "sign_up" && <p className="text-sm text-muted-foreground">{t("authFlow.passwordMinimum", { count: saas.data ? 12 : 8 })}</p>}
            {error && (
              <p ref={errorSummary} tabIndex={-1} id={errorId} role="alert" className="text-xs text-destructive">
                {t(error, { count: saas.data ? 12 : 8 })}
              </p>
            )}
            <Button
              type="submit"
              disabled={mutation.isPending}
              aria-disabled={!canSubmit || mutation.isPending}
              className={`w-full ${!canSubmit && !mutation.isPending ? "opacity-50" : ""}`}
            >
              {mutation.isPending
                ? t("authFlow.working")
                : mode === "sign_in"
                  ? t("authFlow.signIn")
                  : saas.data ? t("authFlow.continue") : t("authFlow.createLegacy")}
            </Button>
          </form>
          {mode === "sign_in" && saas.data?.enterpriseSso ? <Button className="w-full mt-3" variant="outline" disabled={!email.trim() || ssoMutation.isPending || mutation.isPending} onClick={() => ssoMutation.mutate()}>{t("authFlow.companySso")}</Button> : null}

          {(!saas.data || saas.data.signup || mode === "sign_up") && <div className="mt-5 text-sm text-muted-foreground">
            {mode === "sign_in" ? t("authFlow.needAccount") : t("authFlow.alreadyAccount")}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-2"
              onClick={() => {
                setError(null);
                setMode(mode === "sign_in" ? "sign_up" : "sign_in");
              }}
            >
              {mode === "sign_in" ? t("authFlow.createOne") : t("authFlow.signInLink")}
            </button>
          </div>}
          {saas.data && <p className="saas-muted"><Link className="saas-link" to="/saas/reset-password">{t("authFlow.forgotPassword")}</Link></p>}
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </main>
  );
}
