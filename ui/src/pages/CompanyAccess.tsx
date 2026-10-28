import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS,
  hidesCompanyPage,
  type Agent,
  type CreateHumanWorkflowCoverage,
  authSessionSchema,
  type SecuritySuspendCompanyMember,
} from "@paperclipai/shared";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import { Shield, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { accessApi, type CompanyMember } from "@/api/access";
import { workflowsApi } from "@/api/workflows";
import { useAccountIdentity } from "@/api/companies-query";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { hasCurrentV9Session, useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { agentsApi } from "@/api/agents";
import { ApiError, detachInflightGet } from "@/api/client";
import { cloudApi } from "@/api/cloud";
import { issuesApi } from "@/api/issues";
import { routinesApi } from "@/api/routines";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/context/ToastContext";
import { Link, Navigate, useSearchParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { cloudStackInviteUrl } from "@/lib/cloudLinks";
import { usePluginSlots } from "@/plugins/slots";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabBar } from "@/components/PageTabBar";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { useCloudInstance } from "@/hooks/useCloudInstance";
import { InvitesSection } from "@/components/access/InvitesSection";
import { useTranslation } from "@/i18n";
import { useSecondTick } from "@/hooks/useSecondTick";

const reassignmentIssueStatuses = "backlog,todo,in_progress,in_review,blocked,failed,timed_out";
type EditableMemberStatus = "pending" | "active" | "suspended";
type SecuritySuspensionReasonCode = SecuritySuspendCompanyMember["reasonCode"];

export function CompanyAccess() {
  const { t } = useTranslation("experience");
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const identity = useAccountIdentity({ refetchOnMount: false });
  const currentAccount = useV9CurrentAccount();
  const principal = identity.localImplicit ? "local-board" : identity.userId ?? "";
  const authority = useV9PrivateReadAuthority(principal, true);
  const scope = useRef({ company: selectedCompanyId, principal, accountEpoch: authority.epoch, epoch: 0 });
  if (scope.current.company !== selectedCompanyId || scope.current.principal !== principal ||
    scope.current.accountEpoch !== authority.epoch) {
    scope.current = { company: selectedCompanyId, principal, accountEpoch: authority.epoch,
      epoch: scope.current.epoch + 1 };
  }
  const captureAccess = () => {
    const epoch = scope.current.epoch;
    const companyId = selectedCompanyId!;
    const principalId = principal;
    const sessionId = currentAccount.sessionId;
    return { companyId,
      principalId: principal,
      sessionId,
      isCurrent: () => !!selectedCompanyId && epoch === scope.current.epoch && authority.canRead(),
      isOriginalSessionCurrent: () => {
        if (scope.current.company !== companyId || scope.current.principal !== principalId || !sessionId) return false;
        const session = authSessionSchema.safeParse(queryClient.getQueryData(queryKeys.auth.session));
        return session.success && !session.data.session.localImplicit &&
          session.data.user.id === principalId && session.data.session.userId === principalId &&
          session.data.session.id === sessionId;
      } };
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const cloud = useCloudInstance();
  const cloudStacksQuery = useQuery({
    queryKey: queryKeys.cloud.stacks,
    queryFn: () => cloudApi.listStacks(),
    enabled: Boolean(cloud && selectedCompanyId),
    staleTime: 30_000,
    retry: false,
  });
  const currentStack = cloudStacksQuery.data?.stacks.find((stack) => stack.isCurrent);
  // Company roles can differ from Cloud roles. Only the current stack's
  // owner/admin may invite, even if another portfolio entry grants ownership.
  const cloudInviteUrl = cloud && !cloudStacksQuery.isError &&
    (currentStack?.role === "owner" || currentStack?.role === "admin")
    ? cloudStackInviteUrl(cloud.cloudBaseUrl, currentStack.stackSlug)
    : null;
  // Invites render as a tab of this page; `company.invites` hides just that
  // tab while `company.members` (the route gate) hides the whole page.
  const { hidden: hiddenSettings } = useHiddenSettings();
  const hideInvitesTab = hidesCompanyPage(hiddenSettings, "company.invites");
  const requestedTab = searchParams.get("tab") === "invites" ? "invites" : "members";
  const activeTab = hideInvitesTab ? "members" : requestedTab;
  const handleTabChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "invites") {
          next.set("tab", "invites");
        } else {
          next.delete("tab");
        }
        return next;
      },
      { replace: true },
    );
  };
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [securitySuspendingMemberId, setSecuritySuspendingMemberId] = useState<string | null>(null);
  const [securitySuspensionReason, setSecuritySuspensionReason] = useState<SecuritySuspensionReasonCode | "">("");
  const [reassignmentTarget, setReassignmentTarget] = useState<string>("__unassigned");
  const [routineResponsibleTarget, setRoutineResponsibleTarget] = useState<string>("__unassigned");
  const [draftRole, setDraftRole] = useState<CompanyMember["membershipRole"]>(null);
  const [draftStatus, setDraftStatus] = useState<EditableMemberStatus>("active");
  const [coverageDelegatee, setCoverageDelegatee] = useState("");
  const [coverageWorkflowId, setCoverageWorkflowId] = useState("");
  const [coverageScopeType, setCoverageScopeType] = useState<"manual" | "task">("manual");
  const [coverageTaskId, setCoverageTaskId] = useState("");
  const [coverageTaskSearch, setCoverageTaskSearch] = useState("");
  const toLocalDateTimeInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [coverageStart, setCoverageStart] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 5 * 60 * 1000)));
  const [coverageExpiry, setCoverageExpiry] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [coverageReason, setCoverageReason] = useState("");
  const coverageRequestId = useRef(crypto.randomUUID());
  const changeCoverageTerms = () => { coverageRequestId.current = crypto.randomUUID(); };

  useEffect(() => {
    setCoverageDelegatee("");
    setCoverageWorkflowId("");
    setCoverageTaskId("");
    setCoverageTaskSearch("");
    coverageRequestId.current = crypto.randomUUID();
  }, [selectedCompanyId, currentAccount.userId, currentAccount.sessionId, currentAccount.authorityEpoch]);

  useEffect(() => {
    setSecuritySuspendingMemberId(null);
    setSecuritySuspensionReason("");
  }, [selectedCompanyId, currentAccount.userId, currentAccount.sessionId, currentAccount.authorityEpoch]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Organization", href: "/dashboard" },
      { label: "Settings", href: "/company/settings" },
      { label: "Members" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const membersQuery = useQuery({
    queryKey: queryKeys.access.companyMembers(selectedCompanyId ?? ""),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const workflowCoveragesQuery = useQuery({
    queryKey: ["access", "workflow-coverages", selectedCompanyId ?? "", identity.userId ?? "", currentAccount.sessionId ?? "", authority.epoch],
    queryFn: async ({ signal }) => {
      if (!selectedCompanyId || !identity.userId || identity.localImplicit || !currentAccount.settled ||
        !currentAccount.sessionId || !authority.canRead() ||
        !hasCurrentV9Session(queryClient, identity.userId, currentAccount.sessionId))
        throw new Error("Current Human session is unavailable");
      const result = await accessApi.listWorkflowCoverages(selectedCompanyId, identity.userId, currentAccount.sessionId, { signal });
      signal.throwIfAborted();
      if (!authority.canRead() || !hasCurrentV9Session(queryClient, identity.userId, currentAccount.sessionId))
        throw new Error("Current Human session changed");
      return result;
    },
    enabled: !!selectedCompanyId && !!identity.userId && !identity.localImplicit && currentAccount.settled &&
      !!currentAccount.sessionId && authority.readReady,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  useSecondTick((workflowCoveragesQuery.data?.coverages.length ?? 0) > 0);
  const workflowsForCoverageQuery = useQuery({
    queryKey: queryKeys.workflows.list(selectedCompanyId ?? ""),
    queryFn: () => workflowsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && !identity.localImplicit,
    retry: false,
  });
  const coverageTasksQuery = useQuery({
    queryKey: ["access", "workflow-coverage-tasks", selectedCompanyId ?? "", identity.userId ?? "", currentAccount.sessionId ?? "", authority.epoch, coverageTaskSearch],
    queryFn: async ({ signal }) => {
      if (!selectedCompanyId || !identity.userId || !currentAccount.sessionId || !authority.canRead() ||
        !hasCurrentV9Session(queryClient, identity.userId, currentAccount.sessionId))
        throw new Error("Current Human session is unavailable");
      const filters = { q: coverageTaskSearch.trim() || undefined, limit: 20 };
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      params.set("limit", String(filters.limit));
      detachInflightGet(`/companies/${selectedCompanyId}/issues?${params.toString()}`);
      const result = await issuesApi.list(selectedCompanyId, filters, { signal, cache: "no-store" });
      signal.throwIfAborted();
      if (!authority.canRead() || !hasCurrentV9Session(queryClient, identity.userId, currentAccount.sessionId))
        throw new Error("Current Human session changed");
      return result;
    },
    enabled: !!selectedCompanyId && !!identity.userId && !identity.localImplicit && currentAccount.settled &&
      !!currentAccount.sessionId && authority.readReady && coverageScopeType === "task",
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const activeCoverageWorkflows = (workflowsForCoverageQuery.data ?? []).filter((workflow) =>
    workflow.status === "active" && workflow.publishedRevisionId,
  );

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId ?? ""),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const joinRequestsQuery = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId ?? "", "pending_approval"),
    queryFn: () => accessApi.listJoinRequests(selectedCompanyId!, "pending_approval"),
    enabled: !!selectedCompanyId && !!membersQuery.data?.access.canApproveJoinRequests,
  });

  const refreshAccessData = async (receipt: ReturnType<typeof captureAccess>) => {
    for (const queryKey of [
      queryKeys.access.companyMembers(receipt.companyId),
      queryKeys.access.companyUserDirectory(receipt.companyId),
      queryKeys.access.joinRequests(receipt.companyId, "pending_approval"),
    ]) {
      if (!receipt.isCurrent()) return false;
      await queryClient.invalidateQueries({ queryKey });
    }
    return receipt.isCurrent();
  };

  const updateMemberMutation = useMutation({
    mutationFn: async (input: { receipt: ReturnType<typeof captureAccess>; memberId: string; membershipRole: CompanyMember["membershipRole"]; status: EditableMemberStatus }) => {
      if (!input.receipt.isCurrent()) throw new Error("Current account access changed");
      return accessApi.updateMember(input.receipt.companyId, input.memberId, {
        membershipRole: input.membershipRole,
        status: input.status,
      });
    },
    onSuccess: async (_result, { receipt }) => {
      if (!receipt.isCurrent()) return;
      setEditingMemberId(null);
      if (!await refreshAccessData(receipt)) return;
      pushToast({
        title: "Member updated",
        tone: "success",
      });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({
        title: "Failed to update member",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const createWorkflowCoverageMutation = useMutation({
    mutationFn: async (input: { receipt: ReturnType<typeof captureAccess>; value: CreateHumanWorkflowCoverage }) => {
      if (!input.receipt.isCurrent() || !input.receipt.sessionId || input.receipt.principalId === "local-board")
        throw new Error("Current account access changed");
      return accessApi.createWorkflowCoverage(input.receipt.companyId, input.value, input.receipt.principalId, input.receipt.sessionId);
    },
    onSuccess: async (_coverage, { receipt }) => {
      if (!receipt.isCurrent()) return;
      setCoverageReason("");
      setCoverageTaskId("");
      setCoverageStart(toLocalDateTimeInput(new Date(Date.now() + 5 * 60 * 1000)));
      setCoverageExpiry(toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      coverageRequestId.current = crypto.randomUUID();
      await queryClient.invalidateQueries({ queryKey: queryKeys.access.workflowCoverages(receipt.companyId, receipt.principalId) });
      if (receipt.isCurrent()) pushToast({ title: "Workflow coverage created", tone: "success" });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({ title: "Could not create workflow coverage", body: error instanceof Error ? error.message : "Unknown error", tone: "error" });
    },
  });

  const revokeWorkflowCoverageMutation = useMutation({
    mutationFn: async (input: { receipt: ReturnType<typeof captureAccess>; coverageId: string }) => {
      if (!input.receipt.isCurrent() || !input.receipt.sessionId || input.receipt.principalId === "local-board")
        throw new Error("Current account access changed");
      return accessApi.revokeWorkflowCoverage(input.receipt.companyId, input.coverageId, input.receipt.principalId, input.receipt.sessionId);
    },
    onSuccess: async (_coverage, { receipt }) => {
      if (!receipt.isCurrent()) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.access.workflowCoverages(receipt.companyId, receipt.principalId) });
      if (receipt.isCurrent()) pushToast({ title: "Workflow coverage revoked", tone: "success" });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({ title: "Could not revoke workflow coverage", body: error instanceof Error ? error.message : "Unknown error", tone: "error" });
    },
  });

  const approveJoinRequestMutation = useMutation({
    mutationFn: (input: { requestId: string; receipt: ReturnType<typeof captureAccess> }) => {
      if (!input.receipt.isCurrent()) throw new Error("Current account access changed");
      return accessApi.approveJoinRequest(input.receipt.companyId, input.requestId);
    },
    onSuccess: async (_result, { receipt }) => {
      if (!receipt.isCurrent() || !await refreshAccessData(receipt)) return;
      pushToast({
        title: "Join request approved",
        tone: "success",
      });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({
        title: "Failed to approve join request",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const rejectJoinRequestMutation = useMutation({
    mutationFn: (input: { requestId: string; receipt: ReturnType<typeof captureAccess> }) => {
      if (!input.receipt.isCurrent()) throw new Error("Current account access changed");
      return accessApi.rejectJoinRequest(input.receipt.companyId, input.requestId);
    },
    onSuccess: async (_result, { receipt }) => {
      if (!receipt.isCurrent() || !await refreshAccessData(receipt)) return;
      pushToast({
        title: "Join request rejected",
        tone: "success",
      });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({
        title: "Failed to reject join request",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const editingMember = useMemo(
    () => membersQuery.data?.members.find((member) => member.id === editingMemberId) ?? null,
    [editingMemberId, membersQuery.data?.members],
  );
  const removingMember = useMemo(
    () => membersQuery.data?.members.find((member) => member.id === removingMemberId) ?? null,
    [removingMemberId, membersQuery.data?.members],
  );
  const securitySuspendingMember = useMemo(
    () => membersQuery.data?.members.find((member) => member.id === securitySuspendingMemberId) ?? null,
    [securitySuspendingMemberId, membersQuery.data?.members],
  );
  const securitySuspendReady = Boolean(
    !identity.localImplicit && identity.userId && currentAccount.settled && currentAccount.sessionId &&
    authority.canRead() && hasCurrentV9Session(queryClient, identity.userId, currentAccount.sessionId),
  );

  const assignedIssuesQuery = useQuery({
    queryKey: ["access", "member-assigned-issues", selectedCompanyId ?? "", removingMember?.principalId ?? ""],
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        assigneeUserId: removingMember!.principalId,
        status: reassignmentIssueStatuses,
      }),
    enabled: !!selectedCompanyId && !!removingMember,
  });
  const routinesQuery = useQuery({
    queryKey: ["company", selectedCompanyId ?? "", "member-routines", removingMember?.principalId ?? ""],
    queryFn: () => routinesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!removingMember,
  });
  const ownedRoutines = (routinesQuery.data ?? []).filter(
    (routine) => ["active", "paused"].includes(routine.status) && routine.responsibleUserId === removingMember?.principalId,
  );
  const privateOwnedRoutineCount = ownedRoutines.filter((routine) => routine.originKind === "conversation_draft").length;

  const archiveMemberMutation = useMutation({
    mutationFn: async (input: { receipt: ReturnType<typeof captureAccess>; memberId: string; target: string; routineTarget: string }) => {
      if (!input.receipt.isCurrent()) throw new Error("Current account access changed");
      const reassignment =
        input.target.startsWith("agent:")
          ? { assigneeAgentId: input.target.slice("agent:".length), assigneeUserId: null }
          : input.target.startsWith("user:")
            ? { assigneeAgentId: null, assigneeUserId: input.target.slice("user:".length) }
            : null;
      return accessApi.archiveMember(input.receipt.companyId, input.memberId, {
        reassignment,
        routineResponsibleUserId: input.routineTarget.startsWith("user:")
          ? input.routineTarget.slice("user:".length)
          : null,
      });
    },
    onSuccess: async (result, { receipt }) => {
      if (!receipt.isCurrent()) return;
      setRemovingMemberId(null);
      setReassignmentTarget("__unassigned");
      setRoutineResponsibleTarget("__unassigned");
      if (!await refreshAccessData(receipt)) return;
      for (const queryKey of [
        queryKeys.issues.list(receipt.companyId),
        queryKeys.issues.listAssignedToMe(receipt.companyId),
        queryKeys.issues.listTouchedByMe(receipt.companyId),
      ]) {
        if (!receipt.isCurrent()) return;
        await queryClient.invalidateQueries({ queryKey });
      }
      if (!receipt.isCurrent()) return;
      pushToast({
        title: "Member removed",
        body: [
          result.reassignedIssueCount > 0 ? `${result.reassignedIssueCount} assigned task${result.reassignedIssueCount === 1 ? "" : "s"} cleaned up.` : null,
          result.reassignedRoutineCount > 0 ? `${result.reassignedRoutineCount} routine${result.reassignedRoutineCount === 1 ? "" : "s"} reassigned.` : null,
          result.pausedRoutineCount > 0 ? `${result.pausedRoutineCount} active routine${result.pausedRoutineCount === 1 ? "" : "s"} paused.` : null,
          result.ownerActionRoutineCount > 0 ? `${result.ownerActionRoutineCount} routine${result.ownerActionRoutineCount === 1 ? "" : "s"} need an authorized owner action.` : null,
        ].filter(Boolean).join(" ") || undefined,
        tone: "success",
      });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({
        title: "Failed to remove member",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const securitySuspendMemberMutation = useMutation({
    mutationFn: async (input: { receipt: ReturnType<typeof captureAccess>; memberId: string; reasonCode: SecuritySuspensionReasonCode }) => {
      if (!input.receipt.isCurrent() || input.receipt.principalId === "local-board" || !input.receipt.sessionId ||
        !hasCurrentV9Session(queryClient, input.receipt.principalId, input.receipt.sessionId))
        throw new Error("Current Human session is unavailable");
      return accessApi.securitySuspendMember(
        input.receipt.companyId,
        input.memberId,
        { reasonCode: input.reasonCode },
        input.receipt.principalId,
        input.receipt.sessionId,
      );
    },
    onSuccess: async (result, { receipt }) => {
      if (!receipt.isOriginalSessionCurrent()) return;
      setSecuritySuspendingMemberId(null);
      setSecuritySuspensionReason("");
      let refreshed = false;
      try {
        refreshed = await refreshAccessData(receipt);
      } catch {
        // A committed security action still needs a same-session acknowledgement.
      }
      if (!receipt.isOriginalSessionCurrent()) return;
      const accessQueryKeys = [
        queryKeys.access.companyMembers(receipt.companyId),
        queryKeys.access.companyUserDirectory(receipt.companyId),
        queryKeys.access.joinRequests(receipt.companyId, "pending_approval"),
      ];
      if (!refreshed || accessQueryKeys.some((queryKey) => queryClient.getQueryState(queryKey)?.status === "error"))
        for (const queryKey of accessQueryKeys) queryClient.removeQueries({ queryKey });
      pushToast({
        title: t("companyAccess.securitySuspension.successTitle"),
        body: result.ownerRecoveryRequired
          ? t("companyAccess.securitySuspension.ownerRecoveryRequired")
          : t("companyAccess.securitySuspension.successBody"),
        tone: "success",
      });
    },
    onError: (error, { receipt }) => {
      if (!receipt.isCurrent()) return;
      pushToast({
        title: t("companyAccess.securitySuspension.failureTitle"),
        body: error instanceof Error ? error.message : t("companyAccess.securitySuspension.failureBody"),
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (!editingMember) return;
    setDraftRole(editingMember.membershipRole);
    setDraftStatus(isEditableMemberStatus(editingMember.status) ? editingMember.status : "suspended");
  }, [editingMember]);

  useEffect(() => {
    if (!removingMember) return;
    setReassignmentTarget("__unassigned");
  }, [removingMember]);

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">Select an organization to manage access.</div>;
  }

  if (membersQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading organization access…</div>;
  }

  if (membersQuery.error) {
    const message =
      membersQuery.error instanceof ApiError && membersQuery.error.status === 403
        ? "You do not have permission to manage organization members."
        : membersQuery.error instanceof Error
          ? membersQuery.error.message
          : "Failed to load organization members.";
    return <div className="text-sm text-destructive">{message}</div>;
  }

  const members = membersQuery.data?.members ?? [];
  const access = membersQuery.data?.access;
  const pendingHumanJoinRequests =
    joinRequestsQuery.data?.filter((request) => request.requestType === "human") ?? [];
  const joinRequestActionPending =
    approveJoinRequestMutation.isPending || rejectJoinRequestMutation.isPending;
  const activeReassignmentUsers = members.filter(
    (member) =>
      member.status === "active" &&
      member.principalType === "user" &&
      member.user !== null &&
      member.id !== removingMemberId,
  );
  const activeReassignmentAgents = (agentsQuery.data ?? []).filter(isAssignableAgent);
  const assignedIssues = assignedIssuesQuery.data ?? [];

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Organization Members</h1>
        </div>
        {cloudInviteUrl && (
          <Button asChild>
            <a href={cloudInviteUrl}><UserPlus />Invite people</a>
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-4">
        {!hideInvitesTab && (
          <PageTabBar
            items={[
              { value: "members", label: "Members" },
              { value: "invites", label: "Invites" },
            ]}
            align="start"
            value={activeTab}
            onValueChange={handleTabChange}
          />
        )}
        <TabsContent value="members" className="space-y-8">

      {access && !access.currentUserRole && (
        <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          This account can manage access here through instance-admin privileges, but it does not currently hold an active organization membership.
        </div>
      )}

      <section className="space-y-4">
        {access?.canApproveJoinRequests && pendingHumanJoinRequests.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Pending human joins</h3>
                <p className="text-sm text-muted-foreground">
                  Review pending join requests before they become active organization members.
                </p>
              </div>
              <Badge variant="outline">{pendingHumanJoinRequests.length} pending</Badge>
            </div>
            <div className="space-y-3">
              {pendingHumanJoinRequests.map((request) => (
                <PendingJoinRequestCard
                  key={request.id}
                  title={
                    request.requesterUser?.name ||
                    request.requestEmailSnapshot ||
                    request.requestingUserId ||
                    "Unknown human requester"
                  }
                  subtitle={
                    request.requesterUser?.email ||
                    request.requestEmailSnapshot ||
                    request.requestingUserId ||
                    "No email available"
                  }
                  context={
                    request.invite
                      ? `${request.invite.allowedJoinTypes} join invite${request.invite.humanRole ? ` • default role ${request.invite.humanRole}` : ""}`
                      : "Invite metadata unavailable"
                  }
                  detail={`Submitted ${new Date(request.createdAt).toLocaleString()}`}
                  approveLabel="Approve human"
                  rejectLabel="Reject human"
                  disabled={joinRequestActionPending}
                  onApprove={() => approveJoinRequestMutation.mutate({ requestId: request.id, receipt: captureAccess() })}
                  onReject={() => rejectJoinRequestMutation.mutate({ requestId: request.id, receipt: captureAccess() })}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-(--sz-44rem) text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-muted-foreground">
                    No user memberships found for this organization yet.
                  </td>
                </tr>
              ) : members.map((member) => {
                const removalReason = member.removal?.reason ?? null;
                const canArchive = member.removal?.canArchive ?? true;
                const displayName = memberDisplayName(member);
                return (
                  <tr key={member.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar size="sm">
                          {member.user?.image ? <AvatarImage src={member.user.image} alt={displayName} /> : null}
                          <AvatarFallback>{memberInitials(member)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">{displayName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {member.user?.email || member.principalId}
                    </td>
                    <td className="px-3 py-3">
                      {member.membershipRole
                        ? HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS[member.membershipRole]
                        : "Unset"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={member.status === "active" ? "secondary" : member.status === "suspended" ? "destructive" : "outline"}>
                        {member.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingMemberId(member.id)}>
                          Edit
                        </Button>
                        {access?.canManageMembers && member.status !== "suspended" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!securitySuspendReady || securitySuspendMemberMutation.isPending}
                            onClick={() => {
                              if (!securitySuspendReady) return;
                              setSecuritySuspensionReason("");
                              setSecuritySuspendingMemberId(member.id);
                            }}
                          >
                            <Shield className="mr-1 h-3.5 w-3.5" />
                            {t("companyAccess.securitySuspension.action")}
                          </Button>
                        ) : null}
                        <span
                          className="inline-flex"
                          title={!canArchive ? removalReason ?? undefined : undefined}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReassignmentTarget("__unassigned");
                              setRoutineResponsibleTarget("__unassigned");
                              setRemovingMemberId(member.id);
                            }}
                            disabled={!canArchive}
                            title={!canArchive ? removalReason ?? undefined : undefined}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!identity.localImplicit && identity.userId && authority.canRead() ? (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("humanWorkflowCoverage.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("humanWorkflowCoverage.intro")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("humanWorkflowCoverage.delegateTo")}</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={coverageDelegatee}
                onChange={(event) => { changeCoverageTerms(); setCoverageDelegatee(event.target.value); }}>
                <option value="">{t("humanWorkflowCoverage.selectHuman")}</option>
                {(membersQuery.data?.members ?? []).filter((member) => member.status === "active" && member.principalId !== identity.userId)
                  .map((member) => <option key={member.principalId} value={member.principalId}>{memberDisplayName(member)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("humanWorkflowCoverage.workflow")}</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={coverageWorkflowId}
                onChange={(event) => { changeCoverageTerms(); setCoverageWorkflowId(event.target.value); }}>
                <option value="">{t("humanWorkflowCoverage.selectWorkflow")}</option>
                {activeCoverageWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("humanWorkflowCoverage.scope")}</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={coverageScopeType}
                onChange={(event) => { changeCoverageTerms(); setCoverageTaskId(""); setCoverageTaskSearch(""); setCoverageScopeType(event.target.value as "manual" | "task"); }}>
                <option value="manual">{t("humanWorkflowCoverage.manualRun")}</option>
                <option value="task">{t("humanWorkflowCoverage.taskRun")}</option>
              </select>
            </label>
            {coverageScopeType === "task" ? (
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("humanWorkflowCoverage.task")}</span>
                <input className="mb-2 h-10 w-full rounded-md border border-input bg-background px-3" value={coverageTaskSearch}
                  onChange={(event) => setCoverageTaskSearch(event.target.value)} placeholder={t("humanWorkflowCoverage.searchTasks")} />
                <select className="h-10 w-full rounded-md border border-input bg-background px-3" value={coverageTaskId}
                  onChange={(event) => { changeCoverageTerms(); setCoverageTaskId(event.target.value); }}>
                  <option value="">{t("humanWorkflowCoverage.selectTask")}</option>
                  {(coverageTasksQuery.data ?? []).map((task) => <option key={task.id} value={task.id}>
                    {task.identifier ?? task.id.slice(0, 8)} · {task.title}
                  </option>)}
                </select>
              </label>
            ) : null}
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("humanWorkflowCoverage.startsAt")}</span>
              <input type="datetime-local" className="h-10 w-full rounded-md border border-input bg-background px-3"
                value={coverageStart} onChange={(event) => { changeCoverageTerms(); setCoverageStart(event.target.value); }} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("humanWorkflowCoverage.expiresAt")}</span>
              <input type="datetime-local" className="h-10 w-full rounded-md border border-input bg-background px-3"
                value={coverageExpiry} onChange={(event) => { changeCoverageTerms(); setCoverageExpiry(event.target.value); }} />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">{t("humanWorkflowCoverage.reason")}</span>
              <input className="h-10 w-full rounded-md border border-input bg-background px-3" value={coverageReason}
                onChange={(event) => { changeCoverageTerms(); setCoverageReason(event.target.value); }} maxLength={500}
                placeholder={t("humanWorkflowCoverage.reasonPlaceholder")} />
            </label>
          </div>
          <Button size="sm" disabled={createWorkflowCoverageMutation.isPending || !coverageDelegatee || !coverageWorkflowId ||
            (coverageScopeType === "task" && !coverageTaskId) || !coverageReason.trim() || !coverageStart || !coverageExpiry}
            onClick={() => {
              const workflow = activeCoverageWorkflows.find((candidate) => candidate.id === coverageWorkflowId);
              if (!workflow?.publishedRevisionId || !selectedCompanyId) return;
              const value: CreateHumanWorkflowCoverage = {
                requestId: coverageRequestId.current,
                delegateeUserId: coverageDelegatee,
                workflowId: workflow.id,
                workflowRevisionId: workflow.publishedRevisionId,
                scopeType: coverageScopeType,
                taskId: coverageScopeType === "task" ? coverageTaskId : null,
                startsAt: new Date(coverageStart),
                expiresAt: new Date(coverageExpiry),
                reason: coverageReason,
              };
              createWorkflowCoverageMutation.mutate({ receipt: captureAccess(), value });
            }}>
            {t("humanWorkflowCoverage.create")}
          </Button>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("humanWorkflowCoverage.yourCoverage")}</h3>
            {(workflowCoveragesQuery.data?.coverages ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("humanWorkflowCoverage.none")}</p>
            ) : (workflowCoveragesQuery.data?.coverages ?? []).map((coverage) => {
              const expiresAt = new Date(coverage.expiresAt);
              const startsAt = new Date(coverage.startsAt);
              const state = coverage.revokedAt ? "revoked" : expiresAt.getTime() <= Date.now() ? "expired" : startsAt.getTime() > Date.now() ? "scheduled" : "active";
              const isPrincipal = coverage.principalUserId === identity.userId;
              const workflowName = workflowsForCoverageQuery.data?.find((workflow) => workflow.id === coverage.workflowId)?.name ?? t("humanWorkflowCoverage.workflowFallback");
              const delegatee = membersQuery.data?.members.find((member) => member.principalId === coverage.delegateeUserId);
              const principalMember = membersQuery.data?.members.find((member) => member.principalId === coverage.principalUserId);
              const coverageWorkflow = workflowsForCoverageQuery.data?.find((workflow) => workflow.id === coverage.workflowId);
              const revisionIsStale = !!coverageWorkflow?.publishedRevisionId && coverageWorkflow.publishedRevisionId !== coverage.workflowRevisionId;
              return (
                <div key={coverage.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0 space-y-1 text-sm">
                    <div className="font-medium">{t(isPrincipal ? "humanWorkflowCoverage.coveredBy" : "humanWorkflowCoverage.youCover")} {isPrincipal
                      ? (delegatee ? memberDisplayName(delegatee) : t("humanWorkflowCoverage.anotherHuman"))
                      : (principalMember ? memberDisplayName(principalMember) : t("humanWorkflowCoverage.anotherHuman"))} · {workflowName}</div>
                    <div className="text-muted-foreground">{coverage.scopeType === "task" ? t("humanWorkflowCoverage.taskScoped") : t("humanWorkflowCoverage.manualRuns")} · {t("humanWorkflowCoverage.expiresLabel", { value: expiresAt.toLocaleString() })} · {coverage.reason}</div>
                    {revisionIsStale ? <div className="text-amber-700 dark:text-amber-400">{t("humanWorkflowCoverage.staleRevision")}</div> : null}
                    <Badge variant={state === "active" ? "secondary" : "outline"}>{t(`humanWorkflowCoverage.states.${state}`)}</Badge>
                  </div>
                  {state !== "revoked" && (
                    <Button size="sm" variant="outline" disabled={revokeWorkflowCoverageMutation.isPending}
                      onClick={() => revokeWorkflowCoverageMutation.mutate({ receipt: captureAccess(), coverageId: coverage.id })}>
                      {t("humanWorkflowCoverage.revoke")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMemberId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit member</DialogTitle>
            <DialogDescription>
              Update organization role and membership status for {editingMember?.user?.name || editingMember?.user?.email || editingMember?.principalId}.
            </DialogDescription>
          </DialogHeader>
          {editingMember && (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Organization role</span>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    value={draftRole ?? ""}
                    onChange={(event) =>
                      setDraftRole((event.target.value || null) as CompanyMember["membershipRole"])
                    }
                  >
                    <option value="">Unset</option>
                    {Object.entries(HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium">Membership status</span>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                    value={draftStatus}
                    onChange={(event) =>
                      setDraftStatus(event.target.value as EditableMemberStatus)
                    }
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMemberId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingMember) return;
                updateMemberMutation.mutate({
                  receipt: captureAccess(),
                  memberId: editingMember.id,
                  membershipRole: draftRole,
                  status: draftStatus,
                });
              }}
              disabled={updateMemberMutation.isPending}
            >
              {updateMemberMutation.isPending ? "Saving…" : "Save member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!securitySuspendingMember} onOpenChange={(open) => {
        if (!open) {
          setSecuritySuspendingMemberId(null);
          setSecuritySuspensionReason("");
        }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("companyAccess.securitySuspension.title")}</DialogTitle>
            <DialogDescription>
              {t("companyAccess.securitySuspension.description", { name: memberDisplayName(securitySuspendingMember) })}
            </DialogDescription>
          </DialogHeader>
          {securitySuspendingMember ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
                {t("companyAccess.securitySuspension.ownerWarning")}
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium">{t("companyAccess.securitySuspension.reasonLabel")}</span>
                <select
                  aria-label={t("companyAccess.securitySuspension.reasonLabel")}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  value={securitySuspensionReason}
                  onChange={(event) => setSecuritySuspensionReason(event.target.value as SecuritySuspensionReasonCode | "")}
                >
                  <option value="">{t("companyAccess.securitySuspension.chooseReason")}</option>
                  <option value="suspected_compromise">{t("companyAccess.securitySuspension.reasons.suspectedCompromise")}</option>
                  <option value="reported_loss">{t("companyAccess.securitySuspension.reasons.reportedLoss")}</option>
                  <option value="policy_violation">{t("companyAccess.securitySuspension.reasons.policyViolation")}</option>
                  <option value="other">{t("companyAccess.securitySuspension.reasons.other")}</option>
                </select>
              </label>
              <p className="text-sm text-muted-foreground">{t("companyAccess.securitySuspension.recentAuthNote")}</p>
              {!securitySuspendReady ? (
                <p role="status" className="text-sm text-destructive">{t("companyAccess.securitySuspension.currentSessionRequired")}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSecuritySuspendingMemberId(null);
                setSecuritySuspensionReason("");
              }}
            >
              {t("companyAccess.securitySuspension.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!securitySuspendReady || !securitySuspensionReason || securitySuspendMemberMutation.isPending}
              onClick={() => {
                if (!securitySuspendingMember || !securitySuspensionReason || !securitySuspendReady) return;
                securitySuspendMemberMutation.mutate({
                  receipt: captureAccess(),
                  memberId: securitySuspendingMember.id,
                  reasonCode: securitySuspensionReason,
                });
              }}
            >
              {securitySuspendMemberMutation.isPending
                ? t("companyAccess.securitySuspension.pending")
                : t("companyAccess.securitySuspension.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removingMember} onOpenChange={(open) => {
        if (!open) {
          setRemovingMemberId(null);
          setReassignmentTarget("__unassigned");
          setRoutineResponsibleTarget("__unassigned");
        }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Archive {memberDisplayName(removingMember)} and revoke access. Active routines without a replacement will be paused and left for an authorized owner to resolve.
            </DialogDescription>
          </DialogHeader>
          {removingMember && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border px-3 py-3">
                <div className="text-sm font-medium">{memberDisplayName(removingMember)}</div>
                <div className="text-sm text-muted-foreground">{removingMember.user?.email || removingMember.principalId}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {assignedIssuesQuery.isLoading
                    ? "Checking assigned tasks..."
                    : `${assignedIssues.length} open assigned task${assignedIssues.length === 1 ? "" : "s"}`}
                </div>
              </div>

              {assignedIssues.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Task reassignment</div>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={reassignmentTarget}
                    onChange={(event) => setReassignmentTarget(event.target.value)}
                  >
                    <option value="__unassigned">Leave unassigned</option>
                    {activeReassignmentUsers.length > 0 ? (
                      <optgroup label="Humans">
                        {activeReassignmentUsers.map((member) => (
                          <option key={member.id} value={`user:${member.principalId}`}>
                            {memberDisplayName(member)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {activeReassignmentAgents.length > 0 ? (
                      <optgroup label="Agents">
                        {activeReassignmentAgents.map((agent) => (
                          <option key={agent.id} value={`agent:${agent.id}`}>
                            {agent.name} ({agent.role})
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  <div className="max-h-36 overflow-auto rounded-lg border border-border">
                    {assignedIssues.slice(0, 6).map((issue) => (
                      <div key={issue.id} className="border-b border-border px-3 py-2 text-sm last:border-b-0">
                        <div className="font-medium">{issue.identifier ?? issue.id.slice(0, 8)}</div>
                        <div className="truncate text-muted-foreground">{issue.title}</div>
                      </div>
                    ))}
                    {assignedIssues.length > 6 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {assignedIssues.length - 6} more task{assignedIssues.length - 6 === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {ownedRoutines.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Routine responsibility</div>
                  <div className="text-sm text-muted-foreground">
                    {ownedRoutines.length} active or paused routine{ownedRoutines.length === 1 ? "" : "s"} have this member as responsible user. Without a replacement, active routines will be paused and remain on the owner action list.
                  </div>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={routineResponsibleTarget}
                    onChange={(event) => setRoutineResponsibleTarget(event.target.value)}
                  >
                    <option value="__unassigned">No replacement — pause and flag for owner action</option>
                    {activeReassignmentUsers.map((member) => (
                      <option key={member.id} value={`user:${member.principalId}`}>
                        {memberDisplayName(member)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {privateOwnedRoutineCount > 0 ? (
                <div className="text-sm text-destructive">
                  {privateOwnedRoutineCount} private conversation routine{privateOwnedRoutineCount === 1 ? "" : "s"} will keep their original responsible user. Active private routines will be paused; resolve the owner action through a supported private handoff.
                </div>
              ) : null}
              {routinesQuery.isError ? (
                <div className="text-sm text-destructive">Could not verify routine responsibility. Retry before removing this member.</div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setRemovingMemberId(null);
              setReassignmentTarget("__unassigned");
              setRoutineResponsibleTarget("__unassigned");
            }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!removingMember) return;
                archiveMemberMutation.mutate({
                  receipt: captureAccess(),
                  memberId: removingMember.id,
                  target: reassignmentTarget,
                  routineTarget: routineResponsibleTarget,
                });
              }}
              disabled={archiveMemberMutation.isPending || assignedIssuesQuery.isLoading || routinesQuery.isLoading || routinesQuery.isError}
            >
              {archiveMemberMutation.isPending ? "Removing..." : "Remove member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>
        {!hideInvitesTab && (
          <TabsContent value="invites">
            <InvitesSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export function CompanyAccessLegacyRoute() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { slots, isLoading, errorMessage } = usePluginSlots({
    slotTypes: ["companySettingsPage"],
    companyId: selectedCompanyId,
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Access" },
    ]);
  }, [setBreadcrumbs]);

  const permissionsSlot = slots.find((slot) => slot.routePath === "permissions");
  if (permissionsSlot) {
    return <Navigate to="/company/settings/permissions" replace />;
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Checking for advanced permission extensions...</div>;
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Advanced Permissions</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Advanced access, scoped assignment, and explicit grant controls are provided by installed organization settings extensions.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border px-5 py-5">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Advanced permissions unavailable</h2>
          <p className="text-sm text-muted-foreground">
            Core {PRODUCT_IDENTITY.productName} keeps enforcing organization boundaries and any existing restrictive policy data, but editing advanced permissions requires an installed extension.
          </p>
          {errorMessage ? (
            <p className="text-sm text-destructive">Plugin extensions unavailable: {errorMessage}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/company/settings/members">Open Members</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/company/settings/members?tab=invites">Open Invites</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function memberDisplayName(member: CompanyMember | null) {
  if (!member) return "this member";
  return member.user?.name?.trim() || member.user?.email || member.principalId;
}

function memberInitials(member: CompanyMember) {
  const value = memberDisplayName(member).trim();
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

function isAssignableAgent(agent: Agent) {
  return agent.status !== "terminated" && agent.status !== "pending_approval";
}

function isEditableMemberStatus(status: CompanyMember["status"]): status is EditableMemberStatus {
  return status === "pending" || status === "active" || status === "suspended";
}

function PendingJoinRequestCard({
  title,
  subtitle,
  context,
  detail,
  detailSecondary,
  approveLabel,
  rejectLabel,
  disabled,
  onApprove,
  onReject,
}: {
  title: string;
  subtitle: string;
  context: string;
  detail: string;
  detailSecondary?: string;
  approveLabel: string;
  rejectLabel: string;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div>
            <div className="font-medium">{title}</div>
            <div className="text-sm text-muted-foreground">{subtitle}</div>
          </div>
          <div className="text-sm text-muted-foreground">{context}</div>
          <div className="text-sm text-muted-foreground">{detail}</div>
          {detailSecondary ? <div className="text-sm text-muted-foreground">{detailSecondary}</div> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onReject} disabled={disabled}>
            {rejectLabel}
          </Button>
          <Button type="button" onClick={onApprove} disabled={disabled}>
            {approveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
