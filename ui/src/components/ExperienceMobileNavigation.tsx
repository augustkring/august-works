import { useTranslation } from "react-i18next";
import { Home, ListChecks, Briefcase, Users, Unplug } from "lucide-react";
import { NavLink } from "../lib/router";
import { cn } from "../lib/utils";
import { SIDEBAR_SCROLL_RESET_STATE } from "../lib/navigation-scroll";

const destinations = [
  { id: "home", href: "/dashboard", icon: Home },
  { id: "needs_you", href: "/needs-you", icon: ListChecks },
  { id: "work", href: "/work", icon: Briefcase },
  { id: "agents", href: "/agents", icon: Users },
  { id: "apps", href: "/apps", icon: Unplug },
] as const;

export function ExperienceMobileNavigation({ visible }: { visible: boolean }) {
  const { t } = useTranslation("experience");
  return (
    <nav
      aria-label={t("mobileNavigation")}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background pb-(--sz-safe-bottom) md:hidden",
        !visible && "hidden",
      )}
    >
      <div className="grid h-16 grid-cols-5 px-1">
        {destinations.map(({ id, href, icon: Icon }) => (
          <NavLink
            key={id}
            to={href}
            state={SIDEBAR_SCROLL_RESET_STATE}
            className={({ isActive }) =>
              cn(
                "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md text-(length:--text-nano) font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{t(`nav.${id}`)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
