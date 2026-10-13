import { useEffect, useState } from "react";
import { useAccountIdentity } from "@/api/companies-query";
import type { HealthStatus } from "@/api/health";
import { useCompany } from "@/context/CompanyContext";
import { useDialogState } from "@/context/DialogContext";
import { useOptionalToastActions, useOptionalToastState } from "@/context/ToastContext";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { AnnouncementCard } from "./AnnouncementCard";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@/i18n";

// Includes the command palette, sheets and dialogs created outside DialogContext.
const MODAL_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]:not([data-state="closed"]), dialog[open]';
function useModalOpen(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const scan = () => setOpen(Boolean(document.querySelector(MODAL_SELECTOR)));
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-modal", "open"] });
    return () => observer.disconnect();
  }, [enabled]);
  return open;
}

export function AnnouncementWell({ health }: { health?: HealthStatus }) {
  const { t } = useTranslation("experience");
  const { userId: accountId, settled } = useAccountIdentity();
  const { selectedCompanyId, loading } = useCompany();
  const { onboardingOpen } = useDialogState();
  const toastActions = useOptionalToastActions();
  const toasts = useOptionalToastState();
  const userId = health?.deploymentMode === "local_trusted" ? "local-board" : (settled ? accountId : null);
  const { announcement, dismiss } = useAnnouncement({
    userId, companyId: selectedCompanyId,
    enabled: Boolean(userId && !loading && selectedCompanyId && !onboardingOpen),
    onSaveFailure: (savedLocally) => toastActions?.pushToast({
      title: savedLocally ? "Dismissed in this browser" : "Dismissed for this visit",
      body: "Couldn’t save across devices. We’ll retry when you reconnect or return.",
      tone: "info", dedupeKey: "announcement-dismissal-sync",
    }),
  });
  const modalOpen = useModalOpen(Boolean(announcement));
  if (!announcement || modalOpen || (toasts?.length ?? 0) > 0) return null;
  return (
    <aside aria-label="Paperclip announcements" className="announcement-well shrink-0 border-t bg-background p-2 pb-(--announcement-mobile-bottom) md:px-3 md:pb-2">
      <details key={announcement.id} className="group">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
          <span className="shrink-0 font-semibold">{t("announcement.summary")}</span>
          <span className="truncate text-muted-foreground">{announcement.title}</span>
        </summary>
        <div className="max-h-(--announcement-expanded-max-height) overflow-y-auto py-2">
          <AnnouncementCard key={announcement.id} announcement={announcement} onDismiss={() => dismiss(announcement.id)} className="mx-auto" />
        </div>
      </details>
    </aside>
  );
}
