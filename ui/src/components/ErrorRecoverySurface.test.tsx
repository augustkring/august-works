// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ErrorRecoverySurface } from "./ErrorRecoverySurface";

describe("provider-independent error recovery", () => {
  it.each(["en", "da-DK"])("keeps recovery reachable without providers in %s", (language) => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = language;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container), back = vi.fn();
    try {
      act(() => root.render(<ErrorRecoverySurface scope="page" onBack={back} />));
      expect(document.activeElement).toBe(container.querySelector("h1"));
      expect(container.querySelector('section')?.getAttribute("aria-labelledby")).toBe(container.querySelector("h1")?.id);
      const link = container.querySelector("a")!;
      expect(link.getAttribute("href")).toBe("mailto:support@blentera.com");
      expect(link.textContent).toBe(language === "en" ? "Contact support" : "Kontakt support");
      expect(container.textContent).toContain(language === "en" ? "does not confirm whether the change was saved" : "bekræfter ikke, om ændringen blev gemt");
      expect(container.textContent).toContain(language === "en" ? "Unsaved changes" : "kan gå tabt");
      act(() => container.querySelector("button")!.click());
      expect(back).toHaveBeenCalledOnce();
      for (const control of container.querySelectorAll("button,a")) expect(control.classList.contains("min-h-11")).toBe(true);
    } finally {
      act(() => root.unmount()); container.remove(); document.documentElement.lang = previous;
    }
  });
});
