// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowRunExperience as View } from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { WorkflowRunExperience } from "./WorkflowRunExperience";
import * as supportDownloads from "../lib/support-diagnostic-download";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import "../i18n";
let live: (event: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
}) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (listener: typeof live) => {
    live = listener;
  },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("./WorkflowRun", () => ({ WorkflowRun: () => null }));
const companyId = "10000000-0000-4000-8000-000000000001";
const workflowId = "10000000-0000-4000-8000-000000000002";
const runId = "10000000-0000-4000-8000-000000000003";
const data: View = {
  companyId,
  id: runId,
  workflowId,
  revisionId: "10000000-0000-4000-8000-000000000004",
  revisionNumber: 2,
  revisionState: "superseded",
  status: "waiting",
  updatedAt: "2026-10-09T00:00:00.000Z",
  canRequestStop: false,
  purpose: "live",
  stopReceipt: null,
  trace: {
    state: "available",
    attempts: [
      {
        id: "10000000-0000-4000-8000-000000000005",
        name: "Review customer-safe result",
        operation: "Human Approval",
        attempt: 2,
        status: "waiting",
        execution: "not_recorded",
        approvalCheckpoint: true,
        payloadUnavailable: true,
        branchChoice: { state: "not_applicable" },
        waitingFor: ["human_interaction"],
      },
    ],
  },
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
it("withdraws current run history when the original account cache becomes unresolved", async () => {
  vi.spyOn(workflowsApi, "runExperience").mockResolvedValue(data); await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Recorded earlier published version 2"));
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.auth.session, exact: true, refetchType: "none" }); });
  expect(container.textContent).not.toContain("Recorded earlier published version 2");
  expect(container.textContent).not.toContain("Prepare a support report");
});
it("rejects a run history response completed after the account changes", async () => {
  let finish!: (value: typeof data) => void;
  vi.spyOn(workflowsApi, "runExperience").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount();
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("another-account")); finish(data); });
  expect(container.textContent).not.toContain("Recorded earlier published version 2");
  expect(container.textContent).not.toContain("Prepare a support report");
});
async function mount(principal = "member") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(principal));
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture(principal));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkflowRunExperience
            company={companyId}
            principal={principal}
            workflow={workflowId}
            id={runId}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("renders the historical run rather than presenting its superseded version as active or independently verified", async () => {
  const get = vi.spyOn(workflowsApi, "runExperience").mockResolvedValue(data);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "Recorded earlier published version 2",
    ),
  );
  expect(container.textContent).toContain("Attempt 2");
  expect(container.textContent).toContain("Waiting for a human response");
  expect(container.textContent).toContain(
    "decision and authorization have not been verified",
  );
  expect(container.textContent).not.toContain("Active version");
  expect(container.querySelectorAll("a")).toHaveLength(2);
  expect(
    container.querySelector(`a[href$="/${runId}/advanced"]`),
  ).not.toBeNull();
  expect(
    [...container.querySelectorAll("button")].map((b) => b.textContent),
  ).toEqual(["Refresh run", "Prepare a support report"]);
  expect(get.mock.calls[0].slice(0, 4)).toEqual([
    companyId,
    "member",
    workflowId,
    runId,
  ]);
  expect(document.activeElement).toBe(container.querySelector("h1"));
});
it.each(["unavailable", "empty"])(
  "does not invent a successful trace for %s history",
  async (state) => {
    vi.spyOn(workflowsApi, "runExperience").mockResolvedValue({
      ...data,
      trace:
        state === "unavailable"
          ? { state: "unavailable" }
          : { state: "available", attempts: [] },
    });
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        state === "unavailable"
          ? "complete attempt history cannot be shown"
          : "No step attempts have been recorded",
      ),
    );
    expect(container.querySelector("ol")).toBeNull();
  },
);
it.each(["selected", "not_recorded"] as const)(
  "explains %s branch evidence without claiming that the next step ran",
  async (state) => {
    const view = structuredClone(data);
    if (view.trace.state !== "available") throw new Error("trace unavailable");
    view.trace.attempts[0].branchChoice =
      state === "selected" ? { state, nextStep: "Prepare report" } : { state };
    vi.spyOn(workflowsApi, "runExperience").mockResolvedValue(view);
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        state === "selected"
          ? "Recorded branch selects next step: Prepare report"
          : "A branch selection is not available",
      ),
    );
    if (state === "selected")
      expect(container.textContent).toContain(
        "does not confirm that the next step ran",
      );
  },
);
it.each(["permission.revoked", "analytical.context.access_lost"])(
  "hides retained trace for %s and ignores a late prior response",
  async (kind) => {
    let resolveOld!: (v: View) => void, rejectNew!: (e: Error) => void;
    const get = vi
      .spyOn(workflowsApi, "runExperience")
      .mockResolvedValueOnce(data)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectNew = reject;
          }),
      );
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Review customer-safe result"),
    );
    await act(async () =>
      live({
        companyId,
        type: "activity.logged",
        payload: { action: "workflow.run_updated" },
      }),
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(container.textContent).not.toContain("Review customer-safe result");
    await act(async () =>
      live({
        companyId,
        type:
          kind === "permission.revoked"
            ? "activity.logged"
            : "analytical.context.access_lost",
        payload: { action: kind },
      }),
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    await act(async () => resolveOld(data));
    expect(container.textContent).not.toContain("Review customer-safe result");
    await act(async () => rejectNew(new Error("SECRET-ERROR")));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("SECRET-ERROR");
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
  },
);

it("requires preview and an explicit download without including step content or contacting support", async () => {
  vi.spyOn(workflowsApi, "runExperience").mockResolvedValue(data);
  const download = vi
    .spyOn(supportDownloads, "downloadWorkflowSupportDiagnostic")
    .mockImplementation(() => {});
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Prepare a support report"),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Prepare a support report")!
      .click(),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  const preview = dialog.querySelector("textarea")!;
  const report = JSON.parse(preview.value);
  expect(report).toMatchObject({
    companyId,
    workflowId,
    runId,
    runStatus: "waiting",
    verification: "recorded_execution_only",
  });
  expect(preview.readOnly).toBe(true);
  expect(preview.value).not.toContain("Review customer-safe result");
  expect(preview.value).not.toContain("Human Approval");
  expect(preview.value).not.toContain("member");
  expect(dialog.textContent).toContain(
    "Nothing is sent to support automatically",
  );
  expect(download).not.toHaveBeenCalled();
  expect(
    dialog.querySelector('a[href="mailto:support@blentera.com"]'),
  ).not.toBeNull();
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "Download report")!
      .click(),
  );
  expect(download).toHaveBeenCalledExactlyOnceWith(report);
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
    "Download requested",
  );
  const opener = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Prepare a support report",
  )!;
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel")!
      .click(),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull(),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
});

it("withdraws the open support preview during native authority recheck and does not restore it from a late response", async () => {
  let resolveNew!: (view: View) => void;
  vi.spyOn(workflowsApi, "runExperience")
    .mockResolvedValueOnce(data)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
  const download = vi
    .spyOn(supportDownloads, "downloadWorkflowSupportDiagnostic")
    .mockImplementation(() => {});
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Prepare a support report"),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Prepare a support report")!
      .click(),
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () =>
    live({
      companyId,
      type: "activity.logged",
      payload: { action: "permission.revoked" },
    }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull(),
  );
  expect(document.querySelector("textarea")).toBeNull();
  expect(container.textContent).not.toContain("Prepare a support report");
  expect(download).not.toHaveBeenCalled();
  await act(async () => resolveNew(data));
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Prepare a support report"),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
