import { MaintenanceHistoryLink } from "../components/MaintenanceHistoryLink";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  packageInstallSchema,
  packageDecisionSchema,
  type PackageCatalogView,
  type PackagePreview,
  type PackageInstallationView,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { agentPackagesApi, packageProposalsApi } from "@/api/agent-packages";
import { useCompany } from "@/context/CompanyContext";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { PackageInstallationReceipt } from "./PackageInstallationReceipt";
import { clearPendingPackageInstallation, readPendingPackageInstallation, retainPendingPackageInstallation } from "../lib/pending-package-installations";
export function AgentPackages() {
  const { selectedCompanyId: companyId } = useCompany(), identity = useV9CurrentAccount(), { t } = useTranslation("experience");
  // Keep the same person's unsent setup in memory through a session recheck;
  // changing either principal or company remounts the whole private workspace.
  if (!companyId) return <p role="status">{t("selectCompany")}</p>;
  if (!identity.userId) return <p role={identity.failed ? "alert" : "status"}>{t(identity.failed ? "packageWorkspaceUnavailable" : "loading")}</p>;
  return <AgentPackagesWorkspace key={`${companyId}:${identity.userId}`} companyId={companyId} userId={identity.userId}
    principal={identity.localImplicit ? "local-board" : identity.userId} allowLocalImplicit={identity.localImplicit} />;
}
function AgentPackagesWorkspace({ companyId, userId, principal, allowLocalImplicit }: {
  companyId: string; userId: string; principal: string; allowLocalImplicit: boolean;
}) {
  const authority = useV9PrivateReadAuthority(principal, allowLocalImplicit), reader = useId(), { t } = useTranslation("experience");
  const surface = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null), focused = useRef(false);
  const restoreFocus = useRef<string | true | null>(null);
  const scope = useRef({ companyId, userId });
  scope.current = { companyId, userId };
  const [recovery, setRecovery] = useState<{ requestId: string | null; unavailable: boolean }>(() => {
    try { return { requestId: readPendingPackageInstallation(companyId, principal), unavailable: false }; }
    catch { return { requestId: null, unavailable: true }; }
  });
  const originalInstall = useRef<{ requestId: string; key: string; input: ReturnType<typeof packageInstallSchema.parse> } | null>(null);
  const [updating, setUpdating] = useState<PackageInstallationView | null>(
      null,
    ),
    [material, setMaterial] = useState(false),
    [useCaseId, setUseCaseId] = useState("");
  const [selection, setSelection] = useState<Pick<PackageCatalogView, "id" | "versionId"> | null>(null),
    [updatePolicy, setUpdatePolicy] = useState<"manual" | "auto_low_risk">(
      "manual",
    ),
    [agentId, setAgentId] = useState(""),
    [pins, setPins] = useState<Record<string, string>>({}),
    [internal, setInternal] = useState(false),
    [previewReceipt, setPreviewReceipt] = useState<{ value: PackagePreview; epoch: number; setup: string } | null>(null),
    [reason, setReason] = useState("");
  const setPreview = (value: PackagePreview | null, setup?: string | null) =>
    setPreviewReceipt(value && setup ? { value, epoch: authority.epoch, setup } : null);
  const enabled = authority.readReady && !recovery.requestId && !recovery.unavailable;
  const catalog = useQuery({
    queryKey: ["agent-packages", userId, companyId, authority.epoch, reader],
    queryFn: () => authority.read(() => agentPackagesApi.catalog(userId)),
    enabled, retry: false, gcTime: 0,
  });
  const selected = selection ? catalog.data?.find(row => row.id === selection.id && row.versionId === selection.versionId) ?? null : null;
  const setSelected = (value: PackageCatalogView | null) => setSelection(value ? { id: value.id, versionId: value.versionId } : null);
  const options = useQuery({
    queryKey: ["agent-package-options", userId, companyId, authority.epoch, reader],
    queryFn: () => authority.read(() => agentPackagesApi.options(companyId, userId)),
    enabled, retry: false, gcTime: 0,
  });
  const useCases = useQuery({
    queryKey: ["package-use-cases", userId, companyId, authority.epoch, reader],
    queryFn: () => authority.read(() => aiGovernanceApi.list(companyId, userId)),
    enabled: enabled && selected?.manifest.audience === "customer",
    retry: false, gcTime: 0,
  });
  const proposals = useQuery({
    queryKey: ["package-update-proposals", userId, companyId, authority.epoch, reader],
    queryFn: () => authority.read(() => packageProposalsApi.list(companyId, userId)),
    enabled, retry: false, gcTime: 0,
  });
  const installations = useQuery({
    queryKey: ["agent-package-installations", userId, companyId, authority.epoch, reader],
    queryFn: () => authority.read(() => agentPackagesApi.list(companyId, userId)),
    enabled, retry: false, gcTime: 0,
  });
  useEffect(() => {
    setSelected(null);
    setAgentId("");
    setPins({});
    setInternal(false);
    setPreview(null);
    setReason("");
    setUpdating(null);
    setMaterial(false);
    setUseCaseId("");
    setUpdatePolicy("manual");
  }, [companyId, userId]);
  function input() {
    return packageInstallSchema.parse({
      versionId: selected!.versionId,
      agentId,
      components: selected!.components.flatMap((c) => {
        const pin = options.data?.components.find(
          (p) =>
            p.versionId === pins[c.key] &&
            p.type === c.type &&
            p.contentHash === c.contentHash,
        );
        return pin
          ? [
              {
                key: c.key,
                resourceId: pin.resourceId,
                versionId: pin.versionId,
              },
            ]
          : [];
      }),
      acceptInternalEvaluation: internal,
      updatePolicy,
      aiUseCaseId: useCaseId || null,
    });
  }
  const configuredInput = (() => { try { return selected ? input() : null; } catch { return null; } })();
  const nativeComponentTypes = ["role_pack", "skill", "playbook", "workflow_template", "routine_template"];
  const currentInstallation = !updating || installations.data?.some(row => row.id === updating.id && row.version === updating.version && row.status !== "uninstalled");
  const configurationReady = Boolean(configuredInput && selected && currentInstallation &&
    options.data?.agents.some(agent => agent.id === agentId) &&
    selected.components.filter(component => component.required && nativeComponentTypes.includes(component.type))
      .every(component => configuredInput.components.some(pin => pin.key === component.key)) &&
    (selected.manifest.audience !== "customer" || useCases.data?.some(purpose => purpose.id === useCaseId && purpose.status === "approved")));
  const validReason = packageDecisionSchema.shape.reason.safeParse(reason).success;
  // An unchanged payload is insufficient after an Original source has been
  // re-read. A preview belongs to its exact input and observed source frame.
  let setupFingerprint: string | null = null;
  if (selected && configurationReady) {
    try {
      setupFingerprint = JSON.stringify({ input: input(), packageId: selected.id,
        updating: updating ? { id: updating.id, version: updating.version } : null,
        catalog: catalog.dataUpdatedAt, options: options.dataUpdatedAt,
        installations: updating ? installations.dataUpdatedAt : null,
        purpose: selected.manifest.audience === "customer" ? useCases.dataUpdatedAt : null });
    } catch { /* Incomplete inputs cannot carry a reusable readiness receipt. */ }
  }
  const preview = previewReceipt?.epoch === authority.epoch && previewReceipt.setup === setupFingerprint ? previewReceipt.value : null;
  const mutation = useMutation({
    mutationFn: async (action: "preview" | "install" | "update") => authority.write(async () => {
      if (!(action === "install" && originalInstall.current) && !configurationReady)
        throw new Error("Current package setup is incomplete or changed");
      const captured = { companyId: companyId!, userId: userId! };
      if (action === "install" && !originalInstall.current) {
        const requestId = crypto.randomUUID(), snapshot = packageInstallSchema.parse({ ...input(), installationRequestId: requestId });
        try { retainPendingPackageInstallation(companyId, principal, requestId); }
        catch (error) { setRecovery({ requestId: null, unavailable: true }); throw error; }
        originalInstall.current = { requestId, key: selected!.key, input: structuredClone(snapshot) };
        setRecovery({ requestId, unavailable: false });
      }
      return {
        captured,
        action,
        setup: setupFingerprint,
        result:
          action === "update"
            ? await agentPackagesApi.update(
                captured.companyId,
                captured.userId,
                updating!.id,
                {
                  ...input(),
                  expectedVersion: updating!.version,
                  approveMaterialChange: material,
                  reason,
                },
              )
            : action === "install" ? await agentPackagesApi.install(companyId, userId, originalInstall.current!.key, originalInstall.current!.input)
            : await agentPackagesApi.preview(
                captured.companyId,
                captured.userId,
                selected!.key,
                input(),
              ),
      };
    }),
    onSuccess: (ack) => {
      if (!authority.confirmed(ack)) return;
      const { captured, action, result } = ack;
      if (
        captured.companyId !== scope.current.companyId ||
        captured.userId !== scope.current.userId
      )
        return;
      if (action === "preview") setPreview(result as PackagePreview, ack.setup);
      else {
        // Even a transport acknowledgement is reconciled through the exact
        // Original request reader before its pending locator can be cleared.
        if (action === "install") { setSelected(null); setPreview(null); return; }
        setSelected(null);
        setPreview(null);
        setUpdating(null);
        setMaterial(false);
        installations.refetch();
      }
    },
  });
  const decision = useMutation({
    mutationFn: async ({
      row,
      action,
    }: {
      row: PackageInstallationView;
      action: "activate" | "suspend" | "uninstall";
    }) => authority.write(async () => {
      const captured = { companyId: companyId!, userId: userId! };
      return {
        captured,
        result: await agentPackagesApi.decide(
          captured.companyId,
          captured.userId,
          row.id,
          action,
          { expectedVersion: row.version, reason },
        ),
      };
    }),
    onSuccess: (ack) => {
      if (!authority.confirmed(ack)) return;
      const { captured } = ack;
      if (
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      ) {
        installations.refetch();
        setReason("");
      }
    },
  });
  const proposalReview = useMutation({
    mutationFn: async ({
      id,
      decision,
    }: {
      id: string;
      decision: "accept" | "reject";
    }) => authority.write(async () => {
      const captured = { companyId: companyId!, userId: userId! };
      await packageProposalsApi.review(
        captured.companyId,
        captured.userId,
        id,
        decision,
      );
      return captured;
    }),
    onSuccess: (captured) => {
      if (!authority.confirmed(captured)) return;
      if (
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      ) {
        proposals.refetch();
        installations.refetch();
      }
    },
  });
  const error =
    proposalReview.error ??
    proposals.error ??
    useCases.error ??
    catalog.error ??
    options.error ??
    installations.error ??
    mutation.error ??
    decision.error;
  const readFailed = catalog.isError || options.isError || installations.isError || proposals.isError ||
    selected?.manifest.audience === "customer" && useCases.isError;
  const reading = catalog.isPending || options.isPending || installations.isPending || proposals.isPending ||
    catalog.isFetching || options.isFetching || installations.isFetching || proposals.isFetching ||
    selected?.manifest.audience === "customer" && (useCases.isPending || useCases.isFetching);
  const visible = authority.readReady && !readFailed && !reading;
  if (!visible && surface.current?.contains(document.activeElement)) restoreFocus.current = document.activeElement?.id || true;
  useEffect(() => {
    if (!visible) return;
    if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) {
      focused.current = true; restoreFocus.current = null; return;
    }
    if (!focused.current || restoreFocus.current) {
      const target = typeof restoreFocus.current === "string" ? document.getElementById(restoreFocus.current) : null;
      (target && surface.current?.contains(target) ? target : heading.current)?.focus();
      focused.current = true; restoreFocus.current = null;
    }
  }, [visible]);
  const refreshOriginal = async () => {
    if (!authority.canRead()) { await authority.recheck().catch(() => {}); return; }
    await Promise.allSettled([catalog.refetch(), options.refetch(), installations.refetch(), proposals.refetch(),
      ...(selected?.manifest.audience === "customer" ? [useCases.refetch()] : [])]);
  };
  if (recovery.requestId) return <PackageInstallationReceipt company={companyId} principal={principal} userId={userId}
    requestId={recovery.requestId} allowLocalImplicit={allowLocalImplicit} inFlight={mutation.isPending}
    retryOriginal={originalInstall.current ? () => mutation.mutate("install") : undefined}
    onResolved={() => { clearPendingPackageInstallation(companyId, principal, recovery.requestId!);
      originalInstall.current = null; setRecovery({ requestId: null, unavailable: false }); setSelected(null); setPreview(null);
      mutation.reset(); }} />;
  if (recovery.unavailable) return <p role="alert">{t("packageRecovery.storageUnavailable")}</p>;
  if (!visible) return <section ref={surface} className="saas-page">
    <h1 className="saas-title">{t("packageWorkspaceTitle")}</h1>
    <p role={authority.failed || readFailed ? "alert" : "status"}>{t(authority.failed ? "packageWorkspaceUnavailable" : readFailed ? "packageWorkspaceReadOrWriteUnavailable" : "loading")}</p>
    {(authority.failed || readFailed) && <Button disabled={authority.rechecking || reading} onClick={() => void refreshOriginal()}>{t("packageWorkspaceRefresh")}</Button>}
  </section>;
  return (
    <section ref={surface} className="saas-page">
      <Link to="/agents" className="saas-link">
        {t("packageWorkspace.agents")}
      </Link>
      <h1 ref={heading} tabIndex={-1} className="saas-title">{t("packageWorkspaceTitle")}</h1>
      <p>
        {t("packageWorkspace.intro")}
      </p>
      {error && (
        <div className="space-y-2">
          <p role="alert" className="saas-error">{t("packageWorkspaceReadOrWriteUnavailable")}</p>
          <Button variant="outline" onClick={() => void refreshOriginal()}>{t("packageWorkspaceRefresh")}</Button>
        </div>
      )}
      {(catalog.isPending || options.isPending) && (
        <p role="status">{t("packageWorkspace.loading")}</p>
      )}
      {catalog.data?.length === 0 && (
        <p>
          {t("packageWorkspace.empty")}
        </p>
      )}
      {selection && !selected && <p role="alert">{t("packageWorkspaceVersionUnavailable")}</p>}
      {!selected &&
        catalog.data?.map((p) => (
          <section className="saas-section" key={p.versionId}>
            <h2 className="saas-subtitle">
              {p.name} · {p.version}
            </h2>
            <p>{p.description}</p>
            {p.manifest.audience === "internal_test" && (
              <p>
                {t("packageWorkspace.internalOnly")}
              </p>
            )}
            <Button
              onClick={() => {
                setSelected(p);
                setPins({});
                setPreview(null);
                setInternal(false);
                setUpdating(null);
                setUpdatePolicy("manual");
                setUseCaseId("");
              }}
            >
              {t("packageWorkspace.review")}
            </Button>
          </section>
        ))}
      {selected && (
        <section className="saas-section" aria-label={t("packageWorkspace.configuration")}>
          <h2 className="saas-subtitle">{t("packageWorkspace.configure", { name: selected.name })}</h2>
          <p>{selected.manifest.purpose}</p>
          <p>{t("packageWorkspace.prohibited", { uses: selected.manifest.prohibitedUses.join("; ") })}</p>
          <label>
            {t("packageWorkspace.agent")}
            <select
              id={`${reader}-agent`}
              required
              className="saas-input"
              disabled={Boolean(updating)}
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">{t("packageWorkspace.chooseAgent")}</option>
              {options.data?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {updating && (
            <label>
              {t("packageWorkspace.release")}
              <select
                required
                className="saas-input"
                value={selected.versionId}
                onChange={(e) => {
                  setSelected(
                    catalog.data!.find((p) => p.versionId === e.target.value)!,
                  );
                  setPreview(null);
                  setPins({});
                  setMaterial(false);
                }}
              >
                {catalog.data
                  ?.filter(
                    (p) =>
                      p.id === updating.packageId &&
                      p.versionId !== updating.installedVersionId,
                  )
                  .map((p) => (
                    <option key={p.versionId} value={p.versionId}>
                      {p.version}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {selected.manifest.audience === "customer" && (
            <label>
              {t("packageWorkspace.purpose")}
              <select
                required
                className="saas-input"
                value={useCaseId}
                onChange={(e) => {
                  setUseCaseId(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="">{t("packageWorkspace.choosePurpose")}</option>
                {useCases.data
                  ?.filter((u) => u.status === "approved")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.purpose.intendedPurpose}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            {t("packageWorkspace.updatePolicy")}
            <select
              className="saas-input"
              value={updatePolicy}
              onChange={(e) => {
                setUpdatePolicy(e.target.value as "manual" | "auto_low_risk");
                setPreview(null);
              }}
            >
              <option value="manual">{t("packageWorkspace.manualUpdates")}</option>
              <option value="auto_low_risk">
                {t("packageWorkspace.automaticUpdates")}
              </option>
            </select>
          </label>
          <p className="text-muted-foreground">
            {t("packageWorkspace.updateBoundary")}
          </p>
          {selected.components
            .filter(c => nativeComponentTypes.includes(c.type))
            .map((c) => (
              <label key={c.key}>
                {c.key}
                {t(c.required ? "packageWorkspace.required" : "packageWorkspace.optional")}
                <select
                  required={c.required}
                  className="saas-input"
                  value={pins[c.key] ?? ""}
                  onChange={(e) => {
                    setPins({ ...pins, [c.key]: e.target.value });
                    setPreview(null);
                  }}
                >
                  <option value="">{t("packageWorkspace.chooseVersion")}</option>
                  {options.data?.components
                    .filter(
                      (p) =>
                        p.type === c.type && p.contentHash === c.contentHash,
                    )
                    .map((p) => (
                      <option key={p.versionId} value={p.versionId}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          <p>
            {t("packageWorkspace.connections", { required: selected.manifest.requiredConnections.join(", ") || t("packageWorkspace.none"),
              optional: selected.manifest.optionalConnections.join(", ") || t("packageWorkspace.none") })}
          </p>
          <p>
            <Trans ns="experience" i18nKey="packageWorkspace.accessBoundary"
              components={{ connections: <Link className="saas-link" to="/connections" /> }} />
          </p>
          {selected.manifest.audience === "internal_test" && (
            <label>
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              {t("packageWorkspace.internalConsent")}
            </label>
          )}
          {updating && (
            <label>
              <input
                type="checkbox"
                checked={material}
                onChange={(e) => setMaterial(e.target.checked)}
              />
              {t("packageWorkspace.updateConsent")}
            </label>
          )}
          {preview && (
            <div role="status">
              <p>{t("packageWorkspace.readiness", { status: t(`packageWorkspace.readinessStatus.${preview.readiness.status}`, { defaultValue: t("packageWorkspace.unknown") }) })}</p>
              {[
                ...preview.readiness.reasons,
                ...preview.readiness.warnings,
              ].map((r, i) => (
                <p key={i}>{r}</p>
              ))}
            </div>
          )}
          <div>
            {!configurationReady && <p id={`${reader}-configuration-help`} className="text-sm text-muted-foreground">
              {t(!currentInstallation ? "packageWorkspace.changedInstallation" : "packageWorkspace.completeSetup")}
            </p>}
            <Button variant="outline" disabled={!configurationReady || mutation.isPending}
              aria-describedby={!configurationReady ? `${reader}-configuration-help` : undefined}
              onClick={() => mutation.mutate("preview")}>
              {t("packageWorkspace.checkReadiness")}
            </Button>
          </div>
          <div className="saas-row">
            <Button
              variant="outline"
              onClick={() => {
                setSelected(null);
                setPreview(null);
                setUpdating(null);
              }}
            >
              {t("packageWorkspace.cancel")}
            </Button>
            <div className="flex gap-2">
              <Button
                disabled={
                  !configurationReady ||
                  !preview ||
                  mutation.isPending ||
                  (selected.manifest.audience === "internal_test" &&
                    !internal) ||
                  (Boolean(updating) && (!material || !validReason))
                }
                onClick={() => mutation.mutate(updating ? "update" : "install")}
              >
                {t(updating ? "packageWorkspace.saveUpdate" : "packageWorkspace.install")}
              </Button>
            </div>
          </div>
        </section>
      )}
      <section className="saas-section">
        <h2 className="saas-subtitle">{t("packageWorkspace.installed")}</h2>
        <label>
          {t("packageWorkspace.reason")}
          <input
            className="saas-input"
            maxLength={packageDecisionSchema.shape.reason.maxLength ?? undefined}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {installations.data?.map((row) => (
          <section className="saas-section" key={row.id}>
            <MaintenanceHistoryLink installationId={row.id} />
            <h3>
              {catalog.data?.find((p) => p.id === row.packageId)?.name ??
                t("packageWorkspace.installedPackage")}
            </h3>
            <p>
              {t("packageWorkspace.installationStatus", { status: t(`maintenanceInstallationStatus.${row.status}`, { defaultValue: t("packageWorkspace.unknown") }) })}
            </p>
            {[
              ...(row.readiness?.reasons ?? []),
              ...(row.readiness?.warnings ?? []),
            ].map((r, i) => (
              <p key={i}>{r}</p>
            ))}
            {row.status !== "uninstalled" && (
              <div className="flex flex-wrap gap-2">
                {catalog.data?.some(
                  (p) =>
                    p.id === row.packageId &&
                    p.versionId !== row.installedVersionId,
                ) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUpdating(row);
                      setUpdatePolicy(row.updatePolicy);
                      setSelected(
                        catalog.data!.find(
                          (p) =>
                            p.id === row.packageId &&
                            p.versionId !== row.installedVersionId,
                        )!,
                      );
                      setAgentId(row.agentId);
                      setPins({});
                      setPreview(null);
                      setUseCaseId(row.aiUseCaseId ?? "");
                      setMaterial(false);
                    }}
                  >
                    {t("packageWorkspace.reviewUpdate")}
                  </Button>
                )}
                <Button
                  disabled={
                    !validReason ||
                    decision.isPending ||
                    row.status === "active"
                  }
                  onClick={() => decision.mutate({ row, action: "activate" })}
                >
                  {t("packageWorkspace.activate")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!validReason || decision.isPending}
                  onClick={() => decision.mutate({ row, action: "suspend" })}
                >
                  {t("packageWorkspace.suspend")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!validReason || decision.isPending}
                  onClick={() => decision.mutate({ row, action: "uninstall" })}
                >
                  {t("packageWorkspace.uninstall")}
                </Button>
              </div>
            )}
          </section>
        ))}
      </section>
      <section className="saas-section">
        <h2 className="saas-subtitle">{t("packageWorkspace.proposed")}</h2>
        {proposals.data?.map((p) => (
          <div key={p.id}>
            <p>
              {p.reason} · {t(`packageWorkspace.proposalStatus.${p.status}`, { defaultValue: t("packageWorkspace.unknown") })}
            </p>
            {p.afterManifest && (
              <div>
                <p>{t("packageWorkspace.proposalPurpose", { purpose: p.afterManifest.purpose })}</p>
                <p>
                  {t("packageWorkspace.risk", { before: p.beforeManifest?.maximumRisk ?? t("packageWorkspace.unknown"), after: p.afterManifest.maximumRisk })}{" "}
                  {t(p.material ? "packageWorkspace.materialReview" : "packageWorkspace.unchangedPolicies")}
                </p>
                <p>
                  {t("packageWorkspace.proposalAccess", { required: p.afterManifest.requiredConnections.join(", ") || t("packageWorkspace.none"), uses: p.afterManifest.prohibitedUses.join("; ") })}
                </p>
                <p>{t("packageWorkspace.limits", { limits: p.afterManifest.knownLimitations.join("; ") })}</p>
              </div>
            )}
            {p.status === "pending" && p.proposal && (
              <div>
                <p>
                  {t("packageWorkspace.proposedVersion", { version: catalog.data?.find(v => v.versionId === p.proposal?.versionId)?.version ?? t("packageWorkspace.reviewedRelease") })}
                </p>
                <Button
                  disabled={proposalReview.isPending}
                  onClick={() =>
                    proposalReview.mutate({ id: p.id, decision: "accept" })
                  }
                >
                  {t("packageWorkspace.acceptUpdate")}
                </Button>
                <Button
                  variant="outline"
                  disabled={proposalReview.isPending}
                  onClick={() =>
                    proposalReview.mutate({ id: p.id, decision: "reject" })
                  }
                >
                  {t("packageWorkspace.rejectUpdate")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
