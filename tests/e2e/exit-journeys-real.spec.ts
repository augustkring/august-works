import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { readZipArchive } from "../../packages/shared/src/portability-zip.ts";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";

// Exit journeys on the real backend (Phase 5 gap 5, brief section 25, ledger EXIT-R1).
// The company, Task, comment and shared Memory record are created through the
// public API and every screen reads them from PostgreSQL; no `page.route`
// fixture stands in for feature data. The disposable e2e server runs the local
// deployment profile, so the SaaS-only screens (organization deletion request
// with receipt, personal account deletion, Paddle cancellation) are skipped by
// name below rather than mocked.

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const WCAG_21_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

registerEnglishAccountLocaleIsolation(test);

type Seed = {
  companyId: string;
  companyName: string;
  prefix: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  commentBody: string;
  memoryTitle: string;
};

async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

async function seedCompany(api: APIRequestContext): Promise<Seed> {
  const session = await json(await api.get("/api/auth/get-session"));
  const stamp = Date.now();
  const companyName = `Exit journey company ${stamp}`;
  const company = await json(await api.post("/api/companies", { data: { name: companyName } }));
  const base = `/api/companies/${company.id}`;
  const taskTitle = `Close the quarterly books ${stamp}`;
  // Memory evidence quotes the Task description and pins its current version.
  const content = "The books close on the last working day of the quarter.";
  const created = await json(await api.post(`${base}/issues`, { data: {
    title: taskTitle, status: "todo", priority: "high", description: content,
  } }));
  const commentBody = `Ledger reconciled for the exit test ${stamp}.`;
  await json(await api.post(`/api/issues/${created.id}/comments`, { data: { body: commentBody } }));
  const task = await json(await api.get(`/api/issues/${created.id}`));

  // Shared Memory record, accepted through the real Memory review routes
  // (same flow as aw-v4-completion.spec.ts).
  const binding = await json(await api.post(`${base}/memory/bindings/company`, { data: {
    key: "exit-test", name: "Exit journey Memory", providerKey: "local", enabled: true, config: {},
  } }));
  const observedAt = new Date().toISOString();
  const memoryTitle = `Exit journey Memory record ${stamp}`;
  const candidate = await json(await api.post(`${base}/memory/candidates`, { data: {
    bindingId: binding.id, memoryType: "fact", scope: { type: "company", id: null }, ownerAgentId: null,
    subject: null, title: memoryTitle, content, summary: null,
    sensitivity: "internal", importance: 50, confidenceScore: 0.5, validFrom: null, validUntil: null, observedAt,
    retentionPolicy: "standard", expiresAt: null, createdByOperationId: randomUUID(), metadata: {}, evidence: [{
      sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${task.id}`,
      sourceVersion: task.updatedAt, sourceUpdatedAt: task.updatedAt, observedAt,
      excerptHash: createHash("sha256").update(content).digest("hex"),
      citation: { label: `${task.identifier}: ${task.title}` }, trustLevel: "medium", relation: "supports",
    }],
  } }));
  await json(await api.post(`${base}/memory/records/${candidate.record.id}/accept`, { data: { reason: "Exit journey fixture" } }));
  return {
    companyId: company.id, companyName, prefix: company.issuePrefix, userId: session.user.id,
    taskId: task.id, taskTitle, commentBody, memoryTitle,
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
  // Project policy (as in a11y-real-routes.spec.ts): any WCAG 2.1 A/AA violation fails.
  expect(violations.map((violation) => violation.id), `WCAG 2.1 A/AA violations on ${label}`).toEqual([]);
}

test.describe("exit journeys on the real backend", () => {
  test.describe.configure({ mode: "serial" });
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
    await json(await api.patch("/api/instance/settings/experimental", { data: { enableCollectiveMemoryV1: true } }));
    seed = await seedCompany(api);
  });

  test.afterAll(async () => {
    if (!api) return;
    if (seed) await api.delete(`/api/companies/${seed.companyId}`);
    if (originalFlags) await api.patch("/api/instance/settings/experimental", { data: originalFlags });
    await api.dispose();
  });

  test("whole-company export downloads the seeded Task, comment and Memory with a receipt", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/${seed.prefix}/company/export`);
    const exportButton = page.getByRole("button", { name: /^Export \d+ files?$/ });
    await expect(exportButton).toBeEnabled({ timeout: 30_000 });
    await auditWcag(page, "Company export (en)");

    // A whole-company export: Task and routine history is opt-in on this screen
    // ("it can be large"), so select every category, then wait for the preview.
    const include = page.getByRole("group", { name: "What to include" });
    for (const name of ["Agents", "Projects", "Skills", "Routines", "Tasks", "Attachments"]) {
      const box = include.getByRole("checkbox", { name: new RegExp(`^${name}\\b`) });
      if (!(await box.isChecked())) await box.check();
      await expect(box).toBeChecked();
    }
    await expect(exportButton).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('[data-file-tree-path="tasks"]')).toBeVisible();
    // Shared Memory travels in the company state extension; it is opt-in.
    await page.getByRole("checkbox", { name: /Include company V7 state/ }).check();
    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // Receipt: the screen confirms what was written and under which name.
    const receipt = page.getByText(/files? exported as .+\.zip/);
    await expect(receipt).toBeVisible();
    await expect(page.getByText("Export downloaded", { exact: true })).toBeVisible();

    // Read the archive with the product's own portable reader (the importer's).
    const archive = await readZipArchive(await readFile(await download.path()));
    const text = (path: string) => {
      const entry = archive.files[path];
      return typeof entry === "string" ? entry : "";
    };
    const paths = Object.keys(archive.files);
    test.info().annotations.push({ type: "export files", description: paths.join(", ") });
    const taskFiles = paths.filter((path) => path.startsWith("tasks/") && text(path).includes(seed.taskTitle));
    expect(taskFiles, "the seeded Task is in the archive as a Task file").not.toEqual([]);
    expect(paths.some((path) => text(path).includes(seed.commentBody)), "the Task comment is in the archive").toBe(true);
    const state = JSON.parse(text("august-works-state-v7.json") || "{}");
    expect(JSON.stringify(state), "the shared Memory record is in the archive").toContain(seed.memoryTitle);
    // No credentials in a portable package.
    expect(paths.join("\n")).not.toMatch(/secret|\.env$/i);
  });
});
