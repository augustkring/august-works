import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { saasApi } from "@/api/saas";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import {
  runtimeCapacityQualificationSchema,
  saasCostReportSchema,
  runtimeVersionCandidateSchema,
  runtimeVersionTransitionSchema,
} from "@paperclipai/shared";

export function SaasOperationsPage() {
  const identity = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: authApi.getSession,
    retry: false,
  });
  const userId = identity.data?.user.id;
  const scope = useRef(userId);
  scope.current = userId;
  const [sessionId, setSessionId] = useState(""),
    [hostId, setHostId] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [hostAction, setHostAction] = useState<"drain" | "fence" | "retire">(
    "drain",
  );
  const [report, setReport] = useState(""),
    [reportKind, setReportKind] = useState<"version" | "capacity" | "cost">(
      "version",
    );
  const [versionDigest, setVersionDigest] = useState(""),
    [versionAction, setVersionAction] = useState("halted"),
    [versionReason, setVersionReason] = useState("");
  const [canaryProfile, setCanaryProfile] = useState(""),
    [canaryImage, setCanaryImage] = useState(""),
    [canaryKey, setCanaryKey] = useState(() => crypto.randomUUID());
  const operations = useQuery({
    queryKey: ["saas-operations", userId],
    queryFn: () => saasApi.operations(userId!),
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: 15000,
  });
  const grant = operations.data?.support.find(
    (value) => value.id === sessionId,
  );
  const inventory = useQuery({
    queryKey: ["saas-provider-inventory", userId],
    queryFn: () => saasApi.providerInventory(userId!),
    enabled: Boolean(userId && operations.data),
    retry: false,
    refetchInterval: 60000,
  });
  const costs = useQuery({
    queryKey: ["saas-costs", userId],
    queryFn: () => saasApi.costs(userId!),
    enabled: Boolean(userId && operations.data),
    retry: false,
    refetchInterval: 60000,
  });
  const euros = (value: string) => {
    const amount = BigInt(value),
      absolute = amount < 0n ? -amount : amount;
    return (
      (amount < 0n ? "−" : "") +
      (absolute / 100n).toString() +
      "." +
      (absolute % 100n).toString().padStart(2, "0") +
      " EUR"
    );
  };
  const status = useQuery({
    queryKey: ["saas-support-status", userId, sessionId],
    queryFn: () => saasApi.supportStatus(sessionId, userId!),
    enabled: Boolean(userId && grant?.scopes.includes("status:read")),
    retry: false,
    refetchInterval: 15000,
  });
  const fleet = useMutation({
    mutationFn: async () => {
      const actor = userId!;
      await saasApi.fleetAction(actor, hostId, hostAction);
      return actor;
    },
    onSuccess: (actor) => {
      if (scope.current === actor) {
        setConfirmation("");
        void operations.refetch();
      }
    },
  });
  const stop = useMutation({
    mutationFn: async (cellId: string) => {
      const actor = userId!;
      await saasApi.supportRuntimeAction(sessionId, actor, cellId, {
        action: "stop",
        idempotencyKey: crypto.randomUUID(),
      });
      return actor;
    },
    onSuccess: (actor) => {
      if (scope.current === actor) void status.refetch();
    },
  });
  const qualification = useMutation({
    mutationFn: async () => {
      const actor = userId!,
        value = JSON.parse(report);
      if (reportKind === "version")
        await saasApi.registerRuntimeVersion(
          actor,
          runtimeVersionCandidateSchema.parse(value),
        );
      else if (reportKind === "cost")
        await saasApi.recordCosts(actor, saasCostReportSchema.parse(value));
      else
        await saasApi.qualifyRuntimeCapacity(
          actor,
          runtimeCapacityQualificationSchema.parse(value),
        );
      return actor;
    },
    onSuccess: (actor) => {
      if (scope.current === actor) {
        void operations.refetch();
        void costs.refetch();
      }
    },
  });
  const transition = useMutation({
    mutationFn: async () => {
      const actor = userId!,
        version = operations.data?.versions.find(
          (item) => item.imageDigest === versionDigest,
        );
      if (!version) throw Error("Choose a registered version.");
      await saasApi.transitionRuntimeVersion(
        actor,
        runtimeVersionTransitionSchema.parse({
          imageDigest: version.imageDigest,
          expectedStatus: version.status,
          status: versionAction,
          reason: versionReason,
        }),
      );
      return actor;
    },
    onSuccess: (actor) => {
      if (scope.current === actor) void operations.refetch();
    },
  });
  const canary = useMutation({
    mutationFn: async () => {
      const actor = userId!;
      return {
        actor,
        result: await saasApi.canaryRuntime(sessionId, actor, {
          capacityProfile: canaryProfile,
          imageDigest: canaryImage,
          isolationMode: "company_cell",
          idempotencyKey: canaryKey,
        }),
      };
    },
    onSuccess: ({ actor }) => {
      if (scope.current === actor) {
        setCanaryKey(crypto.randomUUID());
        void operations.refetch();
        void status.refetch();
      }
    },
  });
  useEffect(() => {
    setSessionId("");
    setHostId("");
    setConfirmation("");
    setReport("");
    setVersionDigest("");
    setVersionReason("");
    setCanaryProfile("");
    setCanaryImage("");
    setCanaryKey(crypto.randomUUID());
    fleet.reset();
    stop.reset();
    qualification.reset();
    transition.reset();
    canary.reset();
  }, [userId]);
  function changeApproval(value: string) {
    setSessionId(value);
    setCanaryProfile("");
    setCanaryImage("");
    setCanaryKey(crypto.randomUUID());
    canary.reset();
    stop.reset();
  }
  function changeCanary(field: "profile" | "image", value: string) {
    if (field === "profile") setCanaryProfile(value);
    else setCanaryImage(value);
    setCanaryKey(crypto.randomUUID());
    canary.reset();
  }
  const error =
    operations.error ??
    fleet.error ??
    status.error ??
    stop.error ??
    qualification.error ??
    transition.error ??
    canary.error;
  if (identity.isPending) return <p role="status">Loading account…</p>;
  if (!userId)
    return (
      <main className="saas-page">
        <h1 className="saas-title">Operations</h1>
        <p>Sign in with your operator account to continue.</p>
      </main>
    );
  return (
    <main className="saas-page">
      <h1 className="saas-title">Operations</h1>
      <p className="saas-muted">
        Fleet metadata and service queues. Company actions require an active
        approval from that company’s owner.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {operations.isPending && <p role="status">Loading operator status…</p>}
      {operations.data && (
        <>
          <p>Environment: {operations.data.environment}</p>
          <section
            className="saas-section"
            aria-label="Operational cost estimate"
          >
            <h2 className="saas-subtitle">Costs and recurring revenue</h2>
            {costs.error && (
              <p role="alert" className="saas-error">
                {costs.error.message}
              </p>
            )}
            {!costs.data && (
              <p className="saas-muted">
                A current provider cost and revenue report is required.
                Financial amounts are unknown.
              </p>
            )}
            {costs.data && (
              <>
                <p>
                  {costs.data.month} · Reported{" "}
                  {new Date(costs.data.observedAt).toLocaleString()}
                </p>
                <p className="saas-muted">
                  Operator-reported amounts. Runtime allocation uses current CPU
                  reservations; this estimate supports operations.
                </p>
                <p>
                  Estimated monthly COGS:{" "}
                  {euros(costs.data.estimatedMonthlyCogsMinor)}
                </p>
                <p>
                  Reported MRR: {euros(costs.data.reportedMrrMinor)} · ARR:{" "}
                  {euros(costs.data.reportedArrMinor)}
                </p>
                <p>
                  Estimated monthly gross margin:{" "}
                  {euros(costs.data.estimatedGrossMarginMinor)}
                </p>
                <p>
                  Unallocated host capacity cost:{" "}
                  {euros(costs.data.unallocatedHostCostMinor)}
                </p>
                {costs.data.hosts.map((host) => (
                  <p key={host.hostId}>
                    <span className="saas-machine">{host.hostId}</span> ·{" "}
                    {euros(host.monthlyMinor)} · CPU reserved{" "}
                    {host.reservedCpuMillis}/{host.totalCpuMillis}
                  </p>
                ))}
                {costs.data.accounts.map((account) => (
                  <p key={account.accountId}>
                    <span className="saas-machine">{account.accountId}</span> ·
                    Estimated runtime{" "}
                    {euros(account.estimatedRuntimeMonthlyMinor)} · Reported MRR{" "}
                    {euros(account.reportedMrrMinor)}
                  </p>
                ))}
              </>
            )}
          </section>
          <section
            className="saas-section"
            aria-label="Provider ownership inventory"
          >
            <h2 className="saas-subtitle">Provider ownership inventory</h2>
            {inventory.error && (
              <p role="alert" className="saas-error">
                {inventory.error.message}
              </p>
            )}
            {!inventory.data && (
              <p className="saas-muted">
                No provider inventory has been qualified yet.
              </p>
            )}
            {inventory.data && (
              <>
                <p>
                  Observed{" "}
                  {new Date(inventory.data.report.observedAt).toLocaleString()}{" "}
                  · {inventory.data.report.resourceCount} resources
                </p>
                <p>
                  Untracked: {inventory.data.report.untrackedCount} · Ownership
                  mismatches: {inventory.data.report.mismatchCount}
                </p>
                {(inventory.data.report.untrackedCount > 0 ||
                  inventory.data.report.mismatchCount > 0) && (
                  <p role="alert" className="saas-error">
                    Reconcile these resources with the provider. Inventory never
                    authorizes automatic deletion.
                  </p>
                )}
                {[
                  ...inventory.data.report.untracked,
                  ...inventory.data.report.mismatched,
                ].map((id) => (
                  <p className="saas-machine" key={id}>
                    {id}
                  </p>
                ))}
              </>
            )}
          </section>
          <section className="saas-section">
            <h2 className="saas-subtitle">Background services</h2>
            {operations.data.jobs.map((job) => (
              <div className="saas-row" key={job.jobKey}>
                <span>{job.jobKey}</span>
                <span>
                  {job.lastErrorCode ??
                    (job.lastSuccessAt
                      ? "Last success: " +
                        new Date(job.lastSuccessAt).toLocaleString()
                      : "No completed occurrence")}
                </span>
              </div>
            ))}
            {operations.data.queues.map((queue) => (
              <div className="saas-row" key={queue.domain + queue.status}>
                <span>
                  {queue.domain} · {queue.status}
                </span>
                <span>{queue.count}</span>
              </div>
            ))}
          </section>
          <section className="saas-section">
            <h2 className="saas-subtitle">Runtime hosts</h2>
            {operations.data.hosts.length === 0 && (
              <p>No runtime hosts have been provisioned.</p>
            )}
            {operations.data.hosts.map((host) => (
              <div className="saas-row" key={host.id}>
                <span className="saas-machine">{host.id}</span>
                <span>
                  {host.status} · {host.region} · CPU {host.cpuReservedMillis}/
                  {host.cpuTotalMillis}
                </span>
              </div>
            ))}
            {operations.data.hosts.length > 0 && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  fleet.mutate();
                }}
              >
                <label className="saas-label">
                  Host
                  <select
                    className="saas-input"
                    value={hostId}
                    onChange={(event) => {
                      setHostId(event.target.value);
                      setConfirmation("");
                    }}
                    required
                  >
                    <option value="">Choose a host</option>
                    {operations.data.hosts.map((host) => (
                      <option value={host.id} key={host.id}>
                        {host.id} · {host.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="saas-label">
                  Action
                  <select
                    className="saas-input"
                    value={hostAction}
                    onChange={(event) => {
                      setHostAction(event.target.value as typeof hostAction);
                      setConfirmation("");
                    }}
                  >
                    <option value="drain">Drain — prevent new placement</option>
                    <option value="fence">
                      Fence — stop and revoke this host
                    </option>
                    <option value="retire">
                      Retire — erase eligible host storage
                    </option>
                  </select>
                </label>
                <p className="saas-muted">
                  Fencing stops every runtime on this host. Retirement requires
                  confirmed fencing and eligible cells. The server verifies
                  these conditions.
                </p>
                <label className="saas-label">
                  Enter the host ID to confirm
                  <input
                    className="saas-input"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="saas-footer">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setHostId("");
                      setConfirmation("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      fleet.isPending || !hostId || confirmation !== hostId
                    }
                  >
                    Request {hostAction}
                  </Button>
                </div>
              </form>
            )}
            {fleet.isSuccess && (
              <p role="status">
                The host request was accepted. Check the host status for the
                final result.
              </p>
            )}
          </section>
          <section className="saas-section">
            <h2 className="saas-subtitle">Approved company support</h2>
            {operations.data.support.length === 0 ? (
              <p>You have no active company approvals.</p>
            ) : (
              <label className="saas-label">
                Approval
                <select
                  className="saas-input"
                  value={sessionId}
                  disabled={canary.isPending || stop.isPending}
                  onChange={(event) => changeApproval(event.target.value)}
                >
                  <option value="">Choose an approval</option>
                  {operations.data.support.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.companyId} · expires{" "}
                      {new Date(value.expiresAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {grant && <p>Approved scope: {grant.scopes.join(", ")}</p>}
            {grant?.scopes.includes("runtime:manage") && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  canary.mutate();
                }}
              >
                <h3 className="saas-subtitle">
                  Provision a canary in this approved organization
                </h3>
                <p className="saas-muted">
                  The company’s paid quota still applies. Its owner configures
                  model credentials, qualifies the agent and runs the
                  backup/restore trial.
                </p>
                <label className="saas-label">
                  Qualified capacity
                  <select
                    className="saas-input"
                    required
                    disabled={canary.isPending}
                    value={canaryProfile}
                    onChange={(event) =>
                      changeCanary("profile", event.target.value)
                    }
                  >
                    <option value="">Choose capacity</option>
                    {operations.data.profiles
                      .filter(
                        (profile) =>
                          profile.qualified &&
                          ["runtime_standard", "runtime_performance"].includes(
                            profile.commercialProductKey,
                          ),
                      )
                      .map((profile) => (
                        <option value={profile.key} key={profile.key}>
                          {profile.key} · {profile.commercialProductKey}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="saas-label">
                  Canary image
                  <select
                    className="saas-input"
                    required
                    disabled={canary.isPending}
                    value={canaryImage}
                    onChange={(event) =>
                      changeCanary("image", event.target.value)
                    }
                  >
                    <option value="">Choose a canary</option>
                    {operations.data.versions
                      .filter((version) => version.status === "canary")
                      .map((version) => (
                        <option
                          value={version.imageDigest}
                          key={version.imageDigest}
                        >
                          {version.providerVersion}
                        </option>
                      ))}
                  </select>
                </label>
                {canary.isError && (
                  <p className="saas-muted">
                    Retry unchanged fields to recover the same request. Changing
                    the approval, capacity or image starts a new request; check
                    runtime status first.
                  </p>
                )}
                <div className="saas-footer">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={canary.isPending}
                    onClick={() => {
                      changeCanary("profile", "");
                      setCanaryImage("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      canary.isPending || !canaryProfile || !canaryImage
                    }
                    type="submit"
                  >
                    Request canary runtime
                  </Button>
                </div>
                {canary.isSuccess && (
                  <p role="status">
                    Canary request accepted. The owner can continue from the
                    organization’s runtime settings.
                  </p>
                )}
              </form>
            )}
            {status.data?.runtimes.map((cell) => (
              <div className="saas-row" key={cell.id}>
                <span>
                  {cell.id} · {cell.status}
                  {cell.lastErrorCode ? " · " + cell.lastErrorCode : ""}
                </span>
                {grant?.scopes.includes("runtime:manage") &&
                  ["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status) && (
                    <Button
                      variant="outline"
                      disabled={stop.isPending}
                      onClick={() => stop.mutate(cell.id)}
                    >
                      Stop runtime
                    </Button>
                  )}
              </div>
            ))}
            {stop.isSuccess && (
              <p role="status">
                The stop request was accepted. Check runtime status for
                completion.
              </p>
            )}
          </section>
          <section className="saas-section">
            <h2 className="saas-subtitle">Runtime versions</h2>
            {operations.data.versions.length === 0 && (
              <p>No runtime versions have been registered or qualified.</p>
            )}
            {operations.data.versions.map((version) => (
              <div key={version.imageDigest} className="saas-row">
                <span className="saas-machine">{version.imageDigest}</span>
                <span>
                  {version.status} · {version.providerVersion} ·{" "}
                  {version.stateFormat}
                </span>
              </div>
            ))}
          </section>
          <section className="saas-section">
            <h2 className="saas-subtitle">Register qualification evidence</h2>
            <p className="saas-muted">
              Use the report from a completed benchmark or conformance
              rehearsal. Reports need a protected evidence URI, SHA-256 and the
              current controller source commit. Registration alone does not
              approve an image.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                qualification.mutate();
              }}
            >
              <label className="saas-label">
                Report type
                <select
                  className="saas-input"
                  value={reportKind}
                  onChange={(event) =>
                    setReportKind(event.target.value as typeof reportKind)
                  }
                >
                  <option value="version">Runtime version conformance</option>
                  <option value="capacity">Host capacity benchmark</option>
                  <option value="cost">
                    Provider costs and recurring revenue
                  </option>
                </select>
              </label>
              <label className="saas-label">
                Evidence report JSON
                <textarea
                  className="saas-input"
                  value={report}
                  onChange={(event) => setReport(event.target.value)}
                  maxLength={20000}
                  required
                />
              </label>
              <div className="saas-footer">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setReport("")}
                >
                  Clear
                </Button>
                <Button
                  type="submit"
                  disabled={qualification.isPending || !report.trim()}
                >
                  Register report
                </Button>
              </div>
            </form>
            {qualification.isSuccess && (
              <p role="status">
                Report recorded. Review its status before changing admission.
              </p>
            )}
          </section>
          {operations.data.versions.length > 0 && (
            <section className="saas-section">
              <h2 className="saas-subtitle">Change version admission</h2>
              <p className="saas-muted">
                Approval requires at least one hour of canary observation and
                persisted task, conformance, verified backup and restore
                results. Halt stops new admission. Retirement also requires
                every runtime to move away from this image.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  transition.mutate();
                }}
              >
                <label className="saas-label">
                  Version
                  <select
                    className="saas-input"
                    required
                    value={versionDigest}
                    onChange={(event) => setVersionDigest(event.target.value)}
                  >
                    <option value="">Choose a version</option>
                    {operations.data.versions.map((version) => (
                      <option
                        key={version.imageDigest}
                        value={version.imageDigest}
                      >
                        {version.providerVersion} · {version.status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="saas-label">
                  Admission
                  <select
                    className="saas-input"
                    value={versionAction}
                    onChange={(event) => setVersionAction(event.target.value)}
                  >
                    <option value="halted">Halt</option>
                    <option value="canary">Begin canary observation</option>
                    <option value="approved">Approve</option>
                    <option value="retired">Retire</option>
                  </select>
                </label>
                <label className="saas-label">
                  Reason
                  <input
                    className="saas-input"
                    required
                    minLength={10}
                    maxLength={500}
                    value={versionReason}
                    onChange={(event) => setVersionReason(event.target.value)}
                  />
                </label>
                <div className="saas-footer">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setVersionDigest("")}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      transition.isPending ||
                      !versionDigest ||
                      versionReason.trim().length < 10
                    }
                  >
                    Request admission change
                  </Button>
                </div>
              </form>
              {transition.isSuccess && (
                <p role="status">Version admission changed.</p>
              )}
            </section>
          )}
          <section className="saas-section">
            <h2 className="saas-subtitle">Deployment history</h2>
            {operations.data.deployments.length === 0 && (
              <p>No deployment evidence has been recorded.</p>
            )}
            {operations.data.deployments.map((deployment, index) => (
              <div className="saas-row" key={deployment.sourceSha + index}>
                <span className="saas-machine">{deployment.sourceSha}</span>
                <span>
                  {deployment.schemaVersion} · {deployment.verificationResult} ·{" "}
                  {new Date(deployment.deployedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
