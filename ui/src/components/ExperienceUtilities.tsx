import { AccountExperienceLanguageSelect } from "./AccountExperienceLanguageSelect";
import { useTranslation } from "react-i18next";
import { Menu, UserRound } from "lucide-react";
import { FEEDBACK_CONTACTS } from "@paperclipai/shared";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link, useLocation } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { feedbackPageContext } from "../lib/feedback-safe-context";
import { Button } from "./ui/button";
import { CustomerFeedbackDialog } from "./CustomerFeedbackDialog";
import { useSidebar } from "../context/SidebarContext";
import { HELP_CENTER_UTILITY_ENTRY_ID } from "../lib/help-navigation";
export function ExperienceUtilities({ safetyRecovery = false }: { safetyRecovery?: boolean }) {
  const { sidebarOpen, setSidebarOpen } = useSidebar();
  const { selectedCompanyId, selectedCompany } = useCompany(), account = useV9CurrentAccount(), location = useLocation();
  const { t } = useTranslation("experience"),
    shell = useV9FeatureEnabled("progressive_shell_v9");
  const showNavigation = shell.enabled || safetyRecovery;
  return (
    <div
      role="region"
      aria-label={t("utilities")}
      className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border bg-background px-3"
    >
      {showNavigation && (
        <Button
          variant="ghost"
          className="min-h-11 min-w-11 md:hidden"
          aria-label={t("openNavigation")}
          aria-expanded={sidebarOpen}
          aria-controls="mobile-sidebar"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
      )}
      {shell.enabled && (
        <Button
          variant="ghost"
          type="button"
          className="min-h-11"
          onClick={() =>
            document.dispatchEvent(new Event("paperclip:ask-generalist"))
          }
        >
          {t("ask")}
        </Button>
      )}
      <AccountExperienceLanguageSelect companyLocale={selectedCompany?.locale} companyId={selectedCompanyId} />
      <CustomerFeedbackDialog />
      <Link
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to="/company/help"
        id={HELP_CENTER_UTILITY_ENTRY_ID}
        data-help-center-entry
        state={!account.localImplicit && account.userId && selectedCompanyId
          ? { companyId: selectedCompanyId, expectedUserId: account.userId,
              returnPathname: location.pathname, backgroundKey: location.key,
              returnFocusId: HELP_CENTER_UTILITY_ENTRY_ID,
              safeContext: { surface: feedbackPageContext(location.pathname).surfaceKey } }
          : undefined}
        onClick={() => setSidebarOpen(false)}
      >{t("help")}</Link>
      <a
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={FEEDBACK_CONTACTS.support}
      >{t("supportCases.contactSupport")}</a>
      <Link
        to="/company/settings/instance/profile"
        aria-label={t("user")}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserRound className="h-5 w-5" aria-hidden="true" />
      </Link>
    </div>
  );
}
