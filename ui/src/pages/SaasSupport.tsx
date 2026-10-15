import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { saasApi } from "@/api/saas";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { useExperienceHeading } from "@/hooks/useExperienceHeading";

type ApprovalInput = Parameters<typeof saasApi.approveSupport>[2];
export function SaasSupportPage() {
  const { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity(),
    capabilities = useSaasCapabilities(),
    { t } = useTranslation("experience");
  if (identity.failed || capabilities.isError)
    return <p role="alert">{t("nativeSupport.unavailable")}</p>;
  if (!identity.settled || capabilities.isPending)
    return <p role="status">{t("loading")}</p>;
  if (
    !selectedCompanyId ||
    !identity.userId ||
    identity.localImplicit ||
    !capabilities.data?.support
  )
    return <p role="alert">{t("nativeSupport.unavailable")}</p>;
  return (
    <NativeSupportControls
      key={`${selectedCompanyId}:${identity.userId}`}
      companyId={selectedCompanyId}
      principal={identity.userId}
    />
  );
}

/** Current Native V6 controls. An unknown approval has no automatic retry. */
export function NativeSupportControls({
  companyId,
  principal,
}: {
  companyId: string;
  principal: string;
}) {
  const { t } = useTranslation("experience"),
    client = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const prefix = ["saas-support", companyId, principal];
  const region = useRef<HTMLElement>(null),
    errorRegion = useRef<HTMLDivElement>(null),
    restoreFocus = useRef<string | null>(null);
  const [operatorUserId, setOperator] = useState(""),
    [reason, setReason] = useState(""),
    [minutes, setMinutes] = useState(30);
  const [runtimeAccess, setRuntimeAccess] = useState(false),
    [restoreAccess, setRestoreAccess] = useState(false);
  const [review, setReview] = useState<ApprovalInput | null>(null),
    [acknowledged, setAcknowledged] = useState(false);
  const sent = useRef(false),
    reviewPreparing = useRef(false),
    focusReview = useRef(false),
    reviewHeading = useRef<HTMLHeadingElement>(null);
  const sessions = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: async ({ signal }) => {
      const [rows, pending] = await Promise.all([
        saasApi.supportSessions(companyId, principal, signal),
        saasApi.pendingSupportApproval(companyId, principal, signal),
      ]);
      return { rows, pending };
    },
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15000 : false,
    refetchIntervalInBackground: false,
  });
  const heading = useExperienceHeading(
    `${companyId}:${principal}`,
    sessions.isPending || sessions.isFetching,
    sessions.isError,
    restoreFocus.current !== null,
  );
  useEffect(() => {
    if (
      review &&
      focusReview.current &&
      !sessions.isFetching &&
      !sessions.isError
    ) {
      focusReview.current = false;
      if (!document.activeElement?.closest('[role="dialog"]'))
        reviewHeading.current?.focus();
    }
  }, [review, sessions.isFetching, sessions.isError]);
  useCompanyLiveEvent((event) => {
    if (event.companyId !== companyId || event.type !== "activity.logged")
      return;
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    setEpoch((old) => old + 1);
  });
  const checking = sessions.isPending || sessions.isFetching;
  if (
    checking &&
    !sessions.isError &&
    region.current?.contains(document.activeElement)
  )
    restoreFocus.current =
      document.activeElement?.getAttribute("data-native-support-focus") ?? null;
  useEffect(() => {
    if (checking) return;
    const token = restoreFocus.current;
    restoreFocus.current = null;
    if (document.activeElement?.closest('[role="dialog"]')) return;
    if (sessions.isError) {
      errorRegion.current?.focus();
      return;
    }
    if (token && document.activeElement === document.body) {
      const equivalent = Array.from(
        region.current?.querySelectorAll<HTMLElement>(
          "[data-native-support-focus]",
        ) ?? [],
      ).find(
        (element) =>
          element.getAttribute("data-native-support-focus") === token,
      );
      (equivalent ?? heading.current)?.focus();
    }
  }, [checking, sessions.isError]);
  function recordedApproval() {
    setReview(null);
    setAcknowledged(false);
    setOperator("");
    setReason("");
    setRuntimeAccess(false);
    setRestoreAccess(false);
    sent.current = false;
    reviewPreparing.current = false;
    void sessions.refetch();
  }
  const prepareReview = useMutation({
    mutationFn: (input: ApprovalInput) =>
      saasApi.prepareSupportApproval(companyId, principal, input),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      void sessions.refetch();
    },
  });
  const cancelReview = useMutation({
    mutationFn: (approvalId: string) =>
      saasApi.cancelSupportApproval(companyId, principal, approvalId),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      prepareReview.reset();
      approve.reset();
      originalApproval.reset();
      recordedApproval();
    },
  });
  const retainedApproval = useMutation({
    mutationFn: (approvalId: string) =>
      saasApi.originalSupportApproval(companyId, principal, approvalId),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      void sessions.refetch();
    },
  });
  const originalApproval = useMutation({
    mutationFn: (input: ApprovalInput) =>
      saasApi.supportApproval(companyId, principal, input),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      approve.reset();
      recordedApproval();
    },
  });
  const approve = useMutation({
    mutationFn: (input: ApprovalInput) =>
      saasApi.approveSupport(companyId, principal, input),
    retry: false,
    gcTime: 0,
    onSuccess: recordedApproval,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => saasApi.revokeSupport(companyId, principal, id),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      void sessions.refetch();
    },
  });
  if (sessions.isError)
    return (
      <div ref={errorRegion} tabIndex={-1} role="alert" className="space-y-3">
        <p>{t("nativeSupport.unavailable")}</p>
        <Button className="min-h-11" onClick={() => void sessions.refetch()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  // Checking unmounts every retained private field, including review and history.
  if (sessions.isPending || sessions.isFetching)
    return <p role="status">{t("loading")}</p>;
  return (
    <section ref={region} className="saas-page">
      <h1
        ref={heading}
        data-native-support-focus="heading"
        tabIndex={-1}
        className="saas-title"
      >
        {t("nativeSupport.title")}
      </h1>
      <p className="saas-muted">{t("nativeSupport.description")}</p>
      {(prepareReview.isError ||
        cancelReview.isError ||
        retainedApproval.isError) && (
        <div role="alert" className="space-y-3">
          <p>{t("nativeSupport.reviewUnknown")}</p>
          {cancelReview.isError && cancelReview.variables && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={cancelReview.isPending}
              onClick={() => cancelReview.mutate(cancelReview.variables!)}
            >
              {t("nativeSupport.checkCancellation")}
            </Button>
          )}
          {prepareReview.isError && review && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={prepareReview.isPending}
              onClick={() => prepareReview.mutate(review)}
            >
              {t("nativeSupport.checkReview")}
            </Button>
          )}
        </div>
      )}
      {(approve.isError || revoke.isError) && (
        <div role="alert" className="space-y-3">
          <p>
            {t(
              approve.isError
                ? "nativeSupport.approvalUnknown"
                : "nativeSupport.revokeUnknown",
            )}
          </p>
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => void sessions.refetch()}
          >
            {t("nativeSupport.checkHistory")}
          </Button>
          {approve.isError && review?.approvalId && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={originalApproval.isPending}
              onClick={() => originalApproval.mutate(review)}
            >
              {t("nativeSupport.checkOriginal")}
            </Button>
          )}
        </div>
      )}
      {(approve.isSuccess || originalApproval.isSuccess) && (
        <p role="status">{t("nativeSupport.recorded")}</p>
      )}
      {cancelReview.isSuccess && (
        <p role="status">
          {t(
            cancelReview.data.state === "cancelled"
              ? "nativeSupport.cancelled"
              : "nativeSupport.alreadyRecorded",
          )}
        </p>
      )}
      {sessions.data?.pending &&
      sessions.data.pending.approvalId !== review?.approvalId ? (
        <section
          className="saas-section"
          aria-label={t("nativeSupport.pendingTitle")}
        >
          <h2 className="saas-subtitle">{t("nativeSupport.pendingTitle")}</h2>
          <p>{t("nativeSupport.pendingDescription")}</p>
          <div className="saas-footer">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={retainedApproval.isPending || cancelReview.isPending}
              onClick={() =>
                retainedApproval.mutate(sessions.data!.pending!.approvalId)
              }
            >
              {t("nativeSupport.checkOriginal")}
            </Button>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={retainedApproval.isPending || cancelReview.isPending}
              onClick={() =>
                cancelReview.mutate(sessions.data!.pending!.approvalId)
              }
            >
              {t("nativeSupport.cancelOriginal")}
            </Button>
          </div>
        </section>
      ) : review ? (
        <section
          className="saas-section"
          aria-label={t("nativeSupport.reviewTitle")}
        >
          <h2
            ref={reviewHeading}
            data-native-support-focus="review"
            tabIndex={-1}
            className="saas-subtitle"
          >
            {t("nativeSupport.reviewTitle")}
          </h2>
          {prepareReview.isPending && <p role="status">{t("loading")}</p>}
          <dl className="space-y-2">
            <dt>{t("nativeSupport.operator")}</dt>
            <dd className="break-all">{review.operatorUserId}</dd>
            <dt>{t("nativeSupport.reason")}</dt>
            <dd className="whitespace-pre-wrap break-words">{review.reason}</dd>
            <dt>{t("nativeSupport.duration")}</dt>
            <dd>
              {t("nativeSupport.minutes", { count: review.expiresInMinutes })}
            </dd>
            <dt>{t("nativeSupport.permissions")}</dt>
            <dd>
              <ul>
                {review.scopes.map((scope) => (
                  <li key={scope}>
                    {t(`supportHistory.scope.${scope.replace(":", "_")}`)}
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
          <label className="saas-row">
            <input
              type="checkbox"
              data-native-support-focus="acknowledgement"
              checked={acknowledged}
              disabled={
                prepareReview.isPending ||
                prepareReview.isError ||
                !prepareReview.isSuccess ||
                approve.isPending ||
                approve.isError ||
                cancelReview.isPending ||
                cancelReview.isError
              }
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {t("nativeSupport.acknowledge")}
          </label>
          <div className="saas-footer">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={
                prepareReview.isPending ||
                prepareReview.isError ||
                !prepareReview.isSuccess ||
                approve.isPending ||
                approve.isError ||
                cancelReview.isPending ||
                cancelReview.isError
              }
              onClick={() => {
                if (sent.current) return;
                if (review.approvalId) {
                  sent.current = true;
                  cancelReview.mutate(review.approvalId);
                }
              }}
            >
              {t("nativeSupport.cancel")}
            </Button>
            <Button
              className="min-h-11"
              disabled={
                !acknowledged ||
                !prepareReview.isSuccess ||
                prepareReview.isPending ||
                prepareReview.isError ||
                approve.isPending ||
                approve.isError ||
                cancelReview.isPending ||
                cancelReview.isError
              }
              onClick={() => {
                if (
                  !acknowledged ||
                  sent.current ||
                  !prepareReview.isSuccess ||
                  prepareReview.isPending ||
                  prepareReview.isError ||
                  cancelReview.isPending ||
                  cancelReview.isError
                )
                  return;
                sent.current = true;
                approve.mutate(review);
              }}
            >
              {approve.isPending
                ? t("nativeSupport.submitting")
                : t("nativeSupport.confirm")}
            </Button>
          </div>
          {approve.isError && review.approvalId && (
            <Button
              className="min-h-11"
              variant="outline"
              disabled={cancelReview.isPending || originalApproval.isPending}
              onClick={() => cancelReview.mutate(review.approvalId!)}
            >
              {t("nativeSupport.cancelOriginal")}
            </Button>
          )}
        </section>
      ) : (
        <form
          className="saas-section"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              sent.current ||
              reviewPreparing.current ||
              prepareReview.isPending ||
              review ||
              sessions.data?.pending
            )
              return;
            reviewPreparing.current = true;
            approve.reset();
            originalApproval.reset();
            prepareReview.reset();
            cancelReview.reset();
            retainedApproval.reset();
            focusReview.current = true;
            const frozen: ApprovalInput = {
              approvalId: crypto.randomUUID(),
              operatorUserId,
              reason,
              scopes: [
                "status:read",
                ...(runtimeAccess ? ["runtime:manage"] : []),
                ...(restoreAccess ? ["backup:restore"] : []),
              ],
              expiresInMinutes: minutes,
            };
            setReview(frozen);
            prepareReview.mutate(frozen);
            setAcknowledged(false);
          }}
        >
          <label className="saas-label">
            {t("nativeSupport.operator")}
            <input
              className="saas-input"
              required
              maxLength={200}
              data-native-support-focus="operator"
              value={operatorUserId}
              onChange={(event) => setOperator(event.target.value)}
            />
          </label>
          <label className="saas-label">
            {t("nativeSupport.reason")}
            <textarea
              className="saas-input"
              required
              minLength={10}
              maxLength={500}
              data-native-support-focus="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="saas-label">
            {t("nativeSupport.duration")}
            <select
              className="saas-input"
              data-native-support-focus="duration"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            >
              {[15, 30, 60].map((value) => (
                <option key={value} value={value}>
                  {t("nativeSupport.minutes", { count: value })}
                </option>
              ))}
            </select>
          </label>
          <label className="saas-row">
            <input
              type="checkbox"
              data-native-support-focus="runtime"
              checked={runtimeAccess}
              onChange={(event) => setRuntimeAccess(event.target.checked)}
            />
            {t("supportHistory.scope.runtime_manage")}
          </label>
          <label className="saas-row">
            <input
              type="checkbox"
              data-native-support-focus="restore"
              checked={restoreAccess}
              onChange={(event) => setRestoreAccess(event.target.checked)}
            />
            {t("supportHistory.scope.backup_restore")}
          </label>
          <Button className="min-h-11" type="submit">
            {t("nativeSupport.reviewTitle")}
          </Button>
        </form>
      )}
      <section className="saas-section">
        <h2 className="saas-subtitle">{t("nativeSupport.history")}</h2>
        {sessions.data?.rows.length === 0 && <p>{t("nativeSupport.empty")}</p>}
        {sessions.data?.rows.map((session) => (
          <div className="saas-row" key={session.id}>
            <span>
              {session.operatorUserId} ·{" "}
              {session.revokedAt
                ? t("nativeSupport.revoked")
                : new Date(session.expiresAt) <= new Date()
                  ? t("nativeSupport.expired")
                  : t("nativeSupport.expiry", {
                      time: new Date(session.expiresAt).toLocaleString(),
                    })}
            </span>
            {!session.revokedAt && new Date(session.expiresAt) > new Date() && (
              <Button
                className="min-h-11"
                variant="outline"
                disabled={revoke.isPending}
                data-native-support-focus={`revoke:${session.id}`}
                onClick={() => revoke.mutate(session.id)}
              >
                {t("nativeSupport.revoke")}
              </Button>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
