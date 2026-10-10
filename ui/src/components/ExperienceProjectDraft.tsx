import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  experienceProjectReceiptSchema as receiptSchema,
  type ExperienceProjectReceipt,
} from "@paperclipai/shared";
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

/** Verbatim editable customer draft. Only explicit submission reaches the
 * original Native project owner; no repository, runtime or agent is inferred. */
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
  const identity = useV9CurrentAccount();
  const flags = useV9FeatureEnabled("ambient_commands_v9");
  const { selectedCompanyId } = useCompany();
  const resolvedPrincipal = identity.localImplicit
    ? "local-board"
    : identity.userId;
  const matches =
    resolvedPrincipal === principal && selectedCompanyId === companyId;
  const ready =
    matches &&
    identity.settled &&
    flags.enabled &&
    flags.query.isSuccess &&
    !flags.query.isFetching;
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
  const client = useQueryClient();
  const canUseContext = () =>
    context.current.ready &&
    client.getQueryState(queryKeys.auth.session)?.fetchStatus !== "fetching" &&
    client.getQueryState(queryKeys.instance.experimentalSettings)
      ?.fetchStatus !== "fetching";
  const [name, setName] = useState(initialName),
    [description, setDescription] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false),
    [receipt, setReceipt] = useState<ExperienceProjectReceipt | null>(null);
  const attempt = useRef<Attempt | null>(null),
    alive = useRef(true),
    error = useRef<HTMLParagraphElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (identity.settled && !matches) onClose();
  }, [identity.settled, matches, onClose]);
  const save = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!canUseContext()) throw new Error("Project context changed");
      const epoch = context.current.epoch;
      attempt.current ??= {
        idempotencyKey: crypto.randomUUID(),
        name: name.trim(),
        description,
        status: "planned",
      };
      setUnconfirmed(false);
      const native = createAccountClient(
        principal === "local-board" ? "local-board" : `user:${principal}`,
      );
      const result = receiptSchema.parse(
        await native.post(`/companies/${companyId}/projects`, attempt.current),
      );
      if (result.companyId !== companyId)
        throw new Error("Project context changed");
      return { result, epoch };
    },
    onSuccess: ({ result, epoch }) => {
      if (!alive.current) return;
      if (!canUseContext() || epoch !== context.current.epoch) {
        setUnconfirmed(true);
        return;
      }
      attempt.current = null;
      setReceipt(result);
      void client.invalidateQueries({
        queryKey: queryKeys.projects.all(companyId),
      });
    },
  });
  const original = useQuery({
    queryKey: [
      "ambient-project-receipt",
      companyId,
      principal,
      receipt?.id,
      context.current.epoch,
    ],
    enabled: ready && !!receipt,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!canUseContext()) throw new Error("Project context changed");
      const native = createAccountClient(
        principal === "local-board" ? "local-board" : `user:${principal}`,
      );
      const result = receiptSchema.parse(
        await native.get(
          `/projects/${receipt!.id}?companyId=${encodeURIComponent(companyId)}`,
          { signal, cache: "no-store" },
        ),
      );
      signal.throwIfAborted();
      if (result.companyId !== companyId || result.id !== receipt!.id)
        throw new Error("Project context changed");
      return result;
    },
  });
  const current =
    ready && original.isSuccess && !original.isFetching ? original.data : null;
  useEffect(() => {
    if (ready && (save.isError || unconfirmed)) error.current?.focus();
  }, [ready, save.isError, unconfirmed]);
  useEffect(() => {
    if (current) heading.current?.focus();
  }, [current?.id]);
  const frozen = save.isPending || !!attempt.current;
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
        <DialogTitle>{t("projectDraft.title")}</DialogTitle>
        <DialogDescription>{t("projectDraft.description")}</DialogDescription>
        {!ready ? (
          <p
            role={
              identity.failed || flags.query.isError || !flags.enabled
                ? "alert"
                : "status"
            }
          >
            {t(
              identity.failed ||
                flags.query.isError ||
                (!flags.query.isPending && !flags.enabled)
                ? "projectDraft.unavailable"
                : "loading",
            )}
          </p>
        ) : receipt && !current ? (
          <div className="space-y-3">
            <p role={original.isError ? "alert" : "status"}>
              {t(original.isError ? "projectDraft.unavailable" : "loading")}
            </p>
            {original.isError && (
              <Button
                className="min-h-11"
                onClick={() => void original.refetch()}
              >
                {t("tryAgain")}
              </Button>
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
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && !save.isPending && canUseContext())
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
                disabled={frozen}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span>{t("projectDraft.goal")}</span>
              <Textarea
                maxLength={4000}
                value={description}
                disabled={frozen}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <p>{t("projectDraft.noInference")}</p>
            {(save.isError || unconfirmed) && (
              <p ref={error} tabIndex={-1} role="alert">
                {t("projectDraft.unconfirmed")}
              </p>
            )}
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
                {t(
                  save.isError || unconfirmed
                    ? "tryAgain"
                    : "projectDraft.create",
                )}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
