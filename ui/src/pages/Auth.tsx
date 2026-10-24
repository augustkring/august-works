import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "@/i18n";
import { ExperienceLanguageSelect } from "../components/ExperienceLanguageSelect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "@/lib/router";
import { authApi, parseTwoFactorSignInChallenge, type TwoFactorSignInChallenge } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { getRememberedInvitePath } from "../lib/invite-memory";
import { Button } from "@/components/ui/button";
import { AsciiArtAnimation } from "@/components/AsciiArtAnimation";
import { PaperclipLoading } from "@/components/AnimatedPaperclipIcon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Link } from "@/lib/router";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import { hasValidNewLocalPasswordLength, LOCAL_PASSWORD_MAX_LENGTH, LOCAL_PASSWORD_MAX_UTF16_LENGTH, LOCAL_PASSWORD_MIN_LENGTH } from "@paperclipai/shared/local-password-policy";

type AuthMode = "sign_in" | "sign_up";

function challengeFromRouteState(state: unknown): TwoFactorSignInChallenge | null {
  if (!state || typeof state !== "object") return null;
  try {
    // Router state only selects the challenge view; Better Auth's signed
    // challenge cookie remains the authority at either verification endpoint.
    return parseTwoFactorSignInChallenge((state as Record<string, unknown>).twoFactorChallenge);
  } catch {
    return null;
  }
}

export function AuthPage() {
  const { t } = useTranslation("experience");
  const saas = useSaasCapabilities();
  const [verificationSent, setVerificationSent] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorSignInChallenge | null>(() => challengeFromRouteState(location.state));
  const [challengeMethod, setChallengeMethod] = useState<"totp" | "backup_code">("totp");
  const [challengeCode, setChallengeCode] = useState("");
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

  const finishSignIn = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.health });
    // Reset rather than invalidate: the company list is shared app-wide and
    // sign-in can change accounts.
    await queryClient.resetQueries({ queryKey: queryKeys.companies.all });
    navigate(nextPath, { replace: true });
  };

  const ssoMutation = useMutation({mutationFn:()=>authApi.signInSso(email,nextPath,searchParams.get("ssoProvider")??undefined),onSuccess:(url)=>window.location.assign(url),onError:()=>setError("authFlow.companyFailed")});
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "sign_in") {
        return { mode: "sign_in" as const, challenge: await authApi.signInEmail({ email: email.trim(), password }) };
      }
      await authApi.signUpEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      return { mode: "sign_up" as const };
    },
    onSuccess: async (result) => {
      setError(null);
      if (result.mode === "sign_in" && result.challenge) {
        setChallenge(result.challenge);
        setChallengeMethod("totp");
        setChallengeCode("");
        setPassword("");
        return;
      }
      if (result.mode === "sign_up" && saas.data?.emailVerification) { setVerificationSent(true); return; }
      await finishSignIn();
    },
    onError: (err) => {
      const code = err && typeof err === "object" && "code" in err ? err.code : null;
      setError(code === "INVALID_EMAIL_OR_PASSWORD" || (err instanceof Error && err.message === "Invalid email or password")
        ? "authFlow.credentialsInvalid"
        : code === "PASSWORD_TOO_COMMON" ? "authFlow.passwordTooCommon"
          : code === "PASSWORD_TOO_SHORT" ? "authFlow.passwordTooShort"
            : code === "PASSWORD_TOO_LONG" ? "authFlow.passwordTooLong" : "authFlow.failed");
    },
  });

  const challengeMutation = useMutation({
    mutationFn: ({ method, code }: { method: "totp" | "backup_code"; code: string }) =>
      method === "totp" ? authApi.verifyTotp(code) : authApi.verifyBackupCode(code),
    onSuccess: async () => {
      setError(null);
      try {
        // The verification response alone is not treated as an authenticated
        // session; confirm Better Auth's cookie with its canonical session API.
        const verifiedSession = await authApi.getSession();
        if (!verifiedSession) {
          setError("authFlow.challengeFailed");
          return;
        }
        setChallenge(null);
        setChallengeCode("");
        queryClient.setQueryData(queryKeys.auth.session, verifiedSession);
        await finishSignIn();
      } catch {
        setError("authFlow.challengeFailed");
      }
    },
    onError: () => setError("authFlow.challengeInvalid"),
  });

  const challengeAvailable = Boolean(challenge?.twoFactorMethods.includes("totp"));
  const canSubmit =
    challenge
      ? challengeAvailable && challengeCode.trim().length > 0
      : email.trim().length > 0 &&
        (mode === "sign_in"
          ? password.length > 0
          : name.trim().length > 0 && hasValidNewLocalPasswordLength(password));

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
            <p className="text-xl font-semibold">{PRODUCT_IDENTITY.productName}</p>
          </div>

          <h1 className="text-xl font-semibold">
            {challenge ? t("authFlow.challengeTitle") : mode === "sign_in" ? (saas.data ? t("authFlow.signInTitle", { productName: PRODUCT_IDENTITY.productName }) : t("authFlow.legacySignInTitle", { productName: PRODUCT_IDENTITY.productName })) : (saas.data ? t("authFlow.createTitle") : t("authFlow.legacyCreateTitle", { productName: PRODUCT_IDENTITY.productName }))}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {challenge ? t("authFlow.challengeHelp") : mode === "sign_in"
              ? t("authFlow.signInHelp")
              : saas.data?.emailVerification ? t("authFlow.verifyHelp") : t("authFlow.legacyCreateHelp")}
          </p>
          {verificationSent && <p role="status" className="saas-muted">{t("authFlow.verificationSent")}</p>}
          {searchParams.get("accountDeletion") === "requested" && <p role="status" className="saas-muted">{t("authFlow.deletionRequested")}</p>}

          <form
            className="mt-6 space-y-4"
            method="post"
            action={challenge ? undefined : mode === "sign_up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"}
            onSubmit={(event) => {
              event.preventDefault();
              if (challenge) {
                if (challengeMutation.isPending) return;
                if (!canSubmit) {
                  setError(challengeAvailable ? "authFlow.requiredFields" : "authFlow.challengeUnavailable");
                  return;
                }
                challengeMutation.mutate({ method: challengeMethod, code: challengeCode.trim() });
                return;
              }
              if (mutation.isPending) return;
              if (!canSubmit) {
                setError(mode === "sign_up" && name.trim() && email.trim() && password.length > 0
                  ? ((password.length > LOCAL_PASSWORD_MAX_UTF16_LENGTH || [...password].length > LOCAL_PASSWORD_MAX_LENGTH) ? "authFlow.passwordTooLong" : "authFlow.passwordTooShort")
                  : "authFlow.requiredFields");
                return;
              }
              mutation.mutate();
            }}
          >
            {challenge ? (
              <>
                {!challengeAvailable ? (
                  <p role="status" className="text-sm text-muted-foreground">{t("authFlow.challengeUnavailable")}</p>
                ) : (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="text-xs text-muted-foreground">{t("authFlow.challengeMethod")}</legend>
                      <div className="flex gap-2">
                        <Button type="button" disabled={challengeMutation.isPending} variant={challengeMethod === "totp" ? "default" : "outline"} aria-pressed={challengeMethod === "totp"} onClick={() => { setChallengeMethod("totp"); setChallengeCode(""); setError(null); }}>
                          {t("authFlow.challengeTotp")}
                        </Button>
                        <Button type="button" disabled={challengeMutation.isPending} variant={challengeMethod === "backup_code" ? "default" : "outline"} aria-pressed={challengeMethod === "backup_code"} onClick={() => { setChallengeMethod("backup_code"); setChallengeCode(""); setError(null); }}>
                          {t("authFlow.challengeBackupCode")}
                        </Button>
                      </div>
                    </fieldset>
                    <div>
                      <label htmlFor="two-factor-code" className="text-xs text-muted-foreground mb-1 block">{challengeMethod === "totp" ? t("authFlow.challengeTotpLabel") : t("authFlow.challengeBackupCodeLabel")}</label>
                      <input
                        id="two-factor-code"
                        name="code"
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        type="text"
                        inputMode={challengeMethod === "totp" ? "numeric" : "text"}
                        autoComplete="one-time-code"
                        value={challengeCode}
                        onChange={(event) => setChallengeCode(event.target.value)}
                        required
                        aria-required="true"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        autoFocus
                      />
                    </div>
                  </>
                )}
                {error && <p ref={errorSummary} tabIndex={-1} id={errorId} role="alert" className="text-xs text-destructive">{t(error)}</p>}
                <Button type="submit" disabled={challengeMutation.isPending || !challengeAvailable} aria-disabled={!canSubmit || challengeMutation.isPending} className={`w-full ${!canSubmit && !challengeMutation.isPending ? "opacity-50" : ""}`}>
                  {challengeMutation.isPending ? t("authFlow.working") : t("authFlow.challengeVerify")}
                </Button>
                <Button type="button" variant="outline" disabled={challengeMutation.isPending} className="w-full" onClick={() => {
                  setChallenge(null);
                  setChallengeCode("");
                  setPassword("");
                  setError(null);
                  navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
                }}>
                  {t("authFlow.challengeBack")}
                </Button>
              </>
            ) : <>
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
                minLength={mode === "sign_up" ? LOCAL_PASSWORD_MIN_LENGTH : undefined}
                maxLength={mode === "sign_up" ? LOCAL_PASSWORD_MAX_UTF16_LENGTH : undefined}
                required
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
            {mode === "sign_up" && <p className="text-sm text-muted-foreground">{t("authFlow.passwordMinimum")}</p>}
            {error && (
              <p ref={errorSummary} tabIndex={-1} id={errorId} role="alert" className="text-xs text-destructive">
                {t(error)}
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
            </>}
          </form>
          {!challenge && mode === "sign_in" && saas.data?.enterpriseSso ? <Button className="w-full mt-3" variant="outline" disabled={!email.trim() || ssoMutation.isPending || mutation.isPending} onClick={() => ssoMutation.mutate()}>{t("authFlow.companySso")}</Button> : null}

          {!challenge && (!saas.data || saas.data.signup || mode === "sign_up") && <div className="mt-5 text-sm text-muted-foreground">
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
          {!challenge && saas.data && <p className="saas-muted"><Link className="saas-link" to="/saas/reset-password">{t("authFlow.forgotPassword")}</Link></p>}
        </div>
      </div>

      {/* Right half — ASCII art animation (hidden on mobile) */}
      <div className="hidden md:block w-1/2 overflow-hidden">
        <AsciiArtAnimation />
      </div>
    </main>
  );
}
