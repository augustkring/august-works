import { createRequire } from "node:module";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";

// Accessibility sweep over the assembled product (Phase 5 gap 7, ledger A11Y-R1).
// Real backend only: the company, agent, project, tasks, comments and approval are
// created through the public API and every screen reads them from PostgreSQL. No
// `page.route` fixture stands in for feature data. The V9 customer shell rollout
// flags are set through the real instance settings API and restored afterwards.
// This proves automated WCAG 2.1 A/AA rules and keyboard reach of each screen's
// primary action in English and Danish. It is not screen-reader acceptance,
// manual contrast review or human Danish language QA.

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const WCAG_21_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CUSTOMER_SHELL_FLAGS = {
  experience_projection_v9: true,
  progressive_shell_v9: true,
  home_v9: true,
  ambient_commands_v9: true,
  customer_feedback_v9: true,
};

registerEnglishAccountLocaleIsolation(test);

type Locale = "en" | "da";
type Seed = {
  companyId: string;
  prefix: string;
  userId: string;
  agentKey: string;
  projectKey: string;
  blockedIdentifier: string;
  approvalId: string;
};
type Screen = {
  name: string;
  path: (seed: Seed) => string;
  /** Visible h1 per locale, for screens whose heading is translated. */
  heading?: Record<Locale, string>;
  /** Real seeded content that must be on screen before the audit. */
  content?: string;
  /** The real API read that supplies `content`; the audit waits for it. */
  data?: (seed: Seed) => string;
  /** The screen's primary action, which must be reachable with Tab. */
  primary: (main: Locator) => Locator;
};

const byLocale = (en: string, da: string) => new RegExp(`^(${escape(en)}|${escape(da)})$`);
function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SCREENS: Screen[] = [
  {
    name: "Home",
    path: () => "dashboard",
    heading: { en: "Home", da: "Hjem" },
    primary: (main) => main.getByRole("button", { name: byLocale("Ask Blentera", "Spørg Blentera") }),
  },
  {
    name: "Needs you",
    path: () => "needs-you",
    heading: { en: "Needs You", da: "Kræver dig" },
    primary: (main) => main.getByRole("link", { name: byLocale("Review", "Gennemgå") }).first(),
  },
  {
    name: "Work",
    path: () => "work",
    heading: { en: "Work", da: "Arbejde" },
    primary: (main) => main.getByRole("link", { name: byLocale("Tasks", "Opgaver") }),
  },
  {
    name: "Tasks list",
    path: () => "issues",
    content: "Publish pricing page",
    data: (seed) => `/api/companies/${seed.companyId}/issues`,
    primary: (main) => main.getByRole("button", { name: byLocale("New Task", "Ny opgave") }),
  },
  {
    name: "Task detail with comments",
    path: (seed) => `issues/${seed.blockedIdentifier}`,
    content: "Finance expects to confirm on Friday.",
    data: (seed) => `/api/issues/${seed.blockedIdentifier}/comments`,
    primary: (main) => main.getByRole("textbox", { name: "editable markdown" }),
  },
  {
    name: "Agents list",
    path: () => "agents/all",
    content: "Research assistant",
    primary: (main) => main.getByRole("button", { name: byLocale("New Agent", "Ny agent") }),
  },
  {
    name: "Agent detail",
    path: (seed) => `agents/${seed.agentKey}`,
    heading: { en: "Research assistant", da: "Research assistant" },
    primary: (main) => main.getByRole("button", { name: "Assign Task", exact: true }),
  },
  {
    name: "Projects",
    path: () => "projects",
    content: "Website refresh",
    primary: (main) => main.getByRole("button", { name: byLocale("Add Project", "Tilføj projekt") }),
  },
  {
    name: "Project detail",
    path: (seed) => `projects/${seed.projectKey}`,
    content: "Draft the launch announcement",
    data: (seed) => `/api/companies/${seed.companyId}/issues`,
    primary: (main) => main.getByRole("button", { name: byLocale("New Task", "Ny opgave") }),
  },
  {
    name: "Approvals",
    path: () => "approvals/pending",
    content: "Approve publishing the pricing page",
    primary: (main) => main.getByRole("button", { name: byLocale("Approve", "Godkend") }),
  },
  {
    name: "Approval detail",
    path: (seed) => `approvals/${seed.approvalId}`,
    content: "Publish pricing page",
    primary: (main) => main.getByRole("button", { name: byLocale("Approve", "Godkend") }),
  },
  {
    name: "Inbox",
    path: () => "inbox/mine",
    primary: (main) => main.getByRole("link", { name: /Approve publishing the pricing page/ }),
  },
  {
    name: "Apps",
    path: () => "apps",
    primary: (main) => main.getByRole("searchbox", { name: byLocale("Search connections", "Søg i forbindelser") }),
  },
  {
    name: "Company settings",
    path: () => "company/settings",
    heading: { en: "Company", da: "Virksomhed" },
    primary: (main) => main.getByRole("link", { name: byLocale("Company identity", "Virksomhedsidentitet") }),
  },
  {
    name: "Company general settings",
    path: () => "company/settings/general",
    primary: (main) => main.getByRole("textbox", { name: byLocale("Organization name", "Virksomhedsnavn") }),
  },
  {
    name: "Account profile",
    path: () => "company/settings/instance/profile",
    primary: (main) => main.getByRole("button", { name: byLocale("Save profile", "Gem profil") }),
  },
  {
    name: "Account security",
    path: () => "company/settings/security",
    heading: { en: "Account security", da: "Kontosikkerhed" },
    // "Set up an authenticator" stays disabled until the password is entered.
    primary: (main) => main.getByLabel(byLocale("Current password", "Nuværende adgangskode")),
  },
  {
    name: "Help",
    path: () => "company/help",
    heading: { en: "How can we help?", da: "Hvordan kan vi hjælpe?" },
    // The search button stays disabled until a query is typed.
    primary: (main) => main.getByRole("searchbox", { name: byLocale("Search Help", "Søg i Hjælp") }),
  },
  {
    name: "Support",
    path: () => "company/support",
    heading: { en: "Contact support", da: "Kontakt support" },
    primary: (main) => main.getByRole("link", { name: byLocale("Contact support", "Kontakt support") }),
  },
];

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

async function seedCompany(api: APIRequestContext): Promise<Seed> {
  const session = await json(await api.get("/api/auth/get-session"));
  const company = await json(await api.post("/api/companies", { data: { name: "Accessibility sweep company" } }));
  const base = `/api/companies/${company.id}`;
  const agent = await json(await api.post(`${base}/agents`, { data: {
    name: "Research assistant", role: "engineer", adapterType: "process",
    adapterConfig: { command: "/usr/bin/true" },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } }, budgetMonthlyCents: 0,
  } }));
  const project = await json(await api.post(`${base}/projects`, { data: {
    name: "Website refresh", description: "Refresh the public website copy.",
  } }));
  const task = async (data: Record<string, unknown>) => json(await api.post(`${base}/issues`, { data }));
  const draft = await task({ title: "Draft the launch announcement", status: "todo", priority: "high", assigneeAgentId: agent.id, projectId: project.id });
  const blocked = await task({
    title: "Publish pricing page", status: "blocked", priority: "medium", assigneeAgentId: agent.id,
    projectId: project.id, description: "Waiting for final prices.", blockedByIssueIds: [draft.id],
  });
  await task({ title: "Review the onboarding email", status: "in_review", priority: "low", assigneeUserId: session.user.id, projectId: project.id });
  await task({ title: "Collect customer quotes", status: "backlog" });
  for (const body of [
    "The prices are not final yet. I will continue when finance confirms them.",
    "Finance expects to confirm on Friday.",
  ]) await json(await api.post(`/api/issues/${blocked.id}/comments`, { data: { body } }));
  expect((await json(await api.get(`/api/issues/${blocked.id}`))).status).toBe("blocked");
  const approval = await json(await api.post(`${base}/approvals`, { data: {
    type: "request_board_approval", requestedByAgentId: agent.id, issueIds: [blocked.id],
    payload: { title: "Approve publishing the pricing page", summary: "The page goes live after approval." },
  } }));
  return {
    companyId: company.id, prefix: company.issuePrefix, userId: session.user.id,
    agentKey: agent.urlKey ?? agent.id, projectKey: project.urlKey ?? project.id,
    blockedIdentifier: blocked.identifier, approvalId: approval.id,
  };
}

type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

async function auditWcag(page: Page, label: string) {
  await page.addScriptTag({ path: axePath });
  const violations: AxeViolation[] = await page.evaluate(async (tags) => {
    const axe = (window as unknown as {
      axe: { run(context: Document, options: unknown): Promise<{ violations: AxeViolation[] }> };
    }).axe;
    return (await axe.run(document, { runOnly: { type: "tag", values: tags } })).violations;
  }, WCAG_21_A_AA);
  const summary = violations.map((violation) =>
    `[${violation.impact}] ${violation.id}: ${violation.help} -> ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  for (const line of summary) test.info().annotations.push({ type: `axe ${label}`, description: line });
  if (summary.length) console.log(`axe ${label}\n  ${summary.join("\n  ")}`);
  const blocking = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => violation.id), `serious/critical WCAG 2.1 A/AA violations on ${label}`).toEqual([]);
  // Project policy (see aw-v9-*.spec.ts `axe.run(...).violations).toEqual([])`):
  // moderate and minor WCAG violations fail too; they are listed above first.
  expect(violations.map((violation) => violation.id), `WCAG 2.1 A/AA violations on ${label}`).toEqual([]);
}

type FocusStyle = { outline: string; boxShadow: string; borderColor: string; backgroundColor: string; textDecoration: string };
/** Styles of the element and its nearest ancestors, so a rich-text composer that
 * shows focus on its frame with `:focus-within` counts as a visible indicator. */
function focusStyles(target: Locator): Promise<FocusStyle[]> {
  return target.evaluate((element) => {
    const styles: FocusStyle[] = [];
    for (let node: Element | null = element; node && styles.length < 8; node = node.parentElement) {
      const style = getComputedStyle(node);
      styles.push({
        outline: style.outlineStyle === "none" || parseFloat(style.outlineWidth) === 0
          ? "none" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        textDecoration: style.textDecorationLine,
      });
    }
    return styles;
  });
}

async function expectKeyboardReachable(page: Page, target: Locator, label: string) {
  await expect(target, `${label}: primary action`).toBeVisible();
  await target.evaluate((element) => {
    element.setAttribute("data-a11y-primary", "");
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const rest = await focusStyles(target);
  await page.mouse.move(0, 0);
  let reached = false;
  for (let presses = 0; presses < 300 && !reached; presses += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.hasAttribute("data-a11y-primary") ?? false);
  }
  expect(reached, `${label}: primary action is reachable with Tab`).toBe(true);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  expect(await target.evaluate((element) => element.matches(":focus-visible")), `${label}: :focus-visible`).toBe(true);
  // Compare against the resting style so a focus ring, outline, border or fill
  // change counts, while an element that looks identical when focused fails.
  await expect.poll(async () => (await focusStyles(target)).some((focused, level) => {
    const resting = rest[level]!;
    return (level === 0 && focused.outline !== "none")
      || focused.outline !== resting.outline
      || focused.boxShadow !== resting.boxShadow
      || focused.borderColor !== resting.borderColor
      || focused.backgroundColor !== resting.backgroundColor
      || focused.textDecoration !== resting.textDecoration;
  }), { message: `${label}: focus indicator is visible` }).toBe(true);
}

test.describe("accessibility of real routes in English and Danish", () => {
  let seed: Seed;
  let api: APIRequestContext;
  let originalFlags: Record<string, unknown>;

  test.beforeAll(async ({ playwright }, info) => {
    const baseURL = info.project.use.baseURL!;
    api = await playwright.request.newContext({
      baseURL,
      storageState: info.project.use.storageState as string,
      extraHTTPHeaders: { Origin: new URL(baseURL).origin },
    });
    originalFlags = await json(await api.get("/api/instance/settings/experimental"));
    await json(await api.patch("/api/instance/settings/experimental", { data: CUSTOMER_SHELL_FLAGS }));
    seed = await seedCompany(api);
    // A freshly started server can miss the Home projection's 1.5 s deadline
    // on its first reads (503 experience_overloaded; Home then offers "Try
    // again"). Warm the real projection before auditing; A11Y-R1 records it.
    await expect.poll(async () => (await api.get(`/api/companies/${seed.companyId}/experience`)).status(), {
      message: "Home projection answers after server start",
      timeout: 30_000,
    }).toBe(200);
  });

  test.afterAll(async () => {
    if (!api) return;
    if (seed) await api.delete(`/api/companies/${seed.companyId}`);
    if (originalFlags) await api.patch("/api/instance/settings/experimental", { data: originalFlags });
    await api.dispose();
  });

  for (const locale of ["en", "da"] as const) {
    test.describe(locale === "en" ? "English" : "Danish", () => {
      test.beforeEach(async ({ page, request }) => {
        // The account preference is the real persisted language; the explicit
        // browser choice keeps the first paint in the same language.
        if (locale === "da") {
          await json(await request.patch("/api/auth/preferences", { data: { expectedUserId: seed.userId, locale: "da" } }));
        }
        await page.addInitScript((value) => window.localStorage.setItem("aw.v9.display-locale", value), locale);
      });

      for (const screen of SCREENS) {
        test(`${screen.name} passes WCAG 2.1 A/AA and keyboard reach (${locale})`, async ({ page }) => {
          const label = `${screen.name} (${locale})`;
          // Wait for the real read rather than a fixed delay. The task list
          // read measured 2-7 s on the disposable e2e server (see A11Y-R1).
          const data = screen.data
            ? page.waitForResponse((response) => response.request().method() === "GET"
              && new URL(response.url()).pathname === screen.data!(seed))
            : undefined;
          await page.goto(`/${seed.prefix}/${screen.path(seed)}`);
          if (data) expect((await data).ok(), `${label}: ${screen.data!(seed)}`).toBe(true);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          const main = page.getByRole("main");
          if (screen.heading) {
            await expect(page.getByRole("heading", { level: 1, name: screen.heading[locale], exact: true })).toBeVisible();
          }
          if (screen.content) await expect(main.getByText(screen.content).first()).toBeVisible();
          const primary = screen.primary(main);
          await expect(primary).toBeVisible();
          const headings = await page.locator("h1").allInnerTexts();
          test.info().annotations.push({ type: "h1", description: `${label}: ${JSON.stringify(headings)}` });
          await auditWcag(page, label);
          await expectKeyboardReachable(page, primary, label);
        });
      }

      test(`Billing is audited only with a Paddle account (${locale})`, async () => {
        // company/settings/billing renders "Billing is not available in this
        // deployment" unless a SaaS deployment with a Paddle seller account
        // (client token, webhook secret, test price IDs) is configured.
        test.skip(true, "Needs an owner-provided Paddle sandbox seller account");
      });
    });
  }
});
