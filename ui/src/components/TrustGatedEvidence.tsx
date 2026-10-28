import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TrustDocumentGatedAccess } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { trustGatedDocumentsApi } from "../api/trust-gated-documents";

const trustGatedKey = (companyId: string, userId: string, sessionId: string, epoch: number) =>
  ["trust-gated-evidence", companyId, userId, sessionId, epoch] as const;

export function TrustGatedEvidence({ companyId, active }: { companyId?: string | null; active: boolean }) {
  const { t } = useTranslation("experience");
  const identity = useV9CurrentAccount();
  const queryClient = useQueryClient();
  const principal = identity.localImplicit ? "local-board" : identity.userId ?? "";
  const authority = useV9PrivateReadAuthority(principal, false);
  const scope = JSON.stringify([companyId, principal, identity.sessionId, identity.authorityEpoch, authority.epoch]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [actionError, setActionError] = useState(false);
  const ready = active && !!companyId && !!identity.userId && !identity.localImplicit &&
    identity.settled && !identity.failed && !!identity.sessionId && authority.readReady;
  const listKey = useMemo(() => trustGatedKey(companyId ?? "__no-company__", identity.userId ?? "",
    identity.sessionId ?? "", authority.epoch), [companyId, identity.userId, identity.sessionId, authority.epoch]);
  const previousScopeRef = useRef(scope);
  const previousListKeyRef = useRef(listKey);
  const list = useQuery({
    queryKey: listKey,
    enabled: ready,
    queryFn: async ({ signal }) => {
      const requestedScope = scopeRef.current;
      const result = await authority.read(() => trustGatedDocumentsApi.list(companyId!, identity.userId!, signal));
      if (!authority.canRead() || requestedScope !== scopeRef.current)
        throw new Error("Current gated evidence access is unavailable");
      return result;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const selected = list.data?.documents.find(item => item.document.id === selectedId) ?? null;
  const selectedGrant = selected?.access.state === "granted" ? selected.access.grantReceiptId : null;
  const contentKey = [...listKey, "content", selectedId ?? "__none__", selectedGrant ?? "__none__"] as const;
  const content = useQuery({
    queryKey: contentKey,
    enabled: ready && !!selectedId && !!selectedGrant,
    queryFn: async ({ signal }) => {
      const requestedScope = scopeRef.current;
      const result = await authority.read(() => trustGatedDocumentsApi.content(
        companyId!, selectedId!, identity.userId!, selectedGrant!, signal,
      ));
      if (!authority.canRead() || requestedScope !== scopeRef.current)
        throw new Error("Current gated evidence access is unavailable");
      return result;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (previousScopeRef.current !== scope) {
      const previousListKey = previousListKeyRef.current;
      previousScopeRef.current = scope;
      previousListKeyRef.current = listKey;
      void queryClient.removeQueries({ queryKey: previousListKey, exact: false });
    }
    setSelectedId(null);
    setExpiresAtLocal("");
    setActionError(false);
  }, [scope, listKey, queryClient]);
  useEffect(() => {
    if (!active) {
      setSelectedId(null);
      void queryClient.removeQueries({ queryKey: [...listKey, "content"], exact: false });
    }
  }, [active, listKey, queryClient]);

  const grant = useMutation({
    mutationFn: async (document: TrustDocumentGatedAccess["document"]) => {
      const expiresAt = new Date(expiresAtLocal);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
        throw new Error("Choose a future expiry time");
      const input = {
        expectedUserId: identity.userId!, requestId: crypto.randomUUID(),
        registryEntryId: document.id, version: document.version,
        granteeUserId: identity.userId!, expiresAt: expiresAt.toISOString(), surface: "trust_center_gated_evidence",
      };
      const requestedScope = scopeRef.current;
      const receipt = await authority.write(() => trustGatedDocumentsApi.grant(companyId!, input));
      if (!authority.canRead() || requestedScope !== scopeRef.current)
        throw new Error("Current account or company changed before the grant was confirmed");
      return receipt;
    },
    onSuccess: async () => {
      setActionError(false);
      await queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
    onError: () => setActionError(true),
  });
  const revoke = useMutation({
    mutationFn: async (grantReceiptId: string) => {
      const requestedScope = scopeRef.current;
      const receipt = await authority.write(() => trustGatedDocumentsApi.revoke(companyId!, grantReceiptId, {
        expectedUserId: identity.userId!, requestId: crypto.randomUUID(), surface: "trust_center_gated_evidence",
      }));
      if (!authority.canRead() || requestedScope !== scopeRef.current)
        throw new Error("Current account or company changed before revocation was confirmed");
      return receipt;
    },
    onSuccess: async receipt => {
      setActionError(false);
      await queryClient.removeQueries({ queryKey: [...listKey, "content"], exact: false });
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: listKey, exact: true });
      void receipt;
    },
    onError: () => setActionError(true),
  });

  function downloadCurrentBody() {
    const body = content.data;
    const expectedScope = scopeRef.current;
    if (!body || !authority.canRead()) return;
    if (expectedScope !== scopeRef.current) return;
    const extension = body.format === "markdown" ? "md" : "txt";
    const objectUrl = URL.createObjectURL(new Blob([body.body], { type: "text/plain;charset=utf-8" }));
    const anchor = window.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `trust-evidence-${body.document.version}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  if (!active || !companyId || !identity.userId || identity.localImplicit) return null;
  return <section aria-labelledby="trust-gated-evidence-title" className="space-y-3 rounded-lg border border-border p-4">
    <header className="space-y-1">
      <h2 id="trust-gated-evidence-title" className="font-medium">{t("trustGated.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("trustGated.description")}</p>
    </header>
    {!ready && <p role="status" className="text-sm text-muted-foreground">{t("trustGated.sessionChecking")}</p>}
    {ready && list.isFetching && <p role="status" className="text-sm text-muted-foreground">{t("trustGated.loading")}</p>}
    {ready && list.isError && <div role="alert" className="space-y-2">
      <p>{t("trustGated.loadError")}</p>
      <Button type="button" variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>{t("trustGated.retry")}</Button>
    </div>}
    {ready && list.isSuccess && list.data.documents.length === 0 &&
      <p className="text-sm text-muted-foreground">{t("trustGated.empty")}</p>}
    {ready && list.isSuccess && list.data.documents.length > 0 && <ul className="divide-y divide-border">
      {list.data.documents.map(item => {
        const document = item.document;
        const ndaUnconfigured = item.access.state === "nda_binding_unconfigured";
        const grantedAccess = item.access.state === "granted" ? item.access : null;
        return <li key={document.id} className="space-y-2 py-3">
          <div className="space-y-1">
            <h3 className="font-medium">{document.title ?? t("trustGated.untitled")}</h3>
            <p className="text-sm text-muted-foreground">{t("trustGated.version", { version: document.version })}</p>
            <p className="text-sm text-muted-foreground">{t("trustGated.reviewed", {
              date: document.lastReviewedAt ? new Date(document.lastReviewedAt).toLocaleDateString() : t("trustGated.unknownDate"),
            })}</p>
          </div>
          {ndaUnconfigured && <p role="status" className="text-sm">{t("trustGated.ndaUnconfigured")}</p>}
          {item.access.state === "grant_required" && list.data.canGrant && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="space-y-1 text-sm">
              <span>{t("trustGated.expiryLabel")}</span>
              <input type="datetime-local" value={expiresAtLocal} onChange={event => setExpiresAtLocal(event.target.value)}
                className="block min-h-11 rounded-md border border-border bg-background px-3" />
            </label>
            <Button type="button" variant="outline" disabled={!expiresAtLocal || grant.isPending}
              onClick={() => grant.mutate(document)}>
              {grant.isPending && grant.variables?.id === document.id ? t("trustGated.granting") : t("trustGated.grantMe")}
            </Button>
          </div>}
          {grantedAccess && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setSelectedId(selectedId === document.id ? null : document.id)}>
              {selectedId === document.id ? t("trustGated.hide") : t("trustGated.review")}
            </Button>
            <Button type="button" variant="outline" disabled={!list.data.canGrant || revoke.isPending}
              onClick={() => revoke.mutate(grantedAccess.grantReceiptId)}>{t("trustGated.revoke")}</Button>
            <p className="self-center text-xs text-muted-foreground">{t("trustGated.expires", {
              date: new Date(grantedAccess.expiresAt).toLocaleString(),
            })}</p>
          </div>}
          {selectedId === document.id && grantedAccess && <div className="space-y-2 rounded-md bg-muted/40 p-3">
            {content.isFetching && <p role="status">{t("trustGated.contentLoading")}</p>}
            {content.isError && <div role="alert" className="space-y-2">
              <p>{t("trustGated.contentUnavailable")}</p>
              <Button type="button" variant="outline" onClick={() => void content.refetch()} disabled={content.isFetching}>{t("trustGated.retry")}</Button>
            </div>}
            {content.data && <>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{content.data.body}</pre>
              <Button type="button" variant="outline" onClick={downloadCurrentBody}>{t("trustGated.download")}</Button>
            </>}
          </div>}
        </li>;
      })}
    </ul>}
    {actionError && <p role="alert" className="text-sm">{t("trustGated.actionError")}</p>}
  </section>;
}
