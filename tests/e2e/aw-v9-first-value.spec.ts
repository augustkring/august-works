import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import {
  activationViewSchema,
  initialActivationState,
} from "../../packages/shared/src/activation.ts";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// Actual built browser/route/layout with explicit account and private API
// software fixtures. The original Native DB/verification suite proves the
// separate task/run/review binding; these fixtures establish no real output.
test("first result recovers a missing acknowledgement and withdraws success when current evidence is lost", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "Disposable first-result browser fixture" },
    }),
  );
  const session = await json(await request.get("/api/auth/get-session"));
  const id = "10000000-0000-4000-8000-000000000001";
  const { receipts: _, ...initial } = initialActivationState();
  const result = {
    installationId: id,
    verificationRunId: id,
    issueId: id,
    runId: id,
    title: "Native fixture reviewed draft",
    resultHash: "a".repeat(64),
    verifiedAt: "2026-10-10T09:00:00.000Z",
    artifacts: [{ documentId: id, revisionId: id, hash: "b".repeat(64) }],
  };
  let value = activationViewSchema.parse({
    runId: id,
    companyId: company.id,
    companyName: company.name,
    version: 3,
    status: "in_progress",
    state: {
      ...initial,
      step: "review",
      intent: "Prepare a customer research draft",
      packageVersionId: id,
    },
    capabilities: [
      {
        versionId: id,
        name: "Research draft",
        purpose: "Prepare a reviewed draft",
        requiredConnections: [],
        knownLimitations: [],
      },
    ],
    sources: [],
    blockers: ["safe_execution_unqualified"],
    firstValue: {
      status: "not_recorded",
      result: null,
      candidates: [result],
      hasMore: false,
    },
  });
  const commands: Array<Record<string, unknown>> = [];
  let holdRead = false,
    releaseRead: (() => void) | null = null;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        ...session,
        session: { ...session.session, localImplicit: false },
      },
    }),
  );
  await page.route("**/api/saas/capabilities", (route) =>
    route.fulfill({ json: { activationV9: true, onboarding: true } }),
  );
  await page.route(
    `**/api/companies/${company.id}/activation?**`,
    async (route) => {
      expect(
        new URL(route.request().url()).searchParams.get("expectedUserId"),
      ).toBe(session.user.id);
      const headers = { "Cache-Control": "private, no-store" };
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        commands.push(input);
        expect(input.expectedVersion).toBe(value.version);
        if (input.operation === "record_verified_result") {
          expect(Object.keys(input).sort()).toEqual([
            "expectedVersion",
            "installationId",
            "operation",
            "requestId",
            "verificationRunId",
          ]);
          expect(input.installationId).toBe(id);
          expect(input.verificationRunId).toBe(id);
          value = activationViewSchema.parse({
            ...value,
            version: 4,
            blockers: [],
            state: {
              ...value.state,
              step: "result",
              firstValueAt: "2026-10-10T09:01:00.000Z",
              firstValueReceipt: {
                installationId: id,
                verificationRunId: id,
                issueId: id,
                runId: id,
                resultHash: result.resultHash,
              },
            },
            firstValue: {
              status: "verified",
              result,
              candidates: [],
              hasMore: false,
            },
          });
          return route.abort("failed"); // Native outcome unknown until a current read.
        }
        expect(input.operation).toBe("complete_activation");
        expect(Object.keys(input).sort()).toEqual([
          "expectedVersion",
          "operation",
          "requestId",
        ]);
        value = activationViewSchema.parse({
          ...value,
          version: 5,
          status: "completed",
          state: { ...value.state, step: "activated" },
        });
      } else if (holdRead)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      return route.fulfill({ headers, json: value });
    },
  );
  await page.goto(`/${company.issuePrefix}/dashboard`);
  await expect(page.getByRole("main")).toBeVisible();
  await page.goto("/saas/activation/9");
  await expect(
    page.getByRole("button", {
      name: "Use this as my first result",
      exact: true,
    }),
  ).toBeEnabled();
  expect(commands).toHaveLength(0);
  await page
    .getByRole("button", { name: "Use this as my first result", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.reload();
  const resultHeading = page.getByRole("heading", {
    level: 1,
    name: "Your first result is ready",
    exact: true,
  });
  await expect(resultHeading).toBeVisible();
  await expect(resultHeading).toBeFocused();
  await expect(
    page.getByRole("link", { name: result.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Use this as my first result",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(commands).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addScriptTag({ path: axePath });
  expect(
    await page.evaluate(
      async () =>
        (
          await (
            window as unknown as {
              axe: { run(scope: string): Promise<{ violations: unknown[] }> };
            }
          ).axe.run("main")
        ).violations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("v9-first-result-mobile-software-fixture.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use result", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "You're ready", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to Home", exact: true }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  value = activationViewSchema.parse({
    ...value,
    blockers: ["safe_execution_unqualified"],
    firstValue: {
      status: "withdrawn",
      result: null,
      candidates: [],
      hasMore: false,
    },
  });
  holdRead = true;
  await page.reload();
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "Loading saved setup" })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: result.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Use result", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => releaseRead !== null).toBe(true);
  releaseRead!();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Review your saved result",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "You're ready", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: result.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Go to Home", exact: true }),
  ).toHaveCount(0);
  expect(commands).toHaveLength(2);
});
