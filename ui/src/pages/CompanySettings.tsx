import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  type InteractionResolverGovernance,
  type IssueThreadInteractionKind,
  type CompanyResponsibilityContacts,
} from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useOptionalToastActions } from "../context/ToastContext";
import { useCloudInstance } from "../hooks/useCloudInstance";
import { resolveCompanyArchiveDeparture } from "../lib/company-selection";
import { cloudPortfolioManageUrl } from "../lib/cloudLinks";
import { navigateTopLevel } from "@/lib/browserNavigation";
import { companiesApi } from "../api/companies";
import { useV9CurrentAccount, hasCurrentV9Session } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import {
  InteractionGovernancePanel,
  applyGovernanceChange,
  type GovernanceField,
  type GovernanceSelectValue,
} from "../components/InteractionGovernancePanel";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
} from "../components/agent-config-primitives";
import { InstanceGeneralSettings } from "./InstanceGeneralSettings";
import { JevSkillSuggestionSettings } from "../components/JevSkillSuggestionSettings";

type ResponsibilityContactsEnvelope = {
  value: CompanyResponsibilityContacts;
  companyId: string;
  principalId: string;
  sessionId: string;
  authorityEpoch: number;
  scopeEpoch: number;
};

type ResponsibilityContactsDraft = {
  scopeKey: string;
  securityContactUserId: string;
  supportIncidentContactUserId: string;
};

export function CompanySettings() {
  const { t } = useTranslation("experience");
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const account = useV9CurrentAccount();
  const principalId = account.localImplicit ? "local-board" : account.userId ?? "";
  const authority = useV9PrivateReadAuthority(principalId, true);
  const navigate = useNavigate();
  const toastActions = useOptionalToastActions();
  const cloud = useCloudInstance();
  // Managed instances derive the task ID prefix from the company name, so a
  // rename here also renumbers the existing task IDs.
  const isCloudManaged = Boolean(cloud);
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [locale, setLocale] = useState<"en" | "da">("en");
  const [timezone, setTimezone] = useState("UTC");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [governance, setGovernance] = useState<InteractionResolverGovernance>({});
  const [contactsDraft, setContactsDraft] = useState<ResponsibilityContactsDraft | null>(null);
  const sessionId = account.sessionId;
  const contactsReadReady = Boolean(selectedCompanyId && account.settled && principalId && sessionId &&
    authority.readReady && authority.canRead() && hasCurrentV9Session(queryClient, principalId, sessionId, true));
  const contactsScopeRef = useRef({ companyId: selectedCompanyId, principalId, sessionId,
    localImplicit: account.localImplicit, authorityEpoch: authority.epoch, epoch: 0 });
  if (contactsScopeRef.current.companyId !== selectedCompanyId || contactsScopeRef.current.principalId !== principalId ||
    contactsScopeRef.current.sessionId !== sessionId || contactsScopeRef.current.localImplicit !== account.localImplicit ||
    contactsScopeRef.current.authorityEpoch !== authority.epoch) {
    contactsScopeRef.current = { companyId: selectedCompanyId, principalId, sessionId,
      localImplicit: account.localImplicit, authorityEpoch: authority.epoch, epoch: contactsScopeRef.current.epoch + 1 };
  }
  const captureContactsScope = () => {
    const captured = contactsScopeRef.current;
    return { ...captured, isCurrent: () => contactsScopeRef.current.epoch === captured.epoch && authority.canRead() &&
      hasCurrentV9Session(queryClient, captured.principalId, captured.sessionId ?? "", true) };
  };
  const contactsScopeEpoch = contactsScopeRef.current.epoch;
  const contactsScopeKey = JSON.stringify([selectedCompanyId ?? "", principalId, sessionId ?? "", authority.epoch, contactsScopeEpoch]);
  const contactsQueryKey = ["company-responsibility-contacts", selectedCompanyId ?? "", principalId,
    sessionId ?? "", authority.epoch, contactsScopeEpoch] as const;
  const responsibilityContactsQuery = useQuery<ResponsibilityContactsEnvelope>({
    queryKey: contactsQueryKey,
    queryFn: async ({ signal }) => {
      if (!selectedCompanyId || !principalId || !sessionId || !account.settled || !authority.canRead() ||
        !hasCurrentV9Session(queryClient, principalId, sessionId, true))
        throw new Error("Current Human settings access is unavailable");
      const receipt = captureContactsScope();
      if (!receipt.companyId || !receipt.sessionId || !receipt.isCurrent())
        throw new Error("Current Human settings access changed");
      const value = await authority.read(() => companiesApi.responsibilityContacts(receipt.companyId!, receipt.principalId,
        receipt.localImplicit ? null : receipt.sessionId, { signal }));
      signal.throwIfAborted();
      if (!receipt.isCurrent()) throw new Error("Current Human settings access changed");
      return { value, companyId: receipt.companyId, principalId: receipt.principalId, sessionId: receipt.sessionId,
        authorityEpoch: receipt.authorityEpoch, scopeEpoch: receipt.epoch };
    },
    enabled: Boolean(selectedCompanyId && account.settled && principalId && sessionId && authority.readReady &&
      hasCurrentV9Session(queryClient, principalId, sessionId, true)),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const contactsEnvelope = responsibilityContactsQuery.data;
  const contactsSourceReady = contactsReadReady && responsibilityContactsQuery.isSuccess &&
    responsibilityContactsQuery.fetchStatus === "idle" && !queryClient.getQueryState(contactsQueryKey)?.isInvalidated;
  const responsibilityContacts = contactsSourceReady && contactsEnvelope &&
    contactsEnvelope.companyId === selectedCompanyId && contactsEnvelope.principalId === principalId &&
    contactsEnvelope.sessionId === sessionId && contactsEnvelope.authorityEpoch === authority.epoch &&
    contactsEnvelope.scopeEpoch === contactsScopeRef.current.epoch
    ? contactsEnvelope.value : undefined;
  const contactsLoaded = Boolean(responsibilityContacts);
  const contactsError = contactsReadReady ? responsibilityContactsQuery.error : null;
  const contactsBaseline = responsibilityContacts;
  const scopedDraft = contactsSourceReady && contactsDraft?.scopeKey === contactsScopeKey ? contactsDraft : null;
  const securityContactUserId = scopedDraft?.securityContactUserId ?? contactsBaseline?.securityContactUserId ?? "";
  const supportIncidentContactUserId = scopedDraft?.supportIncidentContactUserId ?? contactsBaseline?.supportIncidentContactUserId ?? "";
  const updateContactsField = (field: "securityContactUserId" | "supportIncidentContactUserId", value: string) => {
    setContactsDraft({
      scopeKey: contactsScopeKey,
      securityContactUserId: field === "securityContactUserId" ? value : securityContactUserId,
      supportIncidentContactUserId: field === "supportIncidentContactUserId" ? value : supportIncidentContactUserId,
    });
  };
  useEffect(() => { setContactsDraft(null); }, [contactsScopeKey]);
  useEffect(() => { if (!contactsSourceReady) setContactsDraft(null); }, [contactsScopeKey, contactsSourceReady]);
  useEffect(() => {
    if (!responsibilityContacts) return;
    setContactsDraft(previous => previous?.scopeKey === contactsScopeKey ? previous : {
      scopeKey: contactsScopeKey,
      securityContactUserId: responsibilityContacts.securityContactUserId ?? "",
      supportIncidentContactUserId: responsibilityContacts.supportIncidentContactUserId ?? "",
    });
  }, [contactsScopeKey, responsibilityContacts]);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setLocale(selectedCompany.locale ?? "en");
    setTimezone(selectedCompany.timezone ?? "UTC");
    setLogoUrl(selectedCompany.logoUrl ?? "");
    setGovernance(selectedCompany.interactionResolverGovernance ?? {});
  }, [selectedCompany]);
  const contactsMutation = useMutation({
    mutationFn: async (input: { companyId: string; principalId: string; sessionId: string; authorityEpoch: number;
      scopeEpoch: number; localImplicit: boolean; securityContactUserId: string; supportIncidentContactUserId: string }) => {
      const receipt = captureContactsScope();
      if (!receipt.isCurrent() || receipt.epoch !== input.scopeEpoch || receipt.companyId !== input.companyId ||
        receipt.principalId !== input.principalId || receipt.sessionId !== input.sessionId ||
        receipt.localImplicit !== input.localImplicit || receipt.authorityEpoch !== input.authorityEpoch)
        throw new Error("Current Human settings access changed");
      return authority.write(async () => {
        await companiesApi.updateResponsibilityContacts(input.companyId, {
          securityContactUserId: input.securityContactUserId || null,
          supportIncidentContactUserId: input.supportIncidentContactUserId || null,
        }, input.principalId, input.localImplicit ? null : input.sessionId);
        if (!receipt.isCurrent()) throw new Error("Current Human settings access changed");
        return { input, receipt };
      });
    },
    onSuccess: async (acknowledgement) => {
      if (!authority.confirmed(acknowledgement) || !acknowledgement.receipt.isCurrent()) return;
      const { input } = acknowledgement;
      const queryKey = ["company-responsibility-contacts", input.companyId, input.principalId,
        input.sessionId, input.authorityEpoch, input.scopeEpoch] as const;
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      locale !== (selectedCompany.locale ?? "en") ||
      timezone !== (selectedCompany.timezone ?? "UTC"));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      locale: "en" | "da";
      timezone: string;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const governanceMutation = useMutation({
    mutationFn: (next: InteractionResolverGovernance) =>
      companiesApi.update(selectedCompanyId!, { interactionResolverGovernance: next }),
    onSuccess: (company) => {
      setGovernance(company.interactionResolverGovernance ?? {});
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  function handleGovernanceChange(
    kind: IssueThreadInteractionKind,
    field: GovernanceField,
    value: GovernanceSelectValue,
  ) {
    const next = applyGovernanceChange(governance, kind, field, value);
    setGovernance(next);
    governanceMutation.mutate(next);
  }

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  const archiveMutation = useMutation({
    mutationFn: ({ companyId }: { companyId: string }) =>
      companiesApi.archive(companyId),
    onSuccess: async (_result, { companyId }) => {
      // Never stay on the archived company's settings: the only visible
      // change would be the archive button going inert. Leave for wherever
      // still makes sense (another active company, the Cloud portfolio, or
      // the companies list), with a toast naming what happened.
      const archived = companies.find((company) => company.id === companyId);
      const archivedName = archived?.name ?? "Organization";
      const departure = resolveCompanyArchiveDeparture({
        archivedCompanyId: companyId,
        companies,
        cloudPortfolioUrl: cloudPortfolioManageUrl(cloud?.cloudBaseUrl),
      });
      if (departure.kind === "cloud_portfolio") {
        // The whole organization is on its way to being archived by the
        // control plane; a full navigation to the Cloud portfolio replaces
        // this document, so cache invalidation below would never run.
        navigateTopLevel(departure.url);
        return;
      }
      if (departure.kind === "company") {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: `Switched to ${departure.company.name}.`,
          tone: "info",
          dedupeKey: `company-archive-departure:${companyId}`,
        });
        setSelectedCompanyId(departure.company.id);
        navigate(`/${departure.company.issuePrefix}/dashboard`, { replace: true });
      } else {
        toastActions?.pushToast({
          title: `${archivedName} is archived`,
          body: "You can unarchive it from this list.",
          tone: "info",
          dedupeKey: `company-archive-departure:${companyId}`,
        });
        navigate(`/${archived?.issuePrefix ?? ""}/companies`, { replace: true });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No organization selected. Select an organization from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      locale,
      timezone: timezone.trim(),
    });
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">General</h1>
      </div>

      {/* General */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3">
          <Field label="Organization name" hint="The display name for your organization.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            {isCloudManaged && (
              <p className="mt-1 text-xs text-muted-foreground">
                Renaming can change this company's task ID prefix. Existing task IDs are
                renumbered and old task links stop resolving.
              </p>
            )}
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the organization profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional organization description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label={t("company.generalDefaults.language")}
            hint={t("company.generalDefaults.languageHint")}
          >
            <select
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={locale}
              onChange={(event) => setLocale(event.target.value === "da" ? "da" : "en")}
            >
              <option value="en">English</option>
              <option value="da">Dansk</option>
            </select>
          </Field>
          <Field
            label={t("company.generalDefaults.timezone")}
            hint={t("company.generalDefaults.timezoneHint")}
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              list="company-timezone-suggestions"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              aria-label={t("company.generalDefaults.timezone")}
            />
            <datalist id="company-timezone-suggestions">
              <option value="UTC" />
              <option value="Europe/Copenhagen" />
              <option value="Europe/London" />
              <option value="America/Chicago" />
              <option value="America/Los_Angeles" />
              <option value="Asia/Singapore" />
            </datalist>
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="max-w-2xl space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                className="rounded-(--rad-14)"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="max-w-2xl space-y-4" data-testid="company-responsibility-contacts">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Responsibility contacts</div>
        <p className="text-sm text-muted-foreground">These contacts are accountable people for follow-up. Selecting someone does not grant access or change their permissions.</p>
        <Field label="Security contact" hint="A current Human member for company security follow-up.">
          <select aria-label="Security contact" data-testid="security-contact-select"
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
            disabled={!contactsReadReady || !contactsLoaded || contactsMutation.isPending}
            value={securityContactUserId} onChange={event => updateContactsField("securityContactUserId", event.target.value)}>
            <option value="">No contact selected</option>
            {securityContactUserId && !responsibilityContacts?.eligibleUsers.some(user => user.id === securityContactUserId) &&
              <option value={securityContactUserId}>Current contact is no longer eligible; clear or replace it</option>}
            {(responsibilityContacts?.eligibleUsers ?? []).map(entry =>
              <option key={entry.id} value={entry.id}>{entry.name || entry.email || entry.id}</option>)}
          </select>
        </Field>
        <Field label="Support and incident contact" hint="A current Human member for customer support and incident coordination.">
          <select aria-label="Support and incident contact" data-testid="support-incident-contact-select"
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm"
            disabled={!contactsReadReady || !contactsLoaded || contactsMutation.isPending}
            value={supportIncidentContactUserId} onChange={event => updateContactsField("supportIncidentContactUserId", event.target.value)}>
            <option value="">No contact selected</option>
            {supportIncidentContactUserId && !responsibilityContacts?.eligibleUsers.some(user => user.id === supportIncidentContactUserId) &&
              <option value={supportIncidentContactUserId}>Current contact is no longer eligible; clear or replace it</option>}
            {(responsibilityContacts?.eligibleUsers ?? []).map(entry =>
              <option key={entry.id} value={entry.id}>{entry.name || entry.email || entry.id}</option>)}
          </select>
        </Field>
        {!contactsReadReady && <span className="text-xs text-muted-foreground">Waiting for current Human settings access.</span>}
        {contactsError && <span className="text-xs text-destructive">Could not load responsibility contacts.</span>}
        {contactsLoaded && contactsReadReady && (securityContactUserId !== (responsibilityContacts?.securityContactUserId ?? "") ||
          supportIncidentContactUserId !== (responsibilityContacts?.supportIncidentContactUserId ?? "")) && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => contactsMutation.mutate({ companyId: selectedCompanyId!, principalId,
              sessionId: sessionId!, authorityEpoch: authority.epoch, scopeEpoch: contactsScopeRef.current.epoch,
              localImplicit: account.localImplicit, securityContactUserId, supportIncidentContactUserId })}
              disabled={!contactsReadReady || contactsMutation.isPending}>
              {contactsMutation.isPending ? "Saving..." : "Save contacts"}
            </Button>
            {contactsMutation.isError && contactsReadReady && <span className="text-xs text-destructive">{contactsMutation.error.message}</span>}
          </div>
        )}
      </div>

      {/* Hiring */}
      <div className="max-w-2xl space-y-4" data-testid="company-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div>
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="company-settings-team-approval-toggle"
          />
        </div>
      </div>

      {/* Interaction governance */}
      <InteractionGovernancePanel
        governance={governance}
        onChange={handleGovernanceChange}
        isPending={governanceMutation.isPending}
        errorMessage={
          governanceMutation.isError
            ? governanceMutation.error instanceof Error
              ? governanceMutation.error.message
              : "Failed to save interaction governance"
            : null
        }
      />

      <JevSkillSuggestionSettings companyId={selectedCompanyId!} />

      <InstanceGeneralSettings embedded />

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this organization to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive organization "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                archiveMutation.mutate({ companyId: selectedCompanyId });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive organization"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive organization"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
