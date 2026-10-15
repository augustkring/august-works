// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  WorkflowExperience,
  WorkflowPublicationReview,
} from "@paperclipai/shared";
import { WorkflowPublicationControls } from "./WorkflowPublicationControls";
import { workflowsApi, createWorkflowsApi } from "../api/workflows";
import { api } from "../api/client";
import "../i18n";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
beforeEach(() => { window.sessionStorage.clear(); vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner")); });
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1),
  workflow = id(2),
  draft = id(3),
  run = id(4);
const view: WorkflowPublicationReview = {
  companyId: company,
  workflowId: workflow,
  updatedAt: "2026-10-10T00:00:00Z",
  draftRevisionId: draft,
  publishedRevisionId: null,
  draftVersion: 3,
  testedRunId: run,
  availability: "internal_ready",
  receipt: null,
};
const detail = { canOperate: true } as WorkflowExperience;
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
  useCompany: () => ({ selectedCompany: { issuePrefix: "AW" }, selectedCompanyId: company }),
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function mount(refresh = vi.fn()) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkflowPublicationControls
            company={company}
            principal="owner"
            id={workflow}
            detail={detail}
            refresh={refresh}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Publish internal version"),
  );
}
function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (el) => el.textContent === text,
  )!;
}
async function click(el: HTMLElement) {
  await act(async () => el.click());
}
it("freezes the native draft/test tuple and requires explicit acknowledgement", async () => {
  vi.spyOn(workflowsApi, "publicationReview").mockResolvedValue(view);
  const publish = vi
    .spyOn(workflowsApi, "publishReviewed")
    .mockImplementation(async (_c, _p, _w, command) => ({
      companyId: company,
      workflowId: workflow,
      requestId: command.requestId,
      revisionId: draft,
      testRunId: run,
      disposition: "published",
    }));
  await mount();
  await click(button("Publish reviewed version"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("version 3");
  expect(dialog.textContent).toContain("replaces the prior published revision");
  const confirm = Array.from(dialog.querySelectorAll("button")).find(
    (el) => el.textContent === "Publish reviewed version",
  )!;
  expect(confirm.disabled).toBe(true);
  expect(publish).not.toHaveBeenCalled();
  await click(dialog.querySelector('input[type="checkbox"]')!);
  await click(confirm);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  expect(publish.mock.calls[0][3]).toMatchObject({
    expectedDraftRevisionId: draft,
    expectedTestRunId: run,
    expectedPublishedRevisionId: null,
    acknowledgeInternalPublication: true,
  });
});
it("retains and retries the exact unknown publication request", async () => {
  vi.spyOn(workflowsApi, "publicationReview").mockResolvedValue(view);
  const publish = vi
    .spyOn(workflowsApi, "publishReviewed")
    .mockRejectedValue(new Error("Lost private response"));
  await mount();
  await click(button("Publish reviewed version"));
  await click(document.querySelector('input[type="checkbox"]')!);
  await click(
    Array.from(
      document.querySelector('[role="dialog"]')!.querySelectorAll("button"),
    ).find((el) => el.textContent === "Publish reviewed version")!,
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("response is unconfirmed"),
  );
  const original = publish.mock.calls[0][3];
  await click(
    Array.from(
      document.querySelector('[role="dialog"]')!.querySelectorAll("button"),
    ).find((el) => el.textContent === "Retry original publication request")!,
  );
  await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
  expect(publish.mock.calls[1][3]).toEqual(original);
});
it("reload-style native receipt recovery shows the original publication without a new effect", async () => {
  vi.spyOn(workflowsApi, "publicationReview").mockResolvedValue({
    ...view,
    availability: "test_required",
    testedRunId: null,
    receipt: {
      companyId: company,
      workflowId: workflow,
      requestId: id(7),
      revisionId: draft,
      testRunId: run,
      disposition: "published",
    },
  });
  const publish = vi.spyOn(workflowsApi, "publishReviewed");
  await mount();
  expect(container.textContent).toContain(
    "original native publication was recorded",
  );
  expect(publish).not.toHaveBeenCalled();
});
it("hides retained publication metadata after current private access is lost", async () => {
  vi.spyOn(workflowsApi, "publicationReview")
    .mockResolvedValueOnce(view)
    .mockRejectedValueOnce(new Error("private-role-loss"));
  await mount();
  await act(async () =>
    live({ companyId: company, type: "activity.logged", payload: {} }),
  );
  await vi.waitFor(() =>
    expect(container.textContent).not.toContain("Publish internal version"),
  );
  expect(container.textContent).not.toContain("private-role-loss");
});
it("binds private reads and refuses a foreign receipt before acknowledging publication", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(view);
  const service = createWorkflowsApi(api),
    signal = new AbortController().signal;
  await service.publicationReview(company, "current owner", workflow, signal);
  expect(get).toHaveBeenCalledWith(
    expect.stringContaining("expectedUserId=current%20owner"),
    { signal, cache: "no-store" },
  );
  vi.spyOn(api, "post").mockResolvedValue({
    companyId: company,
    workflowId: workflow,
    requestId: id(5),
    revisionId: id(8),
    testRunId: run,
    disposition: "published",
  });
  await expect(
    service.publishReviewed(company, "owner", workflow, {
      requestId: id(5),
      expectedWorkflowId: workflow,
      expectedUpdatedAt: view.updatedAt,
      expectedDraftRevisionId: draft,
      expectedPublishedRevisionId: null,
      expectedTestRunId: run,
      acknowledgeInternalPublication: true,
    }),
  ).rejects.toThrow("binding changed");
});
