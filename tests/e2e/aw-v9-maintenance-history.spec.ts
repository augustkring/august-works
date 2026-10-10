import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse } from "@playwright/test";
import {
  createDb,
  closeRegisteredClients,
  agentPackages,
  agentPackageVersions,
  companyAgentPackageInstallations,
  activityLog,
} from "../../packages/db/src/index.ts";
import type { PackageRelease } from "@paperclipai/shared";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}
// The retained native history rows below are explicit software prerequisites.
// Native integration tests prove real stewardship; these rows do not qualify a
// release, executed repair, customer package, activation or business outcome.
test("maintenance history reads native receipts separately from current state and closes on rollback", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "Disposable maintenance history fixture" },
    }),
  );
  const agent = await json(
    await request.post(`/api/companies/${company.id}/agents`, {
      data: {
        name: "History fixture worker",
        role: "engineer",
        adapterType: "process",
      },
    }),
  );
  const configPath = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
  expect(configPath).toMatch(/^\/tmp\/paperclip-e2e-home-/);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  expect(config.database.embeddedPostgresDataDir).toMatch(
    /^\/tmp\/paperclip-e2e-home-/,
  );
  const pid = await readFile(
    path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"),
    "utf8",
  );
  const databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${pid.split("\n")[3]}/paperclip`;
  const db = createDb(databaseUrl);
  const packageId = randomUUID(),
    previous = randomUUID(),
    next = randomUUID(),
    installationId = randomUUID(),
    hash = "e".repeat(64);
  try {
    await db.insert(agentPackages).values({
      id: packageId,
      key: `browser-history-${packageId}`,
      name: "Synthetic retained history",
      description: "Software history prerequisite",
      category: "internal",
    });
    await db.insert(agentPackageVersions).values(
      [previous, next].map((id, index) => ({
        id,
        packageId,
        version: `1.0.${index}`,
        state: "testing",
        release: {} as PackageRelease,
        contentHash: hash,
        createdByUserId: "local-board",
      })),
    );
    await db.insert(companyAgentPackageInstallations).values({
      id: installationId,
      companyId: company.id,
      packageId,
      installedVersionId: next,
      agentId: agent.id,
      installedByUserId: "local-board",
      status: "configuring",
      version: 2,
      components: [],
      updatePolicy: "auto_low_risk",
    });
    const configuredId = randomUUID(),
      blockedId = randomUUID();
    await db.insert(activityLog).values([
      {
        id: configuredId,
        companyId: company.id,
        actorType: "system",
        actorId: "core-stewards",
        entityType: "agent_package_installation",
        entityId: installationId,
        action: "agent_package.low_risk_update_configured",
        details: {
          maintenanceClass: "M2",
          policyVersion: "aw-v9-package-maintenance-1",
          policyOwnerUserId: "local-board",
          policy: "auto_low_risk",
          previousVersion: previous,
          nextVersion: next,
          activationRequired: true,
          postcondition: "configured_activation_required",
          reviewedSource: {
            expectedInstallationVersion: 1,
            expectedInstalledVersionId: previous,
            expectedUpdatedAt: new Date().toISOString(),
            expectedReleaseContentHash: hash,
          },
          privateNote: "never-display-history-canary",
        },
      },
      {
        id: blockedId,
        companyId: company.id,
        actorType: "system",
        actorId: "core-stewards",
        entityType: "agent_package_installation",
        entityId: installationId,
        action: "agent_package.maintenance_loop_blocked",
        details: {
          maintenanceClass: "M2",
          policyVersion: "aw-v9-package-maintenance-1",
          policyOwnerUserId: "local-board",
          reason: "configured_change_budget",
          humanReviewRequired: true,
        },
      },
    ]);
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: {
          enableFoundationV1: true,
          enableContextEngineV1: true,
          enableCollectiveMemoryV1: true,
          agent_identities_v5: true,
          agent_provider_bindings_v5: true,
          agent_runtime_fabric_v5: true,
          role_packs_v5: true,
          skill_resolver_v5: true,
          skill_lifecycle_v5: true,
          playbooks_v5: true,
          saas_deployment_profile_v6: true,
          billing_v6: true,
          cognitive_memory_v7: true,
          memory_observations_v7: true,
          learning_engine_v7: true,
          ai_use_cases_v7: true,
          governance_evidence_v7: true,
          readiness_engine_v7: true,
          experience_projection_v9: true,
          progressive_shell_v9: true,
          agent_packages_v7: true,
          core_stewards_v7: true,
          maintenance_autopilot_v9: true,
        },
      }),
    );
    const base = `/api/companies/${company.id}/agent-package-installations/${installationId}/experience/maintenance`;
    const view = await json(
      await request.get(base + "?expectedUserId=local-board"),
    );
    expect(view.installationStatus).toBe("configuring");
    expect(
      view.entries
        .map((entry: { receiptId: string }) => entry.receiptId)
        .sort(),
    ).toEqual([configuredId, blockedId].sort());
    expect(JSON.stringify(view)).not.toContain("never-display-history-canary");
    await page.goto(
      `/${company.issuePrefix}/agents/packages/installations/${installationId}/maintenance`,
    );
    const heading = page.getByRole("heading", {
      name: "Maintenance history",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(
      page.getByText("Configuration updated; activation was required", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Automatic change limit reached; human review was required",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Configuration requires review", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: {
                run: (context: Element) => Promise<{ violations: unknown[] }>;
              };
            }
          ).axe.run(document.querySelector("main")!)
        ).violations,
    );
    expect(violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath("native-maintenance-history-mobile.png"),
      fullPage: true,
    });
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { maintenance_autopilot_v9: false },
      }),
    );
    await page.reload();
    await expect(heading).toHaveCount(0);
    await expect(
      page.getByText("Configuration updated; activation was required", {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (await request.get(base + "?expectedUserId=local-board")).status(),
    ).toBe(404);
    const [retained] = await db
      .select()
      .from(companyAgentPackageInstallations)
      .where(
        (await import("drizzle-orm")).eq(
          companyAgentPackageInstallations.id,
          installationId,
        ),
      );
    expect(retained!.status).toBe("configuring");
    expect(retained!.version).toBe(2);
  } finally {
    try {
      await json(
        await request.patch("/api/instance/settings/experimental", {
          data: original,
        }),
      );
    } finally {
      await closeRegisteredClients(databaseUrl);
    }
  }
});
