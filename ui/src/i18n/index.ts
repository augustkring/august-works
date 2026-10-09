import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, supportedLocales } from "./locales";
import experienceEn from "./experience/en.json";
import experienceDa from "./experience/da.json";
import { assertValidLocaleMessages } from "./locale-validation";

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

// V9 launches with explicit English/Danish coverage; other registered locales
// use i18next's English fallback rather than claiming unreviewed translations.
assertValidLocaleMessages(experienceDa, experienceEn);
i18n.addResourceBundle("en", "experience", experienceEn);
i18n.addResourceBundle("da", "experience", experienceDa);

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n };
