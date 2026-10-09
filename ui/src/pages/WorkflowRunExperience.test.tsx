// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkflowRunExperience as View } from "@paperclipai/shared";
import { workflowsApi } from "../api/workflows";
import { WorkflowRunExperience } from "./WorkflowRunExperience";
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
    selectedCompanyId: "company",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("./WorkflowRun", () => ({ WorkflowRun: () => null }));
const data: View = {
  companyId: "company",
  id: "run",
  workflowId: "workflow",
  revisionId: "historical-revision",
  revisionNumber: 2,
  revisionState: "superseded",
  status: "waiting",
  trace: {
    state: "available",
    attempts: [
      {
        id: "attempt",
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
async function mount(principal = "member") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkflowRunExperience
            company="company"
            principal={principal}
            workflow="workflow"
            id="run"
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
  expect(container.querySelector('a[href$="/run/advanced"]')).not.toBeNull();
  expect(
    [...container.querySelectorAll("button")].map((b) => b.textContent),
  ).toEqual(["Refresh run"]);
  expect(get.mock.calls[0].slice(0, 4)).toEqual([
    "company",
    "member",
    "workflow",
    "run",
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
        companyId: "company",
        type: "activity.logged",
        payload: { action: "workflow.run_updated" },
      }),
    );
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(container.textContent).not.toContain("Review customer-safe result");
    await act(async () =>
      live({
        companyId: "company",
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
