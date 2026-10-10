// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { EXPERIENCE_LOCALE_KEY } from "../i18n/experience-locale-preference";
import { ExperienceLanguageSelect } from "./ExperienceLanguageSelect";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
});
async function mount() {
  await i18n.changeLanguage("en");
  container = document.createElement("div");document.body.append(container);root = createRoot(container);
  await act(async () => root!.render(<ExperienceLanguageSelect />));
}
async function change(locale: string) {
  const select = container!.querySelector("select")!;
  await act(async () => { select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
it("changes real translated labels and document language with only a display preference", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  await mount();
  expect(container!.textContent).toContain("Language");
  await change("da");
  expect(container!.textContent).toContain("Sprog");
  expect(document.documentElement.lang).toBe("da");
  expect(container!.querySelector("select")!.value).toBe("da");
  expect(localStorage.getItem(EXPERIENCE_LOCALE_KEY)).toBe("da");
  expect(fetch).not.toHaveBeenCalled();
  await change("en");
  expect(document.documentElement.lang).toBe("en");
});
it("preserves the chosen language and provides safe feedback if saving is unavailable", async () => {
  await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("PRIVATE-STORAGE-CANARY"); });
  await change("da");
  expect(i18n.resolvedLanguage).toBe("da");
  expect(container!.querySelector('[role="status"]')?.textContent).toBe("Sproget er ændret for denne session. Valget kunne ikke gemmes.");
  expect(container!.textContent).not.toContain("PRIVATE-STORAGE-CANARY");
});
it("retains the current selection and uses a safe alert if the language change fails", async () => {
  // react-i18next captures instance descriptors on mount; install the failure
  // before mounting so the real hook receives the same mocked method.
  const nativeChange = i18n.changeLanguage.bind(i18n);
  vi.spyOn(i18n, "changeLanguage")
    .mockImplementationOnce(nativeChange)
    .mockRejectedValueOnce(new Error("PRIVATE-LANGUAGE-CANARY"));
  await mount();
  await change("da");
  expect(i18n.resolvedLanguage).toBe("en");
  expect(container!.querySelector("select")!.value).toBe("en");
  expect(container!.querySelector('[role="alert"]')?.textContent).toBe("The language could not be changed. Try again.");
  expect(container!.textContent).not.toContain("PRIVATE-LANGUAGE-CANARY");
  expect(localStorage.getItem(EXPERIENCE_LOCALE_KEY)).toBeNull();
});
