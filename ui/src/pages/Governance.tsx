import { useEffect } from "react";
import {
  Bot,
  History,
  KeyRound,
  Link2,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Link } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useHiddenSettings } from "@/hooks/useHiddenSettings";
import { cn } from "@/lib/utils";

type GovernanceDestination = {
  title: string;
  description: string;
  href: string;
  icon: typeof ShieldCheck;
  hiddenSetting?: string;
};

const GOVERNANCE_DESTINATIONS: readonly GovernanceDestination[] = [
  {
    title: "Members & access",
    description: "People, roles, invitations, and organization access.",
    href: "/company/settings/members",
    icon: Users,
    hiddenSetting: "company.members",
  },
  {
    title: "Agent permissions",
    description: "Review each agent's role, connections, and operating authority.",
    href: "/agents/all",
    icon: Bot,
  },
  {
    title: "Connection access",
    description: "See connected systems and manage who can use them.",
    href: "/apps",
    icon: Link2,
  },
  {
    title: "Access policy",
    description: "Control instance-level access and authentication policy.",
    href: "/company/settings/instance/access",
    icon: ShieldCheck,
    hiddenSetting: "instance.access",
  },
  {
    title: "Secrets",
    description: "Manage governed credentials without exposing secret values.",
    href: "/company/settings/secrets",
    icon: KeyRound,
    hiddenSetting: "company.secrets",
  },
  {
    title: "Audit history",
    description: "Inspect agent activity, runs, cost, and operational history.",
    href: "/activity",
    icon: History,
  },
] as const;

export function Governance() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { hidden, loaded } = useHiddenSettings();

  useEffect(() => {
    setBreadcrumbs([{ label: "Governance", href: "/governance" }]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  const destinations = loaded
    ? GOVERNANCE_DESTINATIONS.filter(
        (destination) =>
          !destination.hiddenSetting || !hidden.has(destination.hiddenSetting),
      )
    : [];

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="w-full max-w-5xl space-y-8 px-4 py-5 md:px-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Governance</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Who can access what, and what can they do with it?
          </p>
        </header>

        <section aria-labelledby="governance-access-heading">
          <div className="border-b border-border pb-3">
            <h2
              id="governance-access-heading"
              className="text-sm font-medium text-foreground"
            >
              Access and oversight
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Start with the surface that matches the authority or evidence you
              want to review.
            </p>
          </div>

          <div className="divide-y divide-border">
            {!loaded ? (
              <div
                aria-label="Loading governance controls"
                className="space-y-3 py-4"
              >
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
              </div>
            ) : null}
            {destinations.map((destination) => {
              const Icon = destination.icon;
              return (
                <Link
                  key={destination.title}
                  to={destination.href}
                  className={cn(
                    "group flex min-h-16 items-center gap-3 py-3",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                    <Icon
                      aria-hidden="true"
                      className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {destination.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {destination.description}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-sm text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  >
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
