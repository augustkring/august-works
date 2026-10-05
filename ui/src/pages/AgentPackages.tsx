import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  packageInstallSchema,
  type PackageCatalogView,
  type PackagePreview,
  type PackageInstallationView,
} from "@paperclipai/shared";
import { aiGovernanceApi } from "@/api/ai-governance";
import { agentPackagesApi, packageProposalsApi } from "@/api/agent-packages";
import { useCompany } from "@/context/CompanyContext";
import { useAccountIdentity } from "@/api/companies-query";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
export function AgentPackages() {
  const { selectedCompanyId: companyId } = useCompany(),
    { userId } = useAccountIdentity();
  const scope = useRef({ companyId, userId });
  scope.current = { companyId, userId };
  const [updating, setUpdating] = useState<PackageInstallationView | null>(
      null,
    ),
    [material, setMaterial] = useState(false),
    [useCaseId, setUseCaseId] = useState("");
  const [selected, setSelected] = useState<PackageCatalogView | null>(null),
    [agentId, setAgentId] = useState(""),
    [pins, setPins] = useState<Record<string, string>>({}),
    [internal, setInternal] = useState(false),
    [preview, setPreview] = useState<PackagePreview | null>(null),
    [reason, setReason] = useState("");
  const enabled = Boolean(companyId && userId);
  const catalog = useQuery({
    queryKey: ["agent-packages", userId],
    queryFn: () => agentPackagesApi.catalog(userId!),
    enabled,
  });
  const options = useQuery({
    queryKey: ["agent-package-options", userId, companyId],
    queryFn: () => agentPackagesApi.options(companyId!, userId!),
    enabled,
  });
  const useCases = useQuery({
    queryKey: ["package-use-cases", userId, companyId],
    queryFn: () => aiGovernanceApi.list(companyId!, userId!),
    enabled: enabled && selected?.manifest.audience === "customer",
  });
  const proposals = useQuery({
    queryKey: ["package-update-proposals", userId, companyId],
    queryFn: () => packageProposalsApi.list(companyId!, userId!),
    enabled,
  });
  const installations = useQuery({
    queryKey: ["agent-package-installations", userId, companyId],
    queryFn: () => agentPackagesApi.list(companyId!, userId!),
    enabled,
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
      aiUseCaseId: useCaseId || null,
    });
  }
  const mutation = useMutation({
    mutationFn: async (action: "preview" | "install" | "update") => {
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
    },
    onSuccess: ({ captured, action, result }) => {
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
    }) => {
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
    },
    onSuccess: ({ captured }) => {
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
    }) => {
      const captured = { companyId: companyId!, userId: userId! };
      await packageProposalsApi.review(
        captured.companyId,
        captured.userId,
        id,
        decision,
      );
      return captured;
    },
    onSuccess: (captured) => {
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
  return (
    <main className="saas-page">
      <Link to="/agents" className="saas-link">
        Agents
      </Link>
      <h1 className="saas-title">Specialist packages</h1>
      <p>
        Maintained specialists use your existing company knowledge and access.
        Installing configures a role; activation requires current readiness and
        runtime checks. Model and runtime usage are billed separately.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {(catalog.isPending || options.isPending) && (
        <p role="status">Loading available specialists…</p>
      )}
      {catalog.data?.length === 0 && (
        <p>
          No qualified specialist releases are available in this deployment yet.
        </p>
      )}
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
                variant="outline"
                disabled={!agentId || mutation.isPending}
                onClick={() => mutation.mutate("preview")}
              >
                Check readiness
              </Button>
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
    </main>
  );
}
