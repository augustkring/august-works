import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  parseExperienceCommand,
  type ExperienceCommands,
  type ExperienceCommandId,
} from "@paperclipai/shared";
import { useAccountIdentity } from "../api/companies-query";
import {
  experienceCommandsKey,
  getExperienceCommands,
} from "../api/experience-commands";
import { useCompany } from "../context/CompanyContext";
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

function Commands({
  companyId,
  principal,
  close,
}: {
  companyId: string;
  principal: string;
  close: () => void;
}) {
  const { t } = useTranslation("experience"),
    navigate = useNavigate(),
    { openNewIssue } = useDialogActions();
  const [text, setText] = useState(""),
    [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(timer);
  }, [text]);
  const intent = parseExperienceCommand(text);
  const query = useQuery({
    queryKey: [...experienceCommandsKey(companyId, principal), debounced],
    queryFn: ({ signal }) =>
      getExperienceCommands(companyId, principal, debounced, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const ready = query.isSuccess && text === debounced && !query.isFetching;
  const data = ready ? query.data : null;
  function execute(command: ExperienceCommands["commands"][number]) {
    if (!data) return;
    close();
    if (command.id === "create_task") {
      openNewIssue({
        title:
          intent.kind === "command" && intent.id === "create_task"
            ? intent.text
            : "",
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
          <div role="alert" className="space-y-3 p-4">
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
            {intent.kind !== "semantic" &&
              text.trim() &&
              !data?.resources.length &&
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
    identity = useAccountIdentity(),
    { selectedCompanyId } = useCompany(),
    { isMobile, setSidebarOpen } = useSidebar();
  const [open, setOpen] = useState(false),
    invoker = useRef<HTMLElement | null>(null),
    navigating = useRef(false);
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const scope = `${selectedCompanyId}:${principal}:${identity.settled}`,
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
        ) : !identity.settled || !principal ? (
          <p role="status" className="p-4">
            {t("loading")}
          </p>
        ) : (
          <Commands
            key={scope}
            companyId={selectedCompanyId}
            principal={principal}
            close={() => {
              navigating.current = true;
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
