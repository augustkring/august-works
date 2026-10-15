import { useTranslation } from "react-i18next";
import {
  EXPERIENCE_NAVIGATION,
  experienceProfileSchema,
} from "@paperclipai/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { experienceApi } from "../api/experience";
import {
  Home,
  ListChecks,
  Briefcase,
  Users,
  Unplug,
  ChartNoAxesCombined,
  Settings,
  Search,
  HelpCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { SidebarNavItem } from "./SidebarNavItem";
import { Button } from "./ui/button";
const icons = {
  home: Home,
  needs_you: ListChecks,
  work: Briefcase,
  agents: Users,
  apps: Unplug,
  insights: ChartNoAxesCombined,
  company: Settings,
};
export function ExperienceNavigation() {
  const { selectedCompanyId } = useCompany();
  const { t } = useTranslation("experience");
  const { query, identity } = useExperience(selectedCompanyId);
  const client = useQueryClient(),
    principal = identity.localImplicit ? "local-board" : identity.userId;
  const change = useMutation({
    mutationFn: (value: string) =>
      experienceApi.setProfile(
        selectedCompanyId!,
        principal!,
        experienceProfileSchema.parse(value),
      ),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["experience", selectedCompanyId, principal],
      });
    },
  });
  const profile = query.isError ? "member" : (query.data?.profile ?? "member");
  return (
    <div className="space-y-2">
      {!query.isError && (query.data?.availableProfiles?.length ?? 0) > 1 && (
        <label className="block space-y-2 px-3">
          <span className="text-sm text-muted-foreground">
            {t("profileView")}
          </span>
          <select
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={profile}
            disabled={change.isPending}
            onChange={(event) => change.mutate(event.target.value)}
          >
            {query.data!.availableProfiles!.map((value) => (
              <option key={value} value={value}>
                {t(`profiles.${value}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {change.isError && (
        <p role="alert" className="px-3 text-sm">
          {t("profileFailed")}
        </p>
      )}
      {EXPERIENCE_NAVIGATION.filter((item) =>
        (item.profiles as readonly string[]).includes(profile),
      ).map((item) => (
        <SidebarNavItem
          className="min-h-11"
          key={item.id}
          to={item.href}
          label={t(`nav.${item.id}`)}
          icon={icons[item.id]}
        />
      ))}
      {!query.isError && !!query.data?.advancedLinks?.length && (
        <SidebarNavItem
          className="min-h-11"
          to="/advanced"
          label={t("advanced.title")}
          icon={SlidersHorizontal}
        />
      )}
      {query.isError && (
        <p role="status" className="px-3 text-sm text-muted-foreground">
          {t("navigationLimited")}
        </p>
      )}
      <div className="space-y-2 border-t border-border p-3">
        <Button
          variant="ghost"
          className="min-h-11 w-full justify-start"
          onClick={() =>
            document.dispatchEvent(new Event("paperclip:open-command"))
          }
        >
          <Search className="mr-2 h-4 w-4" />
          {t("ask")}
        </Button>
        <SidebarNavItem
          className="min-h-11"
          to="/company/settings/support"
          label={t("help")}
          icon={HelpCircle}
        />
      </div>
    </div>
  );
}
