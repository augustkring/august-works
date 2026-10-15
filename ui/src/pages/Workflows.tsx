import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Plus } from "lucide-react";
import { workflowsApi } from "@/api/workflows";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { useNavigate } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function Workflows() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Workflows", href: "/workflows" }]);
  }, [setBreadcrumbs]);

  const capabilitiesQuery = useQuery({
    queryKey: queryKeys.workflows.capabilities(selectedCompanyId!),
    queryFn: () => workflowsApi.capabilities(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const listQuery = useQuery({
    queryKey: queryKeys.workflows.list(selectedCompanyId!),
    queryFn: () => workflowsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      return workflowsApi.create(selectedCompanyId, {
        name: name.trim(),
        description: description.trim() || null,
        projectId: null,
      });
    },
    onSuccess: async (workflow) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.list(workflow.companyId),
      });
      setCreateOpen(false);
      setName("");
      setDescription("");
      pushToast({ title: "Workflow created", tone: "success" });
      navigate(`/workflows/${workflow.id}`);
    },
    onError: (error) => {
      pushToast({
        title: "Could not create workflow",
        body: error instanceof Error ? error.message : "Unknown error",
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={GitBranch} message="Select a company to open Workflows." />;
  }
  if (listQuery.isLoading) return <PageSkeleton />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Workflows</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Explicit, versioned processes that combine software, people and agents.
            </p>
          </div>
          {capabilitiesQuery.data?.edit ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New workflow
            </Button>
          ) : null}
        </header>

        {listQuery.error ? (
          <div className="border-l-2 border-destructive pl-4">
            <p className="font-medium">Workflows could not be loaded</p>
            <Button className="mt-3" variant="outline" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (listQuery.data?.length ?? 0) === 0 ? (
          <div className="border-y border-border py-14">
            <EmptyState
              icon={GitBranch}
              message="No workflows yet. Start with one small, explicit process."
            />
          </div>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {(listQuery.data ?? []).map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => navigate(`/workflows/${workflow.id}`)}
                className="flex w-full items-center justify-between gap-4 px-2 py-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{workflow.name}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {workflow.description || "No description"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline">{workflow.status === "active" && !workflow.publishedRevisionId ? "draft" : workflow.status}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    Updated {formatDate(workflow.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Create the draft first. Nothing runs until a validated revision is published.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-xs font-medium">
              Name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                placeholder="Lead qualification"
              />
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Description
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this workflow accomplishes"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !name.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
