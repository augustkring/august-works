import { ExperienceObservationSettings } from "../components/ExperienceObservationSettings";
import { Fragment } from "react";
import { NotificationChannelSettings } from "../components/NotificationChannelSettings";
import { useCompany } from "@/context/CompanyContext";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9AccountScope } from "../hooks/useV9AccountScope";
import { queryKeys } from "../lib/queryKeys";
import { ApiError } from "../api/client";
import { useTranslation } from "react-i18next";
import { authSessionSchema, type SaasNotificationPreference } from "@paperclipai/shared";
import { LOCAL_PASSWORD_MAX_UTF16_LENGTH } from "@paperclipai/shared/local-password-policy";
import { readPendingAccountDeletion, retainPendingAccountDeletion, clearPendingAccountDeletion } from "../lib/pending-account-deletion";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { NotificationPolicySettings } from "../components/NotificationPolicySettings";
import { NativeAuthenticationSettings } from "../components/NativeAuthenticationSettings";

export function SaasAccountPage() {
  const { t } = useTranslation("experience");
  const identity = useV9CurrentAccount();
  const client = useQueryClient();
  const { selectedCompanyId } = useCompany();
  if (!identity.userId || identity.localImplicit)
    return <section className="saas-page" aria-labelledby="account-security-title"><h1 id="account-security-title" className="saas-title">{t("account.heading")}</h1>
      <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "account.checkFailed" : identity.settled ? "account.signInRequired" : "account.checking")}</p>
      {identity.failed && <Button variant="outline" className="min-h-11" onClick={() => { void client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); }}>{t("account.retry")}</Button>}
      {identity.settled && <Link className="saas-link" to="/auth">{t("account.signIn")}</Link>}
    </section>;
  // A company change changes only the audit context for preferences. Account
  // deletion and its original request key remain bound to this personal account.
  return <AccountSecurityScope key={identity.userId} principal={identity.userId} companyId={selectedCompanyId} />;
}

function AccountSecurityScope({ principal, companyId }: { principal: string; companyId: string | null }) {
  const { t, i18n } = useTranslation("experience"), scope = useV9AccountScope(principal);
  const capabilities = useSaasCapabilities(), client = useQueryClient();
  const interruptionPolicy = useV9FeatureEnabled("notification_policy_v9");
  const company = useRef(companyId); company.current = companyId;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!scope.ready) return;
    const active = document.activeElement, section = heading.current?.closest("section");
    // A current-source acknowledgement may arrive after the form is visible.
    // Preserve an interaction already started in this account's controls.
    if (active instanceof HTMLElement && section?.contains(active) &&
      active.matches("input, select, textarea, button, a[href]")) return;
    heading.current?.focus();
  }, [scope.ready, scope.epoch]);
  const preferenceKey = ["saas-notification-preferences", principal, scope.epoch] as const;
  const preferences = useQuery({ queryKey: preferenceKey,
    queryFn: ({ signal }) => scope.read(() => saasApi.notificationPreferences(principal, signal), "notifications"),
    enabled: scope.ready && capabilities.data?.notifications === true, staleTime: 0, gcTime: 0, retry: false });
  const receipts = useQuery({ queryKey: ["saas-deletion-receipts", principal, scope.epoch],
    queryFn: ({ signal }) => scope.read(() => saasApi.deletionReceipts(principal, signal), "deletion"),
    enabled: scope.ready && capabilities.data?.deletion === true, staleTime: 0, gcTime: 0, retry: false, refetchInterval: 30000 });
  const sessions = useQuery({ queryKey: ["saas-account-sessions", principal, scope.epoch],
    queryFn: ({ signal }) => scope.read(() => saasApi.sessions(principal, signal)),
    enabled: scope.ready, staleTime: 0, gcTime: 0, retry: false });
  const authentication = useQuery({ queryKey: ["saas-account-authentication", principal, scope.epoch],
    queryFn: () => scope.read(() => {
      const current = authSessionSchema.safeParse(client.getQueryData(queryKeys.auth.session));
      if (!current.success || current.data.user.id !== principal) throw new Error("Current account is unresolved");
      return authApi.securityStatus(principal, undefined, current.data.session.id);
    }, "deletion"), enabled: scope.ready && capabilities.data?.deletion === true, staleTime: 0, gcTime: 0, retry: false });
  const ssoReauth = useQuery({ queryKey: ["saas-account-deletion-sso", principal, scope.epoch],
    queryFn: () => scope.read(() => {
      const current = authSessionSchema.safeParse(client.getQueryData(queryKeys.auth.session));
      if (!current.success || current.data.user.id !== principal) throw new Error("Current account is unresolved");
      return authApi.accountDeletionSsoStatus(principal, current.data.session.id);
    }, "deletion"), enabled: scope.ready && capabilities.data?.deletion === true && authentication.isSuccess &&
      !authentication.data.hasPassword && !authentication.data.twoFactorEnabled && !authentication.data.phishingResistantRequired,
    staleTime: 0, gcTime: 0, retry: false });
  const callbackReauthId = (() => {
    try { return new URLSearchParams(window.location.search).get("accountDeletionReauth"); } catch { return null; }
  })();
  const preferencesCurrent = () => {
    const state = client.getQueryState(preferenceKey);
    return scope.canUse("notifications") && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  };
  const preference = useMutation({
    mutationFn: async (input: { category: SaasNotificationPreference["category"]; emailEnabled: boolean }) => {
      if (!preferencesCurrent() || !companyId || company.current !== companyId)
        throw new Error("Current preference access is unresolved");
      const epoch = scope.epoch;
      await saasApi.updateNotificationPreference(companyId, principal, input);
      return { epoch, companyId };
    }, retry: false,
    onSuccess: (result) => {
      if (scope.isCurrent(result.epoch, "notifications") && company.current === result.companyId) void preferences.refetch();
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      if (!scope.canUse() || !sessions.isSuccess || sessions.isFetching ||
        !sessions.data.some(session => session.id === id)) throw new Error("Current sessions must finish loading");
      const state = client.getQueryState(["saas-account-sessions", principal, scope.epoch]);
      if (state?.fetchStatus !== "idle" || state.isInvalidated) throw new Error("Current sessions are unresolved");
      const epoch = scope.epoch;
      await saasApi.revokeSession(id, principal);
      return { epoch };
    }, retry: false,
    onSuccess: (result) => { if (scope.isCurrent(result.epoch)) void sessions.refetch(); },
  });
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [ssoReauthError, setSsoReauthError] = useState(false);
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [deletionUnconfirmed, setDeletionUnconfirmed] = useState(false);
  const [initialRecovery] = useState(() => {
    try {
      const key = readPendingAccountDeletion(principal);
      return { key: key ?? crypto.randomUUID(), pending: !!key, unavailable: false };
    } catch { return { key: null, pending: true, unavailable: true }; }
  });
  const deleteKey = useRef<string | null>(initialRecovery.key);
  const [recoveringDeletion, setRecoveringDeletion] = useState(initialRecovery.pending);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(initialRecovery.unavailable);
  const hadUnknownAcceptance = useRef(initialRecovery.pending);
  const deletionInFlight = useRef(false);
  const beginSsoReauth = useMutation({
    mutationFn: async () => {
      if (!scope.canUse("deletion") || !authentication.data || authentication.data.hasPassword ||
        authentication.data.twoFactorEnabled || authentication.data.phishingResistantRequired || !ssoReauth.data?.available)
        throw new Error("A supported recent sign-in method is unavailable");
      const current = authSessionSchema.safeParse(client.getQueryData(queryKeys.auth.session));
      if (!current.success || current.data.user.id !== principal) throw new Error("Current account is unresolved");
      const epoch = scope.epoch;
      const challenge = await authApi.startAccountDeletionSso(principal, current.data.session.id);
      const target = await authApi.signInAccountDeletionSso(challenge.providerId, challenge.callbackURL, principal, current.data.session.id);
      if (!scope.isCurrent(epoch, "deletion")) throw new Error("Account access changed during sign-in");
      return { epoch, target };
    }, retry: false,
    onSuccess: ({ epoch, target }) => { if (scope.isCurrent(epoch, "deletion")) window.location.assign(target); },
    onError: () => { if (scope.canUse("deletion")) setSsoReauthError(true); },
  });
  const readyProofId = ssoReauth.data?.ready && callbackReauthId && ssoReauth.data.challengeId === callbackReauthId
    ? ssoReauth.data.challengeId : null;
  const deletionAttempt = useRef<Parameters<typeof saasApi.deleteAccount>[1] | null>(null);
  const deletion = useMutation({
    mutationFn: async () => {
      if (!scope.canUse("deletion")) throw new Error("Current account access is unresolved");
      if (recoveryUnavailable || !deleteKey.current) throw new Error("Account deletion recovery is unavailable");
      if (!deletionAttempt.current) {
        const proof = authentication.data?.hasPassword ? null : readyProofId;
        if (deleteConfirmation !== "DELETE MY ACCOUNT" || (!deletePassword && !proof) || !exportAcknowledged)
          throw new Error("Explicit account deletion confirmation required");
        // Retain only the original account/key locator before any transport.
        // A reopened form still requires fresh explicit consent and password.
        try { retainPendingAccountDeletion(principal, deleteKey.current); }
        catch (error) { setRecoveryUnavailable(true); throw error; }
        deletionAttempt.current = { confirmation: "DELETE MY ACCOUNT", ...(deletePassword ? { password: deletePassword } : { reauthenticationProofId: proof! }),
          acknowledgeExport: true, idempotencyKey: deleteKey.current };
      }
      try { retainPendingAccountDeletion(principal, deletionAttempt.current.idempotencyKey); }
      catch (error) { setRecoveryUnavailable(true); throw error; }
      const epoch = scope.epoch;
      setDeletionUnconfirmed(false);
      const pending = deletionAttempt.current;
      await saasApi.deleteAccount(principal, pending);
      return { epoch, idempotencyKey: pending.idempotencyKey };
    }, retry: false,
    onSuccess: (result) => {
      if (!scope.isMounted()) return;
      if (!scope.isCurrent(result.epoch, "deletion")) { hadUnknownAcceptance.current = true; setRecoveringDeletion(true); setDeletionUnconfirmed(true); return; }
      try { clearPendingAccountDeletion(principal, result.idempotencyKey); }
      catch { /* A current Native acknowledgement still owns the outcome. */ }
      deletionAttempt.current = null; setDeletePassword("");
      window.location.assign("/auth?accountDeletion=requested");
    },
    onError: (error) => {
      if (!scope.isMounted()) return;
      // These Native refusals establish that this request was not accepted.
      // A lost reply/401/5xx keeps the exact in-memory body and original key.
      if (scope.canUse("deletion") && error instanceof ApiError && [400, 403, 409, 422].includes(error.status)) {
        try {
          // Refusing a retry says nothing about an earlier unknown acceptance.
          // Release its authenticator for correction, retaining the original key.
          if (!hadUnknownAcceptance.current) clearPendingAccountDeletion(principal, deleteKey.current!);
          deletionAttempt.current = null; setRecoveringDeletion(hadUnknownAcceptance.current); setDeletionUnconfirmed(hadUnknownAcceptance.current);
        } catch { setRecoveryUnavailable(true); }
      } else if (deletionAttempt.current) { hadUnknownAcceptance.current = true; setRecoveringDeletion(true); }
    },
    onSettled: () => { deletionInFlight.current = false; },
  });
  useEffect(() => () => { deletionAttempt.current = null; }, []);
  // Keep same-person editors mounted without retaining their private DOM during
  // a recheck. Only a fresh successful Native preference read reveals them.
  const [policyItems, setPolicyItems] = useState<SaasNotificationPreference[]>([]);
  const [policySeen, setPolicySeen] = useState(false);
  useEffect(() => {
    if (preferences.isSuccess && !preferences.isFetching && preferencesCurrent()) setPolicyItems(preferences.data);
  }, [preferences.data, preferences.isFetching, scope.epoch]);
  useEffect(() => { if (interruptionPolicy.enabled) setPolicySeen(true); }, [interruptionPolicy.enabled]);
  const privateReady = scope.ready && scope.canUse();
  const preferencesVisible = privateReady && preferences.isSuccess && !preferences.isFetching && preferencesCurrent();
  const deleteLocked = deletion.isPending || beginSsoReauth.isPending || !!deletionAttempt.current || recoveryUnavailable;
  return <section className="saas-page" aria-labelledby="account-security-title">
    <h1 id="account-security-title" className="saas-title outline-none" tabIndex={-1} ref={heading}>{t("account.heading")}</h1>
    <NativeAuthenticationSettings key={principal} principal={principal} />
    {!privateReady && <div>
      <p role={scope.failed ? "alert" : "status"}>{t(scope.failed ? "account.checkFailed" : capabilities.isSuccess && !capabilities.data ? "account.unavailable" : "account.checking")}</p>
      {scope.failed && <Button variant="outline" className="min-h-11" onClick={() => {
        void client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true });
        void client.refetchQueries({ queryKey: ["saas-capabilities"], exact: true });
      }}>{t("account.retry")}</Button>}
    </div>}
    {privateReady && <>
      {companyId && <ExperienceObservationSettings key={`${companyId}:${principal}`} companyId={companyId} principal={principal} />}
      <p className="saas-muted">{t("account.sessionsExplanation")}</p>
      {sessions.isFetching && <p role="status">{t("account.sessionsLoading")}</p>}
      {(sessions.isError || revoke.isError) && <p role="alert" className="saas-error">{t("account.sessionsFailed")}
        <Button variant="outline" className="min-h-11" onClick={() => { if (scope.canUse()) void sessions.refetch(); }}>{t("account.retry")}</Button>
      </p>}
      {sessions.isSuccess && !sessions.isFetching && sessions.data.map(session => <div className="saas-row" key={session.id}>
        <span>{t("account.signedIn", { date: new Date(session.createdAt).toLocaleString(i18n.resolvedLanguage) })}</span>
        <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(session.id)}>{t("account.revoke")}</Button>
      </div>)}
      {capabilities.data?.deletion && <section className="saas-section" aria-label={t("account.receiptsHeading")}>
        <h2 className="saas-subtitle">{t("account.receiptsHeading")}</h2>
        {receipts.isFetching && <p role="status">{t("account.receiptsLoading")}</p>}
        {receipts.isError && <p role="alert">{t("account.receiptsFailed")}<Button variant="outline" className="min-h-11" onClick={() => { if (scope.canUse("deletion")) void receipts.refetch(); }}>{t("account.retry")}</Button></p>}
        {receipts.isSuccess && !receipts.isFetching && receipts.data.map(receipt => <p key={receipt.id}>
          <span className="saas-machine">{receipt.companyId}</span>: {t(`account.deletionStatus.${receipt.status}`, { defaultValue: t("account.receiptPending") })} · {t(`account.deletionStage.${receipt.stage}`, { defaultValue: t("account.receiptPending") })}
        </p>)}
      </section>}
      <Link className="saas-link" to="/saas/reset-password">{t("account.resetPassword")}</Link>
      {capabilities.data?.deletion && <section className="saas-section" aria-label={t("account.deleteHeading")}>
        <h2 className="saas-subtitle">{t("account.deleteHeading")}</h2><p className="saas-muted">{t("account.deleteExplanation")}</p>
        {recoveringDeletion && !deletionAttempt.current && !recoveryUnavailable && <p role="status">{t("account.deletionRecovery")}</p>}
        {recoveryUnavailable ? <p role="alert" className="saas-error">{t("account.recoveryUnavailable")} <a className="saas-link" href="mailto:privacy@blentera.com">{t("account.contactPrivacy")}</a></p> :
          (deletion.isError || deletionUnconfirmed) && <p role="alert" className="saas-error">{t(recoveringDeletion || deletionAttempt.current ? "account.deletionUnconfirmed" : "account.deletionFailed")}</p>}
        {authentication.isError && <p role="alert" className="saas-error">{t("account.authenticationStatusFailed")}</p>}
        {ssoReauthError && <p role="alert" className="saas-error">{t("account.companySignInFailed")}</p>}
        <form className="saas-section" onSubmit={event => {
          event.preventDefault();
          if (deletionInFlight.current || !scope.canUse("deletion")) return;
          deletionInFlight.current = true; deletion.mutate();
        }}>
          <label className="saas-label">{t("account.confirmDelete")}<input className="saas-input" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} required autoComplete="off" disabled={deleteLocked} /></label>
          {authentication.data?.hasPassword && <label className="saas-label">{t("account.currentPassword")}<input className="saas-input" type="password" autoComplete="current-password" maxLength={LOCAL_PASSWORD_MAX_UTF16_LENGTH} value={deletePassword} onChange={event => setDeletePassword(event.target.value)} required disabled={deleteLocked} /></label>}
          {authentication.data && !authentication.data.hasPassword && readyProofId && <p role="status">{t("account.companySignInReady")}</p>}
          {authentication.data && !authentication.data.hasPassword && !readyProofId && ssoReauth.isSuccess && ssoReauth.data.available &&
            <Button type="button" variant="outline" disabled={deleteLocked || beginSsoReauth.isPending} onClick={() => { setSsoReauthError(false); beginSsoReauth.mutate(); }}>{t("account.companySignInReauthenticate")}</Button>}
          {authentication.data && !authentication.data.hasPassword && !readyProofId && ssoReauth.isSuccess && !ssoReauth.data.available &&
            <p className="saas-muted">{t("account.companySignInUnavailable")}</p>}
          <label className="saas-row"><input type="checkbox" checked={exportAcknowledged} onChange={event => setExportAcknowledged(event.target.checked)} disabled={deleteLocked} />{t("account.exportAcknowledgement")}</label>
          <Button type="submit" variant="destructive" disabled={recoveryUnavailable || deletion.isPending || deleteConfirmation !== "DELETE MY ACCOUNT" ||
            !exportAcknowledged || (authentication.data?.hasPassword ? !deletePassword : !readyProofId)}>{t(recoveringDeletion || deletionAttempt.current ? "account.retryDeletion" : "account.delete")}</Button>
        </form>
      </section>}
    </>}
    {privateReady && capabilities.data?.notifications && <section className="saas-section" aria-label={t("account.preferencesHeading")}>
      <h2 className="saas-subtitle">{t("account.preferencesHeading")}</h2><p className="saas-muted">{t("account.preferencesExplanation")}</p>
      {preferences.isFetching && <p role="status">{t("account.preferencesLoading")}</p>}
      {(preferences.isError || preference.isError) && <p role="alert" className="saas-error">{t("account.preferencesFailed")}<Button variant="outline" className="min-h-11" onClick={() => { if (scope.canUse("notifications")) void preferences.refetch(); }}>{t("account.retry")}</Button></p>}
      {preferencesVisible && preferences.data.map(item => <label className="saas-row" key={item.category}>
        <span>{t(`notifications.category.${item.category}`)}</span><input type="checkbox" checked={item.emailEnabled} disabled={item.category === "security" || preference.isPending || !companyId}
          onChange={event => preference.mutate({ category: item.category, emailEnabled: event.target.checked })} />
      </label>)}
    </section>}
    {policySeen && policyItems.map(item => <Fragment key={item.category}>
      <NotificationPolicySettings item={item} companyId={companyId ?? ""} principal={principal}
        sourceReady={preferencesVisible && !interruptionPolicy.query.isFetching} sourceQueryKey={preferenceKey}
        onSaved={() => { if (preferencesCurrent()) void preferences.refetch(); }} />
      {item.category !== "security" && <NotificationChannelSettings companyId={companyId ?? ""} principal={principal} category={item.category}
        sourceReady={preferencesVisible && !interruptionPolicy.query.isFetching} sourceQueryKey={preferenceKey} />}
    </Fragment>)}
  </section>;
}

export { SaasResetPasswordPage } from "./SaasPasswordReset";
