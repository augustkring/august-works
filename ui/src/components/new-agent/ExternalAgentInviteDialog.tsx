import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";
import { buildAgentOnboardingPrompt } from "@/lib/agent-onboarding-prompt";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

/**
 * Give an existing agent one short-lived instruction, then let it identify
 * and configure its own runtime. The board only needs to approve the join.
 */
export function ExternalAgentInviteDialog({ companyId, onClose, onBack, onComplete, autoCreate = false }: {
  companyId: string;
  onClose: () => void;
  onBack: () => void;
  /** Called only when the wizard's customer confirms they sent the request. */
  onComplete?: () => void;
  /** Wizard mode creates the invitation as soon as the user chooses this path. */
  autoCreate?: boolean;
}) {
  const cache = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [message, setMessage] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [showPrompt, setShowPrompt] = useState(!autoCreate);
  const autoCreateStarted = useRef(false);
  async function copy(value: string) {
    try {
      await copyTextToClipboard(value);
      if (mounted.current) { setCopied(true); setCopyError(false); }
    } catch {
      if (mounted.current) {
        setCopyError(true);
        // Manual copying is the safe fallback when a browser blocks the
        // clipboard. Do not hide the actual request in that situation.
        setShowPrompt(true);
      }
    }
  }
  const createInvite = useMutation({
    mutationFn: async () => {
      const invite = await accessApi.createCompanyInvite(companyId, {
        allowedJoinTypes: "agent",
        humanRole: null,
        agentMessage: message.trim() || null,
      });
      void cache.invalidateQueries({ queryKey: queryKeys.access.invites(companyId, "all", 5) });
      const path = invite.onboardingTextUrl ?? invite.onboardingTextPath ?? `/api/invites/${invite.token}/onboarding.txt`;
      const onboardingTextUrl = new URL(path, window.location.origin).href;
      const manifest = await accessApi.getInviteOnboarding(invite.token).catch(() => null);
      return buildAgentOnboardingPrompt({
        onboardingTextUrl,
        connectionCandidates: manifest?.onboarding.connectivity?.connectionCandidates ?? null,
        testResolutionUrl: manifest?.onboarding.connectivity?.testResolutionEndpoint?.url ?? null,
      });
    },
    onSuccess: async (value) => {
      if (!mounted.current) return;
      setPrompt(value);
      await copy(value);
    },
  });

  useEffect(() => {
    if (!autoCreate || autoCreateStarted.current) return;
    autoCreateStarted.current = true;
    createInvite.mutate();
  }, [autoCreate, createInvite]);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-(--sz-calc-16) overflow-y-auto sm:max-w-2xl">
      <DialogTitle>
        {prompt
          ? autoCreate ? "Ask your agent to connect" : "Agent onboarding prompt"
          : autoCreate ? "Preparing connection request" : "Invite an external agent"}
      </DialogTitle>
      <DialogDescription>
        {prompt
          ? autoCreate
            ? "This request is ready to paste into your agent chat. Your agent handles its own connection, then waits for your approval."
            : "Send this one-time prompt to the agent that should join your organization."
          : "Generate a one-time onboarding prompt for an external agent. An organization admin must approve its join request before it can claim an API key."}
      </DialogDescription>
      {prompt ? <>
        {autoCreate && !showPrompt ? (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
            <p>Your one-time request is copied. Paste it into your agent chat; your agent will handle the technical setup and then wait for your approval.</p>
            <Button variant="ghost" size="sm" onClick={() => setShowPrompt(true)}>Show request</Button>
          </div>
        ) : (
          <Textarea aria-label="Agent onboarding prompt" readOnly value={prompt} className="min-h-64 font-mono text-xs" />
        )}
        {copyError && <p role="alert" className="text-sm text-muted-foreground">Clipboard unavailable. Copy the prompt manually from the field above.</p>}
        <div className="flex justify-between gap-4">
          <Button variant="outline" onClick={() => void copy(prompt)}>{copied ? "Copied request" : "Copy request"}</Button>
          <Button onClick={autoCreate ? (onComplete ?? onClose) : onClose}>
            {autoCreate ? "I've asked my agent" : "Done"}
          </Button>
        </div>
      </> : <>
        {!autoCreate && (
          <label className="space-y-2 text-sm">
            <span>Optional message for the agent</span>
            <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} className="min-h-24" />
          </label>
        )}
        {autoCreate && createInvite.isPending && (
          <p aria-live="polite" className="text-sm text-muted-foreground">Creating a secure, one-time request…</p>
        )}
        {createInvite.error && <p role="alert" className="text-sm text-destructive">{createInvite.error.message}</p>}
        <div className="flex justify-between gap-4">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          {(!autoCreate || createInvite.error) && (
            <Button disabled={createInvite.isPending} onClick={() => createInvite.mutate()}>
              {createInvite.isPending ? "Generating…" : autoCreate ? "Try again" : "Generate onboarding prompt"}
            </Button>
          )}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
