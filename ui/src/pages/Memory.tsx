import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Check,
  ChevronLeft,
  Database,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  MEMORY_TYPES,
  type MemoryCorrectionInput,
  type MemoryEvidence,
  type MemoryRecord,
  type MemoryReviewState,
  type MemoryType,
} from "@paperclipai/shared";
import { memoryApi } from "@/api/memory";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { useNavigate, useParams } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
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
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";

const REVIEW_TABS: Array<{ value: MemoryReviewState; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
];

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function titleFor(record: MemoryRecord) {
  return record.title?.trim() || record.summary?.trim() || record.content.slice(0, 80);
}

function scopeLabel(record: MemoryRecord) {
  if (record.scopeType === "company") return "Company";
  return `${record.scopeType} · ${record.scopeId ?? "—"}`;
}

function evidenceHref(item: MemoryEvidence) {
  const value = item.citationJson?.href;
  return typeof value === "string" ? value : null;
}

function statusTone(record: MemoryRecord) {
  if (record.revokedAt) return "Revoked";
  if (record.supersededByRecordId) return "Superseded";
  return record.reviewState;
}

export function Memory() {
  const { selectedCompanyId } = useCompany();
  const { recordId } = useParams();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();

  const [reviewState, setReviewState] = useState<MemoryReviewState>("pending");
  const [memoryType, setMemoryType] = useState<MemoryType | "all">("all");
  const [decision, setDecision] = useState<"reject" | "revoke" | null>(null);
  const [reason, setReason] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionContent, setCorrectionContent] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [bindingsOpen, setBindingsOpen] = useState(false);
  const [bindingKey, setBindingKey] = useState("");
  const [bindingName, setBindingName] = useState("");
  const [bindingProvider, setBindingProvider] = useState("local");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Memory", href: "/memory" },
      ...(recordId ? [{ label: "Record" }] : []),
    ]);
  }, [recordId, setBreadcrumbs]);

  const listKey = queryKeys.memory.list(
    selectedCompanyId!,
    reviewState,
    memoryType === "all" ? null : memoryType,
  );
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () =>
      memoryApi.listRecords(selectedCompanyId!, {
        reviewState,
        ...(memoryType === "all" ? {} : { memoryType }),
        limit: 100,
      }),
    enabled: !!selectedCompanyId && !recordId,
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.memory.detail(selectedCompanyId!, recordId ?? ""),
    queryFn: () => memoryApi.getRecord(selectedCompanyId!, recordId!),
    enabled: !!selectedCompanyId && !!recordId,
  });

  const bindingsQuery = useQuery({
    queryKey: queryKeys.memory.bindings(selectedCompanyId!),
    queryFn: () => memoryApi.listBindings(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const invalidateMemory = async () => {
    if (!selectedCompanyId) return;
    await queryClient.invalidateQueries({ queryKey: ["memory", selectedCompanyId] });
  };

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !recordId) throw new Error("Memory record is unavailable.");
      return memoryApi.accept(selectedCompanyId, recordId);
    },
    onSuccess: async () => {
      await invalidateMemory();
      pushToast({ title: "Memory accepted", tone: "success" });
    },
    onError: (error) => pushToast({
      title: "Could not accept memory",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    }),
  });

  const decisionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !recordId || !decision) {
        throw new Error("Memory decision is unavailable.");
      }
      if (!reason.trim()) throw new Error("A reason is required.");
      return decision === "reject"
        ? memoryApi.reject(selectedCompanyId, recordId, reason)
        : memoryApi.revoke(selectedCompanyId, recordId, { reason: reason.trim() });
    },
    onSuccess: async () => {
      const completedDecision = decision;
      setDecision(null);
      setReason("");
      await invalidateMemory();
      pushToast({
        title: completedDecision === "reject" ? "Memory rejected" : "Memory revoked",
        tone: "success",
      });
    },
    onError: (error) => pushToast({
      title: "Memory update failed",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    }),
  });

  const correctionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId || !recordId || !detailQuery.data) {
        throw new Error("Memory record is unavailable.");
      }
      if (!correctionContent.trim() || !correctionReason.trim()) {
        throw new Error("Correction content and reason are required.");
      }
      const record = detailQuery.data.record;
      const iso = (value: Date | string | null) =>
        value ? new Date(value).toISOString() : null;
      const input: MemoryCorrectionInput = {
        memoryType: record.memoryType,
        subject:
          record.subjectType && record.subjectId
            ? { type: record.subjectType, id: record.subjectId }
            : null,
        title: record.title,
        content: correctionContent.trim(),
        summary: record.summary,
        sensitivity: record.sensitivityLabel,
        importance: record.importance,
        confidenceScore: record.confidenceScore,
        validFrom: iso(record.validFrom),
        validUntil: iso(record.validUntil),
        observedAt: new Date().toISOString(),
        retentionPolicy: record.retentionPolicy,
        expiresAt: iso(record.expiresAt),
        createdByOperationId: null,
        metadata: { correctedFromUi: true },
        evidence: detailQuery.data.evidence.map((item) => ({
          sourceClass: item.sourceClass,
          sourceProvider: item.sourceProvider,
          sourceType: item.sourceType,
          sourceRef: item.sourceRef,
          sourceVersion: item.sourceVersion,
          sourceUpdatedAt: iso(item.sourceUpdatedAt),
          observedAt: new Date(item.observedAt).toISOString(),
          excerptHash: item.excerptHash,
          citation: item.citationJson,
          trustLevel: item.trustLevel,
          relation: item.supportsOrContradicts,
        })),
        reason: correctionReason.trim(),
      };
      return memoryApi.correct(selectedCompanyId, recordId, input);
    },
    onSuccess: async (created) => {
      setCorrectionOpen(false);
      setCorrectionReason("");
      setCorrectionContent("");
      await invalidateMemory();
      pushToast({ title: "Correction sent for review", tone: "success" });
      navigate(`/memory/${created.record.id}`);
    },
    onError: (error) => pushToast({
      title: "Could not create correction",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    }),
  });

  const bindingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      const created = await memoryApi.createBinding(selectedCompanyId, {
        key: bindingKey.trim(),
        name: bindingName.trim(),
        providerKey: bindingProvider.trim(),
        config: {},
        enabled: true,
      });
      await memoryApi.addBindingTarget(selectedCompanyId, created.id, {
        targetType: "company",
        targetId: selectedCompanyId,
      });
      return created;
    },
    onSuccess: async () => {
      setBindingKey("");
      setBindingName("");
      setBindingProvider("local");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.memory.bindings(selectedCompanyId!),
      });
      pushToast({ title: "Memory binding created", tone: "success" });
    },
    onError: (error) => pushToast({
      title: "Could not create binding",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    }),
  });

  const pendingMutation =
    acceptMutation.isPending ||
    decisionMutation.isPending ||
    correctionMutation.isPending;

  if (!selectedCompanyId) {
    return <EmptyState icon={Brain} message="Select a company to open Memory." />;
  }

  if (recordId) {
    if (detailQuery.isLoading) return <PageSkeleton />;
    if (detailQuery.error || !detailQuery.data) {
      return (
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
          <div role="alert" className="border-l-2 border-destructive pl-4">
            <p className="font-medium">Memory record could not be loaded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Private agent memory is intentionally not exposed on this surface.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" onClick={() => navigate("/memory")}>
                Back to Memory
              </Button>
              <Button variant="outline" onClick={() => detailQuery.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      );
    }

    const { record, evidence } = detailQuery.data;
    const canDecide = record.reviewState === "pending";
    const canRevoke =
      record.reviewState === "accepted" && !record.revokedAt && !record.supersededByRecordId;
    const canCorrect = canRevoke;

    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6">
          <header className="border-b border-border pb-5">
            <Button variant="ghost" size="sm" onClick={() => navigate("/memory")}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Memory
            </Button>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{record.memoryType.replaceAll("_", " ")}</Badge>
                  <Badge variant="outline">{statusTone(record)}</Badge>
                  <Badge variant="outline">{record.verificationState.replaceAll("_", " ")}</Badge>
                </div>
                <h1 className="mt-3 text-xl font-semibold tracking-tight">{titleFor(record)}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {scopeLabel(record)} · observed {formatDate(record.observedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canCorrect ? (
                  <Button
                    variant="outline"
                    disabled={pendingMutation}
                    onClick={() => {
                      setCorrectionContent(record.content);
                      setCorrectionOpen(true);
                    }}
                  >
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    Correct
                  </Button>
                ) : null}
                {canRevoke ? (
                  <Button
                    variant="outline"
                    disabled={pendingMutation}
                    onClick={() => setDecision("revoke")}
                  >
                    Revoke
                  </Button>
                ) : null}
                {canDecide ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={pendingMutation}
                      onClick={() => setDecision("reject")}
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      disabled={pendingMutation}
                      onClick={() => acceptMutation.mutate()}
                    >
                      <Check className="mr-1.5 h-4 w-4" />
                      {acceptMutation.isPending ? "Accepting…" : "Accept"}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </header>

          <section aria-labelledby="memory-content-heading">
            <h2 id="memory-content-heading" className="text-sm font-semibold">
              Memory
            </h2>
            <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-6">
              {record.content}
            </div>
            {record.summary ? (
              <p className="mt-3 text-sm text-muted-foreground">{record.summary}</p>
            ) : null}
          </section>

          <section aria-labelledby="memory-governance-heading">
            <h2 id="memory-governance-heading" className="text-sm font-semibold">
              Governance
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 border-y border-border py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Sensitivity</dt>
                <dd className="mt-1 font-medium">{record.sensitivityLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className="mt-1 font-medium">{Math.round(record.confidenceScore * 100)}%</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Importance</dt>
                <dd className="mt-1 font-medium">{record.importance}/100</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valid from</dt>
                <dd className="mt-1">{formatDate(record.validFrom)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valid until</dt>
                <dd className="mt-1">{formatDate(record.validUntil)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Retention</dt>
                <dd className="mt-1">{record.retentionPolicy}</dd>
              </div>
            </dl>
            {record.revocationReason ? (
              <div role="status" className="mt-4 border-l-2 border-amber-500 pl-4 text-sm">
                <p className="font-medium">Revoked</p>
                <p className="mt-1 text-muted-foreground">{record.revocationReason}</p>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="memory-evidence-heading">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <h2 id="memory-evidence-heading" className="text-sm font-semibold">
                Evidence
              </h2>
              <span className="text-xs text-muted-foreground">{evidence.length}</span>
            </div>
            <div className="mt-3 divide-y divide-border border-y border-border">
              {evidence.map((item) => {
                const href = evidenceHref(item);
                return (
                  <div key={item.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.citationJson.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.sourceProvider} · {item.supportsOrContradicts} · {item.trustLevel}
                      </p>
                    </div>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Source <LinkIcon className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{decision === "reject" ? "Reject memory" : "Revoke memory"}</DialogTitle>
              <DialogDescription>
                {decision === "reject"
                  ? "Explain why this candidate should not become active organizational memory."
                  : "Revoked memory is immediately excluded from future eligible recall."}
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1 text-xs font-medium">
              Reason
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                autoFocus
                placeholder="What changed or why this is incorrect"
              />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision(null)} disabled={decisionMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant={decision === "revoke" ? "destructive" : "default"}
                onClick={() => decisionMutation.mutate()}
                disabled={decisionMutation.isPending || !reason.trim()}
              >
                {decisionMutation.isPending ? "Saving…" : decision === "reject" ? "Reject" : "Revoke"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Propose correction</DialogTitle>
              <DialogDescription>
                The current accepted record stays active until this correction is separately accepted.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block space-y-1 text-xs font-medium">
                Corrected memory
                <textarea
                  value={correctionContent}
                  onChange={(event) => setCorrectionContent(event.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block space-y-1 text-xs font-medium">
                Reason for correction
                <Input
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  placeholder="What evidence or fact changed?"
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCorrectionOpen(false)} disabled={correctionMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => correctionMutation.mutate()}
                disabled={
                  correctionMutation.isPending ||
                  !correctionContent.trim() ||
                  !correctionReason.trim()
                }
              >
                {correctionMutation.isPending ? "Creating…" : "Create correction"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (listQuery.isLoading) return <PageSkeleton />;

  const records = listQuery.data ?? [];
  const counts = useMemo(
    () => ({
      bindings: bindingsQuery.data?.length ?? 0,
      records: records.length,
    }),
    [bindingsQuery.data?.length, records.length],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Review evidence-backed organizational memory before it becomes reusable context.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {listQuery.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" onClick={() => setBindingsOpen(true)}>
              <Database className="mr-1.5 h-4 w-4" />
              Bindings {counts.bindings > 0 ? `(${counts.bindings})` : ""}
            </Button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Memory review state" className="flex rounded-lg border border-border p-1">
            {REVIEW_TABS.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={reviewState === tab.value}
                type="button"
                onClick={() => setReviewState(tab.value)}
                className={
                  reviewState === tab.value
                    ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-foreground"
                    : "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Type
            <select
              value={memoryType}
              onChange={(event) => setMemoryType(event.target.value as MemoryType | "all")}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All</option>
              {MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {listQuery.error ? (
          <div role="alert" className="border-l-2 border-destructive pl-4">
            <p className="font-medium">Memory could not be loaded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No memory state was changed. Retry the read.
            </p>
            <Button className="mt-3" variant="outline" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : records.length === 0 ? (
          <div className="border-y border-border py-14">
            <EmptyState
              icon={Brain}
              message={
                reviewState === "pending"
                  ? "No shared memory is waiting for review."
                  : `No ${reviewState} shared memory matches this filter.`
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {records.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => navigate(`/memory/${record.id}`)}
                className="grid w-full gap-3 px-2 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{titleFor(record)}</p>
                    <Badge variant="outline">{record.memoryType.replaceAll("_", " ")}</Badge>
                    {record.revokedAt ? <Badge variant="outline">revoked</Badge> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {record.summary || record.content}
                  </p>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                  <p>{scopeLabel(record)}</p>
                  <p className="mt-1">{formatDate(record.updatedAt)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={bindingsOpen} onOpenChange={setBindingsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Memory bindings</DialogTitle>
            <DialogDescription>
              Bindings define which governed memory provider may store organizational memory.
            </DialogDescription>
          </DialogHeader>
          {bindingsQuery.isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted" aria-label="Loading bindings" />
          ) : bindingsQuery.error ? (
            <div role="alert" className="text-sm text-destructive">
              Bindings could not be loaded.
            </div>
          ) : (
            <div className="max-h-48 divide-y divide-border overflow-y-auto border-y border-border">
              {(bindingsQuery.data ?? []).length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">No bindings configured.</p>
              ) : (
                (bindingsQuery.data ?? []).map((binding) => (
                  <div key={binding.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{binding.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {binding.key} · {binding.providerKey}
                      </p>
                    </div>
                    <Badge variant="outline">{binding.enabled ? "enabled" : "disabled"}</Badge>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-medium">
              Key
              <Input
                value={bindingKey}
                onChange={(event) => setBindingKey(event.target.value.toLowerCase())}
                placeholder="company-memory"
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              Name
              <Input
                value={bindingName}
                onChange={(event) => setBindingName(event.target.value)}
                placeholder="Company memory"
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              Provider
              <Input
                value={bindingProvider}
                onChange={(event) => setBindingProvider(event.target.value)}
                placeholder="local"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindingsOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => bindingMutation.mutate()}
              disabled={
                bindingMutation.isPending ||
                !bindingKey.trim() ||
                !bindingName.trim() ||
                !bindingProvider.trim()
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {bindingMutation.isPending ? "Creating…" : "New binding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
