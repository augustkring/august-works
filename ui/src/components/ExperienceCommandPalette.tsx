import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  parseExperienceCommand,
  type ExperienceCommands,
  type ExperienceCommandId,
} from "@paperclipai/shared";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import {
  experienceCommandsKey,
  getExperienceCommands,
} from "../api/experience-commands";
import { checkedCompanyHelpHref, checkedCompanyHelpResults, searchApi } from "../api/search";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useDialogActions } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { useNavigate } from "../lib/router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Button } from "./ui/button";

const HELP_RESULT_LIMIT = 6;

function Commands({
  companyId,
  principal,
  close,
  accountReady,
  authorityEpoch,
  sessionId,
}: {
  companyId: string;
  principal: string;
  close: (navigating?: boolean) => void;
  accountReady: boolean;
  authorityEpoch: number;
  sessionId: string | null;
}) {
  const { t, i18n } = useTranslation("experience"),
    navigate = useNavigate(),
    { openNewIssue, openNewProject } = useDialogActions();
  const [text, setText] = useState(""),
    [debounced, setDebounced] = useState("");
  const client = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const error = useRef<HTMLDivElement>(null);
  const prefix = experienceCommandsKey(companyId, principal);
  const helpPrefix = ["experience-command-help", companyId, principal] as const;
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("da") ? "da" : "en";
  const authority = useV9PrivateReadAuthority(principal, true);
  const scope = JSON.stringify([
    companyId, principal, sessionId, authorityEpoch, authority.epoch, locale,
  ]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const helpTokenRef = useRef("");
  useCompanyLiveEvent((event) => {
    if (event.companyId !== companyId) return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type !== "analytical.context.access_lost" &&
      !(
        event.type === "activity.logged" &&
        (/issue|agent|project|workflow|permission|membership|privacy|erased|deleted|withdraw|settings/i.test(
          action,
        ) ||
          event.payload.entityType === "company_membership")
      )
    )
      return;
    helpTokenRef.current = "";
    setEpoch((value) => value + 1);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
    void client.cancelQueries({ queryKey: helpPrefix });
    client.removeQueries({ queryKey: helpPrefix });
  });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(timer);
  }, [text]);
  const intent = parseExperienceCommand(text);
  const settledIntent = parseExperienceCommand(debounced);
  const helpQueryText = settledIntent.kind === "resources" ? settledIntent.text.trim() : "";
  const helpToken = text === debounced && helpQueryText ? `${scope}:${epoch}:${helpQueryText}` : "";
  helpTokenRef.current = helpToken;
  const query = useQuery({
    queryKey: [...prefix, authorityEpoch, debounced, epoch],
    queryFn: ({ signal }) =>
      getExperienceCommands(companyId, principal, debounced, signal),
    enabled: accountReady,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const helpQuery = useQuery({
    queryKey: [...helpPrefix, sessionId, authorityEpoch, authority.epoch, epoch, helpQueryText, locale],
    enabled: accountReady && authority.readReady && !!helpQueryText,
    queryFn: async ({ signal }) => {
      const requestedScope = scopeRef.current;
      const requestedToken = helpToken;
      const current = () => scopeRef.current === requestedScope &&
        helpTokenRef.current === requestedToken && authority.canRead();
      if (!current()) throw new Error("Current Help search access is unavailable");
      const response = await authority.read(() => searchApi.search(companyId, {
        q: helpQueryText, scope: "help", limit: HELP_RESULT_LIMIT, locale,
      }, signal));
      if (!current()) throw new Error("Help search access changed during the request");
      return checkedCompanyHelpResults(response, HELP_RESULT_LIMIT, locale);
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const ready =
    accountReady && query.isSuccess && text === debounced && !query.isFetching;
  useEffect(() => {
    if (!query.isError) return;
    const focusedDialog = document.activeElement?.closest('[role="dialog"]');
    const ownDialog = error.current?.closest('[role="dialog"]');
    if (!focusedDialog || focusedDialog === ownDialog) error.current?.focus();
  }, [query.isError]);
  const data = ready ? query.data : null;
  const helpResults = ready && authority.canRead() && helpToken ? helpQuery.data ?? [] : [];
  function execute(command: ExperienceCommands["commands"][number]) {
    if (!data) return;
    close();
    if (command.id === "share_feedback") {
      document.dispatchEvent(new CustomEvent("paperclip:open-feedback", {
        detail: { returnFocus: "global_feedback" },
      }));
      return;
    }
    if (command.id === "create_task") {
      openNewIssue({
        experienceScope: { companyId, principal },
        title:
          intent.kind === "command" && intent.id === "create_task"
            ? intent.text
            : "",
      });
      return;
    }
    if (command.id === "create_project") {
      openNewProject({
        name:
          intent.kind === "command" && intent.id === "create_project"
            ? intent.text
            : "",
        companyId,
        principal,
      });
      return;
    }
    if (command.href)
      navigate(
        command.id === "search" && intent.kind === "resources" && intent.text
          ? `/search?q=${encodeURIComponent(intent.text)}`
          : command.href,
      );
  }
  function visible(id: ExperienceCommandId) {
    if (intent.kind === "semantic") return false;
    if (intent.kind === "command") return id === intent.id;
    if (!text.trim()) return true;
    return (
      id === "search" ||
      (intent.resourceKind === "agent" && id === "agents") ||
      (intent.resourceKind === "project" && id === "projects")
    );
  }
  if (!accountReady)
    return (
      <p role="status" className="p-4">
        {t("loading")}
      </p>
    );
  return (
    <Command shouldFilter={false}>
      <CommandInput
        aria-label={t("commands.input")}
        placeholder={t("commands.placeholder")}
        maxLength={180}
        value={text}
        onValueChange={setText}
      />
      <p className="px-4 py-2 text-sm text-muted-foreground">
        {t("commands.description")}
      </p>
      <CommandList className="max-h-96">
        {query.isError ? (
          <div ref={error} tabIndex={-1} role="alert" className="space-y-3 p-4">
            <p>{t("commands.failed")}</p>
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("tryAgain")}
            </Button>
          </div>
        ) : !ready ? (
          <p role="status" className="p-4">
            {t("loading")}
          </p>
        ) : (
          <>
            {intent.kind === "semantic" && (
              <p role="status" className="p-4">
                {t("commands.semanticUnavailable")}
              </p>
            )}
            {(["navigate", "ask", "create", "run"] as const).map((group) => {
              const commands =
                data?.commands.filter(
                  (command) => command.group === group && visible(command.id),
                ) ?? [];
              return commands.length ? (
                <CommandGroup
                  key={group}
                  heading={t(`commands.groups.${group}`)}
                >
                  {commands.map((command) => (
                    <CommandItem
                      key={command.id}
                      value={command.id}
                      className="min-h-11"
                      onSelect={() => execute(command)}
                    >
                      {t(`commands.items.${command.id}`)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null;
            })}
            {!!data?.resources.length && (
              <CommandGroup
                heading={t(
                  text.trim() ? "commands.matches" : "commands.recent",
                )}
              >
                {data.resources.map((resource) => (
                  <CommandItem
                    key={`${resource.kind}:${resource.id}`}
                    value={`${resource.kind}:${resource.id}`}
                    className="min-h-11 flex-wrap gap-2"
                    onSelect={() => {
                      if (!data) return;
                      close();
                      navigate(resource.href);
                    }}
                  >
                    <span className="break-words">{resource.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`commands.kinds.${resource.kind}`)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!helpResults.length && (
              <CommandGroup heading={t("commands.helpMatches")}>
                {helpResults.map((result) => (
                  <CommandItem
                    key={`help:${result.helpArticle!.articleId}`}
                    value={`help:${result.helpArticle!.articleId}:${result.title}`}
                    aria-label={t("commands.openHelp", { title: result.title })}
                    className="min-h-11 flex-wrap gap-2"
                    onSelect={() => {
                      if (!authority.canRead() || helpTokenRef.current !== helpToken || scopeRef.current !== scope) return;
                      window.open(checkedCompanyHelpHref(result), "_blank", "noopener,noreferrer");
                      close(false);
                    }}
                  >
                    <span className="break-words">{result.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {result.helpArticle!.maturity === "preview" ? t("commands.helpPreview") : t("commands.help")}
                    </span>
                    {result.snippet && <span className="basis-full text-sm text-muted-foreground">{result.snippet}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {ready && helpToken && helpQuery.isError && (
              <p role="status" className="p-3 text-sm text-muted-foreground">{t("commands.helpUnavailable")}</p>
            )}
            {intent.kind !== "semantic" &&
              text.trim() &&
              !data?.resources.length &&
              !helpResults.length &&
              !helpQuery.isFetching &&
              !data?.commands.some((command) => visible(command.id)) && (
                <p role="status" className="p-4">
                  {t("commands.unavailable")}
                </p>
              )}
            {intent.kind === "resources" &&
              text.trim() &&
              !data?.resources.length && (
                <p role="status" className="p-4">
                  {t("commands.noMatches")}
                </p>
              )}
          </>
        )}
      </CommandList>
    </Command>
  );
}
export function ExperienceCommandPalette() {
  const { t } = useTranslation("experience"),
    identity = useV9CurrentAccount(),
    { selectedCompanyId } = useCompany(),
    { isMobile, setSidebarOpen } = useSidebar();
  const [open, setOpen] = useState(false),
    invoker = useRef<HTMLElement | null>(null),
    navigating = useRef(false);
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const scope = `${selectedCompanyId}:${principal}`,
    previous = useRef(scope);
  useEffect(() => {
    if (scope !== previous.current) {
      setOpen(false);
      previous.current = scope;
    }
  }, [scope]);
  useEffect(() => {
    const show = () => {
      invoker.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      navigating.current = false;
      setOpen(true);
      if (isMobile) setSidebarOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        show();
      }
    };
    document.addEventListener("paperclip:open-command", show);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("paperclip:open-command", show);
      document.removeEventListener("keydown", keyboard);
    };
  }, [isMobile, setSidebarOpen]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-xl overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!navigating.current && invoker.current?.isConnected)
            invoker.current.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("commands.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("commands.description")}
        </DialogDescription>
        {!selectedCompanyId ? (
          <p role="status" className="p-4">
            {t("selectCompany")}
          </p>
        ) : identity.failed ? (
          <p role="alert" className="p-4">
            {t("commands.failed")}
          </p>
        ) : !principal ? (
          <p role="status" className="p-4">
            {t("loading")}
          </p>
        ) : (
          <Commands
            key={scope}
            companyId={selectedCompanyId}
            principal={principal}
            accountReady={identity.settled}
            authorityEpoch={identity.authorityEpoch}
            sessionId={identity.sessionId}
            close={(willNavigate = true) => {
              navigating.current = willNavigate;
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
