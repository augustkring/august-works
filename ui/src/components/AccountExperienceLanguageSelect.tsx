import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { authApi } from "../api/auth";
import { EXPERIENCE_LOCALE_KEY, isExperienceLocale } from "../i18n/experience-locale-preference";
import { queryKeys } from "../lib/queryKeys";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { ExperienceLanguageSelect } from "./ExperienceLanguageSelect";

export function AccountExperienceLanguageSelect({ userId: expectedUserId }: { userId?: string | null }) {
  // The parent already checked this session. A second stale session observer
  // would restart that check on every gated mount and repeatedly unmount us.
  const preferences = useUserPreferences(expectedUserId);
  const userId = expectedUserId === undefined ? preferences.userId : expectedUserId;
  const preferenceMatchesAccount = Boolean(userId && userId === preferences.userId);
  return <AccountExperienceLanguageSelectBound
    key={userId ?? "signed-out"}
    userId={userId}
    locale={preferenceMatchesAccount && preferences.data?.locale != null ? preferences.data.locale : null}
    preferenceReady={preferenceMatchesAccount && preferences.isSuccess}
  />;
}

function AccountExperienceLanguageSelectBound({
  userId,
  locale,
  preferenceReady,
}: {
  userId: string | null;
  locale: string | null;
  preferenceReady: boolean;
}) {
  const { i18n, t } = useTranslation("experience");
  const queryClient = useQueryClient();
  const currentLanguage = i18n.resolvedLanguage ?? i18n.language;
  const lastLanguage = useRef(currentLanguage);
  const languageRevision = useRef(0);
  if (lastLanguage.current !== currentLanguage) {
    lastLanguage.current = currentLanguage;
    languageRevision.current += 1;
  }
  const readRevision = useRef(languageRevision.current);
  const handledHydration = useRef(false);
  const mounted = useRef(true);
  const [hydrationFailed, setHydrationFailed] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!userId || !preferenceReady || handledHydration.current) return;
    handledHydration.current = true;
    let explicitBrowserChoice = false;
    try {
      explicitBrowserChoice = isExperienceLocale(window.localStorage.getItem(EXPERIENCE_LOCALE_KEY));
    } catch {
      explicitBrowserChoice = false;
    }
    const params = new URLSearchParams(window.location.search);
    const isMailLanding = ["/saas/welcome", "/saas/reset-password"].includes(window.location.pathname);
    const mailLocale = isMailLanding && isExperienceLocale(params.get("locale"));
    if (explicitBrowserChoice || mailLocale || readRevision.current !== languageRevision.current) return;
    if (isExperienceLocale(locale) && locale !== currentLanguage) {
      void i18n.changeLanguage(locale).catch(() => setHydrationFailed(true));
    }
  }, [userId, preferenceReady, locale, currentLanguage, i18n]);

  if (!userId) return <ExperienceLanguageSelect />;
  return <div className="flex flex-wrap items-center gap-2">
    <ExperienceLanguageSelect onSaveLocale={async (nextLocale) => {
      const updated = await authApi.updatePreferences({ locale: nextLocale, expectedUserId: userId });
      if (!mounted.current) return;
      queryClient.setQueryData(queryKeys.auth.preferences(userId), updated);
    }} />
    {hydrationFailed && <p role="alert" className="text-sm text-muted-foreground">{t("language.failed")}</p>}
  </div>;
}
