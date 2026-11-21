// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { EXPERIENCE_LOCALE_KEY, readExperienceLocale, readInitialExperienceLocale, persistExperienceLocale } from "./experience-locale-preference";
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  window.history.replaceState(null, "", "/");
});
it.each(["/saas/welcome?legacy=1&locale=da", "/saas/reset-password?token=opaque&locale=da"])("opens the mail landing in its message language without overwriting a saved choice: %s", path => {
  persistExperienceLocale("en");
  window.history.replaceState(null, "", path);
  expect(readInitialExperienceLocale()).toBe("da");
  expect(readExperienceLocale()).toBe("en");
});
it.each(["/dashboard?locale=en", "/saas/reset-password?locale=fr", "/saas/welcome?locale=DA"])("retains the saved choice for unsupported or unrelated locale parameters: %s", path => {
  persistExperienceLocale("da");
  window.history.replaceState(null, "", path);
  expect(readInitialExperienceLocale()).toBe("da");
});
it("uses the existing English default until a person selects a supported language", () => {
  expect(readExperienceLocale()).toBe("en");
  expect(persistExperienceLocale("da")).toBe(true);
  expect(localStorage.getItem(EXPERIENCE_LOCALE_KEY)).toBe("da");
  expect(readExperienceLocale()).toBe("da");
  expect(persistExperienceLocale("en")).toBe(true);
  expect(readExperienceLocale()).toBe("en");
});
it.each(["fr", "DA", '{"principal":"PRIVATE-LOCALE-CANARY"}', "x".repeat(10_000)])("ignores unrecognized saved values without treating them as content or configuration", (value) => {
  localStorage.setItem(EXPERIENCE_LOCALE_KEY, value);
  expect(readExperienceLocale()).toBe("en");
});
it("withholds invalid writes and handles unavailable browser storage", () => {
  expect(persistExperienceLocale("attacker" as "da")).toBe(false);
  expect(localStorage.getItem(EXPERIENCE_LOCALE_KEY)).toBeNull();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("PRIVATE-STORAGE-ERROR"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("PRIVATE-STORAGE-ERROR"); });
  expect(readExperienceLocale()).toBe("en");
  expect(persistExperienceLocale("da")).toBe(false);
});
it.each([
  [["fr-FR", "da-DK", "en-US"], "da"],
  [["en-GB", "da-DK"], "en"],
  [["fr-FR", "de-DE"], "en"],
])("uses the first supported browser language on a first visit: %j", (languages, expected) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  expect(readExperienceLocale()).toBe(expected);
  persistExperienceLocale("da");
  expect(readExperienceLocale()).toBe("da");
});
