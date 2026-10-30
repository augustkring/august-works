import { useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { saasAuthAction } from "@/api/saas";
import { Button } from "@/components/ui/button";
import { ExperienceLanguageSelect } from "@/components/ExperienceLanguageSelect";
import { Link, useSearchParams } from "@/lib/router";
import { hasValidNewLocalPasswordLength, LOCAL_PASSWORD_MAX_UTF16_LENGTH, LOCAL_PASSWORD_MIN_LENGTH } from "@paperclipai/shared/local-password-policy";

export function SaasResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || null;
  // A different recovery link is a different private owner. It cannot inherit
  // the previous password, pending acknowledgement or success claim.
  return <PasswordResetForm key={token ? `token:${token}` : "request"} token={token} />;
}

function PasswordResetForm({ token }: { token: string | null }) {
  const { t } = useTranslation("experience");
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const heading = useRef<HTMLHeadingElement>(null), error = useRef<HTMLParagraphElement>(null), receipt = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: () => token
      ? saasAuthAction("reset-password", { token, newPassword: password })
      : saasAuthAction("request-password-reset", { email, redirectTo: window.location.origin + "/saas/reset-password" }),
    retry: false, gcTime: 0,
    onSuccess: () => setPassword(""),
    onSettled: () => { submitting.current = false; },
  });
  useLayoutEffect(() => {
    // Focus before paint so an asynchronous result does not interrupt input
    // already started after the next visible frame.
    if (mutation.isError) error.current?.focus();
    else if (mutation.isSuccess) receipt.current?.focus();
    else if (mutation.isIdle) heading.current?.focus();
  }, [mutation.status]);
  const errorCode = mutation.error && typeof mutation.error === "object" && "code" in mutation.error
    ? mutation.error.code : null;
  const passwordErrorKey = errorCode === "PASSWORD_TOO_COMMON" ? "passwordTooCommon"
    : errorCode === "PASSWORD_TOO_SHORT" ? "passwordTooShort"
      : errorCode === "PASSWORD_TOO_LONG" ? "passwordTooLong" : null;
  return <main className="saas-page">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 ref={heading} tabIndex={-1} className="saas-title outline-none">{t(token ? "passwordReset.setTitle" : "passwordReset.requestTitle")}</h1>
      <ExperienceLanguageSelect />
    </header>
    {mutation.isError && <p ref={error} tabIndex={-1} role="alert" className="saas-error outline-none">
      {token && passwordErrorKey
        ? t(`passwordReset.${passwordErrorKey}`)
        : t(token ? "passwordReset.changeUnconfirmed" : "passwordReset.requestUnconfirmed")}
    </p>}
    {mutation.isSuccess ? <p ref={receipt} tabIndex={-1} role="status" className="outline-none">
      {t(token ? "passwordReset.changed" : "passwordReset.requested")}
    </p> : <form className="saas-section" onSubmit={event => {
      event.preventDefault();
      if (submitting.current || mutation.isPending) return;
      // Native authentication remains authoritative; never send an empty or
      // undersized value through a programmatically dispatched submission.
      if (token ? !hasValidNewLocalPasswordLength(password) : !email.trim()) return;
      submitting.current = true; mutation.mutate();
    }}>
      {token ? <label className="saas-label">{t("passwordReset.password")}
        <input className="saas-input" type="password" autoComplete="new-password" minLength={LOCAL_PASSWORD_MIN_LENGTH} maxLength={LOCAL_PASSWORD_MAX_UTF16_LENGTH}
          required disabled={mutation.isPending} value={password} onChange={event => setPassword(event.target.value)} />
        <span className="saas-muted">{t("passwordReset.passwordMinimum")}</span>
      </label> : <label className="saas-label">{t("passwordReset.email")}
        <input className="saas-input" type="email" autoComplete="email" required disabled={mutation.isPending}
          value={email} onChange={event => setEmail(event.target.value)} />
      </label>}
      <div className="saas-footer">
        <Link className="saas-link" to="/auth">{t("passwordReset.back")}</Link>
        <Button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>
          {t(mutation.isPending ? token ? "passwordReset.changing" : "passwordReset.sending" : token ? "passwordReset.change" : "passwordReset.send")}
        </Button>
      </div>
    </form>}
    {mutation.isSuccess && <Link className="saas-link" to="/auth">{t("passwordReset.signIn")}</Link>}
  </main>;
}
