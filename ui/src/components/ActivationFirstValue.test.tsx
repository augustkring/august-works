// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activationFirstValueResultSchema,
  type ActivationView,
} from "@paperclipai/shared";
import { ActivationFirstValue } from "./ActivationFirstValue";
import "../i18n";
vi.mock("../lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = "10000000-0000-4000-8000-000000000001";
const result = activationFirstValueResultSchema.parse({
  installationId: id,
  verificationRunId: id,
  issueId: id,
  runId: id,
  resultHash: "a".repeat(64),
  title: "<img src=x onerror=alert(1)> Reviewed research draft",
  verifiedAt: "2026-10-10T08:00:00.000Z",
  artifacts: [{ documentId: id, documentKey: "result", revisionId: id, hash: "b".repeat(64) }],
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const onRecord = vi.fn();
async function render(value: ActivationView["firstValue"], canRecord = true) {
  await act(async () =>
    root.render(
      <ActivationFirstValue
        value={value}
        canRecord={canRecord}
        onRecord={onRecord}
      />,
    ),
  );
}
it("requires an explicit choice and records references without execution, outcome or timestamp claims", async () => {
  onRecord.mockClear();
  await render({
    status: "not_recorded",
    result: null,
    candidates: [result],
    hasMore: false,
  });
  expect(onRecord).not.toHaveBeenCalled();
  expect(container.querySelector("img")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(onRecord).toHaveBeenCalledExactlyOnceWith({
    installationId: id,
    verificationRunId: id,
  });
  expect(container.textContent).toContain("does not establish revenue");
  await render(
    {
      status: "not_recorded",
      result: null,
      candidates: [result],
      hasMore: false,
    },
    false,
  );
  expect(container.querySelector("button")!.disabled).toBe(true);
});
it("shows a current independently reviewed result with the original task and no execution controls", async () => {
  await render({ status: "verified", result, candidates: [], hasMore: false });
  expect(container.textContent).toContain("independent human review");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    `/issues/${id}`,
  );
  expect(container.querySelector("button")).toBeNull();
  const output = Array.from(container.querySelectorAll("a")).find((link) =>
    link.textContent?.includes("Open reviewed output"),
  );
  expect(output?.getAttribute("href")).toBe(`/issues/${id}#document-result&viewer=full`);
  expect(container.querySelector("summary")?.textContent).toBe("Why is this result ready?");
  expect(container.textContent).toContain("One saved output matches");
  expect(container.textContent).toContain("changes need a new review");
  expect(container.textContent).not.toContain(id);
});
it("retains the original task link for an older receipt without inventing a document destination", async () => {
  const legacy = activationFirstValueResultSchema.parse({
    ...result,
    artifacts: [{ documentId: id, revisionId: id, hash: "b".repeat(64) }],
  });
  await render({ status: "verified", result: legacy, candidates: [], hasMore: false });
  expect(container.querySelectorAll("a")).toHaveLength(1);
  expect(container.querySelector("a")?.getAttribute("href")).toBe(`/issues/${id}`);
  expect(container.querySelector("button")).toBeNull();
});
it("withdraws old titles, references and recording controls when evidence is unavailable or the current read is pending", async () => {
  await render({ status: "verified", result, candidates: [], hasMore: false });
  await render({
    status: "withdrawn",
    result: null,
    candidates: [],
    hasMore: false,
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Reviewed research draft");
  expect(container.querySelector("a,button")).toBeNull();
  await render(undefined);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector("a,button")).toBeNull();
});
