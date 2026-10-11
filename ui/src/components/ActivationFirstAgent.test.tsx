// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ActivationFirstAgent } from "./ActivationFirstAgent";
import { i18n } from "../i18n";
vi.mock("../lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); await i18n.changeLanguage("en"); });
async function mount(element: React.ReactNode) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(element));
}
it("requires current preparation authority and one explicit click; language changes do not create an agent", async () => {
  const prepare = vi.fn(), props = { value: { status: "not_created" as const, agentId: null, name: null, canPrepare: true }, canPrepare: false, pending: false, onPrepare: prepare };
  await mount(<ActivationFirstAgent {...props} />);
  expect(container.textContent).toContain("creates a paused agent"); expect(container.querySelector("button")?.disabled).toBe(true);
  await act(async () => root.render(<ActivationFirstAgent {...props} canPrepare />));
  await act(async () => { await i18n.changeLanguage("da"); });
  expect(container.textContent).toContain("Forbered første agent"); expect(prepare).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); expect(prepare).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ActivationFirstAgent {...props} canPrepare pending />));
  expect(container.querySelector("button")?.disabled).toBe(true);
});
it("shows paused preparation and escaped original name separately from any activation or test proof", async () => {
  const prepare = vi.fn();
  await mount(<ActivationFirstAgent value={{ status: "prepared", agentId: "original", name: "<script>PRIVATE plain name</script>", canPrepare: false }} canPrepare pending={false} onPrepare={prepare} />);
  expect(container.textContent).toContain("Access and testing are still needed");
  expect(container.querySelector("script")).toBeNull(); expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/agents/original/monitor"); expect(prepare).not.toHaveBeenCalled();
});
it("does not replace an unavailable original source or offer creation without native authority", async () => {
  const prepare = vi.fn();
  await mount(<ActivationFirstAgent value={{ status: "unavailable", agentId: null, name: null, canPrepare: false }} canPrepare pending={false} onPrepare={prepare} />);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("No replacement has been created");
  expect(container.querySelectorAll("a,button")).toHaveLength(0);
  await act(async () => root.render(<ActivationFirstAgent value={{ status: "not_created", agentId: null, name: null, canPrepare: false }} canPrepare pending={false} onPrepare={prepare} />));
  expect(container.textContent).toBe(""); expect(prepare).not.toHaveBeenCalled();
});
