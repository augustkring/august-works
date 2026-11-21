// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HeartbeatRun, Issue, IssueRecoveryAction } from "@paperclipai/shared";
import { RunWorkspaceRecoverySurface } from "./RunWorkspaceRecoverySurface";
import { ToastProvider } from "../context/ToastContext";

const navigateMock = vi.hoisted(() => vi.fn());
const issueGetMock = vi.hoisted(() => vi.fn());
const issueCreateMock = vi.hoisted(() => vi.fn());
const resolveRecoveryMock = vi.hoisted(() => vi.fn());
const recoveryActionsMock = vi.hoisted(() => vi.fn());
const reconcileMock = vi.hoisted(() => vi.fn());
const boardAccessMock = vi.hoisted(() => vi.fn());
let activeQueryClient: QueryClient | null = null;

vi.mock("@/lib/router", () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to, ...props }: { children: ReactNode; to: string } & ComponentProps<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    get: issueGetMock,
    create: issueCreateMock,
    resolveRecoveryAction: resolveRecoveryMock,
    getRecoveryActions: recoveryActionsMock,
  },
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: {
    reconcile: reconcileMock,
  },
}));

vi.mock("../api/access", () => ({
  accessApi: {
    getCurrentBoardAccess: boardAccessMock,
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// flushSync-based sync `act` shim (matches the repo pattern in IssueRecoveryActionCard.test.tsx).
function act(callback: () => void): void {
  flushSync(callback);
}

// Resolve pending mocked-promise micro/macrotasks, then flush the React state updates react-query
// queued, repeating so chained query → render → dependent-render settles fully.
async function flush() {
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 4; j += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => {});
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.clearAllMocks();
  activeQueryClient = null;
});

function buildRun(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  return {
    id: "run-aaaa1111",
    companyId: "company-1",
    agentId: "agent-1",
    status: "failed",
    errorCode: "workspace_validation_failed",
    contextSnapshot: { issueId: "issue-1" },
    resultJson: null,
    contextSnapshotJson: null,
    ...overrides,
  } as unknown as HeartbeatRun;
}

function buildLostWorkspaceRun(): HeartbeatRun {
  return buildRun({ errorCode: "native_continuation_requires_reconciliation", resultJson: { workspaceRestoreFailure: "restore_failed" } });
}

function buildWorkspaceDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    state: "available",
    reason: null,
    sourceRunId: "run-aaaa1111",
    currentOwnerAgentId: "agent-1",
    destruction: { state: "confirmed", receiptHash: "a".repeat(64), bindingId: "binding-1", cellId: "cell-1", generation: "3" },
    continuation: { available: true, mode: "fresh_bounded", stagingScope: "local_only", reason: null },
    sources: [{ attachmentId: "attachment-1", filename: "plan.md", contentType: "text/markdown", byteSize: 42, sha256: "b".repeat(64) }],
    ...overrides,
  };
}

function buildRecoveryAction(cause = "workspace_validation_failed"): IssueRecoveryAction {
  return {
    id: "action-1",
    companyId: "company-1",
    sourceIssueId: "issue-1",
    recoveryIssueId: null,
    kind: "workspace_validation",
    status: "active",
    ownerType: "board",
    ownerAgentId: null,
    ownerUserId: null,
    previousOwnerAgentId: null,
    returnOwnerAgentId: null,
    cause,
    fingerprint: "fp",
    evidence: {
      workspaceValidation: {
        reason: "git_worktree_branch_incoherence",
        expectedBranch: "PAP-1405-recorded",
        actualBranch: "live-branch",
        cleanliness: "dirty",
        statusEntryCount: 2,
        dirtyPathSample: ["a.ts"],
        sourceIdentifier: "PAP-1405",
        persistedExecutionWorkspaceId: "ws-1",
        provenance: {
          expectedHeadSha: "aaaa1111bbbb",
          actualHeadSha: "cccc2222dddd",
          ancestryVerdict: "diverged",
          plainLanguageReason: "Recorded branch is not an ancestor of the live branch.",
        },
      },
    },
    nextAction: "Repair the workspace.",
    wakePolicy: null,
    monitorPolicy: null,
    attemptCount: 1,
    maxAttempts: 3,
    timeoutAt: null,
    lastAttemptAt: null,
    outcome: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function buildIssue(action: IssueRecoveryAction | null): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1405",
    companyId: "company-1",
    title: "Do the thing",
    description: "body",
    priority: "medium",
    projectId: null,
    parentId: null,
    assigneeAgentId: null,
    executionWorkspaceId: "ws-1",
    activeRecoveryAction: action,
  } as unknown as Issue;
}

async function renderSurface(run: HeartbeatRun) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  activeQueryClient = client;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RunWorkspaceRecoverySurface run={run} />
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  // Let the issue + board-access queries settle and commit.
  await flush();
  return container!;
}

function click(element: Element | null) {
  if (!element) throw new Error("Expected element to exist");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("RunWorkspaceRecoverySurface", () => {
  it("renders nothing for a run that is not a workspace-validation failure", async () => {
    issueGetMock.mockResolvedValue(buildIssue(buildRecoveryAction()));
    boardAccessMock.mockResolvedValue(undefined);
    const node = await renderSurface(buildRun({ errorCode: "process_lost" }));
    expect(node.querySelector("[data-testid='run-workspace-recovery-surface']")).toBeNull();
    expect(issueGetMock).not.toHaveBeenCalled();
  });

  it("renders nothing when the source issue has no workspace_validation recovery action", async () => {
    issueGetMock.mockResolvedValue(buildIssue(null));
    boardAccessMock.mockResolvedValue(undefined);
    const node = await renderSurface(buildRun());
    expect(node.querySelector("[data-testid='run-workspace-recovery-surface']")).toBeNull();
  });

  it("renders the compact recovery card and repair action for a dirty divergence", async () => {
    issueGetMock.mockResolvedValue(buildIssue(buildRecoveryAction()));
    boardAccessMock.mockResolvedValue({ source: "local_implicit", companyIds: ["company-1"] });
    const node = await renderSurface(buildRun());
    expect(node.querySelector("[data-testid='run-workspace-recovery-surface']")).not.toBeNull();
    expect(node.querySelector("[data-testid='recovery-divergence-diagnosis']")).not.toBeNull();
    expect(node.querySelector("[data-testid='recovery-action-repair-trigger']")).not.toBeNull();
    // Compact: metadata rows dropped.
    expect(node.textContent).not.toContain("Repair the workspace.");
  });

  it("wires the repair confirm to reconcile in quarantine_restore mode against the pinned workspace", async () => {
    issueGetMock.mockResolvedValue(buildIssue(buildRecoveryAction()));
    boardAccessMock.mockResolvedValue({ source: "local_implicit", companyIds: ["company-1"] });
    reconcileMock.mockResolvedValue({ id: "ws-1" });
    const node = await renderSurface(buildRun());
    click(node.querySelector("[data-testid='recovery-action-repair-trigger']"));
    click(document.body.querySelector("[data-testid='recovery-action-repair-confirm']"));
    await flush();
    expect(reconcileMock).toHaveBeenCalledWith("ws-1", { mode: "quarantine_restore" });
  });

  it("shows unknown destruction and offers no reconstruction without verified evidence", async () => {
    const action = buildRecoveryAction("native_continuation_requires_reconciliation");
    issueGetMock.mockResolvedValue(buildIssue(action));
    recoveryActionsMock.mockResolvedValue({ active: action, actions: [action], workspaceReconstruction: buildWorkspaceDescriptor({
      state: "unavailable", reason: "confirmed_native_destruction_receipt_unavailable",
      destruction: { state: "unknown", receiptHash: null, bindingId: null, cellId: null, generation: null }, sources: [],
    }) });
    boardAccessMock.mockResolvedValue({ source: "session", companyIds: ["company-1"] });
    const node = await renderSurface(buildLostWorkspaceRun());
    expect(node.querySelector("[data-testid='workspace-destruction-proof']")?.textContent).toContain("Unknown");
    expect(node.querySelector("[data-testid='workspace-reconstruction-submit']")).toBeNull();
    expect(node.querySelector("[data-testid='workspace-reconstruction-unavailable']")).not.toBeNull();
  });

  it("keeps source eligibility closed when access is revoked or no source remains current", async () => {
    const action = buildRecoveryAction("native_continuation_requires_reconciliation");
    issueGetMock.mockResolvedValue(buildIssue(action));
    recoveryActionsMock.mockResolvedValue({ active: action, actions: [action], workspaceReconstruction: buildWorkspaceDescriptor({
      state: "unavailable", reason: "no_currently_qualified_saved_sources", sources: [],
    }) });
    boardAccessMock.mockResolvedValue({ source: "session", companyIds: ["company-1"] });
    const node = await renderSurface(buildLostWorkspaceRun());
    expect(node.querySelector("[data-testid='workspace-destruction-proof']")?.textContent).toContain("destroyedConfirmed");
    expect(node.querySelector("[data-testid='workspace-reconstruction-unavailable']")).not.toBeNull();
    expect(node.querySelector("[data-testid='workspace-reconstruction-submit']")).toBeNull();
  });

  it("hides cached source names and proof when the current access refresh is rejected", async () => {
    const action = buildRecoveryAction("native_continuation_requires_reconciliation");
    issueGetMock.mockResolvedValue(buildIssue(action));
    recoveryActionsMock.mockResolvedValueOnce({ active: action, actions: [action], workspaceReconstruction: buildWorkspaceDescriptor() });
    boardAccessMock.mockResolvedValue({ source: "session", companyIds: ["company-1"] });
    const node = await renderSurface(buildLostWorkspaceRun());
    expect(node.textContent).toContain("plan.md");
    recoveryActionsMock.mockRejectedValueOnce(new Error("403"));
    await activeQueryClient?.invalidateQueries({ queryKey: ["issues", "recovery-actions", "issue-1"] });
    await flush();
    expect(node.textContent).not.toContain("plan.md");
    expect(node.querySelector("[data-testid='workspace-reconstruction-submit']")).toBeNull();
    expect(node.textContent).not.toContain("destroyedConfirmed");
  });

  it("clears source choice and consent when the receipt or source hash changes", async () => {
    const action = buildRecoveryAction("native_continuation_requires_reconciliation");
    issueGetMock.mockResolvedValue(buildIssue(action));
    const first = buildWorkspaceDescriptor();
    recoveryActionsMock.mockResolvedValue({ active: action, actions: [action], workspaceReconstruction: first });
    boardAccessMock.mockResolvedValue({ source: "session", companyIds: ["company-1"] });
    const node = await renderSurface(buildLostWorkspaceRun());
    for (const checkbox of node.querySelectorAll('[role="checkbox"]')) click(checkbox);
    const textarea = node.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "I verified the old operation had stopped before this recovery.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const changed = buildWorkspaceDescriptor({
      destruction: { ...first.destruction, receiptHash: "c".repeat(64) },
      sources: [{ ...first.sources[0]!, sha256: "d".repeat(64) }],
    });
    activeQueryClient?.setQueryData(["issues", "recovery-actions", "issue-1"], {
      active: action, actions: [action], workspaceReconstruction: changed,
    });
    await flush();
    expect((node.querySelector("[data-testid='workspace-reconstruction-submit']") as HTMLButtonElement).disabled).toBe(true);
    expect(node.querySelectorAll('[role="checkbox"][data-state="checked"]')).toHaveLength(0);
  });

  it("shows the verified destruction and only current eligible saved sources", async () => {
    const action = buildRecoveryAction("native_continuation_requires_reconciliation");
    issueGetMock.mockResolvedValue(buildIssue(action));
    recoveryActionsMock.mockResolvedValue({ active: action, actions: [action], workspaceReconstruction: buildWorkspaceDescriptor() });
    boardAccessMock.mockResolvedValue({ source: "session", companyIds: ["company-1"] });
    const node = await renderSurface(buildLostWorkspaceRun());
    expect(node.querySelector("[data-testid='workspace-destruction-proof']")?.textContent).toContain("workspaceReconstruction.destroyedConfirmed");
    expect(node.textContent).toContain("plan.md");
    expect(node.textContent).not.toContain("Download");
    expect(node.textContent).not.toContain("I confirm the workspace was destroyed");
    const submit = node.querySelector("[data-testid='workspace-reconstruction-submit']") as HTMLButtonElement;
    expect(submit).not.toBeNull();
    expect(submit.disabled).toBe(true);
    const checks = [...node.querySelectorAll('[role="checkbox"]')];
    expect(checks).toHaveLength(3);
    for (const checkbox of checks) click(checkbox);
    const textarea = node.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "I verified the old operation had stopped before this recovery.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    expect(resolveRecoveryMock).toHaveBeenCalledWith("issue-1", expect.objectContaining({
      outcome: "restored",
      sourceIssueStatus: "todo",
      executionReconciliation: expect.objectContaining({
        runId: "run-aaaa1111",
        providerStopped: true,
        actionOutcome: "not_performed",
        workspaceReconstruction: {
          confirmed: true,
          destructionReceiptHash: "a".repeat(64),
          selectedSources: [{ attachmentId: "attachment-1", sha256: "b".repeat(64) }],
        },
      }),
    }));
  });
});
