/** Explicit display preference only. It carries no identity or company data. */
export const EXPERIENCE_LOCALE_KEY = "aw.v9.display-locale";
export type ExperienceLocale = "en" | "da";
export function isExperienceLocale(value: unknown): value is ExperienceLocale {
  return value === "en" || value === "da";
}
export function readExperienceLocale(): ExperienceLocale {
  try {
    const value = window.localStorage.getItem(EXPERIENCE_LOCALE_KEY);
    return isExperienceLocale(value) ? value : "en";
  } catch {
    return "en";
  }
}
/** Mail links carry the language of their message, without changing a saved choice. */
export function readInitialExperienceLocale(): ExperienceLocale {
  if (typeof window !== "undefined" &&
      ["/saas/welcome", "/saas/reset-password"].includes(window.location.pathname)) {
    const locale = new URLSearchParams(window.location.search).get("locale");
    if (isExperienceLocale(locale)) return locale;
  }
  return readExperienceLocale();
}
export function persistExperienceLocale(locale: ExperienceLocale): boolean {
  if (!isExperienceLocale(locale)) return false;
  try {
    window.localStorage.setItem(EXPERIENCE_LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
