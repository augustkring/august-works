import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { eq } from "../../server/node_modules/drizzle-orm/index.js";
import { companies, createDb, issueComments, issues, memoryRecords } from "../../packages/db/src/index.ts";
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

const DELETION_COPY = {
  en: {
    heading: "Delete organization",
    organizationsLink: "Open Organizations",
    actions: (name: string) => `Actions for ${name}`,
    deleteItem: "Delete Organization",
    confirmation: ["Delete this organization and all its data?", "cannot be undone", "archive"],
    exportLink: "Export a copy first",
    confirm: "Delete",
    cancel: "Cancel",
  },
  da: {
    heading: "Slet organisation",
    organizationsLink: "Åbn Organisationer",
    actions: (name: string) => `Handlinger for ${name}`,
    deleteItem: "Slet organisation",
    confirmation: ["Slet denne organisation og alle dens data?", "kan ikke fortrydes", "arkiv"],
    exportLink: "Eksportér en kopi først",
    confirm: "Slet",
    cancel: "Annuller",
  },
} as const;

type Seed = {
  companyId: string;
  companyName: string;
  prefix: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  commentBody: string;
  memoryTitle: string;
  memoryRecordId: string;
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
    taskId: task.id, taskTitle, commentBody, memoryTitle, memoryRecordId: candidate.record.id,
  };
}

/** The seeded data, read back through the real API. */
async function expectSeedIntact(api: APIRequestContext, seed: Seed, when: string) {
  const company = await json(await api.get(`/api/companies/${seed.companyId}`));
  expect(company.status, `${when}: company is still active`).toBe("active");
  expect((await json(await api.get(`/api/issues/${seed.taskId}`))).title, `${when}: Task`).toBe(seed.taskTitle);
  const comments = await json(await api.get(`/api/issues/${seed.taskId}/comments`));
  expect(JSON.stringify(comments), `${when}: comment`).toContain(seed.commentBody);
  const memory = await json(await api.get(`/api/companies/${seed.companyId}/memory/records/${seed.memoryRecordId}`));
  expect(JSON.stringify(memory), `${when}: Memory record`).toContain(seed.memoryTitle);
}

/** Rows of the seed still stored in the disposable server's PostgreSQL. */
async function storedSeedRows(seed: Seed) {
  const config = JSON.parse(await readFile(process.env.PAPERCLIP_E2E_SERVER_CONFIG!, "utf8"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const db = createDb(`postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`);
  try {
    const count = async (rows: Promise<unknown[]>) => (await rows).length;
    return {
      company: await count(db.select({ id: companies.id }).from(companies).where(eq(companies.id, seed.companyId))),
      task: await count(db.select({ id: issues.id }).from(issues).where(eq(issues.id, seed.taskId))),
      comments: await count(db.select({ id: issueComments.id }).from(issueComments).where(eq(issueComments.issueId, seed.taskId))),
      memory: await count(db.select({ id: memoryRecords.id }).from(memoryRecords).where(eq(memoryRecords.id, seed.memoryRecordId))),
    };
  } finally {
    await db.$client.end({ timeout: 2 });
  }
}

type AxeViolation = { id: string; impact: string | null; help: string; nodes: { target: string[]; failureSummary?: string }[] };

async function auditWcag(page: Page, label: string) {
  await page.addScriptTag({ path: axePath });
  const violations: AxeViolation[] = await page.evaluate(async (tags) => {
    const axe = (window as unknown as {
      axe: { run(context: Document, options: unknown): Promise<{ violations: AxeViolation[] }> };
    }).axe;
    return (await axe.run(document, { runOnly: { type: "tag", values: tags } })).violations;
  }, WCAG_21_A_AA);
  const summary = violations.map((violation) =>
    `[${violation.impact}] ${violation.id}: ${violation.help} -> ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(" ")} (${node.failureSummary?.replace(/\s+/g, " ")})`).join(" | ")}`);
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
  let deleted = false;

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
    if (seed && !deleted) await api.delete(`/api/companies/${seed.companyId}`);
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

  test("the sole owner cannot remove themselves or give up ownership", async ({ page }) => {
    // Product rule (brief 25.2 step 3, routes/access.ts getProtectedMemberReason
    // and services/access.ts assertCanRemoveActiveOwner): nobody removes their
    // own membership, and the last active owner cannot be removed or demoted.
    // Deleting the company itself is not blocked by being its sole owner.
    const { members } = await json(await api.get(`/api/companies/${seed.companyId}/members`));
    const owners = members.filter((member: { membershipRole: string; status: string }) =>
      member.membershipRole === "owner" && member.status === "active");
    expect(owners.map((member: { principalId: string }) => member.principalId)).toEqual([seed.userId]);
    const self = owners[0];

    await page.goto(`/${seed.prefix}/company/settings/members`);
    const row = page.getByRole("row").filter({ hasText: self.user?.email ?? seed.userId });
    const remove = row.getByRole("button", { name: "Remove", exact: true });
    await expect(remove).toBeDisabled();
    await expect(remove).toHaveAccessibleDescription("You cannot remove yourself.");
    await auditWcag(page, "Members (en)");

    // The same guard holds on the API the screen uses.
    const leave = await api.post(`/api/companies/${seed.companyId}/members/${self.id}/archive`, { data: {} });
    expect(leave.status(), await leave.text()).toBe(403);
    const demote = await api.patch(`/api/companies/${seed.companyId}/members/${self.id}`, { data: { membershipRole: "operator" } });
    expect(demote.status(), await demote.text()).toBe(403);
    const after = (await json(await api.get(`/api/companies/${seed.companyId}/members`))).members
      .find((member: { id: string }) => member.id === self.id);
    expect(after).toMatchObject({ membershipRole: "owner", status: "active" });
  });

  for (const locale of ["en", "da"] as const) {
    test(`organization deletion asks first and keeps the data until confirmed (${locale})`, async ({ page, request }) => {
      const copy = DELETION_COPY[locale];
      if (locale === "da") {
        await json(await request.patch("/api/auth/preferences", { data: { expectedUserId: seed.userId, locale: "da" } }));
      }
      await page.addInitScript((value) => window.localStorage.setItem("aw.v9.display-locale", value), locale);

      // Company settings -> Deletion is the hosted (SaaS) request screen. On this
      // deployment it must say so and point to where deletion really happens.
      await page.goto(`/${seed.prefix}/company/settings/deletion`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1, name: copy.heading, exact: true })).toBeVisible();
      const elsewhere = page.getByRole("link", { name: copy.organizationsLink, exact: true });
      await expect(elsewhere).toBeVisible();
      await auditWcag(page, `Organization deletion (${locale})`);
      await elsewhere.click();

      // Organizations list: the real delete control for this deployment.
      const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: seed.companyName, exact: true }) });
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: copy.actions(seed.companyName), exact: true }).click();
      await page.getByRole("menuitem", { name: copy.deleteItem, exact: true }).click();
      const confirm = card.getByRole("alertdialog");
      await expect(confirm).toBeVisible();
      // Delete erases data; archive keeps it. The confirmation says which is which.
      for (const phrase of copy.confirmation) await expect(confirm).toContainText(phrase);
      await expect(confirm.getByRole("link", { name: copy.exportLink, exact: true })).toBeVisible();
      const confirmDelete = confirm.getByRole("button", { name: copy.confirm, exact: true });
      await expect(confirmDelete).toBeVisible();
      await auditWcag(page, `Organization delete confirmation (${locale})`);

      // Nothing is deleted while the confirmation is open.
      await expectSeedIntact(api, seed, `${locale}: confirmation open`);
      await confirm.getByRole("button", { name: copy.cancel, exact: true }).click();
      await expect(confirm).toBeHidden();
      // Backing out keeps everything.
      await expectSeedIntact(api, seed, `${locale}: after cancel`);
    });
  }

  test("confirmed deletion removes the company with its Task, comment and Memory", async ({ page }) => {
    await expectSeedIntact(api, seed, "before deletion");
    expect(await storedSeedRows(seed)).toEqual({ company: 1, task: 1, comments: 1, memory: 1 });
    await page.goto(`/${seed.prefix}/companies`);
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: seed.companyName, exact: true }) });
    await card.getByRole("button", { name: DELETION_COPY.en.actions(seed.companyName), exact: true }).click();
    await page.getByRole("menuitem", { name: DELETION_COPY.en.deleteItem, exact: true }).click();
    const removal = page.waitForResponse((response) => response.request().method() === "DELETE"
      && new URL(response.url()).pathname === `/api/companies/${seed.companyId}`);
    await card.getByRole("alertdialog").getByRole("button", { name: DELETION_COPY.en.confirm, exact: true }).click();
    expect((await removal).status()).toBe(200);
    await expect(card).toBeHidden();
    deleted = true;
    // Gone from the API (403: no membership remains, so existence is not disclosed)...
    const companiesAfter = await json(await api.get("/api/companies"));
    expect(companiesAfter.map((company: { id: string }) => company.id)).not.toContain(seed.companyId);
    for (const path of [`/api/companies/${seed.companyId}`, `/api/issues/${seed.taskId}`,
      `/api/companies/${seed.companyId}/memory/records/${seed.memoryRecordId}`]) {
      expect([403, 404], path).toContain((await api.get(path)).status());
    }
    // ...and from the database: the rows are erased, not hidden.
    expect(await storedSeedRows(seed)).toEqual({ company: 0, task: 0, comments: 0, memory: 0 });
  });

  test("hosted organization deletion receipt and personal account deletion need the SaaS profile", async () => {
    // company/settings/deletion and the account deletion on company/settings/security
    // are served only by AW_DEPLOYMENT_PROFILE=saas, which requires TLS-verified
    // managed PostgreSQL, S3-compatible object storage, Mailgun and Paddle accounts.
    // Their wording, confirmation and receipt states are covered by
    // SaasDeletion.test.tsx and SaasAccount.test.tsx; the sole-owner account block
    // (ACCOUNT_SOLE_OWNER) by v6-account-deletion.integration.test.ts.
    test.skip(true, "Needs the SaaS deployment profile: managed PostgreSQL with TLS, S3 object storage, Mailgun and Paddle accounts");
  });

  test("cancelling a subscription needs a Paddle account", async () => {
    // company/settings/billing renders "Billing is not available in this
    // deployment" unless a SaaS deployment with a Paddle seller account is configured.
    test.skip(true, "Needs an owner-provided Paddle sandbox seller account");
  });
});
