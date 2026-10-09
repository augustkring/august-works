// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowExperience,
  WorkflowLifecycleCommand,
} from "@paperclipai/shared";
import { createWorkflowsApi, workflowsApi } from "../api/workflows";
import { api, ApiError } from "../api/client";
import { WorkflowLifecycleControls } from "./WorkflowLifecycleControls";
import "../i18n";

const detail: WorkflowExperience = {
  companyId: "10000000-0000-4000-8000-000000000001",
  id: "10000000-0000-4000-8000-000000000002",
  name: "Review",
  description: null,
  status: "active",
  canEdit: true,
  canOperate: true,
  updatedAt: "2026-10-09T10:00:00.000Z",
  active: {
    id: "10000000-0000-4000-8000-000000000003",
    state: "published",
    version: 2,
    coverage: "complete",
    steps: [],
  },
  draft: {
    id: "10000000-0000-4000-8000-000000000004",
    state: "draft",
    version: 3,
    coverage: "complete",
    steps: [],
  },
  comparison: null,
};
let root: Root, container: HTMLDivElement, client: QueryClient;
const refresh = vi.fn();
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
  refresh.mockClear();
});
async function render(value: WorkflowExperience | null) {
  if (!root || !container?.isConnected) {
    client = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <WorkflowLifecycleControls
          company={detail.companyId}
          principal="member"
          id={detail.id}
          detail={value}
          refresh={refresh}
        />
      </QueryClientProvider>,
    ),
  );
}
async function click(label: string) {
  const target = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  expect(target).toBeDefined();
  await act(async () => target!.click());
}
const receipt = (input: WorkflowLifecycleCommand) => ({
  requestId: input.requestId,
  companyId: detail.companyId,
  workflowId: detail.id,
  action: input.action,
  status:
    input.action === "pause"
      ? ("paused" as const)
      : input.action === "resume"
        ? ("active" as const)
        : ("archived" as const),
  updatedAt: "2026-10-09T11:00:00.000Z",
  publishedRevisionId: detail.active!.id,
  draftRevisionId: input.action === "retire" ? null : detail.draft!.id,
  workPolicy: "finish_existing" as const,
});

it("discloses continuing work and applies only after explicit confirmation", async () => {
  const change = vi
    .spyOn(workflowsApi, "lifecycle")
    .mockImplementation(async (_company, _principal, _id, input) =>
      receipt(input),
    );
  await render(detail);
  await click("Pause");
  expect(document.body.textContent).toContain("Pause does not cancel it");
  expect(change).not.toHaveBeenCalled();
  await click("Confirm pause");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Pause confirmed"),
  );
  expect(change.mock.calls[0]!.slice(0, 3)).toEqual([
    detail.companyId,
    "member",
    detail.id,
  ]);
  expect(change.mock.calls[0]![3]).toMatchObject({
    expectedStatus: "active",
    expectedUpdatedAt: detail.updatedAt,
    expectedPublishedRevisionId: detail.active!.id,
    expectedDraftRevisionId: detail.draft!.id,
    workPolicy: "finish_existing",
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("preserves an unacknowledged tuple across private rechecks and close/reopen, even after native retirement", async () => {
  const change = vi
    .spyOn(workflowsApi, "lifecycle")
    .mockRejectedValueOnce(new Error("PRIVATE-NETWORK-ERROR"))
    .mockImplementationOnce(async (_company, _principal, _id, input) =>
      receipt(input),
    );
  await render({ ...detail, status: "paused" });
  await click("Retire workflow");
  await click("Confirm retirement");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "This change could not be confirmed",
    ),
  );
  expect(document.body.textContent).not.toContain("PRIVATE-NETWORK-ERROR");
  const original = change.mock.calls[0]![3];
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render(null);
  expect(document.body.textContent).not.toContain("Retry same request");
  await render({
    ...detail,
    status: "archived",
    updatedAt: "2026-10-09T11:00:00.000Z",
    draft: null,
  });
  await click("Retry same request");
  await click("Retry same request");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Retirement confirmed"),
  );
  expect(change.mock.calls[1]![3]).toEqual(original);
});
it("releases only a canonical refused change so the user can review a fresh version", async () => {
  const change = vi
    .spyOn(workflowsApi, "lifecycle")
    .mockRejectedValueOnce(
      new ApiError("REFUSED", 409, {
        details: { code: "workflow_lifecycle_conflict" },
      }),
    )
    .mockImplementationOnce(async (_company, _principal, _id, input) =>
      receipt(input),
    );
  await render(detail);
  await click("Pause");
  await click("Confirm pause");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("The change was refused"),
  );
  await render({ ...detail, updatedAt: "2026-10-09T10:05:00.000Z" });
  await click("Pause");
  await click("Confirm pause");
  await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(2));
  expect(change.mock.calls[1]![3].requestId).not.toBe(
    change.mock.calls[0]![3].requestId,
  );
  expect(change.mock.calls[1]![3].expectedUpdatedAt).toBe(
    "2026-10-09T10:05:00.000Z",
  );
});
it("suppresses controls after current publication authority is lost", async () => {
  const change = vi.spyOn(workflowsApi, "lifecycle");
  await render({ ...detail, canOperate: false });
  expect(document.querySelectorAll("button")).toHaveLength(0);
  expect(change).not.toHaveBeenCalled();
});
it.each(["companyId", "workflowId", "requestId", "action"] as const)(
  "rejects an unbound %s in a lifecycle receipt",
  async (field) => {
    const command: WorkflowLifecycleCommand = {
      requestId: crypto.randomUUID(),
      action: "pause",
      expectedStatus: "active",
      expectedUpdatedAt: detail.updatedAt,
      expectedPublishedRevisionId: detail.active!.id,
      expectedDraftRevisionId: detail.draft!.id,
      workPolicy: "finish_existing",
    };
    const post = vi
      .fn()
      .mockResolvedValue({
        ...receipt(command),
        [field]: field === "action" ? "resume" : crypto.randomUUID(),
      status: field === "action" ? "active" : "paused",
      });
    const client = createWorkflowsApi({ ...api, post });
    await expect(
      client.lifecycle(detail.companyId, "member", detail.id, command),
    ).rejects.toThrow("Workflow request context changed");
  },
);
