import { SaasRuntimeRecovery } from "@/components/SaasRuntimeRecovery";
import { SaasRuntimeBackupSchedule } from "@/components/SaasRuntimeBackupSchedule";
import { SaasModelProviderForm } from "@/components/SaasModelProviderForm";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { api } from "@/api/client";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
export function SaasRuntimesPage() {
  const { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity(),
    capabilities = useSaasCapabilities();
  const [profile, setProfile] = useState(""),
    [image, setImage] = useState(""),
    [isolation, setIsolation] = useState("company_cell"),
    [agentId, setAgentId] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const actorScope = identity.userId + ":" + selectedCompanyId;
  const scope = useRef(actorScope); scope.current = actorScope;
  const actionKeys = useRef(new Map<string, string>());
  const enabled = Boolean(
    selectedCompanyId && identity.userId && capabilities.data?.runtime,
  );
  const cells = useQuery({
    queryKey: ["saas-runtimes", identity.userId, selectedCompanyId],
    queryFn: () => saasApi.runtimes(selectedCompanyId!, identity.userId!),
    enabled,
    refetchInterval: 5000,
  });
  const options = useQuery({
    queryKey: ["saas-runtime-options", identity.userId, selectedCompanyId],
    queryFn: () => saasApi.runtimeOptions(selectedCompanyId!, identity.userId!),
    enabled,
  });
  const agents = useQuery({
    queryKey: ["saas-runtime-agents", identity.userId, selectedCompanyId],
    queryFn: () =>
      api.get<{ id: string; name: string }[]>(
        `/companies/${selectedCompanyId}/agents?expectedUserId=${encodeURIComponent(identity.userId!)}`,
      ),
    enabled,
  });
  const create = useMutation({
    mutationFn: async () => {
      const actor = actorScope;
      await saasApi.createRuntime(selectedCompanyId!, identity.userId!, {
        capacityProfile: profile, imageDigest: image, isolationMode: isolation,
        ...(isolation === "dedicated_agent_gateway" ? { dedicatedAgentId: agentId } : {}),
        idempotencyKey: requestKey,
      });
      return actor;
    },
    onSuccess: actor => { if (scope.current === actor) { setRequestKey(crypto.randomUUID()); void cells.refetch(); } },
  });
  const action = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      const actor = actorScope, key = id + ":" + action;
      let request = actionKeys.current.get(key);
      if (!request) { request = crypto.randomUUID(); actionKeys.current.set(key, request); }
      await saasApi.runtimeOperation(selectedCompanyId!, identity.userId!, id, { action, idempotencyKey: request });
      return { actor, key };
    },
    onSuccess: ({ actor, key }) => { if (scope.current === actor) { actionKeys.current.delete(key); void cells.refetch(); } },
  });
  const bind = useMutation({
    mutationFn: async (id: string) => { const actor = actorScope; await saasApi.bindRuntime(selectedCompanyId!, identity.userId!, id, agentId); return actor; },
    onSuccess: actor => { if (scope.current === actor) void cells.refetch(); },
  });
  useEffect(() => {
    setRequestKey(crypto.randomUUID()); setProfile(""); setImage(""); setAgentId(""); setIsolation("company_cell");
    actionKeys.current.clear(); create.reset(); action.reset(); bind.reset();
  }, [identity.userId, selectedCompanyId]);
  const error =
    cells.error ??
    options.error ??
    agents.error ??
    create.error ??
    action.error ??
    bind.error;
  if (capabilities.isPending) return <p role="status">Loading runtimes…</p>;
  if (!capabilities.data?.runtime)
    return <p>Managed runtimes are not available yet.</p>;
  if (!selectedCompanyId)
    return <p>Select an organization to manage its runtimes.</p>;
  return (
    <main className="saas-page">
      <h1 className="saas-title">Managed runtimes</h1>
      <p className="saas-muted">
        Each runtime has its own Gateway and state. Model usage is billed by
        your API provider.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      <section className="saas-section">
        <h2 className="saas-subtitle">Create a runtime</h2>
        <label className="saas-label">
          Capacity
          <select
            className="saas-input"
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
          >
            <option value="">Choose capacity</option>
            {options.data?.profiles
              .filter(
                (value) =>
                  !value.commercialProductKey ||
                  (isolation === "company_cell"
                    ? ["runtime_standard", "runtime_performance"]
                    : isolation === "dedicated_vm"
                      ? ["runtime_dedicated_vm"]
                      : ["runtime_dedicated_gateway"]
                  ).includes(value.commercialProductKey),
              )
              .map((value) => (
                <option key={value.key} value={value.key}>
                  {value.key}
                </option>
              ))}
          </select>
        </label>
        <label className="saas-label">
          Version
          <select
            className="saas-input"
            value={image}
            onChange={(event) => setImage(event.target.value)}
          >
            <option value="">Choose a version</option>
            {options.data?.versions.map((value) => (
              <option key={value.imageDigest} value={value.imageDigest}>
                {value.providerVersion}
              </option>
            ))}
          </select>
        </label>
        <label className="saas-label">
          Isolation
          <select
            className="saas-input"
            value={isolation}
            onChange={(event) => {
              setIsolation(event.target.value);
              setProfile("");
            }}
          >
            <option value="company_cell">Organization Gateway</option>
            {options.data?.dedicatedGateway && (
              <option value="dedicated_agent_gateway">
                Dedicated agent Gateway
              </option>
            )}
            {options.data?.dedicatedVm && (
              <option value="dedicated_vm">Dedicated virtual machine</option>
            )}
          </select>
        </label>
        <label className="saas-label">
          Agent
          <select
            className="saas-input"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            <option value="">Choose an agent</option>
            {agents.data?.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <div className="saas-footer">
          <Link className="saas-link" to="/company/settings/billing">
            Review billing and usage
          </Link>
          <Button
            disabled={
              create.isPending ||
              !profile ||
              !image ||
              (isolation === "dedicated_agent_gateway" && !agentId)
            }
            onClick={() => create.mutate()}
          >
            Create runtime
          </Button>
        </div>
        {options.data &&
          (!options.data.profiles.length || !options.data.versions.length) && (
            <p role="status">
              No qualified capacity and approved version are available. Contact
              support.
            </p>
          )}
      </section>
      <section className="saas-section">
        <h2 className="saas-subtitle">Your runtimes</h2>
        {cells.isPending && <p role="status">Loading runtimes…</p>}
        {cells.data?.length === 0 && <p>No managed runtimes yet.</p>}
        {cells.data
          ?.filter((cell) => !cell.deletedAt)
          .map((cell) => (
            <div key={cell.id} className="saas-section">
              <p>
                {cell.capacityProfile} ·{" "}
                {cell.isolationMode.replaceAll("_", " ")} ·{" "}
                {cell.status.toLowerCase().replaceAll("_", " ")}
              </p>
              {cell.suspendedReason && (
                <p role="status">
                  This runtime is paused for a billing review. Restore plan
                  capacity, then start it when you are ready.
                </p>
              )}
              {cell.lastErrorCode && (
                <p role="status">
                  This runtime needs attention. Contact support if the problem
                  continues.
                </p>
              )}
              <div className="saas-row">
                {cell.status === "STOPPED" && (
                  <Button
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: cell.id, action: "start" })
                    }
                  >
                    Start
                  </Button>
                )}
                {["HEALTHY", "DEGRADED", "FAILED"].includes(cell.status) && (
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: cell.id, action: "stop" })
                    }
                  >
                    Stop
                  </Button>
                )}
                {cell.status === "STOPPED" && (
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({ id: cell.id, action: "backup" })
                    }
                  >
                    Create backup
                  </Button>
                )}
                {cell.status === "HEALTHY" && (
                  <Button
                    variant="outline"
                    disabled={bind.isPending || !agentId}
                    onClick={() => bind.mutate(cell.id)}
                  >
                    Attach selected agent
                  </Button>
                )}
              </div>
              {cell.modelConfigured && (
                <p className="saas-muted">
                  Model provider: {cell.modelProvider} · {cell.modelId}
                </p>
              )}
              {cell.status === "STOPPED" && (
                <SaasModelProviderForm
                  key={identity.userId + ":" + cell.id}
                  companyId={selectedCompanyId!}
                  cellId={cell.id}
                  onConfigured={() => {
                    void cells.refetch();
                  }}
                />
              )}
              <SaasRuntimeRecovery
                key={identity.userId + ":" + cell.id + ":" + cell.generation}
                companyId={selectedCompanyId!}
                userId={identity.userId!}
                cell={cell}
                options={options.data}
                onChanged={() => {
                  void cells.refetch();
                }}
              />
              <SaasRuntimeBackupSchedule key={identity.userId+":"+cell.id+":"+cell.generation+":schedule"} companyId={selectedCompanyId!} userId={identity.userId!} cellId={cell.id}/>
              {cell.status === "HEALTHY" && (
                <p className="saas-muted">
                  After attaching, qualify the provider in the agent settings
                  before running work.
                </p>
              )}
            </div>
          ))}
      </section>
    </main>
  );
}
