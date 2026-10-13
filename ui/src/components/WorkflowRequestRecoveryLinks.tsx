import { useEffect, useState } from "react";
import type { WorkflowRequestLocator } from "@paperclipai/shared";
import { useTranslation } from "../i18n";
import { Link } from "../lib/router";
import { pendingWorkflowRequests, WORKFLOW_REQUEST_LOCATORS_CHANGED } from "../lib/pending-workflow-requests";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";

/** Locators reveal no request contents or authority. Follow each exact Original
 * owner to confirm it; page return cannot create a replacement operation. */
export function usePendingWorkflowRequests(company: string, principal: string, workflow: string) {
  const [rows, setRows] = useState<WorkflowRequestLocator[]>([]), [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    const read = () => { try { setRows(pendingWorkflowRequests(company, principal, workflow)); setFailed(false); } catch { setRows([]); setFailed(true); } finally { setReady(true); } };
    read(); window.addEventListener(WORKFLOW_REQUEST_LOCATORS_CHANGED, read);
    return () => window.removeEventListener(WORKFLOW_REQUEST_LOCATORS_CHANGED, read);
  }, [company, principal, workflow]);
  return { rows, failed, ready };
}
export function WorkflowRequestRecoveryLinks({ company, principal, workflow }: { company: string; principal: string; workflow: string }) {
  const { t } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal, true);
  const { rows, failed } = usePendingWorkflowRequests(company, principal, workflow);
  if (!authority.canRead() || (!failed && !rows.length)) return null;
  return <section className="mx-auto w-full max-w-3xl space-y-3 p-4 sm:p-6" aria-label={t("workflowRequestRecovery.pending")}>
    {failed ? <p role="alert">{t("workflowRequestRecovery.storageFailed")}</p> : <>
      <h2 className="text-lg font-semibold">{t("workflowRequestRecovery.pending")}</h2>
      <p>{t("workflowRequestRecovery.boundary")}</p>
      <ul>{rows.map(row => <li key={`${row.kind}:${row.requestId}`}><Link className="inline-flex min-h-11 items-center underline"
        to={`/workflows/${workflow}/requests/${row.kind}/${row.requestId}`}>{t("workflowRequestRecovery.openKind", { kind: t(`workflowRequestRecovery.kind.${row.kind}`) })}</Link></li>)}</ul>
    </>}
  </section>;
}
