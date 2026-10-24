import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { authApi, AuthApiError } from "../api/auth";
import { Button } from "./ui/button";
import { hasCurrentV9Session, useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { LOCAL_PASSWORD_MAX_UTF16_LENGTH } from "@paperclipai/shared/local-password-policy";
import { queryKeys } from "../lib/queryKeys";
import { authSessionSchema, type NativePasskey } from "@paperclipai/shared";

type SecretView =
  | { kind: "enrollment"; sessionId: string; totpSecret: string; backupCodes: string[]; verified: false }
  | { kind: "enrollment"; sessionId: string; totpSecret: string; backupCodes: string[]; verified: true }
  | { kind: "recovery"; sessionId: string; backupCodes: string[] };

function parseTotpSecret(totpURI: string): string | null {
  try {
    const value = new URL(totpURI);
    if (value.protocol !== "otpauth:" || value.hostname !== "totp") return null;
    const secret = value.searchParams.get("secret")?.trim();
    return secret && /^[A-Z2-7]+=*$/i.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

function clearSecretValues(value: SecretView | null) {
  if (!value) return;
  if (value.kind === "enrollment") value.totpSecret = "";
  value.backupCodes.fill("");
}

export function NativeAuthenticationSettings({ principal, confirmationOnly = false, onConfirmed }: {
  principal: string;
  confirmationOnly?: boolean;
  onConfirmed?: (receipt: { userId: string; sessionId: string }) => void;
}) {
  const confirmationId = useId();
  const headingId = confirmationOnly ? `${confirmationId}-heading` : "native-authenticator-heading";
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const identity = useV9CurrentAccount();
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [secretView, setSecretView] = useState<SecretView | null>(null);
  const secretViewRef = useRef<SecretView | null>(null);
  const [error, setError] = useState<"account.authenticator.actionFailed" | "account.authenticator.codeAlreadyUsed" | null>(null);
  const [cancellationSession, setCancellationSession] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const lastFocus = useRef<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);

  const belongsToPrincipal = () => {
    const current = currentIdentity.current;
    const parsed = authSessionSchema.safeParse(client.getQueryData(queryKeys.auth.session));
    return !current.localImplicit && current.userId === principal && parsed.success &&
      !parsed.data.session.localImplicit && parsed.data.user.id === principal && parsed.data.session.userId === principal;
  };
  const ownsCurrentSession = () => belongsToPrincipal() && hasCurrentV9Session(client, principal, currentSessionId());
  const currentSessionId = () => authSessionSchema.parse(client.getQueryData(queryKeys.auth.session)).session.id;
  const sourceChanged = () => new AuthApiError("Sign-in changed", 409, null, "AUTHENTICATION_STATE_CHANGED");
  const statusKey = ["native-authenticator-status", principal, identity.authorityEpoch, secretView?.sessionId ?? null] as const;
  const status = useQuery({
    queryKey: statusKey,
    queryFn: async ({ signal }) => {
      if (!ownsCurrentSession()) throw new Error("Current account is unresolved");
      const result = await authApi.securityStatus(principal, signal, busyRef.current ? undefined : secretViewRef.current?.sessionId);
      if (!ownsCurrentSession() || result.userId !== principal) throw new Error("Current account changed");
      return result;
    },
    enabled: !busy && ownsCurrentSession(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const statusState = client.getQueryState(statusKey);
  const statusCurrent = ownsCurrentSession() && status.isSuccess && !status.isFetching &&
    !statusState?.isInvalidated && status.data?.userId === principal;
  const currentStatus = statusCurrent ? status.data : null;

  const passkeysKey = ["native-passkeys", principal, identity.authorityEpoch] as const;
  const passkeys = useQuery({ queryKey: passkeysKey, enabled: !confirmationOnly && !busy && statusCurrent && currentStatus?.passkeysAvailable === true,
    queryFn: ({ signal }) => authApi.listPasskeys(principal, currentSessionId(), signal), staleTime: 0, gcTime: 0, retry: false });
  const passkeysCurrent = statusCurrent && ownsCurrentSession() && passkeys.isSuccess && !passkeys.isFetching &&
    !client.getQueryState(passkeysKey)?.isInvalidated;
  const canUsePasskey = confirmationOnly ? currentStatus?.passkeysAvailable === true : passkeysCurrent && passkeys.data.length>0;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      busyRef.current = false;
      clearSecretValues(secretViewRef.current);
      secretViewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!statusCurrent || busy || !ownsCurrentSession()) return;
    const target = focusTarget ?? (document.activeElement === document.body ? lastFocus.current : null);
    if (target) {
      (document.getElementById(target) ?? document.getElementById(headingId))?.focus();
      setFocusTarget(null);
    }
  }, [statusCurrent, busy, focusTarget, headingId]);

  function publishSecretView(value: SecretView | null) {
    if (!aliveRef.current || !belongsToPrincipal()) {
      clearSecretValues(value);
      return;
    }
    clearSecretValues(secretViewRef.current);
    secretViewRef.current = value;
    setSecretView(value);
  }

  async function refreshNativeSessionAndStatus(expectedSessionId?: string) {
    // Read the response belonging to this rotation rather than joining an older
    // observer's in-flight session read. Cache rechecks only hide presentation.
    await client.cancelQueries({ queryKey: queryKeys.auth.session, exact: true });
    const session = await authApi.getSession();
    if (!belongsToPrincipal() || !session || session.user.id !== principal || session.session.userId !== principal || session.session.localImplicit ||
      expectedSessionId && session.session.id !== expectedSessionId) throw sourceChanged();
    client.setQueryData(queryKeys.auth.session, session);
    if (expectedSessionId) await authApi.securityStatus(principal, undefined, expectedSessionId);
    await client.invalidateQueries({ queryKey: ["native-authenticator-status", principal], refetchType: busyRef.current ? "none" : "active" });
    if (!busyRef.current) await client.refetchQueries({ queryKey: ["native-authenticator-status", principal] });
    await client.invalidateQueries({ queryKey: ["native-passkeys", principal], refetchType: busyRef.current ? "none" : "active" });
    if (!belongsToPrincipal()) throw sourceChanged();
  }

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current || !statusCurrent || !ownsCurrentSession()) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setConfirmed(null);
    try {
      // An old native session read can expire its cookie after a successful
      // rotation. Stop background status reads until the new session is pinned.
      await client.cancelQueries({ queryKey: ["native-authenticator-status", principal] });
      await client.cancelQueries({ queryKey: ["native-passkeys", principal] });
      await action();
      if (aliveRef.current && belongsToPrincipal()) setFocusTarget(headingId);
    } catch (failure) {
      if (aliveRef.current && belongsToPrincipal()) {
        setError(failure instanceof AuthApiError && failure.code === "OTP_ALREADY_USED"
          ? "account.authenticator.codeAlreadyUsed" : "account.authenticator.actionFailed");
      }
      if (failure instanceof AuthApiError && ["ACCOUNT_CHANGED", "AUTHENTICATION_STATE_CHANGED"].includes(failure.code ?? "")) {
        clearSecretValues(secretViewRef.current);
        secretViewRef.current = null;
        if (aliveRef.current) setSecretView(null);
        await client.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true });
      }
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
      if (aliveRef.current && belongsToPrincipal()) {
        setPassword("");
        setTotpCode("");
        setRecoveryCode("");
      }
    }
  }

  async function startEnrollment() {
    const current = currentStatus;
    if (!current || !current.hasPassword || !password) {
      setError("account.authenticator.actionFailed");
      return;
    }
    await runAction(async () => {
      const receipt = await authApi.reauthenticatePassword(password, principal, currentSessionId());
      await refreshNativeSessionAndStatus(receipt.sessionId);
      const result = await authApi.enableTwoFactor(password, principal, currentSessionId());
      const totpSecret = parseTotpSecret(result.totpURI);
      if (!totpSecret || !Array.isArray(result.backupCodes) || result.backupCodes.length === 0) {
        if (Array.isArray(result.backupCodes)) result.backupCodes.fill("");
        throw new Error("Invalid authenticator setup response");
      }
      const backupCodes = [...result.backupCodes];
      result.backupCodes.fill("");
      await refreshNativeSessionAndStatus(result.sessionId);
      publishSecretView({ kind: "enrollment", sessionId: result.sessionId, totpSecret, backupCodes, verified: false });
      lastFocus.current = "native-authenticator-enrollment-code";
    });
  }

  async function confirmEnrollment() {
    if (!secretView || secretView.kind !== "enrollment" || secretView.verified || !totpCode.trim()) return;
    await runAction(async () => {
      const result = await authApi.verifyTotp(totpCode.trim(), principal, secretView.sessionId);
      await refreshNativeSessionAndStatus(result.sessionId);
      publishSecretView({ ...secretView, sessionId: result.sessionId, backupCodes: [...secretView.backupCodes], verified: true });
    });
  }

  async function confirmFreshFactor() {
    const current = currentStatus;
    if (!current?.twoFactorEnabled) throw new Error("Authenticator is not enabled");
    const result = totpCode.trim()
      ? await authApi.verifyTotp(totpCode.trim(), principal, currentSessionId())
      : recoveryCode.trim() ? await authApi.verifyBackupCode(recoveryCode.trim(), principal, currentSessionId()) : null;
    if (!result) { if (canUsePasskey) return confirmPasskey(); throw new Error("A current authenticator code is required"); }
    await refreshNativeSessionAndStatus(result.sessionId);
    return result.sessionId;
  }

  async function confirmPasskey() {
    const result = await authApi.authenticatePasskey(principal, currentSessionId());
    if (result.userId !== principal) throw sourceChanged();
    await refreshNativeSessionAndStatus(result.sessionId);
    return result.sessionId;
  }
  async function confirmKeyChange() {
    if (currentStatus?.phishingResistantRequired || canUsePasskey && !totpCode && !recoveryCode) return confirmPasskey();
    if (currentStatus?.twoFactorEnabled) return confirmFreshFactor();
    if (!currentStatus?.hasPassword || !password) throw new Error("Confirm your identity first");
    const receipt = await authApi.reauthenticatePassword(password, principal, currentSessionId());
    await refreshNativeSessionAndStatus(receipt.sessionId);
    return currentSessionId();
  }
  async function addKey() {
    await runAction(async () => {
      const sessionId = await confirmKeyChange();
      const result = await authApi.addPasskey(passkeyName.trim(), principal, sessionId);
      await refreshNativeSessionAndStatus(result.sessionId);
      setPasskeyName("");
    });
  }
  async function renameKey(id: string, name: string) {
    await runAction(async () => {
      const sessionId = await confirmKeyChange();
      await authApi.renamePasskey(id, name, principal, sessionId);
      await refreshNativeSessionAndStatus(sessionId);
    });
  }
  async function removeKey(id: string) {
    await runAction(async () => {
      const sessionId = await confirmKeyChange();
      await authApi.deletePasskey(id, principal, sessionId);
      await client.cancelQueries({ queryKey: queryKeys.auth.session, exact: true });
      client.setQueryData(queryKeys.auth.session, await authApi.getSession());
    });
  }

  function announceConfirmation(sessionId: string) {
    if (!aliveRef.current || !belongsToPrincipal()) return;
    if (currentSessionId() !== sessionId) throw sourceChanged();
    setConfirmed(sessionId);
    onConfirmed?.({ userId: principal, sessionId });
  }

  async function confirmIdentity() {
    await runAction(async () => {
      let sessionId: string;
      if (currentStatus?.phishingResistantRequired) sessionId = await confirmPasskey();
      else if (currentStatus?.twoFactorEnabled) sessionId = await confirmFreshFactor();
      else {
        const receipt = await authApi.reauthenticatePassword(password, principal, currentSessionId());
        await refreshNativeSessionAndStatus(receipt.sessionId);
        sessionId = receipt.sessionId;
      }
      announceConfirmation(sessionId);
    });
  }

  async function rotateRecoveryCodes() {
    const current = currentStatus;
    if (!current?.twoFactorEnabled) return;
    const confirmedPassword = current.hasPassword ? password : undefined;
    if (current.hasPassword && !confirmedPassword) {
      setError("account.authenticator.actionFailed");
      return;
    }
    await runAction(async () => {
      const sessionId = await confirmFreshFactor();
      const result = await authApi.generateBackupCodes(confirmedPassword, principal, sessionId);
      if (!Array.isArray(result.backupCodes) || result.backupCodes.length === 0) {
        if (Array.isArray(result.backupCodes)) result.backupCodes.fill("");
        throw new Error("Invalid recovery-code response");
      }
      const backupCodes = [...result.backupCodes];
      result.backupCodes.fill("");
      await refreshNativeSessionAndStatus(result.sessionId);
      publishSecretView({ kind: "recovery", sessionId: result.sessionId, backupCodes });
    });
  }

  async function disableAuthenticator() {
    const current = currentStatus;
    if (!current?.twoFactorEnabled) return;
    const confirmedPassword = current.hasPassword ? password : undefined;
    if (current.hasPassword && !confirmedPassword) {
      setError("account.authenticator.actionFailed");
      return;
    }
    await runAction(async () => {
      const sessionId = await confirmFreshFactor();
      await authApi.disableTwoFactor(confirmedPassword, principal, sessionId);
      await refreshNativeSessionAndStatus();
      publishSecretView(null);
    });
  }

  async function cancelEnrollment() {
    const original = cancellationSession ?? secretViewRef.current?.sessionId;
    if (!original) return;
    setCancellationSession(original);
    await runAction(async () => {
      publishSecretView(null);
      await refreshNativeSessionAndStatus();
      await authApi.cancelTwoFactorEnrollment(principal, original);
      await refreshNativeSessionAndStatus();
      if (aliveRef.current && belongsToPrincipal()) setCancellationSession(null);
    });
  }

  function dismissSecrets() {
    clearSecretValues(secretViewRef.current);
    secretViewRef.current = null;
    setSecretView(null);
    setPassword("");
    setTotpCode("");
    setRecoveryCode("");
  }

  const hiddenForAuthority = !ownsCurrentSession() || !!secretView && secretView.sessionId !== currentSessionId();
  if (confirmationOnly) return <section className="saas-section" aria-labelledby={headingId}
    onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target.id) lastFocus.current = event.target.id; }}>
    <h2 className="saas-subtitle" id={headingId} tabIndex={-1}>{t("account.authenticator.confirmIdentity")}</h2>
    {!statusCurrent && <div role={status.isError ? "alert" : "status"}>
      <p className="saas-muted">{t(status.isError ? "account.authenticator.statusFailed" : "account.authenticator.checking")}</p>
      {status.isError && <Button variant="outline" onClick={() => void refreshNativeSessionAndStatus().catch(() => {})}>{t("account.retry")}</Button>}
    </div>}
    {statusCurrent && currentStatus && <>
      {currentStatus.phishingResistantRequired ? <p className="saas-muted">{t("account.authenticator.phishingResistantRequired")}</p> : <>
        {currentStatus.twoFactorEnabled ? <>
          <label className="saas-label" htmlFor={`${confirmationId}-totp`}>{t("account.authenticator.totpCode")}
            <input id={`${confirmationId}-totp`} className="saas-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={totpCode} onChange={event => { setTotpCode(event.target.value); setRecoveryCode(""); }} disabled={busy} />
          </label>
          <label className="saas-label" htmlFor={`${confirmationId}-recovery`}>{t("account.authenticator.recoveryCode")}
            <input id={`${confirmationId}-recovery`} className="saas-input" autoComplete="off" maxLength={128}
              value={recoveryCode} onChange={event => { setRecoveryCode(event.target.value); setTotpCode(""); }} disabled={busy} />
          </label>
        </> : currentStatus.hasPassword && <label className="saas-label" htmlFor={`${confirmationId}-password`}>{t("account.authenticator.currentPassword")}
          <input id={`${confirmationId}-password`} className="saas-input" type="password" autoComplete="current-password" maxLength={LOCAL_PASSWORD_MAX_UTF16_LENGTH}
            value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        </label>}
        {(currentStatus.twoFactorEnabled || currentStatus.hasPassword) && <Button variant="outline" className="min-h-11"
          disabled={busy || (currentStatus.twoFactorEnabled ? !totpCode && !recoveryCode : !password)}
          onClick={() => void confirmIdentity()}>{t("account.authenticator.confirmIdentity")}</Button>}
      </>}
      {canUsePasskey && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void runAction(async () => {
        announceConfirmation(await confirmPasskey());
      })}>{t("account.passkeys.confirm")}</Button>}
      {!canUsePasskey && (currentStatus.phishingResistantRequired || !currentStatus.hasPassword && !currentStatus.twoFactorEnabled) &&
        <p role="status" className="saas-muted">{t("account.authenticator.confirmationUnavailable")}</p>}
    </>}
    {error && statusCurrent && <p role="alert" className="saas-error">{t(error)}</p>}
    {confirmed === identity.sessionId && statusCurrent && <p role="status" className="saas-muted">{t("account.authenticator.identityConfirmed")}</p>}
    {busy && <p role="status" className="saas-muted">{t("account.authenticator.working")}</p>}
  </section>;
  return <section className="saas-section" aria-labelledby="native-authenticator-heading"
    onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target.id) lastFocus.current = event.target.id; }}>
    <h2 className="saas-subtitle" id="native-authenticator-heading" tabIndex={-1}>{t("account.authenticator.heading")}</h2>
    {!statusCurrent && <p role={status.isError ? "alert" : "status"} className={status.isError ? "saas-error" : "saas-muted"}>
      {t(status.isError ? "account.authenticator.statusFailed" : "account.authenticator.checking")}
      {status.isError && <Button variant="outline" className="min-h-11" onClick={() => {
        if (ownsCurrentSession()) {
          clearSecretValues(secretViewRef.current); secretViewRef.current = null; setSecretView(null);
          void refreshNativeSessionAndStatus().catch(() => {});
        }
      }}>{t("account.retry")}</Button>}
    </p>}
    {statusCurrent && currentStatus && <>
      <p className="saas-muted">{t(currentStatus.twoFactorEnabled ? "account.authenticator.enabled" : "account.authenticator.disabled")}</p>
      {cancellationSession && <div role="status" className="saas-muted">
        <p>{t("account.authenticator.cancelUnconfirmed")}</p>
        <Button variant="outline" className="min-h-11" disabled={busy || !statusCurrent} onClick={() => void cancelEnrollment()}>
          {t("account.authenticator.retryCancellation")}
        </Button>
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => {
          setCancellationSession(null);
          void refreshNativeSessionAndStatus().catch(() => {});
        }}>{t("account.authenticator.reloadSettings")}</Button>
      </div>}
      {currentStatus.phishingResistantRequired && <>
        <p role="status" className="saas-muted">{t("account.authenticator.phishingResistantRequired")}</p>
        {!currentStatus.passkeysAvailable && <p role="status" className="saas-muted">{t("account.authenticator.phishingResistantSettingsUnavailable")}</p>}
      </>}
      {!currentStatus.phishingResistantRequired && !currentStatus.twoFactorEnabled && !secretView && !cancellationSession && <>
        {currentStatus.hasPassword ? <>
          <label className="saas-label" htmlFor="native-authenticator-password">{t("account.authenticator.currentPassword")}
            <input id="native-authenticator-password" className="saas-input" type="password" autoComplete="current-password" maxLength={LOCAL_PASSWORD_MAX_UTF16_LENGTH}
              value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !statusCurrent} />
          </label>
          <Button variant="outline" className="min-h-11" disabled={busy || !password || !statusCurrent}
            onClick={() => void startEnrollment()}>{t("account.authenticator.enable")}</Button>
          <Button variant="outline" className="min-h-11" disabled={busy || !password || !statusCurrent}
            onClick={() => void confirmIdentity()}>{t("account.authenticator.confirmIdentity")}</Button>
        </> : <p role="status" className="saas-muted">{t("account.authenticator.passwordlessEnrollmentUnavailable")}</p>}
      </>}
      {currentStatus.passkeysAvailable && !secretView && !cancellationSession && <section className="saas-section" aria-labelledby="native-passkeys-heading">
        <h3 className="saas-subtitle" id="native-passkeys-heading">{t("account.passkeys.heading")}</h3>
        <p className="saas-muted">{t("account.passkeys.confirmation")}</p>
        {!passkeysCurrent && <div role={passkeys.isError ? "alert" : "status"}><p>{t(passkeys.isError ? "account.passkeys.failed" : "account.passkeys.loading")}</p>
          {passkeys.isError && <Button variant="outline" className="min-h-11" onClick={() => void refreshNativeSessionAndStatus().catch(() => {})}>{t("account.authenticator.reloadSettings")}</Button>}
        </div>}
        {passkeysCurrent && <>
          {passkeys.data.length===0 && <p className="saas-muted">{t("account.passkeys.empty")}</p>}
          {canUsePasskey && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void runAction(async () => {
            announceConfirmation(await confirmPasskey());
          })}>{t("account.passkeys.confirm")}</Button>}
          <label className="saas-label" htmlFor="native-passkey-name">{t("account.passkeys.newName")}
            <input className="saas-input" id="native-passkey-name" autoComplete="off" maxLength={120} value={passkeyName} disabled={busy}
              onChange={event => setPasskeyName(event.target.value)} />
          </label>
          <Button variant="outline" className="min-h-11" disabled={busy || passkeys.data.length>=16 ||
            (!canUsePasskey && (currentStatus.twoFactorEnabled ? !totpCode && !recoveryCode : !currentStatus.hasPassword || !password))}
            onClick={() => void addKey()}>{t("account.passkeys.add")}</Button>
          <p className="saas-muted">{t("account.passkeys.removal")}</p>
          {passkeys.data.map(key => <PasskeyRow key={key.id} value={key} disabled={busy} onRename={renameKey} onRemove={removeKey} />)}
        </>}
      </section>}
      {secretView?.kind === "enrollment" && !secretView.verified && !hiddenForAuthority && <div className="saas-section">
        <p className="saas-muted">{t("account.authenticator.enrollmentInstructions")}</p>
        <label className="saas-label" htmlFor="native-authenticator-setup-key">{t("account.authenticator.setupKey")}
          <input id="native-authenticator-setup-key" className="saas-input saas-machine" readOnly value={secretView.totpSecret} />
        </label>
        <label className="saas-label" htmlFor="native-authenticator-enrollment-code">{t("account.authenticator.firstCode")}
          <input id="native-authenticator-enrollment-code" className="saas-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
            value={totpCode} onChange={event => setTotpCode(event.target.value)} disabled={busy || !statusCurrent} />
        </label>
        <div className="saas-row justify-between">
          <Button variant="outline" className="min-h-11" disabled={busy || !statusCurrent} onClick={() => void cancelEnrollment()}>
            {t("account.authenticator.cancelEnrollment")}
          </Button>
          <Button className="min-h-11" disabled={busy || !totpCode.trim() || !statusCurrent}
            onClick={() => void confirmEnrollment()}>{t("account.authenticator.verifyFirstCode")}</Button>
        </div>
      </div>}
      {!currentStatus.phishingResistantRequired && currentStatus.twoFactorEnabled && !secretView && !hiddenForAuthority && <div className="saas-section">
        <p className="saas-muted">{t("account.authenticator.freshConfirmation")}</p>
        {currentStatus.hasPassword && <label className="saas-label" htmlFor="native-authenticator-current-password">{t("account.authenticator.currentPassword")}
          <input id="native-authenticator-current-password" className="saas-input" type="password" autoComplete="current-password" maxLength={LOCAL_PASSWORD_MAX_UTF16_LENGTH}
            value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !statusCurrent} />
        </label>}
        <label className="saas-label" htmlFor="native-authenticator-current-totp">{t("account.authenticator.totpCode")}
          <input id="native-authenticator-current-totp" className="saas-input" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} value={totpCode} onChange={event => { setTotpCode(event.target.value); setRecoveryCode(""); }} disabled={busy || !statusCurrent} />
        </label>
        <label className="saas-label" htmlFor="native-authenticator-current-recovery">{t("account.authenticator.recoveryCode")}
          <input id="native-authenticator-current-recovery" className="saas-input" autoComplete="off" maxLength={128}
            value={recoveryCode} onChange={event => { setRecoveryCode(event.target.value); setTotpCode(""); }} disabled={busy || !statusCurrent} />
        </label>
        <div className="saas-row">
          <Button variant="outline" className="min-h-11" disabled={busy || !statusCurrent || (!totpCode && !recoveryCode && !canUsePasskey)}
            onClick={() => void confirmIdentity()}>{t("account.authenticator.confirmIdentity")}</Button>
          <Button variant="outline" className="min-h-11" disabled={busy || !statusCurrent || (currentStatus.hasPassword && !password) || (!totpCode && !recoveryCode && !canUsePasskey)}
            onClick={() => void rotateRecoveryCodes()}>{t("account.authenticator.rotateRecoveryCodes")}</Button>
          <Button variant="destructive" className="min-h-11" disabled={busy || !statusCurrent || (currentStatus.hasPassword && !password) || (!totpCode && !recoveryCode && !canUsePasskey)}
            onClick={() => void disableAuthenticator()}>{t("account.authenticator.disable")}</Button>
        </div>
      </div>}
      {secretView && !hiddenForAuthority && <div className="saas-section" aria-live="polite">
        {secretView.kind === "enrollment" && !secretView.verified ? null : <>
          <h3 className="saas-subtitle">{t("account.authenticator.recoveryCodesHeading")}</h3>
          <p role="status" className="saas-muted">{t("account.authenticator.recoveryCodesOneTime")}</p>
          <ul className="saas-section" aria-label={t("account.authenticator.recoveryCodesHeading")}>
            {secretView.backupCodes.map((code, index) => <li className="saas-machine" key={`${index}:${code}`}>{code}</li>)}
          </ul>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={dismissSecrets}>{t("account.authenticator.savedCodes")}</Button>
        </>}
      </div>}
    </>}
    {error && statusCurrent && <p role="alert" className="saas-error">{t(error)}</p>}
    {confirmed === identity.sessionId && statusCurrent && <p role="status" className="saas-muted">{t("account.authenticator.identityConfirmed")}</p>}
    {busy && <p role="status" className="saas-muted">{t("account.authenticator.working")}</p>}
  </section>;
}


function PasskeyRow({ value, disabled, onRename, onRemove }: { value: NativePasskey; disabled: boolean;
  onRename: (id: string, name: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const { t } = useTranslation("experience"), [name, setName] = useState(value.name ?? "");
  return <div className="saas-section">
    <label className="saas-label" htmlFor={`native-passkey-${value.id}`}>{t("account.passkeys.name")}
      <input id={`native-passkey-${value.id}`} className="saas-input" value={name} autoComplete="off" maxLength={120}
        disabled={disabled} onChange={event => setName(event.target.value)} />
    </label>
    <div className="saas-row justify-between">
      <Button variant="destructive" className="min-h-11" disabled={disabled} onClick={() => void onRemove(value.id)}>{t("account.passkeys.remove")}</Button>
      <Button variant="outline" className="min-h-11" disabled={disabled || !name.trim() || name.trim()===value.name}
        onClick={() => void onRename(value.id, name.trim())}>{t("account.passkeys.rename")}</Button>
    </div>
  </div>;
}
