import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "@paperclipai/shared";
import { AgentIcon } from "@/components/AgentIconPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";

export interface AgentChatPickerProps {
  agents: Agent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (agent: Agent) => void;
  preferredAgentId?: string | null;
  onSetPreferredAgent?: (agentId: string | null) => void;
  savingPreferred?: boolean;
  preferenceError?: string | null;
  preferenceLoadError?: boolean;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export function AgentChatPicker({ open, onOpenChange, ...props }: AgentChatPickerProps) {
  const { t } = useTranslation("experience");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="px-4 pt-4 pb-3">
          <DialogTitle>{t("generalist.choose")}</DialogTitle>
        </div>
        {/* The dialog unmounts its content on close, so each search starts empty. */}
        <AgentChatPickerResults {...props} onSelect={(agent) => {
          onOpenChange(false);
          props.onSelect(agent);
        }} />
      </DialogContent>
    </Dialog>
  );
}

function AgentChatPickerResults({ agents, onSelect, loading, error, onRetry, preferredAgentId, onSetPreferredAgent, savingPreferred, preferenceError, preferenceLoadError }: Omit<AgentChatPickerProps, "open" | "onOpenChange">) {
  const { t } = useTranslation("experience");
  const [search, setSearch] = useState("");
  return (
    <Command>
      <CommandInput
        aria-label={t("generalist.search")}
        placeholder={t("generalist.search")}
        value={search}
        onValueChange={setSearch}
      />
      {error ? (
        <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
          <p>Couldn’t load agents. Try again.</p>
          {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
        </div>
      ) : loading ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">Loading agents…</p>
      ) : (
        <CommandList>
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 px-4">
              <span>{agents.length ? t("generalist.noMatch", { search }) : t("generalist.noCoworkers")}</span>
              {agents.length ? <>
                <span className="text-xs text-muted-foreground">{t("generalist.searchHelp")}</span>
                <Button variant="ghost" size="sm" onClick={() => setSearch("")}>{t("generalist.clearSearch")}</Button>
              </> : null}
            </div>
          </CommandEmpty>
          <CommandGroup>
            {agents.map((agent) => (
              <CommandItem
                key={agent.id}
                value={agent.id}
                keywords={[agent.name, agent.title ?? "", agent.role]}
                onSelect={() => onSelect(agent)}
                className="gap-3 px-3 py-3"
              >
                <AgentIcon icon={agent.icon} className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{agent.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{agent.title ?? agent.role}</span>
                </span>
                {agent.status === "paused" && <span className="text-xs text-(--status-agent-paused)">{t("generalist.status.paused")}</span>}
                {agent.status === "terminated" && <span className="text-xs text-muted-foreground">{t("generalist.status.terminated")}</span>}
                {agent.status === "pending_approval" && <span className="text-xs text-muted-foreground">{t("generalist.status.pendingApproval")}</span>}
                {preferredAgentId === agent.id && <span className="text-xs text-muted-foreground">{t("generalist.preferred")}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      )}
      {onSetPreferredAgent && (
        <div className="border-t border-border px-3 py-3">
          <label htmlFor="preferred-coworker" className="mb-1 block text-xs font-medium">{t("generalist.setPreferred")}</label>
          <select
            id="preferred-coworker"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={preferredAgentId ?? ""}
            disabled={savingPreferred}
            onChange={(event) => onSetPreferredAgent(event.currentTarget.value || null)}
          >
            <option value="">{t("generalist.noPreference")}</option>
            {agents.filter((agent) => agent.status !== "terminated").map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name} — {agent.title ?? agent.role}</option>
            ))}
          </select>
        </div>
      )}
      {preferenceLoadError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{t("generalist.preferenceLoadFailed")}</p>}
      {preferenceError && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{t("generalist.preferenceFailed")}</p>}
    </Command>
  );
}
