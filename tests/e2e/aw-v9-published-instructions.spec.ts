import { createRequire } from "node:module";
import { test, expect, type APIResponse } from "@playwright/test";
import { V5_FEATURE_KEYS } from "../../packages/shared/src/index.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) { expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json(); }

// Built host with explicit software published-body responses. Original
// publication/version ownership is separately proven in PostgreSQL.
for (const locale of ["en", "da"] as const) {
  test(`published instructions in ${locale} remain read-only and navigate to this Agent's private draft builder`, async ({ page, request }) => {
    const company = await json(await request.post("/api/companies", { data: { name: `Disposable ${locale} published instructions` } }));
    try {
      const session = await json(await request.get("/api/auth/get-session"));
      const agent = await json(await request.post(`/api/companies/${company.id}/agents`, { data: {
        name: "Published specialist", role: "general", adapterType: "codex_local", status: "paused", permissions: { canCreateAgents: false },
      } }));
      const detail = await json(await request.get(`/api/agents/${agent.id}?companyId=${company.id}`));
      const flags = { ...await json(await request.get("/api/instance/settings/experimental")), ...Object.fromEntries(V5_FEATURE_KEYS.map(key => [key, true])),
        enableFoundationV1: true, enableContextEngineV1: true, saas_deployment_profile_v6: true, billing_v6: true,
        agent_packages_v7: true, hire_agent_v9: true, experience_projection_v9: true, progressive_shell_v9: true };
      const file = { path: "AGENTS.md", size: 100, language: "markdown", markdown: true, isEntryFile: true, editable: false, deprecated: false, virtual: true };
      let writes = 0;
      await page.addInitScript(language => localStorage.setItem("aw.v9.display-locale", language), locale);
      await page.route("**/api/auth/get-session", route => route.fulfill({ json: { ...session, session: { ...session.session, localImplicit: false } } }));
      await page.route("**/api/instance/settings/experimental", route => route.fulfill({ json: flags }));
      await page.route(`**/api/agents/${agent.id}**`, async route => {
        if (route.request().method() !== "GET") { writes++; return route.fulfill({ status: 409, json: { error: "This host fixture grants no instruction writes" } }); }
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/instructions-bundle/file")) return route.fulfill({ json: { ...file, content: "# Published responsibility\n\nDraft internal responses. Never send externally." } });
        if (path.endsWith("/instructions-bundle")) return route.fulfill({ json: { agentId: agent.id, companyId: company.id, mode: "managed",
          rootPath: null, managedRootPath: "virtual", entryFile: "AGENTS.md", resolvedEntryPath: null, editable: false, warnings: [],
          legacyPromptTemplateActive: false, legacyBootstrapPromptTemplateActive: false, files: [file] } });
        if (path === `/api/agents/${agent.id}`) return route.fulfill({ json: { ...detail,
          runtimeConfig: { ...detail.runtimeConfig, agentDefinitionVersion: { revisionId: "10000000-0000-4000-8000-000000000001" } } } });
        return route.continue();
      });
      await page.route(`**/api/companies/${company.id}/agent-configuration-drafts**`, async route => {
        if (route.request().method() !== "GET") { writes++; return route.fulfill({ status: 409, json: { error: "No draft creation was confirmed" } }); }
        if (new URL(route.request().url()).pathname.endsWith("/admission")) return route.fulfill({ json: { companyId: company.id, agentId: agent.id, canCreateDraft: true } });
        return route.fulfill({ json: { items: [], nextCursor: null } });
      });
      await page.goto(`/${company.issuePrefix}/agents/${agent.id}/instructions`);
      const region = page.getByRole("region", { name: locale === "da" ? "Publicerede instruktioner" : "Published instructions", exact: true });
      await expect(region).toContainText("Published responsibility");
      await expect(region.locator("textarea, input")).toHaveCount(0);
      await page.addScriptTag({ path: axePath });
      const violations = await region.evaluate(async element => (await (window as any).axe.run(element)).violations.map((item: any) => item.id));
      expect(violations).toEqual([]); expect(writes).toBe(0);
      await region.getByRole("link", { name: locale === "da" ? "Rediger en privat kladde" : "Edit a private draft", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/agents/custom\\?agentId=${agent.id}$`));
      expect(writes).toBe(0);
    } finally { await json(await request.delete(`/api/companies/${company.id}`)); }
  });
}
