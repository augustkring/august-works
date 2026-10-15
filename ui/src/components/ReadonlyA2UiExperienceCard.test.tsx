// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeExperienceA2Ui, type ExperienceCard } from "@paperclipai/shared";
import { ReadonlyA2UiExperienceCard } from "./ReadonlyA2UiExperienceCard";
import "../i18n";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "00000000-0000-4000-8000-000000000001";
const source = {
  companyId,
  domain: "task" as const,
  resourceId: "task",
  version: "1",
  observedAt: "2026-10-10T06:00:00.000Z",
};
const card: ExperienceCard = {
  id: "card",
  kind: "decision",
  title: "Review task",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh",
  evidence: [],
  actions: [
    {
      id: "view",
      label: "View task",
      operation: "open",
      href: "/issues/task",
      criticality: "C0",
      source,
      requiresCurrentAuthorization: true,
    },
  ],
};
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
async function render(wire: unknown, currentNative = card) {
  await act(async () =>
    root.render(
      <ReadonlyA2UiExperienceCard
        wire={wire}
        currentNative={currentNative}
        companyId={companyId}
        surfaceId="current-card"
      />,
    ),
  );
}

it("renders the actual typed card with navigation and no effect controls or request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  await render(encodeExperienceA2Ui(card, companyId, "current-card"));
  expect(container.querySelector("article")?.getAttribute("aria-label")).toBe(
    "Review task",
  );
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "/issues/task",
  );
  expect(container.querySelector("button")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("withdraws the peer card when separately observed Native state changes", async () => {
  const wire = encodeExperienceA2Ui(card, companyId, "current-card");
  await render(wire);
  await render(wire, { ...card, source: { ...source, version: "2" } });
  expect(container.querySelector("article")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "The current view is unavailable",
  );
});
it("uses fixed refusal copy without showing peer secrets or arbitrary components", async () => {
  await render(
    JSON.stringify([
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "current-card",
          components: [
            { id: "root", component: "HTML", html: "private-secret" },
          ],
        },
      },
    ]),
  );
  expect(container.querySelector("article")).toBeNull();
  expect(container.textContent).not.toContain("private-secret");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("escapes admitted Native text and rejects model bindings and event handlers", async () => {
  const literal = { ...card, title: '<img src=x onerror="sendPrivateData()">' };
  await render(
    encodeExperienceA2Ui(literal, companyId, "current-card"),
    literal,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain(literal.title);
  const events = JSON.parse(
    encodeExperienceA2Ui(card, companyId, "current-card"),
  );
  events[1].updateComponents.components[0].onClick = { call: "approve" };
  await render(JSON.stringify(events));
  expect(container.querySelector("article")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});
