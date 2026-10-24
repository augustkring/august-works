// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerHelpCenter } from "./CustomerHelpCenter";
import "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { issuePrefix: "PAP" } }),
}));
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  container = null;
});

it("links to the governed docs, service status, support cases, and direct human contacts", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter initialEntries={["/PAP/company/help"]}><CustomerHelpCenter /></MemoryRouter>));

  expect(container.textContent).toContain("How can we help?");
  expect(container.querySelector('a[href="https://docs.blentera.com"]')).not.toBeNull();
  expect(container.querySelector('a[href="https://status.blentera.com"]')).not.toBeNull();
  expect(container.querySelector('a[href="/PAP/company/support"]')).not.toBeNull();
  expect(container.querySelector('a[href="mailto:support@blentera.com"]')).not.toBeNull();
  expect(container.querySelector('a[href="mailto:security@blentera.com"]')).not.toBeNull();
  expect(container.querySelector('a[href="mailto:privacy@blentera.com"]')).not.toBeNull();
});
