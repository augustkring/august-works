// @vitest-environment jsdom

import { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Governance } from "./Governance";

const mockHiddenSettings = vi.hoisted(() => new Set<string>());
const mockHiddenSettingsLoaded = vi.hoisted(() => ({ value: true }));
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("@/hooks/useHiddenSettings", () => ({
  useHiddenSettings: () => ({
    hidden: mockHiddenSettings,
    loaded: mockHiddenSettingsLoaded.value,
  }),
}));

describe("Governance", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    mockHiddenSettings.clear();
    mockHiddenSettingsLoaded.value = true;
    mockSetBreadcrumbs.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("answers the governance question with concrete existing control surfaces", () => {
    const root = createRoot(container);
    flushSync(() => root.render(<Governance />));

    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain(
      "Who can access what, and what can they do with it?",
    );

    const hrefForTitle = (title: string) =>
      [...container.querySelectorAll("a")]
        .find((anchor) => anchor.textContent?.includes(title))
        ?.getAttribute("href");

    expect(hrefForTitle("Members & access")).toBe("/company/settings/members");
    expect(hrefForTitle("Agent permissions")).toBe("/agents/all");
    expect(hrefForTitle("Connection access")).toBe("/apps");
    expect(hrefForTitle("Audit history")).toBe("/activity");

    expect(mockSetBreadcrumbs).toHaveBeenCalledWith([
      { label: "Governance", href: "/governance" },
    ]);

    flushSync(() => root.unmount());
  });

  it("does not expose governance destinations before visibility settings load", () => {
    mockHiddenSettingsLoaded.value = false;
    const root = createRoot(container);
    flushSync(() => root.render(<Governance />));

    expect(
      container.querySelector('[aria-label="Loading governance controls"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);

    flushSync(() => root.unmount());
  });

  it("does not re-expose operator-hidden settings pages", () => {
    mockHiddenSettings.add("company.members");
    mockHiddenSettings.add("company.secrets");
    mockHiddenSettings.add("instance.access");

    const root = createRoot(container);
    flushSync(() => root.render(<Governance />));

    const hrefs = [...container.querySelectorAll("a")].map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(hrefs).not.toContain("/company/settings/members");
    expect(hrefs).not.toContain("/company/settings/secrets");
    expect(hrefs).not.toContain("/company/settings/instance/access");
    expect(hrefs).toEqual(expect.arrayContaining(["/agents/all", "/apps", "/activity"]));

    flushSync(() => root.unmount());
  });
});
