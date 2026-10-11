import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true);
  return response.json();
}

// Built UI and actual disposable Native metadata. No provider execution occurs.
for (const [policy, locale] of [["drain", "en"], ["cancel", "da"]] as const) {
  test(`explicit ${policy} pause in ${locale} preserves the Native agent and starts no work`, async ({ page, request }) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${policy} pause company` } }));
    try {
      const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
        name: "Pause decision worker", role: "engineer", adapterType: "process",
        runtimeConfig: { heartbeat: { enabled: false, wakeOnAssignment: false } },
        permissions: { canCreateAgents: false, canCreateSkills: false },
      } }));
      await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
      let writes = 0;
      page.on("request", event => {
        if (new URL(event.url()).pathname === `/api/agents/${agent.id}/pause` && event.method() === "POST") {
          writes++;
          expect(event.postDataJSON()).toEqual({ pendingWork: policy });
        }
      });
      await page.goto(`/${company.issuePrefix}/agents/${agent.id}/dashboard`);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      expect(writes).toBe(0);
      expect((await json(await request.get(`/api/agents/${agent.id}`))).status).toBe(agent.status);
      await dialog.getByRole("radio", { name: locale === "en" ? /Let running work finish/ : /Anmod om annullering/ }).check();
      await page.addScriptTag({ path: axePath });
      expect(await page.evaluate(async () => (await (window as unknown as {
        axe: { run(scope: string): Promise<{ violations: unknown[] }> };
      }).axe.run('[role="alertdialog"]')).violations)).toEqual([]);
      await dialog.getByRole("button", { name: locale === "en" ? "Pause agent" : "Sæt agent på pause", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => writes).toBe(1);
      await expect.poll(async () => (await json(await request.get(`/api/agents/${agent.id}`))).status).toBe("paused");
      const retained = await json(await request.get(`/api/agents/${agent.id}`));
      expect(retained.id).toBe(agent.id);
      expect(retained.runtimeConfig).toEqual(agent.runtimeConfig);
      const runs = await json(await request.get(`/api/companies/${company.id}/heartbeat-runs`));
      expect(Array.isArray(runs) ? runs : runs.items).toEqual([]);
    } finally {
      await json(await request.delete(`/api/companies/${company.id}`));
    }
  });
}
