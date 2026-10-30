import { lazy, Suspense, type ComponentType } from "react";
import { useTranslation } from "../i18n";

/** Keep the native shell mounted while loading a route. Importing this registry
 * does not fetch any page; existing page owners still admit account and scope. */
function deferredPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return function DeferredPage() {
    const { t } = useTranslation("experience");
    return (
      <Suspense fallback={<p role="status">{t("routeLoading")}</p>}>
        <Page />
      </Suspense>
    );
  };
}

export const CustomerSupportCases = lazy(() =>
  import("./CustomerSupportCases").then(page => ({ default: page.CustomerSupportCases })),
);
export const CustomerSupport = deferredPage(() =>
  import("./CustomerSupport").then((page) => ({
    default: page.CustomerSupport,
  })),
);
export const MaintenanceHistoryEntry = deferredPage(() =>
  import("./MaintenanceHistory").then((page) => ({
    default: page.MaintenanceHistoryEntry,
  })),
);
export const MemoryMaintenanceHistoryEntry = deferredPage(() =>
  import("./MemoryMaintenanceHistory").then((page) => ({ default: page.MemoryMaintenanceHistoryEntry })),
);
export const ExperienceMeasuresEntry = deferredPage(() =>
  import("./ExperienceMeasures").then((page) => ({ default: page.ExperienceMeasuresEntry })),
);
export const AgentMonitorEntry = deferredPage(() =>
  import("./AgentMonitor").then((page) => ({
    default: page.AgentMonitorEntry,
  })),
);
export const AgentRetirementEntry = deferredPage(() =>
  import("./AgentRetirement").then((page) => ({ default: page.AgentRetirementEntry })),
);
export const CustomAgent = deferredPage(() =>
  import("./CustomAgent").then((page) => ({ default: page.CustomAgent })),
);
export const NewAgent = deferredPage(() =>
  import("./NewAgent").then((page) => ({ default: page.NewAgent })),
);
export const HireAgent = deferredPage(() =>
  import("./HireAgent").then((page) => ({ default: page.HireAgent })),
);
export const MyFeedback = deferredPage(() =>
  import("./MyFeedback").then((page) => ({ default: page.MyFeedback })),
);
export const FeedbackTriage = deferredPage(() =>
  import("./FeedbackTriage").then((page) => ({ default: page.FeedbackTriage })),
);
export const SaasWelcomeEntry = deferredPage(() =>
  import("./Activation").then((page) => ({ default: page.SaasWelcomeEntry })),
);
export const ActivationPage = deferredPage(() =>
  import("./Activation").then((page) => ({ default: page.ActivationPage })),
);
