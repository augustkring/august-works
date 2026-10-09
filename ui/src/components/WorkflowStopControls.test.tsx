// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowRunExperience,
  WorkflowStopCommand,
} from "@paperclipai/shared";
import { WorkflowStopControls } from "./WorkflowStopControls";
import { workflowsApi } from "../api/workflows";
import { ApiError } from "../api/client";
import "../i18n";
const company = "10000000-0000-4000-8000-000000000001",
  workflow = "10000000-0000-4000-8000-000000000002",
  revision = "10000000-0000-4000-8000-000000000003",
  run = "10000000-0000-4000-8000-000000000004";
const detail: WorkflowRunExperience = {
  companyId: company,
  workflowId: workflow,
  id: run,
  revisionId: revision,
  revisionNumber: 2,
  revisionState: "superseded",
  status: "waiting",
  updatedAt: "2026-10-09T10:00:00.000Z",
  canRequestStop: true,
  trace: { state: "available", attempts: [] },
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
async function render(value: WorkflowRunExperience | null) {
  if (!root || !container?.isConnected) {
    client = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <WorkflowStopControls
          company={company}
          principal="member"
          workflow={workflow}
          id={run}
          detail={value}
          refresh={refresh}
        />
      </QueryClientProvider>,
    ),
  );
}
async function click(label: string, inDialog = false) {
  const scope = inDialog
    ? document.querySelector('[role="dialog"]')!
    : document;
  const target = [...scope.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  expect(target).toBeDefined();
  await act(async () => target!.click());
}
async function acknowledge() {
  const checkbox = document.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox!.click());
}
const receipt = (command: WorkflowStopCommand) => ({
  companyId: company,
  workflowId: workflow,
  runId: run,
  revisionId: command.expectedRevisionId,
  requestId: command.requestId,
  disposition: "cancellation_requested" as const,
});
it("requires acknowledgement and freezes the reviewed run when its live state changes", async () => {
  const stop = vi
    .spyOn(workflowsApi, "stop")
    .mockImplementation(async (_c, _p, _w, _r, command) => receipt(command));
  await render(detail);
  await click("Stop run");
  expect(stop).not.toHaveBeenCalled();
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent === "Stop run")!;
  expect(confirm.disabled).toBe(true);
  expect(document.body.textContent).toContain("Completed actions remain");
  await render({
    ...detail,
    revisionNumber: 3,
    revisionId: crypto.randomUUID(),
    updatedAt: "2026-10-09T11:00:00.000Z",
  });
  expect(document.body.textContent).toContain(
    "Reviewed run of published version 2",
  );
  expect(document.body.textContent).not.toContain(
    "Reviewed run of published version 3",
  );
  await acknowledge();
  await click("Stop run", true);
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The original stop request was accepted",
    ),
  );
  expect(stop.mock.calls[0][4]).toMatchObject({
    expectedWorkflowId: workflow,
    expectedRevisionId: revision,
    expectedUpdatedAt: detail.updatedAt,
    acknowledgeCompletedEffectsRemain: true,
  });
  expect(container.textContent).toContain("whether all work has stopped");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(
    container.querySelector('[role="status"]'),
  );
});
it("keeps the original unknown command across private checks and eventual terminal status", async () => {
  const stop = vi
    .spyOn(workflowsApi, "stop")
    .mockRejectedValueOnce(new Error("PRIVATE-ERROR"))
    .mockImplementationOnce(async (_c, _p, _w, _r, command) =>
      receipt(command),
    );
  await render(detail);
  await click("Stop run");
  await acknowledge();
  await click("Stop run", true);
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "The stop request could not be confirmed",
    ),
  );
  expect(document.body.textContent).not.toContain("PRIVATE-ERROR");
  const original = stop.mock.calls[0][4];
  await click("Close", true);
  await render(null);
  expect(document.body.textContent).not.toContain(
    "Retry original stop request",
  );
  await render({ ...detail, canRequestStop: false });
  expect(document.body.textContent).not.toContain(
    "Retry original stop request",
  );
  await render({
    ...detail,
    status: "cancelled",
    revisionNumber: 3,
    updatedAt: "2026-10-09T11:00:00.000Z",
  });
  await click("Retry original stop request");
  expect(document.body.textContent).toContain(
    "Reviewed run of published version 2",
  );
  expect(document.body.textContent).not.toContain(
    "Reviewed run of published version 3",
  );
  expect(
    [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === "Retry original stop request")
      ?.disabled,
  ).toBe(true);
  await acknowledge();
  await click("Retry original stop request", true);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  expect(stop.mock.calls[1][4]).toEqual(original);
});
it("starts a fresh review only after a canonical native pre-effect refusal", async () => {
  const stop = vi
    .spyOn(workflowsApi, "stop")
    .mockRejectedValueOnce(
      new ApiError("REFUSED", 409, {
        details: { code: "workflow_stop_conflict" },
      }),
    )
    .mockImplementationOnce(async (_c, _p, _w, _r, command) =>
      receipt(command),
    );
  await render(detail);
  await click("Stop run");
  await acknowledge();
  await click("Stop run", true);
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The run changed before this stop request was accepted",
    ),
  );
  await render({ ...detail, updatedAt: "2026-10-09T11:00:00.000Z" });
  await click("Stop run");
  await acknowledge();
  await click("Stop run", true);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  expect(stop.mock.calls[1][4].requestId).not.toBe(
    stop.mock.calls[0][4].requestId,
  );
  expect(stop.mock.calls[1][4].expectedUpdatedAt).toBe(
    "2026-10-09T11:00:00.000Z",
  );
});
it.each([
  null,
  { ...detail, canRequestStop: false },
  { ...detail, status: "succeeded" as const },
  { ...detail, companyId: crypto.randomUUID() },
])("offers no new stop without a current eligible review %j", async (view) => {
  const stop = vi.spyOn(workflowsApi, "stop");
  await render(view);
  expect(container.textContent).toBe("");
  expect(stop).not.toHaveBeenCalled();
});
