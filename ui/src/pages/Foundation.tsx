import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FOUNDATION_CATEGORIES,
  type FoundationCategory,
  type FoundationChangeProposal,
  type FoundationDocument,
  type FoundationDocumentStatus,
  type FoundationSensitivity,
} from "@paperclipai/shared";
import {
  BookOpen,
  Check,
  FileText,
  History,
  Lightbulb,
  Pencil,
  Plus,
  Search as SearchIcon,
  ShieldCheck,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "@/lib/router";
import { foundationApi, type FoundationRevision } from "@/api/foundation";
import { agentsApi } from "@/api/agents";
import { accessApi } from "@/api/access";
import { ApiError } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownBody } from "@/components/MarkdownBody";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";

export const FOUNDATION_CATEGORY_LABELS: Record<FoundationCategory, string> = {
  company: "Company",
  business_model: "Business Model",
  market_customer: "Market & Customer",
  products_services: "Products",
  brand: "Brand",
  strategy: "Strategy",
  organization_leadership: "Organization",
  operating_model: "Operating Model",
  governance: "Governance",
};

const STATUS_LABELS: Record<FoundationDocumentStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  superseded: "Superseded",
  archived: "Archived",
};

type WorkspaceTab = "document" | "revisions" | "proposals";
type DocumentMode = "working" | "approved";

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: Date | string | null | undefined) {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";
}

function statusClass(status: FoundationDocumentStatus) {
  if (status === "approved") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "in_review") return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  if (status === "archived" || status === "superseded") return "text-muted-foreground";
  return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function sensitivityLabel(value: FoundationSensitivity) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ownerLabel(
  document: FoundationDocument,
  users: Map<string, string>,
  agents: Map<string, string>,
) {
  if (document.ownerUserId) return users.get(document.ownerUserId) ?? "Human owner";
  if (document.ownerAgentId) return agents.get(document.ownerAgentId) ?? "Agent owner";
  return "Unassigned";
}

function mutationMessage(error: unknown) {
  if (error instanceof ApiError) {
    const code = (error.body as { code?: string } | null)?.code;
    if (code === "revision_conflict") {
      return "This document changed elsewhere. Your edits are preserved; reload the latest revision before saving.";
    }
  }
  return error instanceof Error ? error.message : "The Foundation change could not be saved.";
}

function useFoundationInvalidation(companyId: string | null, foundationDocumentId?: string) {
  const queryClient = useQueryClient();
  return async () => {
    if (!companyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.foundation.list(companyId) }),
      queryClient.invalidateQueries({ queryKey: ["foundation", companyId, "search"] }),
      ...(foundationDocumentId
        ? [
            queryClient.invalidateQueries({
              queryKey: queryKeys.foundation.detail(companyId, foundationDocumentId),
            }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.foundation.revisions(companyId, foundationDocumentId),
            }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.foundation.proposals(companyId, foundationDocumentId),
            }),
          ]
        : []),
    ]);
  };
}

export function Foundation() {
  const { selectedCompanyId } = useCompany();
  const { foundationDocumentId } = useParams();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<FoundationCategory>("company");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Foundation", href: "/foundation" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: queryKeys.foundation.list(selectedCompanyId!),
    queryFn: () => foundationApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.foundation.detail(selectedCompanyId!, foundationDocumentId ?? ""),
    queryFn: () => foundationApi.get(selectedCompanyId!, foundationDocumentId!),
    enabled: !!selectedCompanyId && !!foundationDocumentId,
  });

  const searchQuery = useQuery({
    queryKey: queryKeys.foundation.search(selectedCompanyId!, search.trim(), "approved"),
    queryFn: () => foundationApi.search(selectedCompanyId!, {
      q: search.trim(),
      scope: "approved",
      limit: 20,
    }),
    enabled: !!selectedCompanyId && search.trim().length >= 2,
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const userNames = useMemo(
    () => new Map((usersQuery.data?.users ?? []).map((entry) => [
      entry.principalId,
      entry.user?.name ?? entry.user?.email ?? "Member",
    ])),
    [usersQuery.data?.users],
  );
  const agentNames = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent.name])),
    [agentsQuery.data],
  );

  const documents = listQuery.data ?? [];
  const categoryCounts = useMemo(() => {
    const counts = new Map<FoundationCategory, number>();
    for (const item of documents) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return counts;
  }, [documents]);
  const categoryDocuments = documents.filter((item) => item.category === category);
  const searchDocumentIds = new Set((searchQuery.data ?? []).map((result) => result.foundationDocumentId));
  const visibleDocuments = search.trim().length >= 2
    ? documents.filter((item) => searchDocumentIds.has(item.id))
    : categoryDocuments;

  useEffect(() => {
    if (detailQuery.data && search.trim().length < 2) {
      setCategory(detailQuery.data.category);
    }
  }, [detailQuery.data?.category, detailQuery.data?.id, search]);

  useEffect(() => {
    if (!foundationDocumentId && visibleDocuments.length === 1) {
      navigate(`/foundation/${visibleDocuments[0]!.id}`, { replace: true });
    }
  }, [foundationDocumentId, navigate, visibleDocuments]);

  if (!selectedCompanyId) {
    return <EmptyState icon={BookOpen} message="Select a company to open its Foundation." />;
  }
  if (listQuery.isLoading) return <PageSkeleton />;
  if (listQuery.error) {
    return (
      <div className="p-6">
        <div className="max-w-xl border-l-2 border-destructive pl-4">
          <p className="font-medium">Foundation could not be loaded</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {listQuery.error instanceof Error ? listQuery.error.message : "Unknown error"}
          </p>
          <Button className="mt-3" variant="outline" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="w-full max-w-7xl space-y-5 px-4 py-5 md:px-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Foundation</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              The approved operating truth your people and agents can rely on.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New document
          </Button>
        </header>

        <div className="relative max-w-lg">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
          />
          <Input
            aria-label="Search approved Foundation"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search approved Foundation"
            className="pl-9"
          />
          {search.trim().length >= 2 && searchQuery.isFetching ? (
            <span aria-live="polite" className="absolute right-3 top-2.5 text-xs text-muted-foreground">
              Searching…
            </span>
          ) : null}
        </div>

        <div className="grid min-h-[560px] gap-0 border-y border-border lg:grid-cols-[190px_270px_minmax(0,1fr)]">
          <nav
            aria-label="Foundation categories"
            className="border-b border-border py-3 lg:border-b-0 lg:border-r lg:pr-3"
          >
            <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Company manual
            </p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
              {FOUNDATION_CATEGORIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-current={category === key ? "page" : undefined}
                  onClick={() => {
                    setSearch("");
                    setCategory(key);
                  }}
                  className={cn(
                    "flex min-h-9 items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    category === key
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span>{FOUNDATION_CATEGORY_LABELS[key]}</span>
                  <span className="text-xs text-muted-foreground">{categoryCounts.get(key) ?? 0}</span>
                </button>
              ))}
            </div>
          </nav>

          <section
            aria-label="Foundation documents"
            className="border-b border-border py-3 lg:border-b-0 lg:border-r lg:px-3"
          >
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {search.trim().length >= 2 ? "Search results" : FOUNDATION_CATEGORY_LABELS[category]}
              </p>
              <span className="text-xs text-muted-foreground">{visibleDocuments.length}</span>
            </div>
            {search.trim().length >= 2 && searchQuery.error ? (
              <div className="px-2 py-6">
                <p className="text-sm font-medium text-destructive">Search failed</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approved Foundation could not be searched.
                </p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => searchQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : search.trim().length >= 2 && !searchQuery.isFetching && visibleDocuments.length === 0 ? (
              <p className="px-2 py-8 text-sm text-muted-foreground">No approved Foundation matches.</p>
            ) : visibleDocuments.length === 0 ? (
              <div className="px-2 py-8">
                <p className="text-sm font-medium">Nothing here yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add only the company knowledge this category actually needs.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {visibleDocuments.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(`/foundation/${item.id}`)}
                    className={cn(
                      "w-full rounded-md px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      foundationDocumentId === item.id ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {item.title?.trim() || item.foundationKey}
                      </span>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", statusClass(item.status))}>
                        {STATUS_LABELS[item.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {ownerLabel(item, userNames, agentNames)} · {sensitivityLabel(item.sensitivity)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <main className="min-w-0 py-4 lg:pl-5">
            {!foundationDocumentId ? (
              <div className="flex min-h-[440px] items-center justify-center">
                <EmptyState
                  icon={FileText}
                  message="Choose a Foundation document to read or update."
                />
              </div>
            ) : detailQuery.isLoading ? (
              <PageSkeleton />
            ) : detailQuery.error ? (
              <div className="border-l-2 border-destructive pl-4">
                <p className="font-medium">Document could not be loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detailQuery.error instanceof Error ? detailQuery.error.message : "Unknown error"}
                </p>
                <Button className="mt-3" variant="outline" onClick={() => detailQuery.refetch()}>
                  Retry
                </Button>
              </div>
            ) : detailQuery.data ? (
              <FoundationDocumentWorkspace
                companyId={selectedCompanyId}
                document={detailQuery.data}
                users={usersQuery.data?.users ?? []}
                agents={agentsQuery.data ?? []}
                userNames={userNames}
                agentNames={agentNames}
              />
            ) : null}
          </main>
        </div>
      </div>

      <CreateFoundationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={selectedCompanyId}
        initialCategory={category}
        onCreated={async (document) => {
          await queryClient.invalidateQueries({ queryKey: queryKeys.foundation.list(selectedCompanyId) });
          setCreateOpen(false);
          navigate(`/foundation/${document.id}`);
          pushToast({ title: "Foundation document created", tone: "success" });
        }}
      />
    </div>
  );
}

function FoundationDocumentWorkspace({
  companyId,
  document,
  users,
  agents,
  userNames,
  agentNames,
}: {
  companyId: string;
  document: FoundationDocument;
  users: Array<{ principalId: string; user: { name: string | null; email: string | null } | null }>;
  agents: Array<{ id: string; name: string }>;
  userNames: Map<string, string>;
  agentNames: Map<string, string>;
}) {
  const { pushToast } = useToastActions();
  const invalidate = useFoundationInvalidation(companyId, document.id);
  const [tab, setTab] = useState<WorkspaceTab>("document");
  const [mode, setMode] = useState<DocumentMode>(
    () => document.approvedRevisionId ? "approved" : "working",
  );
  const [editing, setEditing] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [edit, setEdit] = useState(() => makeEditState(document));
  const editIsStale =
    editing &&
    Boolean(document.latestRevisionId) &&
    edit.baseRevisionId !== document.latestRevisionId;

  const displayedGovernance =
    mode === "approved" && document.canonicalGovernance
      ? document.canonicalGovernance
      : {
          category: document.category,
          documentType: document.documentType,
          authorityLevel: document.authorityLevel,
          sensitivity: document.sensitivity,
          ownerUserId: document.ownerUserId,
          ownerAgentId: document.ownerAgentId,
          reviewFrequencyDays: document.reviewFrequencyDays,
          validFrom: document.validFrom,
          validUntil: document.validUntil,
        };
  const displayedOwner = displayedGovernance.ownerUserId
    ? userNames.get(displayedGovernance.ownerUserId) ?? "Human owner"
    : displayedGovernance.ownerAgentId
      ? agentNames.get(displayedGovernance.ownerAgentId) ?? "Agent owner"
      : "Unassigned";

  useEffect(() => {
    setEditing(false);
    setEdit(makeEditState(document));
    setSelectedRevisionId(null);
    setMode(document.approvedRevisionId ? "approved" : "working");
  }, [document.approvedRevisionId, document.id]);

  useEffect(() => {
    if (!editing) setEdit(makeEditState(document));
  }, [document, editing]);

  const revisionsQuery = useQuery({
    queryKey: queryKeys.foundation.revisions(companyId, document.id),
    queryFn: () => foundationApi.revisions(companyId, document.id),
    enabled: tab === "revisions",
  });
  const proposalsQuery = useQuery({
    queryKey: queryKeys.foundation.proposals(companyId, document.id),
    queryFn: () => foundationApi.listProposals(companyId, document.id),
    enabled: tab === "proposals",
  });

  const fail = async (title: string, error: unknown) => {
    pushToast({ title, body: mutationMessage(error), tone: "error" });
    if (error instanceof ApiError && (error.body as { code?: string } | null)?.code === "revision_conflict") {
      await invalidate();
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!edit.baseRevisionId) throw new Error("This document has no working revision.");
      if (editIsStale) throw new Error("Reload the latest revision before saving this draft.");
      const reviewDays = edit.reviewFrequencyDays.trim()
        ? Number.parseInt(edit.reviewFrequencyDays, 10)
        : null;
      if (reviewDays !== null && (!Number.isFinite(reviewDays) || reviewDays <= 0)) {
        throw new Error("Review frequency must be a positive number of days.");
      }
      const owner = parseOwner(edit.owner);
      return foundationApi.updateDraft(companyId, document.id, {
        baseRevisionId: edit.baseRevisionId,
        title: edit.title.trim() || null,
        body: edit.body,
        category: edit.category,
        documentType: edit.documentType.trim() || "general",
        sensitivity: edit.sensitivity,
        reviewFrequencyDays: reviewDays,
        ownerUserId: owner.userId,
        ownerAgentId: owner.agentId,
        changeSummary: edit.changeSummary.trim() || null,
      });
    },
    onSuccess: async () => {
      setEditing(false);
      setMode("working");
      await invalidate();
      pushToast({ title: "Draft saved", tone: "success" });
    },
    onError: (error) => void fail("Could not save draft", error),
  });

  const transition = (kind: "submit" | "approve" | "reject") => {
    if (!document.latestRevisionId) return;
    const call =
      kind === "submit"
        ? foundationApi.submitForReview
        : kind === "approve"
          ? foundationApi.approve
          : foundationApi.rejectReview;
    return call(companyId, document.id, document.latestRevisionId);
  };

  const transitionMutation = useMutation({
    mutationFn: transition,
    onSuccess: async (_result, kind) => {
      await invalidate();
      setMode(kind === "approve" ? "approved" : "working");
      pushToast({
        title: kind === "approve" ? "Foundation approved" : kind === "reject" ? "Review rejected" : "Sent for review",
        tone: "success",
      });
    },
    onError: (error) => void fail("Could not update review state", error),
  });

  const approveProposal = useMutation({
    mutationFn: (proposalId: string) => foundationApi.acceptProposal(companyId, document.id, proposalId),
    onSuccess: async () => {
      await invalidate();
      setMode("working");
      pushToast({ title: "Proposal accepted into draft", tone: "success" });
    },
    onError: (error) => void fail("Could not accept proposal", error),
  });

  const rejectProposal = useMutation({
    mutationFn: (proposalId: string) => foundationApi.rejectProposal(companyId, document.id, proposalId),
    onSuccess: async () => {
      await invalidate();
      pushToast({ title: "Proposal rejected", tone: "success" });
    },
    onError: (error) => void fail("Could not reject proposal", error),
  });

  const selectedRevision =
    revisionsQuery.data?.find((revision) => revision.id === selectedRevisionId)
    ?? revisionsQuery.data?.[0]
    ?? null;

  const displayBody = mode === "approved"
    ? document.canonicalRevision?.body ?? ""
    : document.body;
  const displayTitle = mode === "approved"
    ? document.canonicalRevision?.title ?? document.title
    : document.title;
  const canEdit = !["in_review", "archived", "superseded"].includes(document.status);

  return (
    <div className="space-y-5" data-testid="foundation-document-workspace">
      <header className="space-y-3 border-b border-border pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">
                {document.title?.trim() || document.foundationKey}
              </h2>
              <Badge variant="outline" className={cn(statusClass(document.status))}>
                {STATUS_LABELS[document.status]}
              </Badge>
              <Badge variant="outline">{sensitivityLabel(displayedGovernance.sensitivity)}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {FOUNDATION_CATEGORY_LABELS[displayedGovernance.category]} · {document.foundationKey}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTab("document");
                  setMode("working");
                  setEdit(makeEditState(document));
                  setEditing(true);
                }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit draft
              </Button>
            ) : null}
            {document.status === "draft" ? (
              <Button
                size="sm"
                disabled={transitionMutation.isPending}
                onClick={() => transitionMutation.mutate("submit")}
              >
                Send for review
              </Button>
            ) : null}
            {document.status === "in_review" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={transitionMutation.isPending}
                  onClick={() => transitionMutation.mutate("reject")}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={transitionMutation.isPending}
                  onClick={() => transitionMutation.mutate("approve")}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>Owner: {displayedOwner}</span>
          <span>Last approved: {formatDate(document.canonicalRevision?.createdAt)}</span>
          <span>Next review: {formatDate(document.nextReviewAt)}</span>
          <span>Working rev: {document.latestRevisionNumber}</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border p-0.5" aria-label="Foundation view">
          <button
            type="button"
            aria-pressed={mode === "working"}
            onClick={() => setMode("working")}
            className={cn(
              "rounded px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === "working" ? "bg-accent text-foreground" : "text-muted-foreground",
            )}
          >
            Working
          </button>
          <button
            type="button"
            aria-pressed={mode === "approved"}
            disabled={!document.canonicalRevision}
            onClick={() => setMode("approved")}
            className={cn(
              "rounded px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
              mode === "approved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
            )}
          >
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
            Approved truth
          </button>
        </div>

        <div className="flex items-center gap-1" role="tablist" aria-label="Foundation document sections">
          {([
            ["document", FileText, "Document"],
            ["revisions", History, "Revisions"],
            ["proposals", Lightbulb, "Proposals"],
          ] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="mr-1 inline h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "document" ? (
        editing ? (
          <FoundationEditor
            state={edit}
            setState={setEdit}
            users={users}
            agents={agents}
            onCancel={() => {
              setEdit(makeEditState(document));
              setEditing(false);
            }}
            onSave={() => saveMutation.mutate()}
            onReloadLatest={() => setEdit(makeEditState(document))}
            saving={saveMutation.isPending}
            stale={editIsStale}
          />
        ) : mode === "approved" && !document.canonicalRevision ? (
          <div className="border-l-2 border-amber-500 pl-4 py-2">
            <p className="text-sm font-medium">No approved version yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The working draft does not become agent-ready company truth until it is approved.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {mode === "working" && document.canonicalRevision && document.approvedRevisionId !== document.latestRevisionId ? (
              <div className="border-l-2 border-blue-500 pl-3 text-xs text-muted-foreground">
                You are viewing a working revision. Agents using approved Foundation still receive the approved truth.
              </div>
            ) : null}
            <article className="min-w-0 py-1">
              {displayTitle && displayTitle !== document.title ? (
                <h3 className="mb-3 text-base font-semibold">{displayTitle}</h3>
              ) : null}
              {displayBody.trim() ? (
                <MarkdownBody>{displayBody}</MarkdownBody>
              ) : (
                <p className="text-sm text-muted-foreground">This document is empty.</p>
              )}
            </article>
          </div>
        )
      ) : tab === "revisions" ? (
        <RevisionPanel
          revisions={revisionsQuery.data ?? []}
          selected={selectedRevision}
          loading={revisionsQuery.isLoading}
          error={revisionsQuery.error}
          onRetry={() => revisionsQuery.refetch()}
          onSelect={setSelectedRevisionId}
        />
      ) : (
        <ProposalPanel
          document={document}
          proposals={proposalsQuery.data ?? []}
          loading={proposalsQuery.isLoading}
          error={proposalsQuery.error}
          onRetry={() => proposalsQuery.refetch()}
          onCreate={() => setProposalOpen(true)}
          onAccept={(id) => approveProposal.mutate(id)}
          onReject={(id) => rejectProposal.mutate(id)}
          pending={approveProposal.isPending || rejectProposal.isPending}
        />
      )}

      <ProposalDialog
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        companyId={companyId}
        document={document}
        onCreated={async () => {
          setProposalOpen(false);
          await invalidate();
          setTab("proposals");
          pushToast({ title: "Proposal created", tone: "success" });
        }}
      />
    </div>
  );
}

function makeEditState(document: FoundationDocument) {
  const owner = document.ownerUserId
    ? `user:${document.ownerUserId}`
    : document.ownerAgentId
      ? `agent:${document.ownerAgentId}`
      : "";
  return {
    baseRevisionId: document.latestRevisionId,
    title: document.title ?? "",
    body: document.body,
    category: document.category,
    documentType: document.documentType,
    sensitivity: document.sensitivity,
    owner,
    reviewFrequencyDays: document.reviewFrequencyDays?.toString() ?? "",
    changeSummary: "",
  };
}

function parseOwner(value: string) {
  if (value.startsWith("user:")) return { userId: value.slice(5), agentId: null };
  if (value.startsWith("agent:")) return { userId: null, agentId: value.slice(6) };
  return { userId: null, agentId: null };
}

function FoundationEditor({
  state,
  setState,
  users,
  agents,
  onCancel,
  onSave,
  onReloadLatest,
  saving,
  stale,
}: {
  state: ReturnType<typeof makeEditState>;
  setState: (next: ReturnType<typeof makeEditState>) => void;
  users: Array<{ principalId: string; user: { name: string | null; email: string | null } | null }>;
  agents: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSave: () => void;
  onReloadLatest: () => void;
  saving: boolean;
  stale: boolean;
}) {
  return (
    <section aria-label="Edit Foundation draft" className="space-y-4">
      {stale ? (
        <div role="alert" className="border-l-2 border-amber-500 pl-3">
          <p className="text-sm font-medium">A newer revision exists</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your edits are still here. Reload the latest revision before saving so another person's changes are not overwritten.
          </p>
          <Button className="mt-2" size="sm" variant="outline" onClick={onReloadLatest}>
            Reload latest revision
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Title
          <Input
            value={state.title}
            onChange={(event) => setState({ ...state, title: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Category
          <select
            value={state.category}
            onChange={(event) => setState({ ...state, category: event.target.value as FoundationCategory })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FOUNDATION_CATEGORIES.map((key) => (
              <option key={key} value={key}>{FOUNDATION_CATEGORY_LABELS[key]}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Document type
          <Input
            value={state.documentType}
            onChange={(event) => setState({ ...state, documentType: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Sensitivity
          <select
            value={state.sensitivity}
            onChange={(event) => setState({ ...state, sensitivity: event.target.value as FoundationSensitivity })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(["public", "internal", "confidential", "restricted"] as const).map((value) => (
              <option key={value} value={value}>{sensitivityLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Owner
          <select
            value={state.owner}
            onChange={(event) => setState({ ...state, owner: event.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Unassigned</option>
            <optgroup label="People">
              {users.map((entry) => (
                <option key={entry.principalId} value={`user:${entry.principalId}`}>
                  {entry.user?.name ?? entry.user?.email ?? "Member"}
                </option>
              ))}
            </optgroup>
            <optgroup label="Agents">
              {agents.filter((agent) => agent.id).map((agent) => (
                <option key={agent.id} value={`agent:${agent.id}`}>{agent.name}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Review every (days)
          <Input
            inputMode="numeric"
            value={state.reviewFrequencyDays}
            onChange={(event) => setState({ ...state, reviewFrequencyDays: event.target.value })}
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium">Working content</p>
        <MarkdownEditor
          value={state.body}
          onChange={(body) => setState({ ...state, body })}
          placeholder="Write the company truth in clear Markdown…"
          bordered
          contentClassName="min-h-[320px]"
        />
      </div>

      <label className="block space-y-1 text-xs font-medium">
        Change summary
        <Input
          value={state.changeSummary}
          onChange={(event) => setState({ ...state, changeSummary: event.target.value })}
          placeholder="What changed and why?"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={onSave} disabled={saving || stale}>{saving ? "Saving…" : "Save draft"}</Button>
      </div>
    </section>
  );
}

function RevisionPanel({
  revisions,
  selected,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  revisions: FoundationRevision[];
  selected: FoundationRevision | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (id: string) => void;
}) {
  if (loading) return <p aria-live="polite" className="text-sm text-muted-foreground">Loading revisions…</p>;
  if (error) {
    return (
      <div className="border-l-2 border-destructive pl-3">
        <p className="text-sm font-medium text-destructive">Revisions could not be loaded.</p>
        <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (revisions.length === 0) return <p className="text-sm text-muted-foreground">No revisions yet.</p>;

  return (
    <div className="grid gap-5 md:grid-cols-[170px_minmax(0,1fr)]">
      <div className="space-y-1">
        {revisions.map((revision) => (
          <button
            key={revision.id}
            type="button"
            onClick={() => onSelect(revision.id)}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected?.id === revision.id ? "bg-accent" : "border-border/70 hover:bg-accent/40",
            )}
          >
            <p className="text-sm font-medium">Revision {revision.revisionNumber}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(revision.createdAt)}</p>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="min-w-0">
          <div className="mb-3 border-b border-border pb-3">
            <p className="text-sm font-medium">
              {selected.title?.trim() || `Revision ${selected.revisionNumber}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {selected.changeSummary || "No change summary"}
            </p>
          </div>
          <MarkdownBody>{selected.body}</MarkdownBody>
        </div>
      ) : null}
    </div>
  );
}

function ProposalPanel({
  document,
  proposals,
  loading,
  error,
  onRetry,
  onCreate,
  onAccept,
  onReject,
  pending,
}: {
  document: FoundationDocument;
  proposals: FoundationChangeProposal[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onCreate: () => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  pending: boolean;
}) {
  return (
    <section aria-label="Foundation proposals" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Proposed changes</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Suggestions become a working draft first. Approval is still a separate step.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onCreate}>
          <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
          Propose change
        </Button>
      </div>
      {loading ? <p aria-live="polite" className="text-sm text-muted-foreground">Loading proposals…</p> : null}
      {error ? (
        <div className="border-l-2 border-destructive pl-3">
          <p className="text-sm font-medium text-destructive">Proposals could not be loaded.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        </div>
      ) : null}
      {!loading && !error && proposals.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No proposals for this document.</p>
      ) : null}
      <div className="divide-y divide-border">
        {proposals.map((proposal) => (
          <article key={proposal.id} className="space-y-3 py-4 first:pt-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{proposal.status}</Badge>
                  <span className="text-xs text-muted-foreground">{proposal.sourceType}</span>
                </div>
                {proposal.changeSummary ? (
                  <p className="mt-2 text-sm font-medium">{proposal.changeSummary}</p>
                ) : null}
                {proposal.reason ? (
                  <p className="mt-1 text-xs text-muted-foreground">{proposal.reason}</p>
                ) : null}
              </div>
              {proposal.status === "pending" && document.status !== "in_review" ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => onReject(proposal.id)}>
                    Reject
                  </Button>
                  <Button size="sm" disabled={pending} onClick={() => onAccept(proposal.id)}>
                    Accept into draft
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="max-h-64 overflow-auto border-l border-border pl-3">
              <MarkdownBody>{proposal.proposedBody}</MarkdownBody>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CreateFoundationDialog({
  open,
  onOpenChange,
  companyId,
  initialCategory,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  initialCategory: FoundationCategory;
  onCreated: (document: FoundationDocument) => Promise<void>;
}) {
  const { pushToast } = useToastActions();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<FoundationCategory>(initialCategory);
  const [documentType, setDocumentType] = useState("general");

  useEffect(() => {
    if (open) setCategory(initialCategory);
  }, [initialCategory, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const foundationKey = (title.trim() || documentType.trim() || "foundation")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || "foundation";
      return foundationApi.create(companyId, {
        foundationKey,
        title: title.trim() || null,
        body,
        category,
        documentType: documentType.trim() || "general",
      });
    },
    onSuccess: async (document) => {
      setTitle("");
      setBody("");
      setDocumentType("general");
      await onCreated(document);
    },
    onError: (error) => {
      pushToast({ title: "Could not create Foundation document", body: mutationMessage(error), tone: "error" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Foundation document</DialogTitle>
          <DialogDescription>
            Add durable company knowledge only when it should become part of the operating manual.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as FoundationCategory)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {FOUNDATION_CATEGORIES.map((key) => (
                <option key={key} value={key}>{FOUNDATION_CATEGORY_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Document type
            <Input value={documentType} onChange={(event) => setDocumentType(event.target.value)} />
          </label>
        </div>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          placeholder="Write the first draft…"
          bordered
          contentClassName="min-h-[240px]"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !title.trim()}>
            {mutation.isPending ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProposalDialog({
  open,
  onOpenChange,
  companyId,
  document,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  document: FoundationDocument;
  onCreated: () => Promise<void>;
}) {
  const { pushToast } = useToastActions();
  const [body, setBody] = useState(document.body);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setBody(document.body);
      setSummary("");
      setReason("");
    }
  }, [document.body, open]);

  const mutation = useMutation({
    mutationFn: () => foundationApi.createProposal(companyId, document.id, {
      sourceType: "user",
      baseRevisionId: document.latestRevisionId,
      proposedBody: body,
      changeSummary: summary.trim() || null,
      reason: reason.trim() || null,
    }),
    onSuccess: onCreated,
    onError: (error) => {
      pushToast({ title: "Could not create proposal", body: mutationMessage(error), tone: "error" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Propose a Foundation change</DialogTitle>
          <DialogDescription>
            This creates a reviewable suggestion. It does not change approved company truth.
          </DialogDescription>
        </DialogHeader>
        <MarkdownEditor
          value={body}
          onChange={setBody}
          bordered
          contentClassName="min-h-[260px]"
        />
        <Input
          aria-label="Proposal summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Change summary"
        />
        <Input
          aria-label="Proposal reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why should this change?"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || body === document.body}>
            {mutation.isPending ? "Creating…" : "Create proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
