import { useTranslation } from "react-i18next";
import { FEEDBACK_CONTACTS, PRODUCT_IDENTITY } from "@paperclipai/shared";
import { Link, useLocation } from "../lib/router";

const linkClass = "inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CustomerHelpCenter() {
  const { t } = useTranslation("experience");
  const location = useLocation();

  return (
    <section aria-labelledby="customer-help-title" className="space-y-6">
      <header className="space-y-2">
        <h1 id="customer-help-title" tabIndex={-1} className="text-2xl font-semibold">
          {t("helpCenter.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("helpCenter.description")}</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <a className={linkClass} href={PRODUCT_IDENTITY.docsOrigin} target="_blank" rel="noreferrer">
          {t("helpCenter.browse")}
        </a>
        <Link className={linkClass} to="/company/support" state={location.state} replace data-support-help-entry>
          {t("helpCenter.cases")}
        </Link>
        <a className={linkClass} href={PRODUCT_IDENTITY.statusOrigin} target="_blank" rel="noreferrer">
          {t("helpCenter.status")}
        </a>
      </div>
      <section aria-labelledby="customer-help-contact" className="space-y-2 rounded-lg border border-border p-4">
        <h2 id="customer-help-contact" className="font-medium">{t("helpCenter.humanTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("helpCenter.humanDescription")}</p>
        <div className="flex flex-wrap gap-3">
          <a className={linkClass} href={FEEDBACK_CONTACTS.support}>{t("supportCases.contactSupport")}</a>
          <a className={linkClass} href={FEEDBACK_CONTACTS.security}>{t("helpCenter.security")}</a>
          <a className={linkClass} href={FEEDBACK_CONTACTS.privacy}>{t("helpCenter.privacy")}</a>
        </div>
      </section>
    </section>
  );
}
