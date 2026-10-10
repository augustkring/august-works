// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowExperience,
  WorkflowLaunchCommand,
} from "@paperclipai/shared";
import { WorkflowRunControls } from "./WorkflowRunControls";
import { workflowsApi, createWorkflowsApi } from "../api/workflows";
import { api, ApiError } from "../api/client";
import "../i18n";
const company = "10000000-0000-4000-8000-000000000001";
const workflow = "10000000-0000-4000-8000-000000000002";
const revision = "10000000-0000-4000-8000-000000000003";
const run = "10000000-0000-4000-8000-000000000004";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { issuePrefix: "AW" },
    selectedCompanyId: company,
  }),
}));
const detail: WorkflowExperience = {
  companyId: company,
  id: workflow,
  name: "Review",
  description: null,
  status: "active",
  canEdit: false,
  canOperate: false,
  canRequestRun: true,
  runAvailability: "internal_ready",
  updatedAt: "2026-10-09T10:00:00.000Z",
  active: {
    id: revision,
    state: "published",
    version: 2,
    coverage: "complete",
    steps: [],
  },
  draft: null,
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
        <MemoryRouter>
          <WorkflowRunControls
            company={company}
            principal="member"
            id={workflow}
            detail={value}
            refresh={refresh}
          />
        </MemoryRouter>
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
const receipt = (command: WorkflowLaunchCommand) => ({
  companyId: company,
  workflowId: workflow,
  requestId: command.requestId,
  runId: run,
  revisionId: command.expectedPublishedRevisionId,
  disposition: "admitted" as const,
});
it("requires confirmation and keeps the displayed version when a newer publication arrives", async () => {
  const launch = vi
    .spyOn(workflowsApi, "launch")
    .mockImplementation(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Run now");
  expect(launch).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Reviewed published version 2");
  await render({
    ...detail,
    updatedAt: "2026-10-09T11:00:00.000Z",
    active: { ...detail.active!, id: crypto.randomUUID(), version: 3 },
  });
  await click("Confirm run");
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The original run request was accepted",
    ),
  );
  expect(launch.mock.calls[0]![3]).toMatchObject({
    expectedUpdatedAt: detail.updatedAt,
    expectedPublishedRevisionId: revision,
    acknowledgeInternalExecution: true,
  });
  expect(container.textContent).toContain(
    "completion and independent verification are separate",
  );
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    `/AW/workflows/${workflow}/runs/${run}`,
  );
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("reconciles an unknown original request after Pause and a private read recheck", async () => {
  const launch = vi
    .spyOn(workflowsApi, "launch")
    .mockRejectedValueOnce(new Error("PRIVATE-ERROR"))
    .mockImplementationOnce(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Run now");
  await click("Confirm run");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Run admission is unconfirmed"),
  );
  expect(document.body.textContent).not.toContain("PRIVATE-ERROR");
  const original = launch.mock.calls[0]![3];
  await click("Close");
  await render(null);
  expect(document.body.textContent).not.toContain("Retry original run request");
  await render({ ...detail, status: "paused", runAvailability: "not_active" });
  await click("Retry original run request");
  await click("Retry original run request");
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  expect(launch.mock.calls[1]![3]).toEqual(original);
});
it("requires a fresh review after an explicit native pre-effect conflict", async () => {
  const launch = vi
    .spyOn(workflowsApi, "launch")
    .mockRejectedValueOnce(
      new ApiError("REFUSED", 409, {
        details: { code: "workflow_launch_conflict" },
      }),
    )
    .mockImplementationOnce(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Run now");
  await click("Confirm run");
  await vi.waitFor(() =>
    expect(container.textContent).toContain("The run was refused"),
  );
  await render({ ...detail, updatedAt: "2026-10-09T11:00:00.000Z" });
  await click("Run now");
  await click("Confirm run");
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  expect(launch.mock.calls[1]![3].requestId).not.toBe(
    launch.mock.calls[0]![3].requestId,
  );
  expect(launch.mock.calls[1]![3].expectedUpdatedAt).toBe(
    "2026-10-09T11:00:00.000Z",
  );
});
it("directs material work to its review and hides controls without current run authority", async () => {
  const launch = vi.spyOn(workflowsApi, "launch");
  await render({ ...detail, runAvailability: "review_required" });
  expect(container.textContent).not.toContain("Run now");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    `/AW/workflows/${workflow}/advanced`,
  );
  await render({ ...detail, canRequestRun: false });
  expect(container.textContent).toBe("");
  expect(launch).not.toHaveBeenCalled();
});
it.each(["companyId", "workflowId", "requestId", "revisionId"] as const)(
  "rejects a foreign %s admission receipt",
  async (field) => {
    const command: WorkflowLaunchCommand = {
      requestId: crypto.randomUUID(),
      expectedUpdatedAt: detail.updatedAt,
      expectedPublishedRevisionId: revision,
      expectedDraftRevisionId: null,
      acknowledgeInternalExecution: true,
    };
    const post = vi
      .fn()
      .mockResolvedValue({ ...receipt(command), [field]: crypto.randomUUID() });
    await expect(
      createWorkflowsApi({ ...api, post }).launch(
        company,
        "member",
        workflow,
        command,
      ),
    ).rejects.toThrow("Workflow run request context changed");
  },
);
