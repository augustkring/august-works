// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowExperience,
  WorkflowOperations as Operations,
} from "@paperclipai/shared";
import { WorkflowOperations } from "./WorkflowOperations";
import { workflowsApi, createWorkflowsApi } from "../api/workflows";
import { api } from "../api/client";
import "../i18n";

const company = "10000000-0000-4000-8000-000000000001";
const workflow = "10000000-0000-4000-8000-000000000002";
const revision = "10000000-0000-4000-8000-000000000003";
const id = "10000000-0000-4000-8000-000000000004";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { issuePrefix: "AW" },
    selectedCompanyId: company,
  }),
}));
const detail: WorkflowExperience = {
  companyId: company,
  id: workflow,
  name: "Private workflow",
  description: null,
  status: "active",
  updatedAt: "2026-10-09T10:00:00.000Z",
  canEdit: false,
  canOperate: false,
  canRequestRun: false,
  runAvailability: "review_required",
  draft: null,
  comparison: null,
  active: {
    id: revision,
    version: 1,
    state: "published",
    coverage: "complete",
    steps: [],
  },
};
const view: Operations = {
  companyId: company,
  workflowId: workflow,
  publishedRevisionId: revision,
  updatedAt: detail.updatedAt,
  status: "active",
  nextTrigger: { state: "scheduled", at: "2026-10-10T08:00:00.000Z" },
  recent: {
    runs: [
      {
        id,
        revisionId: revision,
        status: "succeeded",
        createdAt: "2026-10-09T08:00:00.000Z",
        finishedAt: "2026-10-09T08:01:00.000Z",
      },
    ],
    hasMore: true,
  },
  blockers: {
    runs: [
      {
        id,
        revisionId: revision,
        status: "waiting",
        createdAt: "2026-10-09T08:00:00.000Z",
        finishedAt: null,
      },
    ],
    hasMore: false,
  },
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function mount(refresh = vi.fn()) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkflowOperations
            company={company}
            principal="member"
            detail={detail}
            refresh={refresh}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return refresh;
}
it("shows configured timing, actual run/blocker links and the independent-verification boundary", async () => {
  vi.spyOn(workflowsApi, "operations").mockResolvedValue(view);
  const refresh = await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Next scheduled request:"),
  );
  expect(container.textContent).toContain("Other requests can arrive sooner");
  expect(container.textContent).toContain(
    "does not establish an independently verified business result",
  );
  expect(container.textContent).toContain("Showing the ten most recent runs");
  expect(
    container.querySelectorAll(`a[href$='/workflows/${workflow}/runs/${id}']`),
  ).toHaveLength(2);
  expect(container.textContent).not.toContain(revision);
  await act(async () => [...container.querySelectorAll("button")][0].click());
  expect(refresh).toHaveBeenCalledOnce();
});
it("hides retained private metadata while the current read is pending, then suppresses denied data", async () => {
  const get = vi.spyOn(workflowsApi, "operations").mockResolvedValueOnce(view);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Next scheduled request:"),
  );
  let reject!: (error: Error) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: ["workflow-operations"] });
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Loading"));
  expect(container.querySelector(`a[href$='/runs/${id}']`)).toBeNull();
  await act(async () => reject(new Error("PRIVATE-DENIED")));
  await vi.waitFor(() =>
    expect(container.querySelector("[role=alert]")).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("PRIVATE-DENIED");
  expect(container.textContent).not.toContain("Next scheduled request:");
});
it.each(["updatedAt", "publishedRevisionId", "status"] as const)(
  "requires the overview to match the current parent %s",
  async (field) => {
    vi.spyOn(workflowsApi, "operations").mockResolvedValue({
      ...view,
      [field]:
        field === "status"
          ? "paused"
          : field === "updatedAt"
            ? "2026-10-09T11:00:00.000Z"
            : id,
    });
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector("[role=alert]")).not.toBeNull(),
    );
    expect(container.querySelector(`a[href$='/runs/${id}']`)).toBeNull();
  },
);
it.each(["companyId", "workflowId"] as const)(
  "rejects a foreign %s even when its strict schema is valid",
  async (field) => {
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ ...view, [field]: id });
    await expect(
      createWorkflowsApi(api).operations(company, "member", workflow),
    ).rejects.toThrow("Workflow overview context changed");
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("expectedUserId=member"),
      { signal: undefined, cache: "no-store" },
    );
  },
);
