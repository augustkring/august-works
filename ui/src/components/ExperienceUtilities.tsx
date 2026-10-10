import { useTranslation } from "react-i18next";
import { Menu, UserRound } from "lucide-react";
import { FEEDBACK_CONTACTS } from "@paperclipai/shared";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";
import { Button } from "./ui/button";
import { CustomerFeedbackDialog } from "./CustomerFeedbackDialog";
import { useSidebar } from "../context/SidebarContext";
export function ExperienceUtilities() {
  const { sidebarOpen, setSidebarOpen } = useSidebar();
  const { t } = useTranslation("experience"),
    shell = useV9FeatureEnabled("progressive_shell_v9"),
    feedback = useV9FeatureEnabled("customer_feedback_v9");
  if (!shell.enabled && !feedback.enabled) return null;
  return (
    <div
      aria-label={t("utilities")}
      className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border bg-background px-3"
    >
      {shell.enabled && (
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
            document.dispatchEvent(new Event("paperclip:open-command"))
          }
        >
          {t("ask")}
        </Button>
      )}
      <CustomerFeedbackDialog />
      <a
        className="inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={FEEDBACK_CONTACTS.support}
      >
        {t("help")}
      </a>
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
