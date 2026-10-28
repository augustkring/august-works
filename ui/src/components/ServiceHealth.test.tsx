// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PRODUCT_IDENTITY } from "@paperclipai/shared";
import { ServiceHealth } from "./ServiceHealth";
import { i18n } from "../i18n";

const query = vi.hoisted(() => ({ result: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query.result }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
const current = { state: "current", statusUrl: PRODUCT_IDENTITY.statusOrigin, observedAt: "2026-10-27T12:00:00Z",
  providerUpdatedAt: "2026-10-27T11:00:00Z", indicator: "none", source: "statuspage_public_v2",
  components: [{ id: "app", name: "Blentera app", status: "operational" }], incidents: [], scheduledMaintenance: [] };
beforeEach(async () => {
  await i18n.changeLanguage("en");
  query.result = { data: current, isError: false, isPending: false };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(compact = false) { await act(async () => root.render(<ServiceHealth compact={compact} />)); }

it("discards a previous all-clear on a failed refresh and retains the independent handoff", async () => {
  query.result = { data: current, isError: true, isPending: false };
  await render();
  expect(container.textContent).toContain("cannot verify current service status");
  expect(container.textContent).not.toContain("Operational");
  expect(container.querySelector(`a[href="${PRODUCT_IDENTITY.statusOrigin}"]`)).not.toBeNull();
});
it("shows the compact projection for a current incident and renders provider titles as text", async () => {
  query.result = { data: { ...current, indicator: "minor", incidents: [{ id: "incident1", name: "<img src=x onerror=alert(1)>",
    status: "investigating", updatedAt: current.observedAt, href: `${PRODUCT_IDENTITY.statusOrigin}/incidents/incident1`, scheduledFor: null, scheduledUntil: null }] } };
  await render(true); expect(container.querySelector("aside")).not.toBeNull();
  await render(); expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
});
it("does not turn an unconfigured provider into a green service claim or a global incident", async () => {
  query.result = { data: { state: "unconfigured", statusUrl: PRODUCT_IDENTITY.statusOrigin } };
  await render(true); expect(container.textContent).toBe("");
  await act(async () => { await i18n.changeLanguage("da"); }); await render();
  expect(container.textContent).toContain("kan ikke bekræfte den aktuelle servicestatus");
});
