import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CompanyProvider } from "./context/CompanyContext";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { DialogProvider, useDialog } from "./context/DialogContext";
import { ThemeProvider } from "./context/ThemeContext";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { NewAgentSetup } from "./components/new-agent/NewAgentSetup";
import { TooltipProvider } from "./components/ui/tooltip";
import { Dashboard } from "./pages/Dashboard";
import "./index.css";

/**
 * The real onboarding wizard, with the network stubbed, deployed so the connect
 * step can be walked as the product actually renders it.
 *
 * The sibling `connect-flow-preview` draws the sequence from the same
 * components but drives it with its own state machine. This one renders
 * `OnboardingWizard` itself, so what is on screen is the step's real code path:
 * its phases, its panel, its session handling and its footer.
 *
 * Everything below the app is faked and nothing above it is. Every API call in
 * this codebase goes through one `fetch` in `api/client.ts`, so intercepting
 * that is enough to stand the whole wizard up without a server — no module
 * mocks, and therefore no chance of previewing something other than the code
 * that ships.
 */

const COMPANY = { id: "company-preview", name: "Initech", issuePrefix: "INI" };
const SESSION_ID = "preview-session";
const AUTH_URL = "https://claude.ai/oauth/authorize?code=true&client=paperclip";
const OPENAI_URL = "https://auth.openai.com/codex/device";

/** How long the fake server takes to produce a prompt. */
const PROMPT_LATENCY_MS = 1200;
let sessionStartedAt = 0;
let authenticated = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * The canned server.
 *
 * Only the routes the connect step actually reaches. Anything else answers with
 * an empty object rather than a 404: an unhandled call should not be the reason
 * a preview looks broken, and the console still shows what was asked for.
 */
function respond(pathname: string, method: string): Response {
  const has = (p: string) => pathname.includes(p);

  /*
    Ordered most-specific first, and the registry matched at the *end* of the
    path rather than anywhere in it. Several routes live under
    `/adapters/:type` — the model list and the auth signal among them — so a
    substring test for the registry answers those with a list of adapters, and
    the step then tries to sort model ids that are not there.
  */
  if (has("/instance/settings/experimental")) return json({ enableConferenceRoomChat: true });
  if (has("/instance/settings")) return json({ defaultEnvironmentId: "env-sandbox" });

  if (has("/dashboard"))
    return json({
      companyId: COMPANY.id,
      agents: { active: 0, running: 0, paused: 0, error: 0 },
      tasks: { open: 0, inProgress: 0, blocked: 0, done: 0 },
      costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 },
      pendingApprovals: 0,
      budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
      runActivity: [],
    });
  if (has("/activity") || has("/issues") || has("/projects")) return json([]);
  if (has("/user-directory")) return json({ users: [] });

  // No credential anywhere, which is what makes the step offer a sign-in.
  if (has("/auth-signal")) return json({ status: "absent" });
  if (has("/claude-oauth-token-status")) return json({}, 404);
  if (pathname.endsWith("/models")) return json([]);

  if (pathname.endsWith("/environments/capabilities"))
    return json({
      sandboxProviders: {
        daytona: {
          status: "supported",
          supportsSavedProbe: true,
          supportsUnsavedProbe: true,
          supportsRunExecution: true,
          supportsReusableLeases: false,
          supportsInteractiveSetup: false,
          interactiveSetupConnectionTypes: [],
          supportsTemplateCapture: false,
          supportsTemplateDelete: false,
          supportsLoginPty: true,
          source: "plugin",
        },
      },
    });

  if (pathname.endsWith("/environments"))
    return json([
      {
        id: "env-sandbox",
        name: "Daytona",
        description: null,
        driver: "sandbox",
        status: "active",
        config: { provider: "daytona" },
        envVars: {},
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

  if (pathname.includes("/config-schema")) return json({ fields: [] });

  if (pathname.endsWith("/adapters"))
    return json(
      [
        ["claude_local", "Claude Code", "submitted_browser_code", "fixed"],
        ["codex_local", "Codex", "displayed_code", "caller_bounded"],
        ["openclaw_gateway", "OpenClaw Gateway", "none", "fixed"],
        ["hermes_gateway", "Hermes Gateway", "none", "fixed"],
      ].map(([type, label, panelMode, timeoutPolicy]) => ({
        type,
        label,
        source: "builtin",
        modelsCount: 0,
        loaded: true,
        disabled: false,
        capabilities: {
          supportsInstructionsBundle: true,
          supportsSkills: true,
          supportsLocalAgentJwt: true,
          requiresMaterializedRuntimeSkills: false,
          supportsAcp: true,
          login: { panelMode, timeoutPolicy },
        },
      })),
    );

  if (pathname.endsWith("/agents")) return json([]);
  // The onboarding connect step asks for reusable AI connections alongside
  // saved secrets. It expects the list envelope, not a bare object: the
  // latter makes the credential picker call `flatMap` on an absent
  // `connections` field and hides the entire step behind the error boundary.
  if (pathname.includes("/ai-connections"))
    return json({ currentUserId: "user-preview", connections: [] });
  if (
    pathname.includes("/secrets") ||
    pathname.includes("/user-secrets")
  )
    return json([]);

  // The browser-code login: a session, then a prompt once the latency passes.
  if (has("/setup-token-login-sessions")) {
    if (has("/prompt")) {
      const ready = Date.now() - sessionStartedAt > PROMPT_LATENCY_MS;
      return ready ? json({ authorizationUrl: AUTH_URL, transportAdvisory: null }) : json({}, 404);
    }
    if (has("/completion")) return json({ storedSessionId: "stored-preview" });
    if (has("/code")) {
      // Accepted, and the next status read reports the login authenticated.
      authenticated = true;
      return json({ sessionId: SESSION_ID, status: "authenticated" });
    }
    if (has("/cancel")) return json({});
    if (method === "POST") {
      sessionStartedAt = Date.now();
      authenticated = false;
      return json({
        sessionId: SESSION_ID,
        status: "pending",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    return json({
      sessionId: SESSION_ID,
      status: authenticated ? "authenticated" : "pending",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  }

  // The displayed-code login: one session that hands a code over.
  if (has("/login-sessions")) {
    if (has("/cancel")) return json({});
    if (method === "POST") {
      sessionStartedAt = Date.now();
      return json({ sessionId: SESSION_ID, status: "pending" });
    }
    const ready = Date.now() - sessionStartedAt > PROMPT_LATENCY_MS;
    return json({
      sessionId: SESSION_ID,
      status: "pending",
      prompt: ready ? { url: OPENAI_URL, code: "Q2RJ-E1YIF" } : null,
    });
  }

  if (has("/test-environment"))
    return json({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    });
  if (has("/agent-hires")) return json({ agent: { id: "agent-preview" }, approval: null });
  if (has("/goals")) return json([]);
  if (has("/companies")) return json(method === "POST" ? COMPANY : [COMPANY]);

  return json({});
}


const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  // Only the app's own API is stood in for; anything else (fonts, assets) goes
  // to the network as normal.
  if (!url.includes("/api/")) return realFetch(input as RequestInfo, init);
  const { pathname } = new URL(url, window.location.origin);
  // eslint-disable-next-line no-console
  console.debug("[preview]", method, pathname);
  return respond(pathname, method);
}) as typeof window.fetch;

/**
 * Opens the actual wizard on its agent arc. The preview has a tenant already,
 * so organization creation is deliberately outside this flow: the first thing
 * a customer decides here is what kind of agent to add.
 */
function OpenOnboarding() {
  const { openOnboarding } = useDialog();
  useEffect(() => {
    openOnboarding({ initialStep: 3, companyId: COMPANY.id });
  }, [openOnboarding]);
  return null;
}

/**
 * The wizard hands external runtimes to the app's existing New Agent screen.
 * Keep that actual route in the preview too, rather than substituting a
 * lookalike confirmation screen after someone selects OpenClaw or Hermes.
 */
function PreviewRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/:companyPrefix/dashboard" element={<Dashboard />} />
      <Route path="/agents/new" element={<NewAgentSetup />} />
      <Route path="/:companyPrefix/agents/new" element={<NewAgentSetup />} />
      <Route
        path="*"
        element={
          <>
            <OpenOnboarding />
            <OnboardingWizard />
          </>
        }
      />
    </Routes>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <CompanyProvider>
            <BreadcrumbProvider>
              <DialogProvider>
                <TooltipProvider>
                  <PreviewRoutes />
                </TooltipProvider>
              </DialogProvider>
            </BreadcrumbProvider>
          </CompanyProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </StrictMode>,
);
