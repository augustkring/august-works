import { MaintenanceHistoryLink } from "../components/MaintenanceHistoryLink";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  packageInstallSchema,
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
    [previewReceipt, setPreviewReceipt] = useState<{ value: PackagePreview; epoch: number } | null>(null),
    [reason, setReason] = useState("");
  const preview = previewReceipt?.epoch === authority.epoch ? previewReceipt.value : null;
  const setPreview = (value: PackagePreview | null) => setPreviewReceipt(value ? { value, epoch: authority.epoch } : null);
  const enabled = authority.readReady;
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
  const mutation = useMutation({
    mutationFn: async (action: "preview" | "install" | "update") => authority.write(async () => {
      const captured = { companyId: companyId!, userId: userId! };
      return {
        captured,
        action,
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
            : await agentPackagesApi[action](
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
      if (action === "preview") setPreview(result as PackagePreview);
      else {
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
  if (!visible) return <section ref={surface} className="saas-page">
    <h1 className="saas-title">{t("packageWorkspaceTitle")}</h1>
    <p role={authority.failed || readFailed ? "alert" : "status"}>{t(authority.failed ? "packageWorkspaceUnavailable" : readFailed ? "packageWorkspaceReadOrWriteUnavailable" : "loading")}</p>
    {(authority.failed || readFailed) && <Button disabled={authority.rechecking || reading} onClick={() => void refreshOriginal()}>{t("packageWorkspaceRefresh")}</Button>}
  </section>;
  return (
    <section ref={surface} className="saas-page">
      <Link to="/agents" className="saas-link">
        Agents
      </Link>
      <h1 ref={heading} tabIndex={-1} className="saas-title">{t("packageWorkspaceTitle")}</h1>
      <p>
        Maintained specialists use your existing company knowledge and access.
        Installing configures a role; activation requires current readiness and
        runtime checks. Model and runtime usage are billed separately.
      </p>
      {error && (
        <div className="space-y-2">
          <p role="alert" className="saas-error">{t("packageWorkspaceReadOrWriteUnavailable")}</p>
          <Button variant="outline" onClick={() => void refreshOriginal()}>{t("packageWorkspaceRefresh")}</Button>
        </div>
      )}
      {(catalog.isPending || options.isPending) && (
        <p role="status">Loading available specialists…</p>
      )}
      {catalog.data?.length === 0 && (
        <p>
          No qualified specialist releases are available in this deployment yet.
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
                Internal evaluation only. Customer outcome qualification is
                pending.
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
              Review package
            </Button>
          </section>
        ))}
      {selected && (
        <section className="saas-section" aria-label="Package configuration">
          <h2 className="saas-subtitle">Configure {selected.name}</h2>
          <p>{selected.manifest.purpose}</p>
          <p>Prohibited uses: {selected.manifest.prohibitedUses.join("; ")}</p>
          <label>
            Agent
            <select
              id={`${reader}-agent`}
              className="saas-input"
              disabled={Boolean(updating)}
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Choose an existing company agent</option>
              {options.data?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {updating && (
            <label>
              Release
              <select
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
              Reviewed purpose
              <select
                className="saas-input"
                value={useCaseId}
                onChange={(e) => {
                  setUseCaseId(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="">Choose an approved intended purpose</option>
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
            Update policy
            <select
              className="saas-input"
              value={updatePolicy}
              onChange={(e) => {
                setUpdatePolicy(e.target.value as "manual" | "auto_low_risk");
                setPreview(null);
              }}
            >
              <option value="manual">Review every update</option>
              <option value="auto_low_risk">
                Configure unchanged-content updates automatically
              </option>
            </select>
          </label>
          <p className="text-muted-foreground">
            Automatic updates preserve capabilities and access. New activation
            is required; changes to purpose, knowledge, components or
            permissions always need review.
          </p>
          {selected.components
            .filter((c) =>
              [
                "role_pack",
                "skill",
                "playbook",
                "workflow_template",
                "routine_template",
              ].includes(c.type),
            )
            .map((c) => (
              <label key={c.key}>
                {c.key}
                {c.required ? " (required)" : " (optional)"}
                <select
                  className="saas-input"
                  value={pins[c.key] ?? ""}
                  onChange={(e) => {
                    setPins({ ...pins, [c.key]: e.target.value });
                    setPreview(null);
                  }}
                >
                  <option value="">Choose a matching approved version</option>
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
            Required connections:{" "}
            {selected.manifest.requiredConnections.join(", ") || "None"}.
            Optional connections:{" "}
            {selected.manifest.optionalConnections.join(", ") || "None"}.
          </p>
          <p>
            Installation creates no connection or permission grants. The
            selected Role Pack is pinned to this agent. Grant any needed access
            in{" "}
            <Link className="saas-link" to="/connections">
              Connections
            </Link>
            .
          </p>
          {selected.manifest.audience === "internal_test" && (
            <label>
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              I understand this package is for internal evaluation and can only
              read.
            </label>
          )}
          {updating && (
            <label>
              <input
                type="checkbox"
                checked={material}
                onChange={(e) => setMaterial(e.target.checked)}
              />
              I have reviewed the purpose, policies and component changes and
              authorize this update. Activation will be checked separately.
            </label>
          )}
          {preview && (
            <div role="status">
              <p>Readiness: {preview.readiness.status.replaceAll("_", " ")}</p>
              {[
                ...preview.readiness.reasons,
                ...preview.readiness.warnings,
              ].map((r, i) => (
                <p key={i}>{r}</p>
              ))}
            </div>
          )}
          <div>
            <Button variant="outline" disabled={!agentId || mutation.isPending} onClick={() => mutation.mutate("preview")}>
              Check readiness
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
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                disabled={
                  !agentId ||
                  !preview ||
                  mutation.isPending ||
                  (selected.manifest.audience === "internal_test" &&
                    !internal) ||
                  (Boolean(updating) && (!material || !reason.trim()))
                }
                onClick={() => mutation.mutate(updating ? "update" : "install")}
              >
                {updating
                  ? "Save reviewed update"
                  : "Install for configuration"}
              </Button>
            </div>
          </div>
        </section>
      )}
      <section className="saas-section">
        <h2 className="saas-subtitle">Installed packages</h2>
        <label>
          Decision reason
          <input
            className="saas-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {installations.data?.map((row) => (
          <section className="saas-section" key={row.id}>
            <MaintenanceHistoryLink installationId={row.id} />
            <h3>
              {catalog.data?.find((p) => p.id === row.packageId)?.name ??
                "Installed package"}
            </h3>
            <p>
              Status: {row.status.replaceAll("_", " ")}. Updates require review.
            </p>
            {[
              ...(row.readiness?.reasons ?? []),
              ...(row.readiness?.warnings ?? []),
            ].map((r, i) => (
              <p key={i}>{r}</p>
            ))}
            {row.status !== "uninstalled" && (
              <div className="flex gap-2">
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
                    Review update
                  </Button>
                )}
                <Button
                  disabled={
                    !reason.trim() ||
                    decision.isPending ||
                    row.status === "active"
                  }
                  onClick={() => decision.mutate({ row, action: "activate" })}
                >
                  Check and activate
                </Button>
                <Button
                  variant="outline"
                  disabled={!reason.trim() || decision.isPending}
                  onClick={() => decision.mutate({ row, action: "suspend" })}
                >
                  Suspend
                </Button>
                <Button
                  variant="outline"
                  disabled={!reason.trim() || decision.isPending}
                  onClick={() => decision.mutate({ row, action: "uninstall" })}
                >
                  Uninstall package
                </Button>
              </div>
            )}
          </section>
        ))}
      </section>
      <section className="saas-section">
        <h2 className="saas-subtitle">Proposed updates</h2>
        {proposals.data?.map((p) => (
          <div key={p.id}>
            <p>
              {p.reason} · {p.status}
            </p>
            {p.afterManifest && (
              <div>
                <p>Purpose: {p.afterManifest.purpose}</p>
                <p>
                  Risk envelope: {p.beforeManifest?.maximumRisk} →{" "}
                  {p.afterManifest.maximumRisk}.{" "}
                  {p.material
                    ? "Material configuration review required."
                    : "Execution policies are unchanged."}
                </p>
                <p>
                  Required access:{" "}
                  {p.afterManifest.requiredConnections.join(", ") || "None"}.
                  Prohibited uses: {p.afterManifest.prohibitedUses.join("; ")}
                </p>
                <p>Limits: {p.afterManifest.knownLimitations.join("; ")}</p>
              </div>
            )}
            {p.status === "pending" && p.proposal && (
              <div>
                <p>
                  Proposed version:{" "}
                  {catalog.data?.find(
                    (v) => v.versionId === p.proposal?.versionId,
                  )?.version ?? "Reviewed release"}
                  . Approval saves configuration; activation stays separate.
                </p>
                <Button
                  disabled={proposalReview.isPending}
                  onClick={() =>
                    proposalReview.mutate({ id: p.id, decision: "accept" })
                  }
                >
                  Accept evaluated update
                </Button>
                <Button
                  variant="outline"
                  disabled={proposalReview.isPending}
                  onClick={() =>
                    proposalReview.mutate({ id: p.id, decision: "reject" })
                  }
                >
                  Reject update
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
