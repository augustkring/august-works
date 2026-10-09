import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";

/** A failed private read exposes only the translated recovery message. */
export function ExperienceReadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  const { t } = useTranslation("experience");
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!document.activeElement?.closest('[role="dialog"]'))
      error.current?.focus();
  }, []);
  return (
    <div ref={error} role="alert" tabIndex={-1} className="space-y-4">
      <p>{message}</p>
      <Button className="min-h-11" onClick={retry}>
        {t("tryAgain")}
      </Button>
    </div>
  );
}
