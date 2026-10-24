import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { NativeAuthenticationSettings } from "../components/NativeAuthenticationSettings";
import { Card } from "@/components/ui/card";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

function cliAuthRetryDelay(error: unknown): number {
  const body = error instanceof ApiError && error.body && typeof error.body === "object"
    ? error.body as { details?: unknown } : null;
  const details = body?.details && typeof body.details === "object"
    ? body.details as { retryAfterSeconds?: unknown } : null;
  const milliseconds = typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds * 1000 : Number.NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.max(1000, milliseconds) : 60_000;
}

function isCliAuthRateLimit(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429;
}

function needsIdentityConfirmation(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 &&
    (error.body as { details?: { code?: unknown } } | null)?.details?.code === "recent_authentication_required";
}

export function CliAuthPage() {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation("experience");
  useEffect(() => {
    const policy = document.createElement("meta");
    policy.name = "referrer";
    policy.content = "no-referrer";
    document.head.appendChild(policy);
    return () => policy.remove();
  }, []);
  const params = useParams();
  const [searchParams] = useSearchParams();
  const challengeId = (params.id ?? "").trim();
  const token = (searchParams.get("token") ?? "").trim();
  const currentPath = useMemo(
    () => `/cli-auth/${encodeURIComponent(challengeId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    [challengeId, token],
  );

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const identity = useV9CurrentAccount();
  const principal = identity.localImplicit ? "local-board" : identity.userId ?? "";
  const authority = useV9PrivateReadAuthority(principal, true);
  const selection = useRef({ principal, challengeId, token, epoch: 0 });
  if (selection.current.principal !== principal || selection.current.challengeId !== challengeId || selection.current.token !== token)
    selection.current = { principal, challengeId, token, epoch: selection.current.epoch + 1 };
  const selectionEpoch = selection.current.epoch;
  const [confirmationNeeded, setConfirmationNeeded] = useState<number | null>(null);
  const [confirmedReceipt, setConfirmedReceipt] = useState<{ userId: string; sessionId: string; selectionEpoch: number } | null>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const confirmationRegion = useRef<HTMLDivElement>(null);
  const focusedReceipt = useRef<string | null>(null);
  const confirmationRequired = confirmationNeeded === selectionEpoch;
  useEffect(() => { setConfirmationNeeded(null); setConfirmedReceipt(null); }, [selectionEpoch]);
  useEffect(() => { if (confirmationRequired) confirmationRegion.current?.focus(); }, [confirmationRequired]);
  const scope = useRef({ challengeId, token, accountEpoch: authority.epoch, epoch: 0 });
  if (scope.current.challengeId !== challengeId || scope.current.token !== token || scope.current.accountEpoch !== authority.epoch) {
    scope.current = { challengeId, token, accountEpoch: authority.epoch, epoch: scope.current.epoch + 1 };
  }
  const captureConsent = () => {
    const epoch = scope.current.epoch;
    return { challengeId, token, userId: principal, sessionId: identity.localImplicit ? undefined : identity.sessionId ?? undefined,
      selectionEpoch, isCurrent: () => epoch === scope.current.epoch && authority.canRead() };
  };
  const challengeQueryKey = useMemo(() => ["cli-auth-challenge", challengeId, token, principal, identity.sessionId, identity.authorityEpoch] as const,
    [challengeId, token, principal, identity.sessionId, identity.authorityEpoch]);
  const retryWindowEndsAt = useMemo(() => Date.now() + 10 * 60_000, [challengeId, token]);
  const challengeQuery = useQuery({
    queryKey: challengeQueryKey,
    queryFn: () => accessApi.getCliAuthChallenge(challengeId, token),
    enabled: challengeId.length > 0 && token.length > 0 && identity.settled,
    // Keep the same user's consent panel mounted during its own native session
    // rotation. Approval stays disabled until confirmation and the fresh read.
    placeholderData: previous => confirmationRequired ? previous : undefined,
    retry: (failureCount, error) => {
      if (!isCliAuthRateLimit(error) || failureCount >= 3) return false;
      const knownChallenge = queryClient.getQueryData<{ expiresAt: string }>(challengeQueryKey);
      const knownExpiry = Date.parse(knownChallenge?.expiresAt ?? "");
      const deadline = Number.isFinite(knownExpiry) ? Math.min(knownExpiry, retryWindowEndsAt) : retryWindowEndsAt;
      return Date.now() + cliAuthRetryDelay(error) < deadline;
    },
    retryDelay: (_failureCount, error) => cliAuthRetryDelay(error),
  });

  const approveMutation = useMutation({
    retry: false,
    mutationFn: (receipt: ReturnType<typeof captureConsent>) => {
      if (!receipt.isCurrent()) throw new Error(t("cliAuth.accessChanged"));
      return accessApi.approveCliAuthChallenge(receipt.challengeId, receipt.token, receipt.userId, receipt.sessionId);
    },
    onSuccess: async (_result, receipt) => {
      if (receipt.isCurrent()) await challengeQuery.refetch();
    },
    onError: (error, receipt) => {
      // Guidance survives a same-account freshness recheck. It grants no
      // authority: native confirmation and the next explicit approval bind the
      // actual current session separately. Account/challenge changes discard it.
      if (selection.current.epoch === receipt.selectionEpoch && selection.current.principal === receipt.userId &&
          needsIdentityConfirmation(error)) {
        setConfirmationNeeded(receipt.selectionEpoch);
        setConfirmedReceipt(null);
      }
    },
  });

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: (receipt: ReturnType<typeof captureConsent>) => {
      if (!receipt.isCurrent()) throw new Error(t("cliAuth.accessChanged"));
      return accessApi.cancelCliAuthChallenge(receipt.challengeId, receipt.token);
    },
    onSuccess: async (_result, receipt) => {
      if (receipt.isCurrent()) await challengeQuery.refetch();
    },
  });
  const mutationError = [approveMutation, cancelMutation].find(mutation => mutation.error && mutation.variables?.isCurrent())?.error;

  const confirmationCurrent = confirmedReceipt?.selectionEpoch === selectionEpoch && confirmedReceipt.userId === principal &&
    confirmedReceipt.sessionId === identity.sessionId && authority.canRead();
  useEffect(() => {
    const button = approveButton.current;
    if (confirmationCurrent && challengeQuery.isSuccess && !challengeQuery.isFetching && !challengeQuery.isPlaceholderData &&
        button && !button.disabled && focusedReceipt.current !== confirmedReceipt?.sessionId) {
      button.focus();
      focusedReceipt.current = confirmedReceipt?.sessionId ?? null;
    }
  }, [confirmationCurrent, confirmedReceipt?.sessionId, challengeQuery.isSuccess, challengeQuery.isFetching, challengeQuery.isPlaceholderData]);

  if (!challengeId || !token) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">{t("cliAuth.invalidUrl")}</div>;
  }

  if (sessionQuery.isError || identity.failed) {
    return <div role="alert" className="mx-auto max-w-xl py-10">
      <Card className="block p-6">
        <h1 className="text-lg font-semibold">{t("cliAuth.sessionFailed")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("cliAuth.sessionRetryHelp")}</p>
        <Button className="mt-4" onClick={() => { void sessionQuery.refetch(); }}>{t("cliAuth.retrySession")}</Button>
      </Card>
    </div>;
  }

  const waitingForRateLimit = isCliAuthRateLimit(challengeQuery.failureReason) && challengeQuery.isFetching;
  if ((!identity.settled || sessionQuery.isLoading) && !confirmationRequired || challengeQuery.isLoading || waitingForRateLimit) {
    return <div role="status" className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">
      {waitingForRateLimit ? t("cliAuth.rateWait") : t("cliAuth.loading")}
    </div>;
  }

  if (challengeQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-lg font-semibold">{t("cliAuth.unavailable")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {challengeQuery.error instanceof Error ? challengeQuery.error.message : t("cliAuth.invalidOrExpired")}
          </p>
        </Card>
      </div>
    );
  }

  const challenge = challengeQuery.data;
  if (!challenge) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">{t("cliAuth.unavailable")}</div>;
  }

  if (challenge.status === "approved") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">{t("cliAuth.approved")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("cliAuth.approvedHelp")}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {t("cliAuth.command")}: <span className="font-mono text-foreground">{challenge.command}</span>
          </p>
        </Card>
      </div>
    );
  }

  if (challenge.status === "cancelled" || challenge.status === "expired") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">
            {challenge.status === "expired" ? t("cliAuth.expired") : t("cliAuth.cancelled")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("cliAuth.restart")}
          </p>
        </Card>
      </div>
    );
  }

  if (challenge.requiresSignIn || !sessionQuery.data) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">{t("cliAuth.signInRequired")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("cliAuth.signInHelp")}
          </p>
          <Button asChild className="mt-4">
            <Link to={`/auth?next=${encodeURIComponent(currentPath)}`}>{t("cliAuth.signIn")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      {!identity.settled && <p role="status" className="text-sm text-muted-foreground">{t("cliAuth.loading")}</p>}
      {/* Keep the native ceremony alive through its own session recheck, while
          hiding consent and private context until current identity is settled. */}
      <Card className={identity.settled ? "block p-6" : "hidden"}>
        <h1 className="text-xl font-semibold">{t("cliAuth.approveTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("cliAuth.scope")}
        </p>

        <p className="mt-2 text-sm text-muted-foreground">{t("cliAuth.revokeHelp")}</p>
        {challenge.keyName && <p className="mt-2 text-sm">{t("cliAuth.keyName")}: {challenge.keyName}</p>}
        <p className="mt-2 text-sm text-muted-foreground">{challenge.keyExpiresAt === null ? t("cliAuth.neverExpires") :
          challenge.keyExpiresAt ? <>{t("cliAuth.keyExpires")}: <time dateTime={challenge.keyExpiresAt}>{new Date(challenge.keyExpiresAt).toLocaleString(i18n.language)}</time></> : t("cliAuth.expires")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("cliAuth.requestExpires")}: <time dateTime={challenge.expiresAt}>{new Date(challenge.expiresAt).toLocaleString(i18n.language)}</time></p>
        <div className="mt-5 space-y-3 text-sm">
          <div>
            <div className="text-muted-foreground">{t("cliAuth.command")}</div>
            <div className="font-mono text-foreground">{challenge.command}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("cliAuth.client")}</div>
            <div className="text-foreground">{challenge.clientName ?? "paperclipai cli"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("cliAuth.requestedAccess")}</div>
            <div className="text-foreground">
              {challenge.requestedAccess === "instance_admin_required" ? t("cliAuth.instanceAdmin") : t("cliAuth.board")}
            </div>
          </div>
          {challenge.requestedCompanyName && (
            <div>
              <div className="text-muted-foreground">{t("cliAuth.auditContext")}</div>
              <div className="text-foreground">{challenge.requestedCompanyName}</div>
            </div>
          )}
        </div>

        {confirmationRequired && <div ref={confirmationRegion} tabIndex={-1} role="region" aria-label={t("cliAuth.confirmIdentityRequired")} className="mt-4">
          <p className="text-sm text-muted-foreground">{t("cliAuth.confirmIdentityRequired")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("cliAuth.confirmationHelp")}</p>
          <NativeAuthenticationSettings key={selectionEpoch} principal={principal} confirmationOnly onConfirmed={receipt => {
            if (selection.current.epoch !== selectionEpoch || receipt.userId !== principal) return;
            setConfirmedReceipt({ ...receipt, selectionEpoch });
            setConfirmationNeeded(null);
            approveMutation.reset();
            void queryClient.invalidateQueries({ queryKey: ["cli-auth-challenge", challengeId] });
          }} />
        </div>}
        {confirmationCurrent && <p role="status" className="mt-4 text-sm text-muted-foreground">{t("cliAuth.identityConfirmedReview")}</p>}
        {mutationError && !confirmationRequired && (
          <p className="mt-4 text-sm text-destructive">
            {mutationError instanceof Error
              ? (mutationError as Error).message
              : t("cliAuth.updateFailed")}
          </p>
        )}

        {!challenge.canApprove && (
          <p className="mt-4 text-sm text-destructive">
            {challenge.requestedAccess === "instance_admin_required"
              ? t("cliAuth.adminRequired")
              : t("cliAuth.companyDenied")}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <Button type="button" variant="outline"
            onClick={() => cancelMutation.mutate(captureConsent())}
            disabled={approveMutation.isPending || cancelMutation.isPending}>
            {cancelMutation.isPending ? t("cliAuth.cancelling") : t("cliAuth.cancel")}
          </Button>
          <Button ref={approveButton} onClick={() => approveMutation.mutate(captureConsent())}
            disabled={confirmationRequired || challengeQuery.isFetching || challengeQuery.isPlaceholderData || !authority.canRead() || !challenge.canApprove || approveMutation.isPending || cancelMutation.isPending}>
            {approveMutation.isPending ? t("cliAuth.approving") : t("cliAuth.approve")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
