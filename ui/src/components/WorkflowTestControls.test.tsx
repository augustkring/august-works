// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  WorkflowExperience,
  WorkflowTestCommand,
} from "@paperclipai/shared";
import { WorkflowTestControls } from "./WorkflowTestControls";
import { workflowsApi, createWorkflowsApi } from "../api/workflows";
import { api, ApiError } from "../api/client";
import "../i18n";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { pendingWorkflowRequests } from "../lib/pending-workflow-requests";
beforeEach(() => { window.sessionStorage.clear(); vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("member")); });
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
  canRequestTest: true,
  testAvailability: "internal_ready",
  testDeadlineSeconds: 60,
  testReceipt: null,
  canRequestRun: true,
  runAvailability: "internal_ready",
  updatedAt: "2026-10-09T10:00:00.000Z",
  draft: {
    id: revision,
    state: "draft",
    version: 2,
    coverage: "complete",
    steps: [],
  },
  active: null,
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
    client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("member"));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkflowTestControls
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
async function acknowledge() {
  await act(async () =>
    (
      document.querySelector('input[type="checkbox"]') as HTMLInputElement
    ).click(),
  );
}
const receipt = (command: WorkflowTestCommand) => ({
  companyId: company,
  workflowId: workflow,
  requestId: command.requestId,
  runId: run,
  revisionId: command.expectedDraftRevisionId,
  purpose: "test" as const,
  disposition: "admitted" as const,
});
it("retains only the original locator across reload and refuses a fresh test identity", async () => {
  const test = vi.spyOn(workflowsApi, "test").mockRejectedValue(new Error("PRIVATE lost response"));
  await render(detail); await click("Review internal test"); await acknowledge(); await click("Start internal test");
  await vi.waitFor(() => expect(pendingWorkflowRequests(company, "member", workflow)).toHaveLength(1));
  const pending = pendingWorkflowRequests(company, "member", workflow)[0]!;
  expect(window.sessionStorage.getItem("aw.v9.pending-workflow-request-receipts")).not.toMatch(/PRIVATE|expectedUpdatedAt|acknowledge|prompt|input/);
  await act(async () => root.unmount()); container.remove(); client.clear();
  await render(detail);
  const start = [...container.querySelectorAll("button")].find(button => button.textContent === "Review internal test")!;
  expect(start.disabled).toBe(true);
  expect(container.querySelector(`a[href$="/requests/test/${pending.requestId}"]`)).not.toBeNull();
  expect(test).toHaveBeenCalledTimes(1);
});
it("blocks a new test when Original request recovery storage is corrupted", async () => {
  window.sessionStorage.setItem("aw.v9.pending-workflow-request-receipts", "{corrupt");
  const test = vi.spyOn(workflowsApi, "test"); await render(detail);
  expect(container.textContent).toContain("Request recovery is unavailable");
  const start = [...container.querySelectorAll("button")].find(button => button.textContent === "Review internal test")!;
  expect(start.disabled).toBe(true); expect(test).not.toHaveBeenCalled();
});
it("keeps an admitted test unconfirmed after the current account changes before acknowledgement", async () => {
  let finish!: (value: ReturnType<typeof receipt>) => void;
  const test = vi.spyOn(workflowsApi, "test").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(detail); await click("Review internal test"); await acknowledge(); await click("Start internal test");
  await vi.waitFor(() => expect(test).toHaveBeenCalledOnce());
  const command = test.mock.calls[0]![3];
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("another-account")); finish(receipt(command)); });
  expect(pendingWorkflowRequests(company, "member", workflow)).toHaveLength(1);
  expect(container.textContent).not.toContain("Internal test admitted"); expect(refresh).not.toHaveBeenCalled();
});
it("requires explicit acknowledgement and freezes the reviewed draft and expected result", async () => {
  const test = vi
    .spyOn(workflowsApi, "test")
    .mockImplementation(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Review internal test");
  expect(document.body.textContent).toContain("Draft version 2");
  expect(document.body.textContent).toContain(
    "Succeeded, within the configured 60 seconds",
  );
  await click("Start internal test");
  expect(test).not.toHaveBeenCalled();
  await render({
    ...detail,
    updatedAt: "2026-10-09T11:00:00.000Z",
    draft: { ...detail.draft!, id: crypto.randomUUID(), version: 3 },
    testDeadlineSeconds: 30,
  });
  expect(document.body.textContent).toContain("configured 60 seconds");
  await acknowledge();
  await click("Start internal test");
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The original internal test was admitted",
    ),
  );
  expect(test.mock.calls[0]![3]).toMatchObject({
    expectedWorkflowId: workflow,
    expectedDraftRevisionId: revision,
    expectedUpdatedAt: detail.updatedAt,
    expectedRunStatus: "succeeded",
    acknowledgeInternalTest: true,
  });
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    `/AW/workflows/${workflow}/runs/${run}`,
  );
});
it("retains exactly the unknown request across private rechecks and Pause", async () => {
  const test = vi
    .spyOn(workflowsApi, "test")
    .mockRejectedValueOnce(new Error("PRIVATE-ERROR"))
    .mockImplementationOnce(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Review internal test");
  await acknowledge();
  await click("Start internal test");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("The test result is unknown"),
  );
  expect(document.body.textContent).not.toContain("PRIVATE-ERROR");
  const original = test.mock.calls[0]![3];
  await click("Close");
  await render(null);
  expect(container.textContent).toBe("");
  await render({
    ...detail,
    status: "paused",
    testAvailability: "not_active",
    testDeadlineSeconds: null,
  });
  await click("Reconcile original test");
  await click("Reconcile original test");
  await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(2));
  expect(test.mock.calls[1]![3]).toEqual(original);
});
it("recovers the actual original receipt after reload without another test submission", async () => {
  const test = vi.spyOn(workflowsApi, "test");
  const original: WorkflowTestCommand = {
    requestId: crypto.randomUUID(),
    expectedWorkflowId: workflow,
    expectedDraftRevisionId: revision,
    expectedUpdatedAt: detail.updatedAt,
    expectedRunStatus: "succeeded",
    acknowledgeInternalTest: true,
  };
  await render({ ...detail, testReceipt: receipt(original) });
  expect(container.textContent).toContain(
    "The original internal test was admitted",
  );
  expect(test).not.toHaveBeenCalled();
  await render({ ...detail, canRequestTest: false, testReceipt: null });
  expect(container.textContent).toBe("");
});
it("does not resolve an unknown attempt from an unrelated older native receipt", async () => {
  const test = vi
    .spyOn(workflowsApi, "test")
    .mockRejectedValue(new Error("Unknown"));
  await render(detail);
  await click("Review internal test");
  await acknowledge();
  await click("Start internal test");
  await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(1));
  const original = test.mock.calls[0]![3];
  await render({
    ...detail,
    testReceipt: receipt({ ...original, requestId: crypto.randomUUID() }),
  });
  expect(document.body.textContent).toContain("The test result is unknown");
  await render({ ...detail, testReceipt: receipt(original) });
  await vi.waitFor(() =>
    expect(document.body.textContent).not.toContain(
      "The test result is unknown",
    ),
  );
  expect(test).toHaveBeenCalledTimes(1);
});
it("requires a fresh review after a canonical pre-effect conflict", async () => {
  const test = vi
    .spyOn(workflowsApi, "test")
    .mockRejectedValueOnce(
      new ApiError("REFUSED", 409, {
        details: { code: "workflow_test_conflict" },
      }),
    )
    .mockImplementationOnce(async (_c, _p, _w, command) => receipt(command));
  await render(detail);
  await click("Review internal test");
  await acknowledge();
  await click("Start internal test");
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The draft changed or needs a different test",
    ),
  );
  await render({ ...detail, updatedAt: "2026-10-09T11:00:00.000Z" });
  await click("Review internal test");
  await acknowledge();
  await click("Start internal test");
  await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(2));
  expect(test.mock.calls[1]![3].requestId).not.toBe(
    test.mock.calls[0]![3].requestId,
  );
  expect(test.mock.calls[1]![3].expectedUpdatedAt).toBe(
    "2026-10-09T11:00:00.000Z",
  );
});
it("hides material draft testing and current role losses", async () => {
  await render({
    ...detail,
    testAvailability: "review_required",
    testDeadlineSeconds: null,
  });
  expect(container.textContent).toContain("separately qualified test");
  expect(container.textContent).not.toContain("Review internal test");
  await render({ ...detail, canRequestTest: false });
  expect(container.textContent).toBe("");
});
it.each(["companyId", "workflowId", "requestId", "revisionId"] as const)(
  "rejects a foreign %s test receipt",
  async (field) => {
    const command: WorkflowTestCommand = {
      requestId: crypto.randomUUID(),
      expectedWorkflowId: workflow,
      expectedDraftRevisionId: revision,
      expectedUpdatedAt: detail.updatedAt,
      expectedRunStatus: "succeeded",
      acknowledgeInternalTest: true,
    };
    const post = vi
      .fn()
      .mockResolvedValue({ ...receipt(command), [field]: crypto.randomUUID() });
    await expect(
      createWorkflowsApi({ ...api, post }).test(
        company,
        "member",
        workflow,
        command,
      ),
    ).rejects.toThrow("context changed");
  },
);
