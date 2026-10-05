import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
export function SaasSupportPage() {
  const { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity(),
    capabilities = useSaasCapabilities();
  const [operatorUserId, setOperator] = useState(""),
    [reason, setReason] = useState(""),
    [minutes, setMinutes] = useState(30);
  const [runtimeAccess, setRuntimeAccess] = useState(false),
    [restoreAccess, setRestoreAccess] = useState(false);
  useEffect(() => {
    setOperator("");
    setReason("");
    setRuntimeAccess(false);
    setRestoreAccess(false);
  }, [identity.userId, selectedCompanyId]);
  const sessions = useQuery({
    queryKey: ["saas-support", identity.userId, selectedCompanyId],
    queryFn: () =>
      saasApi.supportSessions(selectedCompanyId!, identity.userId!),
    enabled: Boolean(
      selectedCompanyId && identity.userId && capabilities.data?.support,
    ),
  });
  const approve = useMutation({
    mutationFn: () =>
      saasApi.approveSupport(selectedCompanyId!, identity.userId!, {
        operatorUserId,
        reason,
        scopes: [
          "status:read",
          ...(runtimeAccess ? ["runtime:manage"] : []),
          ...(restoreAccess ? ["backup:restore"] : []),
        ],
        expiresInMinutes: minutes,
      }),
    onSuccess: () => sessions.refetch(),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      saasApi.revokeSupport(selectedCompanyId!, identity.userId!, id),
    onSuccess: () => sessions.refetch(),
  });
  if (!capabilities.data?.support)
    return <p>Support access is not available yet.</p>;
  const error = sessions.error ?? approve.error ?? revoke.error;
  return (
    <main className="saas-page">
      <h1 className="saas-title">Support access</h1>
      <p className="saas-muted">
        An organization owner can allow a named August Works operator to inspect
        runtime status and perform the actions you select. Access expires
        automatically, is recorded in your activity log, and does not show API
        keys or private work content.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      <form
        className="saas-section"
        onSubmit={(event) => {
          event.preventDefault();
          approve.mutate();
        }}
      >
        <label className="saas-label">
          Operator ID supplied by support
          <input
            className="saas-input"
            required
            value={operatorUserId}
            onChange={(event) => setOperator(event.target.value)}
          />
        </label>
        <label className="saas-label">
          Reason
          <textarea
            className="saas-input"
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="saas-label">
          Duration
          <select
            className="saas-input"
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <label className="saas-row">
          <input
            type="checkbox"
            checked={runtimeAccess}
            onChange={(event) => setRuntimeAccess(event.target.checked)}
          />
          Allow starting, stopping, backing up and upgrading runtimes
        </label>
        <label className="saas-row">
          <input
            type="checkbox"
            checked={restoreAccess}
            onChange={(event) => setRestoreAccess(event.target.checked)}
          />
          Allow replacing runtime state from a verified backup
        </label>
        <div className="saas-footer">
          <span>Access is limited to the selected permissions.</span>
          <Button
            disabled={
              approve.isPending || !selectedCompanyId || !identity.userId
            }
            type="submit"
          >
            Approve temporary access
          </Button>
        </div>
      </form>
      <section className="saas-section">
        <h2 className="saas-subtitle">Access history</h2>
        {sessions.data?.length === 0 && (
          <p>No support access has been approved.</p>
        )}
        {sessions.data?.map((session) => (
          <div className="saas-row" key={session.id}>
            <span>
              {session.operatorUserId} ·{" "}
              {session.revokedAt
                ? "Revoked"
                : new Date(session.expiresAt) <= new Date()
                  ? "Expired"
                  : "Expires " + new Date(session.expiresAt).toLocaleString()}
            </span>
            {!session.revokedAt && new Date(session.expiresAt) > new Date() && (
              <Button
                variant="outline"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
              >
                Revoke access
              </Button>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
