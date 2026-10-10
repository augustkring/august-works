import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FEEDBACK_CONTACTS,
  type WorkflowSupportDiagnostic,
} from "@paperclipai/shared";
import { downloadWorkflowSupportDiagnostic } from "../lib/support-diagnostic-download";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

/** Parent mounts this only while its current private native view is available;
 * background authority/source rechecks unmount the preview and download control. */
export function WorkflowSupportDiagnostics({
  report,
}: {
  report: WorkflowSupportDiagnostic;
}) {
  const { t } = useTranslation("experience");
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        className="min-h-11"
        onClick={() => {
          setFailed(false);
          setDownloaded(false);
          setOpen(true);
        }}
      >
        {t("supportDiagnostics.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-dvh overflow-y-auto"
          closeButtonClassName="min-h-11 min-w-11 flex items-center justify-center"
          closeButtonLabel={t("supportDiagnostics.cancel")}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
        >
          <DialogTitle>{t("supportDiagnostics.title")}</DialogTitle>
          <DialogDescription>
            {t("supportDiagnostics.disclosure")}
          </DialogDescription>
          <p className="text-sm text-muted-foreground">
            {t("supportDiagnostics.boundary")}
          </p>
          <label className="block space-y-2">
            <span>{t("supportDiagnostics.preview")}</span>
            <Textarea
              readOnly
              value={JSON.stringify(report, null, 2)}
              className="min-h-48"
            />
          </label>
          <a
            className="inline-flex min-h-11 items-center underline"
            href={FEEDBACK_CONTACTS.support}
          >
            {t("supportDiagnostics.contact")}
          </a>
          {failed && <p role="alert">{t("supportDiagnostics.failed")}</p>}
          {downloaded && (
            <p role="status">{t("supportDiagnostics.downloaded")}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setOpen(false)}
            >
              {t("supportDiagnostics.cancel")}
            </Button>
            <Button
              className="min-h-11"
              onClick={() => {
                setFailed(false);
                setDownloaded(false);
                try {
                  downloadWorkflowSupportDiagnostic(report);
                  setDownloaded(true);
                } catch {
                  setFailed(true);
                }
              }}
            >
              {t("supportDiagnostics.download")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
