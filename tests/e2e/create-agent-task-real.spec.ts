import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";
import { deleteCompany } from "./company-cleanup";

// Create an agent and a task through the real UI (Phase 5 gap 8, ledger CREATE-R1).
// Real backend only: the agent is created by the New Agent wizard
// (POST agent-hires) and the task by the New Task dialog (POST issues); every
// screen reads them back from PostgreSQL. No `page.route` fixture stands in for
// feature data. Only the disposable company and the customer shell rollout
// flags are set through the public API.
//
// Runtime: the wizard deliberately offers no process/fixture adapter, so the
// agent uses Gemini CLI with no key ("optional if already configured"). No
// model is called: the server's paid-transport admission refuses the
// assignment wake before any process starts (configuration_incomplete, no
// pid), which this spec asserts. A real model answer needs a provider account
// and is out of scope here.

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const WCAG_21_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CUSTOMER_SHELL_FLAGS = {
  experience_projection_v9: true,
  progressive_shell_v9: true,
  home_v9: true,
  ambient_commands_v9: true,
  customer_feedback_v9: true,
};

type Locale = "en" | "da";
type Tree = { [key: string]: string | Tree };
const catalogues: Record<Locale, Tree> = {
  en: JSON.parse(readFileSync(path.resolve("ui/src/i18n/experience/en.json"), "utf8")),
  da: JSON.parse(readFileSync(path.resolve("ui/src/i18n/experience/da.json"), "utf8")),
};

/** The visible text for a catalogue key, with {{name}} placeholders filled. */
function copy(locale: Locale, key: string, values: Record<string, string> = {}) {
  const value = key.split(".").reduce<string | Tree | undefined>(
    (node, part) => (typeof node === "object" ? node[part] : undefined),
    catalogues[locale],
  );
  if (typeof value !== "string") throw new Error(`Missing ${locale} catalogue key ${key}`);
  return value.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => values[name] ?? "");
}

registerEnglishAccountLocaleIsolation(test);

async function json(response: APIResponse) {
  expect(response.ok(), `${response.url()}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] };

/** WCAG 2.1 A/AA audit of one step's main region (or its dialog). */
async function auditWcag(page: Page, region: Locator, label: string) {
  await expect(region).toBeVisible();
  await page.addScriptTag({ path: axePath });
  const handle = await region.elementHandle();
  const violations: AxeViolation[] = await page.evaluate(async ([element, tags]) => {
    const axe = (window as unknown as {
      axe: { run(context: Element, options: unknown): Promise<{ violations: AxeViolation[] }> };
    }).axe;
    return (await axe.run(element as Element, { runOnly: { type: "tag", values: tags } })).violations;
  }, [handle, WCAG_21_A_AA] as const);
  const summary = violations.map((violation) =>
    `[${violation.impact}] ${violation.id}: ${violation.help} -> ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary?.replace(/\s+/g, " ")})`).join(" | ")}`);
  for (const line of summary) test.info().annotations.push({ type: `axe ${label}`, description: line });
  if (summary.length) console.log(`axe ${label}\n  ${summary.join("\n  ")}`);
  // Project policy (as in a11y-real-routes.spec.ts): any WCAG 2.1 A/AA violation fails.
  expect(violations.map((violation) => violation.id), `WCAG 2.1 A/AA violations on ${label}`).toEqual([]);
}

test.describe("create an agent and a task through the real UI", () => {
  let api: APIRequestContext;
  let originalFlags: Record<string, unknown>;
  let userId: string;

  test.beforeAll(async ({ playwright }, info) => {
    const baseURL = info.project.use.baseURL!;
    api = await playwright.request.newContext({
      baseURL,
      storageState: info.project.use.storageState as string,
      extraHTTPHeaders: { Origin: new URL(baseURL).origin },
    });
    userId = (await json(await api.get("/api/auth/get-session"))).user.id;
    originalFlags = await json(await api.get("/api/instance/settings/experimental"));
    await json(await api.patch("/api/instance/settings/experimental", { data: CUSTOMER_SHELL_FLAGS }));
  });

  test.afterAll(async () => {
    if (!api) return;
    if (originalFlags) {
      await api.patch("/api/instance/settings/experimental", {
        data: Object.fromEntries(Object.keys(CUSTOMER_SHELL_FLAGS).map((key) => [key, originalFlags[key]])),
      });
    }
    await api.dispose();
  });

  for (const locale of ["en", "da"] as const) {
    test(`create an agent, assign it a task from Tasks and find it again after reload (${locale})`, async ({ page, request }) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      const t = (key: string, values?: Record<string, string>) => copy(locale, key, values);
      const stamp = Date.now();
      const companyName = `Create journey ${locale} ${stamp}`;
      const agentName = locale === "en" ? `Ledger helper ${stamp}` : `Bogholderhjælper ${stamp}`;
      const taskTitle = locale === "en" ? `Reconcile the cash book ${stamp}` : `Afstem kassebogen ${stamp}`;
      const company = await json(await request.post("/api/companies", { data: { name: companyName } }));
      try {
        if (locale === "da") {
          await json(await request.patch("/api/auth/preferences", { data: { expectedUserId: userId, locale: "da" } }));
        }
        await page.addInitScript((value) => window.localStorage.setItem("aw.v9.display-locale", value), locale);
        const main = page.getByRole("main");

        // 1. Agents list -> New Agent.
        await page.goto(`/${company.issuePrefix}/agents/all`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const newAgent = main.getByRole("button", { name: t("screens.agents.newAgent"), exact: true }).first();
        await expect(newAgent).toBeVisible();
        await auditWcag(page, main, `Agents list (${locale})`);
        await newAgent.click();

        // 2. Name step of the New Agent dialog.
        let dialog = page.getByRole("dialog", { name: t("screens.newAgent.nameTitle"), exact: true });
        await expect(dialog).toBeVisible();
        await auditWcag(page, dialog, `New agent name (${locale})`);
        await dialog.getByRole("textbox", { name: t("screens.newAgent.nameLabel"), exact: true }).fill(agentName);
        await dialog.getByRole("button", { name: t("screens.newAgent.chooseAdapter"), exact: true }).click();

        // 3. Adapter step. The radio is visually hidden inside its card label.
        dialog = page.getByRole("dialog", { name: t("screens.newAgent.adapterTitle"), exact: true });
        await expect(dialog.getByText(t("screens.newAgent.adapterLede", { name: agentName }), { exact: true })).toBeVisible();
        const gemini = dialog.getByRole("radio", { name: "Gemini CLI", exact: true });
        await auditWcag(page, dialog, `New agent adapter (${locale})`);
        await dialog.locator("label").filter({ has: page.getByRole("radio", { name: "Gemini CLI", exact: true }) }).click();
        await expect(gemini).toBeChecked();
        await dialog.getByRole("button", { name: t("screens.newAgent.configure"), exact: true }).click();

        // 4. Configure step on the New Agent page.
        await expect(main.getByRole("heading", { name: t("screens.newAgent.configureTitle"), exact: true })).toBeVisible();
        await expect(main.getByRole("navigation", { name: t("screens.newAgent.stepsNav"), exact: true })).toBeVisible();
        await expect(main.getByRole("textbox", { name: "GEMINI_API_KEY", exact: true }))
          .toHaveAttribute("placeholder", t("screens.newAgent.optionalKey"));
        const finish = main.getByRole("button", { name: t("screens.newAgent.finish"), exact: true });
        await expect(finish).toBeEnabled();
        await auditWcag(page, main, `New agent configure (${locale})`);
        const hired = page.waitForResponse((response) => response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/companies/${company.id}/agent-hires`);
        await finish.click();
        expect((await hired).status()).toBe(201);

        // 5. Confirmation, read back from the server.
        await expect(main.getByRole("heading", { name: t("screens.newAgent.ready"), exact: true })).toBeVisible();
        await expect(main.getByText(t("screens.newAgent.assignWhenReady"), { exact: true })).toBeVisible();
        await auditWcag(page, main, `New agent confirmation (${locale})`);
        const agents = await json(await request.get(`/api/companies/${company.id}/agents`));
        const agent = agents.find((row: { name: string }) => row.name === agentName);
        expect(agent, "the agent is stored").toBeTruthy();
        expect(agent).toMatchObject({ companyId: company.id, adapterType: "gemini_local", status: "idle" });

        // 6. Work -> Tasks -> New Task, assigned to the new agent.
        await page.getByRole("complementary").getByRole("link", { name: t("nav.work"), exact: true }).click();
        await main.getByRole("link", { name: t("tasks"), exact: true }).click();
        await expect(page.getByRole("heading", { level: 1, name: t("screens.issues.breadcrumb"), exact: true })).toBeVisible();
        await auditWcag(page, main, `Tasks (${locale})`);
        await main.getByRole("button", { name: t("screens.issues.newTask"), exact: true }).first().click();
        dialog = page.getByRole("dialog", { name: t("screens.newTask.title"), exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("textbox", { name: t("screens.newTask.taskTitle"), exact: true }).fill(taskTitle);
        await dialog.getByRole("button", { name: t("screens.newTask.assignee"), exact: true }).click();
        const picker = page.getByRole("dialog").filter({
          has: page.getByRole("textbox", { name: t("screens.newTask.searchAssignees"), exact: true }),
        });
        await picker.getByRole("textbox", { name: t("screens.newTask.searchAssignees"), exact: true }).fill(agentName);
        await picker.getByRole("button", { name: agentName, exact: true }).click();
        await expect(dialog.getByRole("button", { name: agentName, exact: true })).toBeVisible();
        await auditWcag(page, dialog, `New task (${locale})`);
        const created = page.waitForResponse((response) => response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/companies/${company.id}/issues`);
        await dialog.getByRole("button", { name: t("screens.newTask.create"), exact: true }).click();
        const createdResponse = await created;
        expect(createdResponse.status(), await createdResponse.text()).toBe(201);
        const task = await createdResponse.json();
        expect(task).toMatchObject({ companyId: company.id, title: taskTitle, assigneeAgentId: agent.id });
        await expect(dialog).toBeHidden();
        await expect(main.getByRole("link", { name: new RegExp(taskTitle) }).first()).toBeVisible();

        // No model is called: the assignment wake is refused before a process
        // starts, and the refusal is a stored run the agent page can show.
        await expect.poll(async () => {
          const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs?agentId=${agent.id}`));
          return runs.map((run: { status: string; errorCode: string | null }) => `${run.status}:${run.errorCode}`);
        }, { timeout: 30_000 }).toEqual(["failed:configuration_incomplete"]);
        const [run] = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs?agentId=${agent.id}`));
        const runDetail = await json(await request.get(`/api/heartbeat-runs/${run.id}`));
        expect(runDetail).toMatchObject({ issueId: task.id, processPid: null, processStartedAt: null });

        // 7. The agent's page lists the task; so does the monitor's last run.
        await page.getByRole("complementary").getByRole("link", { name: t("nav.agents"), exact: true }).click();
        await main.getByRole("link", { name: agentName }).first().click();
        const recent = main.getByRole("region", { name: t("screens.agent.ov.recentTasks"), exact: true });
        await expect(recent.getByRole("link", { name: new RegExp(taskTitle) })).toBeVisible();
        await auditWcag(page, main, `Agent overview (${locale})`);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(recent.getByRole("link", { name: new RegExp(taskTitle) })).toBeVisible();

        await page.goto(`/${company.issuePrefix}/agents/${agent.id}/monitor`);
        await expect(main.getByRole("heading", { level: 1, name: t("agentMonitorTitle", { name: agentName }), exact: true })).toBeVisible();
        await expect(main.getByRole("region", { name: t("agentMonitorRecent"), exact: true })).toBeVisible();
        await auditWcag(page, main, `Agent monitor (${locale})`);

        // 8. Reload Tasks and open the task: still assigned to the agent.
        await page.goto(`/${company.issuePrefix}/issues`);
        await page.reload();
        await main.getByRole("link", { name: new RegExp(taskTitle) }).first().click();
        await expect(main.getByRole("heading", { name: taskTitle })).toBeVisible();
        expect(await json(await request.get(`/api/issues/${task.id}`))).toMatchObject({
          title: taskTitle, assigneeAgentId: agent.id,
        });
      } finally {
        await json(await deleteCompany(api, company.id));
      }
    });
  }
});
