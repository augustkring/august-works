import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import { eq } from "../../packages/db/node_modules/drizzle-orm/index.js";
import { createDb, closeRegisteredClients, memoryBindings, memoryBindingTargets, memoryRecords, memoryJobs } from "../../packages/db/src/index.ts";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}
// Explicit software source records, original Native API/worker/index and built
// UI. This is not hosted maintenance, human acceptance or knowledge validation.
test("Memory history follows an actual native index receipt, language changes and original source erasure", async ({ page, request }, info) => {
  test.setTimeout(120000);
  const original = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable native Memory history fixture" } }));
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  const configParts = path.relative(tmpdir(), configPath).split(path.sep);
  expect(configParts).toHaveLength(4);
  expect(configParts[0]).toMatch(/^paperclip-e2e-home-[a-zA-Z0-9]+$/);
  expect(configParts.slice(1)).toEqual(["instances", "playwright-e2e", "config.json"]);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(path.resolve(config.database.embeddedPostgresDataDir)).toBe(path.join(path.dirname(configPath), "db"));
  const pid = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`;
  const db = createDb(databaseUrl);
  const recordId = randomUUID(), bindingId = randomUUID();
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      enableFoundationV1: true, enableContextEngineV1: true, enableCollectiveMemoryV1: true,
      agent_identities_v5: true, agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true,
      role_packs_v5: true, skill_resolver_v5: true, skill_lifecycle_v5: true, playbooks_v5: true,
      saas_deployment_profile_v6: true, billing_v6: true, cognitive_memory_v7: true,
      memory_observations_v7: true, learning_engine_v7: true, ai_use_cases_v7: true,
      governance_evidence_v7: true, readiness_engine_v7: true, core_stewards_v7: true,
      experience_projection_v9: true, progressive_shell_v9: true, maintenance_autopilot_v9: true,
    } }));
    await db.insert(memoryBindings).values({ id: bindingId, companyId: company.id, key: `history-${bindingId}`, name: "Software shared source", providerKey: "local", enabled: true, config: {} });
    await db.insert(memoryBindingTargets).values({ companyId: company.id, bindingId, targetType: "company", targetId: company.id });
    await db.insert(memoryRecords).values({ id: recordId, companyId: company.id, bindingId, providerKey: "local",
      memoryType: "observation", scopeType: "company", title: "never-display-memory-history-canary",
      content: "Explicit software-only source for a native search-index check.", reviewState: "accepted", verificationState: "human_verified",
      observedAt: new Date(), createdByActorType: "system", createdByActorId: "local-board" });
    const base = `/api/companies/${company.id}/memory/experience/maintenance`;
    const initial = await json(await request.get(`${base}?expectedUserId=local-board`));
    expect(initial.entries).toEqual([]);
    const queued = await json(await request.post(`/api/companies/${company.id}/memory/jobs`, {
      headers: { "Idempotency-Key": `browser-index-history-${recordId}` },
      data: { operationType: "index_refresh", recordIds: [recordId] },
    }));
    // The original 15-second reconciliation tick executes the real index job.
    await expect.poll(async () => {
      const view = await json(await request.get(`${base}?expectedUserId=local-board`));
      return view.entries.find((entry: { jobId: string }) => entry.jobId === queued.id)?.outcome;
    }, { timeout: 45000 }).toBe("verified_index_check");
    const response = await request.get(`${base}?expectedUserId=local-board`);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const view = await json(response);
    expect(view.entries[0]).toMatchObject({ jobId: queued.id, maintenanceClass: "M1", indexedRecordCount: 1 });
    expect(view.entries[0].receiptId).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain(recordId);
    expect(JSON.stringify(view)).not.toContain("never-display-memory-history-canary");
    expect((await request.get(`${base}?expectedUserId=another-account`)).status()).toBe(409);
    await page.goto(`/${company.issuePrefix}/memory/maintenance`);
    const heading = page.getByRole("heading", { name: "Memory maintenance history", exact: true });
    await expect(heading).toBeVisible(); await expect(heading).toBeFocused();
    await expect(page.getByRole("heading", { name: "Index check recorded", exact: true })).toBeVisible();
    await expect(page.getByText("1 shared record checked", { exact: true })).toBeVisible();
    await expect(page.getByText("never-display-memory-history-canary")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("da");
    await expect(page.getByRole("heading", { name: "Hukommelsens vedligeholdelseshistorik", exact: true })).toBeVisible();
    await expect(page.getByText("1 fælles post kontrolleret", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Sprog", exact: true }).selectOption("en");
    const reference = page.getByText("Show reference", { exact: true });
    await reference.focus(); await page.keyboard.press("Enter");
    await expect(page.getByText(queued.id, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run: (scope: string) => Promise<{ violations: unknown[] }> } }).axe.run("main")).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-memory-maintenance-mobile.png"), fullPage: true });
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.companyId, company.id))).filter((job) => job.operationType === "index_refresh")).toHaveLength(1);
    await json(await request.delete(`/api/companies/${company.id}/memory/records/${recordId}`));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Source unavailable", exact: true })).toBeVisible();
    await expect(page.getByText("1 shared record checked", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Index check recorded", exact: true })).toHaveCount(0);
    const erased = await json(await request.get(`${base}?expectedUserId=local-board`));
    expect(erased.entries[0]).toMatchObject({ outcome: "source_unavailable", receiptId: null, indexedRecordCount: null });
    await json(await request.patch("/api/instance/settings/experimental", { data: { maintenance_autopilot_v9: false } }));
    expect((await request.get(`${base}?expectedUserId=local-board`)).status()).toBe(404);
    await page.reload(); await expect(heading).toHaveCount(0);
  } finally {
    await json(await request.patch("/api/instance/settings/experimental", { data: original }));
    await closeRegisteredClients(databaseUrl);
  }
});
