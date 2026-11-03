import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { enterpriseIdentityPolicySchema, enterpriseOperatingEnvelopeSchema, type EnterpriseOperatingEnvelope } from "@paperclipai/shared";
import { enterpriseApi } from "@/api/enterprise";
import { secretsApi } from "@/api/secrets";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { ApiError } from "@/api/client";
import { accessApi } from "@/api/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/lib/router";
import { useTranslation } from "@/i18n";
const supportedAwProcessingRegions = ["dk-cph1", "europe-1"] as const;
function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}
export function Enterprise() {
  const { t } = useTranslation("experience");
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
    [reason, setReason] = useState(""),
    [processingRegions, setProcessingRegions] = useState<string[]>([]),
    [providersJson, setProvidersJson] = useState(""),
    [dedicatedPlacement, setDedicatedPlacement] = useState<"" | "none" | "dedicated_gateway" | "dedicated_vm">(""),
    [retentionPolicyDescription, setRetentionPolicyDescription] = useState(""),
    [contractUri, setContractUri] = useState(""),
    [contractSha256, setContractSha256] = useState(""),
    [limitations, setLimitations] = useState(""),
    [operatingFactsReviewed, setOperatingFactsReviewed] = useState(false),
    [operatingValidation, setOperatingValidation] = useState("");
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
    setProcessingRegions([]);
    setProvidersJson("");
    setDedicatedPlacement("");
    setRetentionPolicyDescription("");
    setContractUri("");
    setContractSha256("");
    setLimitations("");
    setOperatingFactsReviewed(false);
    setOperatingValidation("");
    setSubject("");
    setMemberId("");
    setManageLifecycle(false);
    setCredential(null);
    setScim(false);
    mutation.reset();
  }, [companyId, userId]);
  useEffect(() => {
    const data = policy.data;
    if (!data) return;
    const c = data.configuration;
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
    setScim(data.scimRequired);
    const envelope = data.operatingEnvelope;
    setProcessingRegions(envelope.awProcessingRegions);
    setProvidersJson(JSON.stringify(envelope.providers, null, 2));
    setDedicatedPlacement(envelope.dedicatedPlacement);
    setRetentionPolicyDescription(envelope.retentionPolicyDescription);
    setContractUri(envelope.contractEvidence?.uri ?? "");
    setContractSha256(envelope.contractEvidence?.sha256 ?? "");
    setLimitations(envelope.limitations.join("\n"));
    setOperatingFactsReviewed(false);
    setOperatingValidation("");
  }, [policy.data]);
  function readOperatingEnvelope(): { success: true; data: EnterpriseOperatingEnvelope } | { success: false; message: string } {
    if (!operatingFactsReviewed) return { success: false, message: t("enterprise.operating.reviewRequired") };
    if (!processingRegions.length) return { success: false, message: t("enterprise.operating.regionRequired") };
    if (!providersJson.trim()) return { success: false, message: t("enterprise.operating.providersRequired") };
    let providers: unknown;
    try { providers = JSON.parse(providersJson); }
    catch { return { success: false, message: t("enterprise.operating.providersJsonInvalid") }; }
    const providerKeys = ["provider", "purpose", "responsibility", "regions", "dataCategories", "retentionDescription", "dpaStatus", "criticality", "status", "assuranceEvidence", "exitDescription"];
    if (!Array.isArray(providers) || providers.some((provider) => !provider || typeof provider !== "object" || Array.isArray(provider) || providerKeys.some((key) => !Object.hasOwn(provider, key))))
      return { success: false, message: t("enterprise.operating.providersFieldsRequired") };
    if (!dedicatedPlacement) return { success: false, message: t("enterprise.operating.placementRequired") };
    const evidence = contractUri.trim() || contractSha256.trim()
      ? { uri: contractUri.trim(), sha256: contractSha256.trim() }
      : null;
    const parsed = enterpriseOperatingEnvelopeSchema.safeParse({
      awProcessingRegions: processingRegions,
      providers,
      dedicatedPlacement,
      retentionPolicyDescription,
      contractEvidence: evidence,
      supportAccess: "native_scoped_owner_approval",
      limitations: lines(limitations),
    });
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, message: t("enterprise.operating.factsInvalid") };
  }
  const mutation = useMutation({
    mutationFn: async (
      action: "suspend" | "bind" | "rotate" | "decommission" | { kind: "configure"; operatingEnvelope: EnterpriseOperatingEnvelope },
    ) => {
      const captured = { companyId: companyId!, userId: userId! },
        row = policy.data;
      const kind = typeof action === "string" ? action : action.kind;
      const operatingEnvelope = typeof action === "string" ? null : action.operatingEnvelope;
      if (action !== "rotate") setCredential(null);
      const result =
        kind === "configure"
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
                operatingEnvelope: operatingEnvelope!,
              }),
            )
          : kind === "suspend"
            ? await enterpriseApi.suspend(
                captured.companyId,
                captured.userId,
                row!.version,
              )
            : kind === "bind"
              ? await enterpriseApi.bind(captured.companyId, captured.userId, {
                  userId: memberId,
                  subject,
                  manageMembershipLifecycle: manageLifecycle,
                  reason,
                })
              : kind === "decommission"
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
        kind === "rotate" &&
        "token" in result &&
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      )
        setCredential({ token: result.token, expiresAt: result.expiresAt });
      return {
        captured,
        action: kind,
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
    return <p>{t("enterprise.selectCompanyAndSignIn")}</p>;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">
          {t("enterprise.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("enterprise.intro")}
        </p>
      </div>
      {failure ? (
        <p role="alert">
          {failure instanceof Error
            ? failure.message
            : t("enterprise.policyLoadFailed")}
        </p>
      ) : null}
      {policy.data ? (
        <section className="space-y-2" aria-label={t("enterprise.currentPolicy")}>
          <p>{t("enterprise.status")}: {t(`enterprise.statuses.${policy.data.status}`, { defaultValue: policy.data.status.replaceAll("_", " ") })}</p>
          <p>
            {t("enterprise.recordedRegions")}:{" "}
            {policy.data.operatingEnvelope.awProcessingRegions.join(", ")}
          </p>
          <p>
            {t("enterprise.providerResponsibilityNote")}
          </p>
          <p>{t("enterprise.operating.placement")}: {t(`enterprise.operating.placementValues.${policy.data.operatingEnvelope.dedicatedPlacement}`)}</p>
          <p>{t("enterprise.operating.retention")}: {policy.data.operatingEnvelope.retentionPolicyDescription}</p>
          <p>{t("enterprise.operating.contractEvidence")}: {policy.data.operatingEnvelope.contractEvidence
            ? `${policy.data.operatingEnvelope.contractEvidence.uri} · ${policy.data.operatingEnvelope.contractEvidence.sha256}`
            : t("enterprise.operating.noContractEvidence")}</p>
          <p>{t("enterprise.operating.supportAccess")}</p>
          {policy.data.operatingEnvelope.providers.map((p) => (
            <p key={p.provider}>
              {p.provider}: {p.regions.join(", ") || t("enterprise.regionRequiresReview")} ·{" "}
              {t(`enterprise.responsibilities.${p.responsibility}`, { defaultValue: p.responsibility.replaceAll("_", " ") })} · {t("enterprise.dpaStatus")}: {t(`enterprise.dpaStatuses.${p.dpaStatus ?? "unknown"}`)} · {t(`enterprise.criticalities.${p.criticality ?? "material"}`)} · {t(`enterprise.providerStatuses.${p.status ?? "unknown"}`)}
            </p>
          ))}
          {policy.data.operatingEnvelope.limitations.map((l) => (
            <p key={l} className="text-muted-foreground">
              {l}
            </p>
          ))}
          {policy.data.qualification ? (
            <p>
              {t("enterprise.identityEvidenceExpires")}{" "}
              {new Date(policy.data.qualification.expiresAt).toLocaleString()}.
            </p>
          ) : (
            <p>{t("enterprise.platformQualificationRequired")}</p>
          )}
          {policy.data.status === "qualified" ? (
            <label className="block">
              {t("enterprise.companySignInLink")}
              <Input
                readOnly
                value={`${window.location.origin}/auth?ssoProvider=${encodeURIComponent(policy.data.providerId)}`}
              />
              <span className="text-muted-foreground">
                {t("enterprise.signInLinkHelp")}
              </span>
            </label>
          ) : null}
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("suspend")}
          >
            {t("enterprise.suspendIdentity")}
          </Button>
        </section>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setCredential(null);
          const envelope = readOperatingEnvelope();
          if (!envelope.success) {
            setOperatingValidation(envelope.message);
            return;
          }
          setOperatingValidation("");
          mutation.mutate({ kind: "configure", operatingEnvelope: envelope.data });
        }}
      >
        <label className="block">
          {t("enterprise.fields.signInProtocol")}
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
          {t("enterprise.fields.issuer")}
          <Input
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            required
            type="url"
          />
        </label>
        <label className="block">
          {t("enterprise.fields.companyDomain")}
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </label>
        {protocol === "oidc" ? (
          <>
            <label className="block">
              {t("enterprise.fields.clientId")}
              <Input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
              />
            </label>
            <label className="block">
              {t("enterprise.fields.discoveryUrl")}
              <Input
                value={discovery}
                onChange={(e) => setDiscovery(e.target.value)}
                required
                type="url"
              />
            </label>
            <label className="block">
              {t("enterprise.fields.signingKey")}
              <select
                className="saas-input"
                value={signingKey}
                onChange={(e) => setSigningKey(e.target.value)}
                required
              >
                <option value="">{t("enterprise.chooseSigningSecret")}</option>
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
              <p role="alert">{t("enterprise.signingKeyLoadFailed")}</p>
            ) : null}
          </>
        ) : (
          <>
            <label className="block">
              {t("enterprise.fields.entryPoint")}
              <Input
                value={entryPoint}
                onChange={(e) => setEntryPoint(e.target.value)}
                required
                type="url"
              />
            </label>
            <label className="block">
              {t("enterprise.fields.certificate")}
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
          {t("enterprise.fields.scimRequired")}
        </label>
        <fieldset className="space-y-3 rounded-md border p-4">
          <legend className="font-medium">{t("enterprise.operating.heading")}</legend>
          <p className="text-muted-foreground">{t("enterprise.operating.disclosure")}</p>
          <fieldset className="space-y-2">
            <legend>{t("enterprise.operating.regions")}</legend>
            <p className="text-muted-foreground">{t("enterprise.operating.regionsHelp")}</p>
            {supportedAwProcessingRegions.map((region) => (
              <label key={region} className="flex items-center gap-2">
                <input type="checkbox" aria-label={t("enterprise.operating.selectRegion", { region })} checked={processingRegions.includes(region)} onChange={() => {
                  setProcessingRegions((current) => current.includes(region) ? current.filter((value) => value !== region) : [...current, region]);
                  setOperatingValidation("");
                }} />
                {region}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-2">
            <span>{t("enterprise.operating.providers")}</span>
            <Textarea value={providersJson} onChange={(event) => { setProvidersJson(event.target.value); setOperatingValidation(""); }} />
            <span className="text-muted-foreground">{t("enterprise.operating.providersHelp")}</span>
          </label>
          <label className="block space-y-2">
            <span>{t("enterprise.operating.placement")}</span>
            <select className="saas-input" value={dedicatedPlacement} onChange={(event) => { setDedicatedPlacement(event.target.value as typeof dedicatedPlacement); setOperatingValidation(""); }}>
              <option value="">{t("enterprise.operating.choosePlacement")}</option>
              <option value="none">{t("enterprise.operating.placementNone")}</option>
              <option value="dedicated_gateway">{t("enterprise.operating.placementGateway")}</option>
              <option value="dedicated_vm">{t("enterprise.operating.placementVm")}</option>
            </select>
          </label>
          <label className="block space-y-2">
            <span>{t("enterprise.operating.retention")}</span>
            <Textarea value={retentionPolicyDescription} onChange={(event) => { setRetentionPolicyDescription(event.target.value); setOperatingValidation(""); }} />
          </label>
          <fieldset className="space-y-2">
            <legend>{t("enterprise.operating.contractEvidence")}</legend>
            <p className="text-muted-foreground">{t("enterprise.operating.contractEvidenceHelp")}</p>
            <Input aria-label={t("enterprise.operating.contractUri")} value={contractUri} onChange={(event) => { setContractUri(event.target.value); setOperatingValidation(""); }} />
            <Input aria-label={t("enterprise.operating.contractSha256")} value={contractSha256} onChange={(event) => { setContractSha256(event.target.value); setOperatingValidation(""); }} />
          </fieldset>
          <label className="block space-y-2">
            <span>{t("enterprise.operating.limitations")}</span>
            <Textarea value={limitations} onChange={(event) => { setLimitations(event.target.value); setOperatingValidation(""); }} />
            <span className="text-muted-foreground">{t("enterprise.operating.limitationsHelp")}</span>
          </label>
          <p>{t("enterprise.operating.supportAccess")}</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={operatingFactsReviewed} onChange={(event) => { setOperatingFactsReviewed(event.target.checked); setOperatingValidation(""); }} />
            {t("enterprise.operating.confirmCurrent")}
          </label>
          {operatingValidation ? <p role="alert">{operatingValidation}</p> : null}
        </fieldset>
        <label className="block">
          {t("enterprise.fields.reason")}
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </label>
        <div className="flex items-center justify-between">
          <Link to="/company/settings">{t("enterprise.backToSettings")}</Link>
          <Button
            type="submit"
            disabled={mutation.isPending || Boolean(failure) || policy.isPending}
          >
            {t("enterprise.savePolicyDraft")}
          </Button>
        </div>
      </form>
      {policy.data ? (
        <section className="space-y-4" aria-label={t("enterprise.memberMappings")}>
          <h2 className="font-medium">{t("enterprise.approveMemberIdentity")}</h2>
          <p className="text-muted-foreground">
            {t("enterprise.memberMappingHelp")}
          </p>
          {bindings.data?.map((binding) => (
            <div key={binding.id} className="flex items-center justify-between">
              <p>
                {members.data?.members.find(
                  (m) => m.principalId === binding.userId,
                )?.user?.name ?? binding.userId}{" "}
                · {binding.issuer} · {binding.subject} · {t(`enterprise.bindingStatuses.${binding.status}`, { defaultValue: binding.status })}
              </p>
              {binding.status === "active" ? (
                <Button
                  variant="outline"
                  disabled={withdrawal.isPending}
                  onClick={() => withdrawal.mutate(binding.id)}
                >
                  {t("enterprise.withdrawMapping")}
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
            {t("enterprise.fields.existingMember")}
            <select
              className="saas-input"
              value={memberId}
              onChange={(e) => {
                setMemberId(e.target.value);
                setManageLifecycle(false);
              }}
            >
              <option value="">{t("enterprise.selectMember")}</option>
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
            {t("enterprise.fields.signedSubject")}
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
            {t("enterprise.allowScimLifecycle")}
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
            {t("enterprise.approveMapping")}
          </Button>
          {policy.data.scimRequired ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {t("enterprise.scimRemovalDisclosure")}
              </p>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate("decommission")}
              >
                {t("enterprise.decommissionScim")}
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
              {t("enterprise.rotateScim")}
            </Button>
          ) : null}
        </section>
      ) : null}
      {credential ? (
        <section className="space-y-2" aria-label={t("enterprise.newScimCredential")}>
          <p>
            {t("enterprise.copyScimCredential")} {new Date(credential.expiresAt).toLocaleString()}.
          </p>
          <Input
            readOnly
            type="password"
            value={credential.token}
            aria-label={t("enterprise.newScimCredential")}
          />
          <Button
            variant="outline"
            onClick={() => {
              setCredential(null);
              mutation.reset();
            }}
          >
            {t("enterprise.dismissCredential")}
          </Button>
        </section>
      ) : null}
      {mutation.isError ? (
        <p role="alert">
          {mutation.error instanceof Error
            ? mutation.error.message
            : t("enterprise.actionFailed")}
        </p>
      ) : null}
    </div>
  );
}
