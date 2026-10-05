import { useCompany } from "@/context/CompanyContext";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi, saasAuthAction } from "@/api/saas";
import { Button } from "@/components/ui/button";
import { Link, useSearchParams } from "@/lib/router";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { useAccountIdentity } from "@/api/companies-query";

export function SaasAccountPage() {
  const capabilities = useSaasCapabilities();
  const identity = useAccountIdentity();
  const { selectedCompanyId } = useCompany();
  const scope = identity.userId + ":" + selectedCompanyId;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const preferences = useQuery({
    queryKey: ["saas-notification-preferences", identity.userId],
    queryFn: () => saasApi.notificationPreferences(identity.userId!),
    enabled: Boolean(identity.userId && capabilities.data?.notifications),
  });
  const preference = useMutation({
    mutationFn: (input: {
      category: "security" | "billing" | "runtime" | "approval" | "work_update";
      emailEnabled: boolean;
    }) =>
      saasApi.updateNotificationPreference(
        selectedCompanyId!,
        identity.userId!,
        input,
      ),
    onSuccess: () => currentScope.current === scope && preferences.refetch(),
  });
  const receipts = useQuery({
    queryKey: ["saas-deletion-receipts", identity.userId],
    queryFn: () => saasApi.deletionReceipts(identity.userId!),
    enabled: Boolean(identity.userId && capabilities.data?.deletion),
    refetchInterval: 30000,
  });
  const sessions = useQuery({
    queryKey: ["saas-account-sessions", identity.userId],
    queryFn: () => saasApi.sessions(identity.userId!),
    enabled: Boolean(identity.userId && capabilities.data),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => saasApi.revokeSession(id, identity.userId!),
    onSuccess: () => currentScope.current === scope && sessions.refetch(),
  });
  useEffect(() => {
    preference.reset();
    revoke.reset();
  }, [scope]);
  return (
    <main className="saas-page">
      <h1 className="saas-title">Account security</h1>
      {(sessions.error || revoke.error) && (
        <p role="alert" className="saas-error">
          {(sessions.error ?? revoke.error)?.message}
        </p>
      )}
      <p className="saas-muted">
        Revoke a session to sign that device out. Resetting your password
        revokes all existing sessions.
      </p>
      {sessions.data?.map((session) => (
        <div className="saas-row" key={session.id}>
          <span>Signed in {new Date(session.createdAt).toLocaleString()}</span>
          <Button
            variant="outline"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(session.id)}
          >
            Revoke session
          </Button>
        </div>
      ))}
      {receipts.data && receipts.data.length > 0 && (
        <section className="saas-section" aria-label="Deletion receipts">
          <h2 className="saas-subtitle">Organization deletion receipts</h2>
          {receipts.data.map((receipt) => (
            <p key={receipt.id}>
              <span className="saas-machine">{receipt.companyId}</span>:{" "}
              {receipt.status.replaceAll("_", " ")} ·{" "}
              {receipt.stage.replaceAll("_", " ")}
            </p>
          ))}
        </section>
      )}
      {capabilities.data?.notifications && (
        <section className="saas-section" aria-label="Email preferences">
          <h2 className="saas-subtitle">Email preferences</h2>
          <p className="saas-muted">
            Security emails remain enabled. In-app updates remain available when
            optional email is disabled.
          </p>
          {(preferences.error || preference.error) && (
            <p role="alert" className="saas-error">
              {(preferences.error ?? preference.error)?.message}
            </p>
          )}
          {preferences.data?.map((item) => (
            <label className="saas-row" key={item.category}>
              <span>{item.category}</span>
              <input
                type="checkbox"
                checked={item.emailEnabled}
                disabled={
                  item.category === "security" ||
                  preference.isPending ||
                  !selectedCompanyId
                }
                onChange={(event) =>
                  preference.mutate({
                    ...item,
                    emailEnabled: event.target.checked,
                  })
                }
              />
            </label>
          ))}
        </section>
      )}
      <Link className="saas-link" to="/saas/reset-password">
        Reset password
      </Link>
    </main>
  );
}
export function SaasResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      token
        ? saasAuthAction("reset-password", { token, newPassword: password })
        : saasAuthAction("request-password-reset", {
            email,
            redirectTo: window.location.origin + "/saas/reset-password",
          }),
  });
  return (
    <main className="saas-page">
      <h1 className="saas-title">
        {token ? "Set a new password" : "Reset password"}
      </h1>
      {mutation.error && (
        <p role="alert" className="saas-error">
          {mutation.error.message}
        </p>
      )}
      {mutation.isSuccess ? (
        <p role="status">
          {token
            ? "Your password has been changed. Sign in with your new password."
            : "If this email has an account, a reset link will arrive shortly."}
        </p>
      ) : (
        <form
          className="saas-section"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          {token ? (
            <label className="saas-label">
              New password
              <input
                className="saas-input"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          ) : (
            <label className="saas-label">
              Email
              <input
                className="saas-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          <div className="saas-footer">
            <Link className="saas-link" to="/auth">
              Back to sign in
            </Link>
            <Button type="submit" disabled={mutation.isPending}>
              {token ? "Change password" : "Send reset link"}
            </Button>
          </div>
        </form>
      )}
      {mutation.isSuccess && (
        <Link className="saas-link" to="/auth">
          Sign in
        </Link>
      )}
    </main>
  );
}
