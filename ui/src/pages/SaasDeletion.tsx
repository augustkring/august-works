import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";

export function SaasDeletionPage() {
  const { selectedCompanyId } = useCompany();
  const identity = useAccountIdentity();
  return <SaasDeletionForm key={identity.userId + ":" + selectedCompanyId} />;
}

function SaasDeletionForm() {
  const { t, i18n } = useTranslation("experience");
  const { selectedCompanyId, selectedCompany } = useCompany(),
    identity = useAccountIdentity(),
    capabilities = useSaasCapabilities();
  const [confirmation, setConfirmation] = useState(""),
    [exported, setExported] = useState(false),
    [requestKey] = useState(() => crypto.randomUUID());
  const deletion = useQuery({
    queryKey: ["saas-deletion", identity.userId, selectedCompanyId],
    queryFn: ({ signal }) => saasApi.deletion(selectedCompanyId!, identity.userId!, signal),
    enabled: Boolean(
      selectedCompanyId && identity.userId && capabilities.data?.profile === "saas",
    ),
    retry: false,
    gcTime: 0,
    refetchInterval: 5000,
  });
  const request = useMutation({
    mutationFn: () =>
      saasApi.deleteCompany(selectedCompanyId!, identity.userId!, {
        confirmation,
        acknowledgeExport: true,
        idempotencyKey: requestKey,
      }),
    onSuccess: () => deletion.refetch(),
  });
  if (capabilities.isPending) return <p role="status">{t("organizationDeletion.loading")}</p>;
  if (capabilities.error) return <p role="alert">{t("organizationDeletion.unavailable")}</p>;
  if (capabilities.data?.profile !== "saas") return <p>{t("organizationDeletion.disabled")}</p>;
  const statusLabels: Record<string, string> = {
    requested: "requested", processing: "processing", waiting_retention: "waitingRetention",
    failed: "failed", completed: "completed", cancelled: "cancelled",
  };
  const stageLabels: Record<string, string> = {
    revoke: "revoke", revoke_finalizing: "stopping", runtimes: "runtimes", billing: "billing",
    retention: "retention", purge: "purge", completed: "completed",
  };
  const reasonLabels: Record<string, string> = {
    secret_provider_erasure_identity_unresolved: "providerIdentity",
    runtime_erasure_attempts_exhausted: "runtimeRepair",
    offboarding_stage_invalid: "stageRepair",
    offboarding_provider_access_denied: "providerAccess",
    offboarding_provider_invalid_request: "providerRequest",
    secret_provider_erasure_pending: "providerPending",
    managed_provider_erasure_pending: "runtimePending",
    legacy_runtime_asset_erasure_pending: "runtimePending",
    runtime_erasure_pending: "runtimePending",
    backup_retention_pending: "backupPending",
    feedback_retention_hold_pending: "retentionHold",
    feedback_image_erasure_pending: "imagePending",
  };
  const error = deletion.error ?? request.error;
  return (
    <main className="saas-page">
      <h1 className="saas-title">{t("organizationDeletion.heading")}</h1>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {deletion.data ? (
        <section className="saas-section">
          <h2 className="saas-subtitle">
            {t("organizationDeletion.statusLabel", { status: t(`organizationDeletion.status.${statusLabels[deletion.data.status] ?? "unknown"}`) })}
          </h2>
          <p>{t("organizationDeletion.stepLabel", { step: t(`organizationDeletion.stage.${stageLabels[deletion.data.stage] ?? "unknown"}`) })}</p>
          <p className="saas-machine">{t("organizationDeletion.requestId", { id: deletion.data.id })}</p>
          {deletion.data.errorCode && <p>{t(`organizationDeletion.reason.${reasonLabels[deletion.data.errorCode] ?? "reconciliationPending"}`)}</p>}
          {deletion.data.status === "failed" ? <p>{t("organizationDeletion.manualReconciliation")}</p> :
            deletion.data.notBefore && !["completed", "cancelled"].includes(deletion.data.status) &&
            <p>{t("organizationDeletion.nextReconciliation", { date: new Date(deletion.data.notBefore).toLocaleString(i18n.resolvedLanguage) })}</p>}
          {deletion.data.status === "waiting_retention" && (
            <p>{t("organizationDeletion.retention")}</p>
          )}
          {deletion.data.status === "failed" ? (
            <p role="alert">{t("organizationDeletion.recoveryRequired")} <a className="saas-link" href="mailto:privacy@blentera.com">privacy@blentera.com</a></p>
          ) : deletion.data.errorCode && (
            <p role="status">{t("organizationDeletion.awaitingConfirmation")}</p>
          )}
          <p className="saas-muted">
            {t("organizationDeletion.retainedRecords")}
          </p>
        </section>
      ) : deletion.isPending ? (
        <p role="status">{t("organizationDeletion.loading")}</p>
      ) : deletion.isError ? (
        <Button type="button" variant="outline" onClick={() => { void deletion.refetch(); }}>{t("organizationDeletion.retry")}</Button>
      ) : !capabilities.data.deletion ? (
        <p>{t("organizationDeletion.disabled")}</p>
      ) : (
        <form
          className="saas-section"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <p>
            {t("organizationDeletion.consequences")}
          </p>
          <Link className="saas-link" to="/company/export">
            {t("organizationDeletion.export")}
          </Link>
          <label className="saas-label">
            <span>
              <input
                type="checkbox"
                checked={exported}
                onChange={(event) => setExported(event.target.checked)}
              />{" "}
              {t("organizationDeletion.exported")}
            </span>
          </label>
          <label className="saas-label">
            {t("organizationDeletion.confirm", { name: selectedCompany?.name ?? t("organizationDeletion.organizationName") })}
            <input
              className="saas-input"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="saas-footer">
            <Link className="saas-link" to="/company/settings">
              {t("organizationDeletion.back")}
            </Link>
            <Button
              variant="destructive"
              disabled={
                request.isPending ||
                !exported ||
                confirmation !== selectedCompany?.name ||
                !identity.userId
              }
              type="submit"
            >
              {t("organizationDeletion.submit")}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
