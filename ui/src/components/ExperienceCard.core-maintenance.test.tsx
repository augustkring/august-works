// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExperienceCard as CardModel } from "@paperclipai/shared";
import { ExperienceCard } from "./ExperienceCard";
import { i18n } from "../i18n";

vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); vi.restoreAllMocks(); });

it.each([
  ["en", false, "Review your work checks"], ["da", false, "Gennemgå dine arbejdskontroller"],
] as const)("renders current recovery navigation in %s with capacity=%s and no effect controls", async (locale, capacity, heading) => {
  await i18n.changeLanguage(locale);
  const fetch = vi.spyOn(globalThis, "fetch");
  const source = { domain: "readiness" as const, companyId: "10000000-0000-4000-8000-000000000001",
    resourceId: "10000000-0000-4000-8000-000000000002", version: "a".repeat(64), observedAt: new Date().toISOString() };
  const card: CardModel = { id: "owned-recovery", kind: "maintenance", source, freshness: "fresh", title: "server fallback title",
    whyYou: "server fallback reason", consequence: "server fallback consequence",
    evidence: [capacity ? "own_open_checks" : "own_open_checks"], actions: [{ id: "review-own-checks", label: "fallback action",
      labelKey: "review", operation: "open", href: "/readiness", criticality: "C2", source, requiresCurrentAuthorization: true }] };
  await act(async () => root.render(<ExperienceCard card={card} />));
  expect(container.querySelector("h3")?.textContent).toBe(heading);
  expect(container.querySelector("article")?.getAttribute("aria-label")).toBe(heading);
  expect(container.textContent).not.toContain("server fallback");
  expect(container.textContent).not.toContain("own_open_checks");
  expect(container.textContent).not.toContain("own_open_checks");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/readiness");
  expect(container.querySelector("button")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
