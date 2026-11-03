// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { CustomerChangelog } from "./CustomerChangelog";
import { i18n } from "../i18n";

const read = vi.hoisted(() => vi.fn());
vi.mock("../api/announcements", () => ({ announcementsApi: { changelog: read } }));
it("shows translated labels, explicit language fallback, actions and unavailable configuration without inventing releases", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  read.mockResolvedValue({ state: "available", coverage: "configured_publication_window", entries: [{
    id: "note-en", title: "Reviewed change", description: "Customer description", publishedAt: "2026-01-01T00:00:00Z",
    releaseNote: { releaseId: "v10-test", locale: "en", changes: ["Published change"], affectedAudience: "Members",
      actionRequired: true, requiredAction: "Review your settings", documentation: [{ label: "Migration", url: "https://docs.example.test/migration" }],
      rollback: null, knownLimitations: ["Existing limitation"] },
  }] });
  async function render(locale: "en" | "da", active = true) {
    await act(async () => {
      await i18n.changeLanguage(locale);
      root.render(<QueryClientProvider client={client}><CustomerChangelog locale={locale} active={active} scope="session-one" /></QueryClientProvider>);
      await new Promise(resolve => setTimeout(resolve, 15));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  }
  try {
    await render("da");
    expect(element.textContent).toContain("Produktændringer");
    expect(element.textContent).toContain("Denne udgivelsesnote findes på en.");
    expect(element.textContent).toContain("Review your settings");
    expect(element.textContent).toContain("Existing limitation");
    expect(element.querySelector("a")?.getAttribute("rel")).toBe("noreferrer");
    await render("en");
    expect(element.textContent).toContain("Product changes");
    expect(element.textContent).not.toContain("This release note is available");
    await render("en", false);
    expect(element.textContent).not.toContain("Reviewed change");
    expect(element.textContent).toContain("Sign in");
    client.clear(); read.mockResolvedValue({ state: "unconfigured", coverage: "configured_publication_window", entries: [] });
    await render("da");
    expect(element.textContent).toContain("Udgivelsesnoter er ikke konfigureret");
    expect(element.textContent).not.toContain("Reviewed change");
  } finally {
    await act(async () => { root.unmount(); }); client.clear(); element.remove(); await i18n.changeLanguage("en");
  }
});
