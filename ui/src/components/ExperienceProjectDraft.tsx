import {
  readPendingProjectReceipt,
  retainPendingProjectReceipt,
  clearPendingProjectReceipt,
} from "../lib/pending-project-receipts";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { experienceProjectReceiptSchema as receiptSchema } from "@paperclipai/shared";
import { createAccountClient } from "../api/account-client";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";

type Attempt = {
  idempotencyKey: string;
  name: string;
  description: string;
  status: "planned";
};

/** One explicit create. Unknown outcomes reconcile only through the original
 * Native key and current project read guards; a missing key never causes a write. */
export default function ExperienceProjectDraft({
  companyId,
  principal,
  initialName,
  onClose,
}: {
  companyId: string;
  principal: string;
  initialName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("experience");
  const identity = useV9CurrentAccount(),
    flags = useV9FeatureEnabled("ambient_commands_v9");
  const { selectedCompanyId } = useCompany();
  const resolvedPrincipal = identity.localImplicit
    ? "local-board"
    : identity.userId;
  const matches =
    resolvedPrincipal === principal && selectedCompanyId === companyId;
  const authorityReady =
    matches &&
    identity.settled &&
    flags.enabled &&
    flags.query.isSuccess &&
    !flags.query.isFetching;
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [storageWriteFailed, setStorageWriteFailed] = useState(false);
  const receiptKey = useRef<string | null>(null);
  const initialized = useRef(false);
  const ready = authorityReady && recoveryReady && !recoveryUnavailable;
  const context = useRef({
    ready,
    accountEpoch: identity.authorityEpoch,
    epoch: 0,
  });
  if (
    context.current.ready !== ready ||
    context.current.accountEpoch !== identity.authorityEpoch
  )
    context.current = {
      ready,
      accountEpoch: identity.authorityEpoch,
      epoch: context.current.epoch + 1,
    };
  const blocked =
    identity.failed ||
    (identity.settled &&
      (!matches ||
        flags.query.isError ||
        (flags.query.isSuccess && !flags.enabled)));
  const client = useQueryClient();
  const canUseContext = () =>
    context.current.ready &&
    client.getQueryState(queryKeys.auth.session)?.fetchStatus !== "fetching" &&
    client.getQueryState(queryKeys.instance.experimentalSettings)
      ?.fetchStatus !== "fetching";
  const [name, setName] = useState(initialName),
    [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  useEffect(() => {
    if (!authorityReady || initialized.current) return;
    initialized.current = true;
    try {
      receiptKey.current = readPendingProjectReceipt(companyId, principal);
      if (receiptKey.current) {
        setSubmitted(true);
        setResumed(true);
      }
      setRecoveryReady(true);
    } catch {
      setRecoveryUnavailable(true);
    }
  }, [authorityReady, companyId, principal]);
  const error = useRef<HTMLParagraphElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (identity.settled && !matches) onClose();
  }, [identity.settled, matches, onClose]);
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!canUseContext() || attempt.current || receiptKey.current)
        throw new Error("Project create is not available");
      const body: Attempt = {
        idempotencyKey: crypto.randomUUID(),
        name: name.trim(),
        description,
        status: "planned",
      };
      // Persist only the nonce/scope before the first POST. If this fails no
      // original create is sent, and an unknown attempt is never overwritten.
      try {
        retainPendingProjectReceipt(companyId, principal, body.idempotencyKey);
      } catch {
        setStorageWriteFailed(true);
        throw new Error("Project recovery is unavailable");
      }
      attempt.current = body;
      receiptKey.current = body.idempotencyKey;
      setStorageWriteFailed(false);
      setSubmitted(true);
      const native = createAccountClient(
        principal === "local-board" ? "local-board" : `user:${principal}`,
      );
      const result = receiptSchema.parse(
        await native.post(
          `/companies/${companyId}/projects`,
          attempt.current,
        ),
      );
      if (result.companyId !== companyId)
        throw new Error("Project context changed");
      // The POST body is transport acknowledgement only. The Native key read
      // below determines whether this project may be shown after any auth recheck.
    },
  });
  const original = useQuery({
    queryKey: [
      "ambient-project-receipt",
      companyId,
      principal,
      receiptKey.current,
      context.current.epoch,
    ],
    enabled: ready && submitted && !save.isPending,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!canUseContext() || !receiptKey.current)
        throw new Error("Project receipt is not available");
      const native = createAccountClient(
        principal === "local-board" ? "local-board" : `user:${principal}`,
      );
      const result = receiptSchema.parse(
        await native.get(
          `/companies/${companyId}/projects/create-receipts/${receiptKey.current}`,
          { signal, cache: "no-store" },
        ),
      );
      signal.throwIfAborted();
      if (result.companyId !== companyId)
        throw new Error("Project context changed");
      return result;
    },
  });
  const current =
    ready && original.isSuccess && !original.isFetching ? original.data : null;
  useEffect(() => {
    if (current && receiptKey.current) {
      try {
        clearPendingProjectReceipt(companyId, principal, receiptKey.current);
      } catch {
        /* Leave the locator intact; never repeat a create to clear it. */
      }
    }
  }, [current?.id, companyId, principal]);
  useEffect(() => {
    if (ready && original.isError) error.current?.focus();
  }, [ready, original.isError]);
  useEffect(() => {
    if (current) heading.current?.focus();
  }, [current?.id]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        closeButtonClassName="min-h-11 min-w-11"
        className="max-h-dvh overflow-y-auto"
        closeButtonLabel={t("projectDraft.close")}
      >
        <DialogTitle>
          {t(resumed ? "projectDraft.resumeTitle" : "projectDraft.title")}
        </DialogTitle>
        <DialogDescription>
          {t(resumed ? "projectDraft.resumeDescription" : "projectDraft.description")}
        </DialogDescription>
        {!ready ? (
          <div className="space-y-3">
            <p role={blocked || recoveryUnavailable ? "alert" : "status"}>
              {t(
                recoveryUnavailable
                  ? "projectDraft.recoveryUnavailable"
                  : blocked
                    ? "projectDraft.unavailable"
                    : "loading",
              )}
            </p>
            {recoveryUnavailable && authorityReady && (
              <Link
                className="inline-flex min-h-11 items-center underline"
                to="/projects"
                onClick={onClose}
              >
                {t("projectDraft.checkProjects")}
              </Link>
            )}
          </div>
        ) : current ? (
          <div className="space-y-3">
            <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">
              {t("projectDraft.saved")}
            </h2>
            <p>{current.name}</p>
            <p>{t("projectDraft.noExecution")}</p>
            <Link
              className="inline-flex min-h-11 items-center underline"
              to={`/projects/${current.id}`}
              onClick={onClose}
            >
              {t("projectDraft.open")}
            </Link>
          </div>
        ) : submitted ? (
          <div className="space-y-3">
            <p
              ref={error}
              tabIndex={-1}
              role={original.isError ? "alert" : "status"}
            >
              {t(original.isError ? "projectDraft.unconfirmed" : "loading")}
            </p>
            {original.isError && (
              <Button
                className="min-h-11"
                disabled={original.isFetching}
                onClick={() => {
                  if (canUseContext()) void original.refetch();
                }}
              >
                {t("projectDraft.checkReceipt")}
              </Button>
            )}
            <Link
              className="inline-flex min-h-11 items-center underline"
              to="/projects"
              onClick={onClose}
            >
              {t("projectDraft.checkProjects")}
            </Link>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                name.trim() &&
                !save.isPending &&
                canUseContext() &&
                !attempt.current
              )
                save.mutate();
            }}
          >
            <label className="block space-y-2">
              <span>{t("projectDraft.name")}</span>
              <Input
                className="min-h-11"
                required
                maxLength={180}
                value={name}
                disabled={save.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span>{t("projectDraft.goal")}</span>
              <Textarea
                maxLength={4000}
                value={description}
                disabled={save.isPending}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p>{t("projectDraft.noInference")}</p>
            {storageWriteFailed && <p role="alert">{t("projectDraft.notSent")}</p>}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={save.isPending}
                onClick={onClose}
              >
                {t("projectDraft.cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={save.isPending || !name.trim()}
              >
                {t("projectDraft.create")}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
