import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { enterpriseIdentityPolicySchema } from "@paperclipai/shared";
import { enterpriseApi } from "@/api/enterprise";
import { secretsApi } from "@/api/secrets";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { ApiError } from "@/api/client";
import { accessApi } from "@/api/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/router";
export function Enterprise() {
  const { selectedCompanyId: companyId } = useCompany(),
    { userId } = useAccountIdentity();
  const scope = useRef({ companyId, userId });
  scope.current = { companyId, userId };
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc"),
    [issuer, setIssuer] = useState(""),
    [domain, setDomain] = useState(""),
    [clientId, setClientId] = useState(""),
    [discovery, setDiscovery] = useState(""),
    [signingKey, setSigningKey] = useState(""),
    [entryPoint, setEntryPoint] = useState(""),
    [certificate, setCertificate] = useState(""),
    [scim, setScim] = useState(false),
    [reason, setReason] = useState("");
  const [subject, setSubject] = useState(""),
    [memberId, setMemberId] = useState(""),
    [manageLifecycle, setManageLifecycle] = useState(false),
    [credential, setCredential] = useState<{
      token: string;
      expiresAt: string;
    } | null>(null);
  const enabled = Boolean(companyId && userId);
  const members = useQuery({
    queryKey: ["enterprise-members", userId, companyId],
    queryFn: () => accessApi.listMembers(companyId!),
    enabled,
  });
  const policy = useQuery({
    queryKey: ["enterprise-identity", userId, companyId],
    queryFn: () => enterpriseApi.identity(companyId!, userId!),
    enabled,
    retry: false,
  });
  const bindings = useQuery({
    queryKey: ["enterprise-subjects", userId, companyId],
    queryFn: () => enterpriseApi.bindings(companyId!, userId!),
    enabled: enabled && Boolean(policy.data),
  });
  const withdrawal = useMutation({
    mutationFn: async (bindingId: string) => {
      const captured = { ...scope.current };
      await enterpriseApi.revokeBinding(
        captured.companyId!,
        captured.userId!,
        bindingId,
      );
      return captured;
    },
    onSuccess: (captured) => {
      if (
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      )
        void bindings.refetch();
    },
  });
  const secrets = useQuery({
    queryKey: ["enterprise-signing-keys", userId, companyId],
    queryFn: () => secretsApi.list(companyId!),
    enabled: enabled && protocol === "oidc",
  });
  useEffect(() => {
    setIssuer("");
    setDomain("");
    setClientId("");
    setDiscovery("");
    setSigningKey("");
    setEntryPoint("");
    setCertificate("");
    setReason("");
    setSubject("");
    setMemberId("");
    setManageLifecycle(false);
    setCredential(null);
    setScim(false);
    mutation.reset();
  }, [companyId, userId]);
  useEffect(() => {
    const c = policy.data?.configuration;
    if (!c) return;
    setProtocol(c.protocol);
    setIssuer(c.issuer);
    setDomain(c.domain);
    if (c.protocol === "oidc") {
      setClientId(c.clientId);
      setDiscovery(c.discoveryEndpoint);
      setSigningKey(c.privateKeySecretId);
    } else {
      setEntryPoint(c.entryPoint);
      setCertificate(c.certificate);
    }
    setScim(policy.data!.scimRequired);
  }, [policy.data]);
  const mutation = useMutation({
    mutationFn: async (
      action: "configure" | "suspend" | "bind" | "rotate" | "decommission",
    ) => {
      const captured = { companyId: companyId!, userId: userId! },
        row = policy.data;
      if (action !== "rotate") setCredential(null);
      const result =
        action === "configure"
          ? await enterpriseApi.configure(
              captured.companyId,
              captured.userId,
              enterpriseIdentityPolicySchema.parse({
                expectedVersion: row?.version ?? 0,
                configuration:
                  protocol === "oidc"
                    ? {
                        protocol,
                        issuer,
                        domain,
                        clientId,
                        discoveryEndpoint: discovery,
                        privateKeySecretId: signingKey,
                        privateKeySecretVersion: secrets.data?.find(
                          (s) => s.id === signingKey,
                        )?.latestVersion,
                      }
                    : { protocol, issuer, domain, entryPoint, certificate },
                scimRequired: scim,
                reason,
                operatingEnvelope: row?.operatingEnvelope ?? {
                  awProcessingRegions: ["dk-cph1", "europe-1"],
                  providers: [],
                  dedicatedPlacement: "none",
                  retentionPolicyDescription:
                    "Uses the existing product retention policies; contractual changes require operating qualification",
                  contractEvidence: null,
                  supportAccess: "native_scoped_owner_approval",
                  limitations: [
                    "Live IdP, security-event delivery, contracted residency/retention and procurement qualification remain required before enterprise GA",
                    "SSO binds existing verified native members; SCIM manages explicitly approved existing non-owner memberships",
                  ],
                },
              }),
            )
          : action === "suspend"
            ? await enterpriseApi.suspend(
                captured.companyId,
                captured.userId,
                row!.version,
              )
            : action === "bind"
              ? await enterpriseApi.bind(captured.companyId, captured.userId, {
                  userId: memberId,
                  subject,
                  manageMembershipLifecycle: manageLifecycle,
                  reason,
                })
              : action === "decommission"
                ? await enterpriseApi.decommissionScim(
                    captured.companyId,
                    captured.userId,
                    row!.version,
                  )
                : await enterpriseApi.rotateScim(
                    captured.companyId,
                    captured.userId,
                    row!.version,
                    row!.scimCredentialId,
                  );
      if (
        action === "rotate" &&
        "token" in result &&
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      )
        setCredential({ token: result.token, expiresAt: result.expiresAt });
      return {
        captured,
        action,
        result:
          "token" in result
            ? { credentialId: result.credentialId, expiresAt: result.expiresAt }
            : result,
      };
    },
    onSuccess: ({ captured }) => {
      if (
        captured.companyId !== scope.current.companyId ||
        captured.userId !== scope.current.userId
      ) {
        return;
      }
      void policy.refetch();
      void bindings.refetch();
    },
  });
  const failure =
    policy.error instanceof ApiError && policy.error.status === 404
      ? null
      : policy.error;
  if (!enabled)
    return <p>Select a company and sign in to manage enterprise identity.</p>;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">
          Enterprise identity and operating envelope
        </h1>
        <p className="text-muted-foreground">
          Save a company identity policy, approve exact member mappings and
          qualify the provider before enabling sign-in.
        </p>
      </div>
      {failure ? (
        <p role="alert">
          {failure instanceof Error
            ? failure.message
            : "Enterprise policy could not be loaded"}
        </p>
      ) : null}
      {policy.data ? (
        <section className="space-y-2" aria-label="Current enterprise policy">
          <p>Status: {policy.data.status.replaceAll("_", " ")}</p>
          <p>
            Recorded AW processing regions:{" "}
            {policy.data.operatingEnvelope.awProcessingRegions.join(", ")}
          </p>
          <p>
            Customer-selected providers have their own processing regions and
            responsibilities.
          </p>
          {policy.data.operatingEnvelope.providers.map((p) => (
            <p key={p.provider}>
              {p.provider}: {p.regions.join(", ") || "Region requires review"} ·{" "}
              {p.responsibility.replaceAll("_", " ")} · DPA:{" "}
              {p.dpaStatus ?? "unknown"} · {p.criticality ?? "material"}{" "}
              criticality · {p.status ?? "unknown"}
            </p>
          ))}
          {policy.data.operatingEnvelope.limitations.map((l) => (
            <p key={l} className="text-muted-foreground">
              {l}
            </p>
          ))}
          {policy.data.qualification ? (
            <p>
              Identity evidence expires{" "}
              {new Date(policy.data.qualification.expiresAt).toLocaleString()}.
            </p>
          ) : (
            <p>Platform qualification is required for activation.</p>
          )}
          {policy.data.status === "qualified" ? (
            <label className="block">
              Company sign-in link
              <Input
                readOnly
                value={`${window.location.origin}/auth?ssoProvider=${encodeURIComponent(policy.data.providerId)}`}
              />
              <span className="text-muted-foreground">
                This link selects the approved company provider, including when
                several companies share an email domain.
              </span>
            </label>
          ) : null}
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("suspend")}
          >
            Suspend enterprise identity
          </Button>
        </section>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setCredential(null);
          mutation.mutate("configure");
        }}
      >
        <label className="block">
          Sign-in protocol
          <select
            className="saas-input"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as "oidc" | "saml")}
          >
            <option value="oidc">OpenID Connect</option>
            <option value="saml">SAML</option>
          </select>
        </label>
        <label className="block">
          Identity provider issuer
          <Input
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            required
            type="url"
          />
        </label>
        <label className="block">
          Company domain
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </label>
        {protocol === "oidc" ? (
          <>
            <label className="block">
              Client ID
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              />
            </label>
            <label className="block">
              Provider discovery URL
              <Input
                value={discovery}
                onChange={(e) => setDiscovery(e.target.value)}
                required
                type="url"
              />
            </label>
            <label className="block">
              Existing encrypted signing key
              <select
                className="saas-input"
                value={signingKey}
                onChange={(e) => setSigningKey(e.target.value)}
                required
              >
                <option value="">Choose a company signing secret</option>
                {secrets.data
                  ?.filter(
                    (s) => s.scope === "company" && s.status === "active",
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            {secrets.isError ? (
              <p role="alert">Signing key choices could not be loaded.</p>
            ) : null}
          </>
        ) : (
          <>
            <label className="block">
              Provider sign-in URL
              <Input
                value={entryPoint}
                onChange={(e) => setEntryPoint(e.target.value)}
                required
                type="url"
              />
            </label>
            <label className="block">
              IdP public signing certificate
              <textarea
                className="saas-input"
                value={certificate}
                onChange={(e) => setCertificate(e.target.value)}
                required
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={scim}
            onChange={(e) => setScim(e.target.checked)}
          />
          This company requires SCIM lifecycle management
        </label>
        <label className="block">
          Reason for this policy or mapping
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </label>
        <div className="flex items-center justify-between">
          <Link to="/company/settings">Back to settings</Link>
          <Button
            type="submit"
            disabled={mutation.isPending || Boolean(failure)}
          >
            Save policy draft
          </Button>
        </div>
      </form>
      {policy.data ? (
        <section className="space-y-4" aria-label="Member identity mappings">
          <h2 className="font-medium">Approve an existing member identity</h2>
          <p className="text-muted-foreground">
            Map the signed stable subject to an existing verified company
            member. Provider groups grant no access. Company owner lifecycle
            requires native ownership management.
          </p>
          {bindings.data?.map((binding) => (
            <div key={binding.id} className="flex items-center justify-between">
              <p>
                {members.data?.members.find(
                  (m) => m.principalId === binding.userId,
                )?.user?.name ?? binding.userId}{" "}
                · {binding.issuer} · {binding.subject} · {binding.status}
              </p>
              {binding.status === "active" ? (
                <Button
                  variant="outline"
                  disabled={withdrawal.isPending}
                  onClick={() => withdrawal.mutate(binding.id)}
                >
                  Withdraw mapping
                </Button>
              ) : null}
            </div>
          ))}
          {bindings.error || members.error || withdrawal.error ? (
            <p role="alert">
              {String(bindings.error ?? members.error ?? withdrawal.error)}
            </p>
          ) : null}
          <label className="block">
            Existing company member
            <select
              className="saas-input"
              value={memberId}
              onChange={(e) => {
                setMemberId(e.target.value);
                setManageLifecycle(false);
              }}
            >
              <option value="">Select a member</option>
              {members.data?.members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.id} value={m.principalId}>
                    {m.user?.name ?? m.user?.email ?? m.principalId} ·{" "}
                    {m.membershipRole}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            Signed IdP subject
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={
                !policy.data.scimRequired ||
                members.data?.members.find((m) => m.principalId === memberId)
                  ?.membershipRole === "owner"
              }
              checked={manageLifecycle}
              onChange={(e) => setManageLifecycle(e.target.checked)}
            />
            Allow SCIM to manage this membership lifecycle
          </label>
          <Button
            disabled={
              !memberId ||
              !subject ||
              reason.trim().length < 10 ||
              mutation.isPending
            }
            onClick={() => mutation.mutate("bind")}
          >
            Approve exact mapping
          </Button>
          {policy.data.scimRequired ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                Removing provisioning suspends its managed non-owner
                memberships, withdraws lifecycle mappings and requires fresh
                identity qualification. Other companies and global accounts are
                retained.
              </p>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("decommission")}
              >
                Decommission SCIM
              </Button>
            </div>
          ) : null}
          {policy.data.status === "qualified" && policy.data.scimRequired ? (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => {
                setCredential(null);
                mutation.mutate("rotate");
              }}
            >
              Rotate SCIM credential
            </Button>
          ) : null}
        </section>
      ) : null}
      {credential ? (
        <section className="space-y-2" aria-label="New SCIM credential">
          <p>
            Copy this credential into the approved IdP provisioning connection.
            It expires {new Date(credential.expiresAt).toLocaleString()}.
          </p>
          <Input
            readOnly
            type="password"
            value={credential.token}
            aria-label="New SCIM credential"
          />
          <Button
            variant="outline"
            onClick={() => {
              setCredential(null);
              mutation.reset();
            }}
          >
            Dismiss credential
          </Button>
        </section>
      ) : null}
      {mutation.isError ? (
        <p role="alert">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "The enterprise action failed"}
        </p>
      ) : null}
    </div>
  );
}
