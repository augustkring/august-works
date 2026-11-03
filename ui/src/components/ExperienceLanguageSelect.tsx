import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isExperienceLocale,
  persistExperienceLocale,
} from "../i18n/experience-locale-preference";

export function ExperienceLanguageSelect({ onSaveLocale }: { onSaveLocale?: (locale: "en" | "da") => Promise<void> }) {
  const { t, i18n } = useTranslation("experience");
  const [saveFailed, setSaveFailed] = useState(false);
  const [changeFailed, setChangeFailed] = useState(false);
  const [accountSaveFailed, setAccountSaveFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (pending) return;
    // A disabled select loses native browser focus. Restore it after the
    // change only if the person has not moved to another control.
    if (restoreFocus.current && document.activeElement === document.body)
      select.current?.focus();
    restoreFocus.current = false;
  }, [pending]);
  const current = i18n.resolvedLanguage === "da" ? "da" : "en";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span>{t("language.label")}</span>
        <select
          ref={select}
          className="min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={current}
          disabled={pending}
          onChange={async (event) => {
            const locale = event.currentTarget.value;
            if (!isExperienceLocale(locale)) return;
            restoreFocus.current = document.activeElement === event.currentTarget;
            setPending(true);
            setChangeFailed(false);
            setAccountSaveFailed(false);
            try {
              await i18n.changeLanguage(locale);
              setSaveFailed(!persistExperienceLocale(locale));
              if (onSaveLocale) {
                try {
                  await onSaveLocale(locale);
                } catch {
                  setAccountSaveFailed(true);
                }
              }
            } catch {
              setChangeFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          <option value="en" lang="en">English</option>
          <option value="da" lang="da">Dansk</option>
        </select>
      </label>
      {(saveFailed || changeFailed || accountSaveFailed) && (
        <p role={changeFailed ? "alert" : "status"} className="text-sm text-muted-foreground">
          {t(changeFailed ? "language.failed" : accountSaveFailed ? "language.accountNotSaved" : "language.notSaved")}
        </p>
      )}
    </div>
  );
}
