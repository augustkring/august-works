import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
export function SaasDeletionPage() {
  const { selectedCompanyId } = useCompany();
  const identity = useAccountIdentity();
  return <SaasDeletionForm key={identity.userId + ":" + selectedCompanyId} />;
}

function SaasDeletionForm() {
  const { selectedCompanyId, selectedCompany } = useCompany(),
    identity = useAccountIdentity(),
    capabilities = useSaasCapabilities();
  const [confirmation, setConfirmation] = useState(""),
    [exported, setExported] = useState(false),
    [requestKey] = useState(() => crypto.randomUUID());
  const deletion = useQuery({
    queryKey: ["saas-deletion", identity.userId, selectedCompanyId],
    queryFn: () => saasApi.deletion(selectedCompanyId!, identity.userId!),
    enabled: Boolean(
      selectedCompanyId && identity.userId && capabilities.data?.deletion,
    ),
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
  if (!capabilities.data?.deletion)
    return <p>Organization deletion is not available yet.</p>;
  const error = deletion.error ?? request.error;
  return (
    <main className="saas-page">
      <h1 className="saas-title">Delete organization</h1>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {deletion.data ? (
        <section className="saas-section">
          <h2 className="saas-subtitle">
            Deletion: {deletion.data.status.replaceAll("_", " ")}
          </h2>
          <p>Current step: {deletion.data.stage.replaceAll("_", " ")}</p>
          {deletion.data.status === "waiting_retention" && (
            <p>
              Work has stopped. Retained backups must reach their deletion date
              before final erasure.
            </p>
          )}
          {deletion.data.errorCode && (
            <p role="status">
              Erasure is awaiting confirmation. Contact support if this state
              continues.
            </p>
          )}
          <p className="saas-muted">
            Financial records and a minimal deletion receipt are retained where
            required.
          </p>
        </section>
      ) : (
        <form
          className="saas-section"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <p>
            Deletion stops agent work, erases managed runtimes and removes your
            organization’s content after the retention period. This cannot be
            undone. Shared agents must be moved to another home organization
            first.
          </p>
          <Link className="saas-link" to="/company/export">
            Export your organization before deletion
          </Link>
          <label className="saas-label">
            <span>
              <input
                type="checkbox"
                checked={exported}
                onChange={(event) => setExported(event.target.checked)}
              />{" "}
              I have saved the exports I need.
            </span>
          </label>
          <label className="saas-label">
            Type {selectedCompany?.name ?? "the organization name"} to confirm
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
              Back to settings
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
              Request organization deletion
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
