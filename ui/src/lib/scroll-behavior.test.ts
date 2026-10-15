// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { preferredScrollBehavior } from "./scroll-behavior";

afterEach(() => vi.unstubAllGlobals());
it("honors a live preference change for both defaults and explicit smooth requests", () => {
  let reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(prefers-reduced-motion: reduce)");
    return { matches: reduced };
  });
  expect(preferredScrollBehavior()).toBe("smooth");
  expect(preferredScrollBehavior("instant")).toBe("instant");
  reduced = true;
  expect(preferredScrollBehavior()).toBe("auto");
  expect(preferredScrollBehavior("smooth")).toBe("auto");
  reduced = false;
  expect(preferredScrollBehavior("smooth")).toBe("smooth");
});
it("preserves the caller's behavior when media preferences cannot be queried", () => {
  vi.stubGlobal("matchMedia", undefined);
  expect(preferredScrollBehavior()).toBe("smooth");
  expect(preferredScrollBehavior("auto")).toBe("auto");
});
