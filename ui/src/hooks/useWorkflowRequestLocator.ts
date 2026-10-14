import { useEffect, useRef, useState } from "react";
import type { WorkflowRequestKind, WorkflowRequestLocator } from "@paperclipai/shared";
import { useV9PrivateReadAuthority } from "./useV9PrivateReadAuthority";
import { useCompany } from "../context/CompanyContext";
import { clearWorkflowRequest, pendingWorkflowRequests, retainWorkflowRequest, isWorkflowDraftRequest, WORKFLOW_REQUEST_LOCATORS_CHANGED } from "../lib/pending-workflow-requests";

/** A locator is written before the single Original command. No write, new
 * nonce or clear is inferred from an absent/late/foreign acknowledgement. */
export function useWorkflowRequestLocator(companyId: string, principal: string, workflowId: string, kind: WorkflowRequestKind, sourceReady: boolean) {
  const authority = useV9PrivateReadAuthority(principal, true);
  const { selectedCompanyId } = useCompany();
  sourceReady = sourceReady && selectedCompanyId === companyId;
  const [pending, setPending] = useState<string | null>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [blockedBy, setBlockedBy] = useState<WorkflowRequestLocator | null>(null);
  const scope = JSON.stringify([companyId, principal, workflowId, kind]);
  const source = useRef({ ready: sourceReady, scope, epoch: 0 });
  if (source.current.ready !== sourceReady || source.current.scope !== scope) source.current = { ready: sourceReady, scope, epoch: source.current.epoch + 1 };
  const confirmations = useRef(new WeakMap<object, number>());
  const row = (requestId: string) => ({ companyId, principal, workflowId, kind, requestId });
  useEffect(() => {
    const read = () => {
      try {
        const values = pendingWorkflowRequests(companyId, principal, workflowId), own = values.find(value => value.kind === kind);
        setPending(own?.requestId ?? null); setBlockedBy(own ?? values.find(value => isWorkflowDraftRequest(kind) && isWorkflowDraftRequest(value.kind)) ?? null); setReady(true); setFailed(false);
      }
      catch { setReady(false); setFailed(true); }
    };
    read(); window.addEventListener(WORKFLOW_REQUEST_LOCATORS_CHANGED, read);
    return () => window.removeEventListener(WORKFLOW_REQUEST_LOCATORS_CHANGED, read);
  }, [companyId, principal, workflowId, kind]);
  return {
    pending, blockedBy, ready, failed,
    async write<T extends { companyId: string; workflowId: string; requestId: string }>(requestId: string, operation: () => Promise<T>) {
      if (!authority.canRead() || source.current.scope !== scope || !source.current.ready || !ready || failed) throw new Error("Current workflow request recovery needs review");
      retainWorkflowRequest(row(requestId));
      const epoch = source.current.epoch;
      const receipt = await authority.write(operation);
      if (source.current.epoch !== epoch || !source.current.ready || receipt.companyId !== companyId || receipt.workflowId !== workflowId || receipt.requestId !== requestId)
        throw new Error("The Original workflow request needs current confirmation");
      confirmations.current.set(receipt, epoch); return receipt;
    },
    confirm(receipt: { companyId: string; workflowId: string; requestId: string }) {
      if (!authority.confirmed(receipt) || confirmations.current.get(receipt) !== source.current.epoch || !source.current.ready ||
        receipt.companyId !== companyId || receipt.workflowId !== workflowId) return false;
      try { clearWorkflowRequest(row(receipt.requestId)); return true; } catch { setFailed(true); return false; }
    },
    observed(receipt: { companyId: string; workflowId: string; requestId: string }) {
      if (!authority.canRead() || !source.current.ready || source.current.scope !== scope || receipt.companyId !== companyId || receipt.workflowId !== workflowId) return false;
      try {
        const saved = pendingWorkflowRequests(companyId, principal, workflowId).find(value => value.kind === kind);
        if (!saved || saved.requestId !== receipt.requestId) return false;
        clearWorkflowRequest(saved); return true;
      } catch { setFailed(true); return false; }
    },
    /** A named Native pre-effect refusal can release only this exact tuple.
     * Conflict with an already recorded request is not an absence proof. */
    refused(requestId: string) {
      if (!authority.canRead()) return;
      try { clearWorkflowRequest(row(requestId)); } catch { setFailed(true); }
    },
    canRead: authority.canRead,
  };
}
