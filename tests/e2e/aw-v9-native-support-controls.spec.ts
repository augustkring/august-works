import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(
    true,
  );
  return response.json();
}

// Built application/layout/browser qualification with explicit private-response
// fixtures. These fixtures are not Native grants, cancellation fences or proof
// of authenticated/hosted support. Real Native DB tests qualify that separately.
test("support review preserves consent and recovers the original request after a missing approval response", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120000);
  const original = await json(
    await request.get("/api/instance/settings/experimental"),
  );
  const company = await json(
    await request.post("/api/companies", {
      data: { name: "Disposable support presentation fixture" },
    }),
  );
  const session = await json(await request.get("/api/auth/get-session"));
  const principal = session.user.id;
  const base = `/api/companies/${company.id}/support-sessions`;
  let pending: {
    companyId: string;
    approvalId: string;
    reviewedAt: string;
    state: "pending";
  } | null = null;
  let prepared = 0,
    grants = 0,
    cancelled = 0;
  const refs: string[] = [];
  try {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: { experience_projection_v9: true, progressive_shell_v9: true },
      }),
    );
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        json: {
          ...session,
          session: { ...session.session, localImplicit: false },
        },
      }),
    );
    await page.route("**/api/saas/capabilities", (route) =>
      route.fulfill({ json: { support: true } }),
    );
    await page.route(`**${base}**`, async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      expect(url.searchParams.get("expectedUserId")).toBe(principal);
      const headers = { "Cache-Control": "private, no-store" };
      if (url.pathname === base && req.method() === "GET")
        return route.fulfill({ headers, json: [] });
      if (url.pathname === `${base}/pending-review`)
        return route.fulfill({ headers, json: pending });
      if (url.pathname === `${base}/reviews` && req.method() === "POST") {
        const body = req.postDataJSON();
        prepared++;
        refs.push(body.approvalId);
        pending = {
          companyId: company.id,
          approvalId: body.approvalId,
          reviewedAt: "2026-10-10T08:00:00.000Z",
          state: "pending",
        };
        return route.fulfill({ status: 201, headers, json: pending });
      }
      if (url.pathname === base && req.method() === "POST") {
        grants++;
        expect(req.postDataJSON().approvalId).toBe(pending?.approvalId);
        // Missing ACK does not establish whether the Native owner committed.
        return route.abort("failed");
      }
      if (
        url.pathname.startsWith(`${base}/reviews/`) &&
        req.method() === "DELETE"
      ) {
        expect(url.pathname).toBe(`${base}/reviews/${pending!.approvalId}`);
        cancelled++;
        const receipt = { ...pending!, state: "cancelled" };
        pending = null;
        return route.fulfill({ headers, json: receipt });
      }
      // Missing original read is unconfirmed, never proof of no effect.
      return route.fulfill({
        status: 404,
        headers,
        json: { error: "fixture private-secret must not be rendered" },
      });
    });
    await page.goto(`/${company.issuePrefix}/company/settings/support`);
    const heading = page.getByRole("heading", {
      name: "Temporary support access",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByRole("main")).toHaveCount(1);
    await page
      .getByLabel("Operator ID supplied by support", { exact: true })
      .fill("fixture-support-operator");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Inspect this explicit browser software fixture");
    await page
      .getByRole("button", { name: "Review temporary access", exact: true })
      .click();
    const consent = page.getByRole("checkbox", {
      name: "I have reviewed the operator, duration and permissions and approve this temporary access.",
      exact: true,
    });
    await expect(consent).toBeEnabled();
    await expect(consent).not.toBeChecked();
    const confirm = page.getByRole("button", {
      name: "Approve temporary access",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    expect(prepared).toBe(1);
    expect(grants).toBe(0);
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
    await page.screenshot({
      path: info.outputPath("v9-support-review-mobile-fixture.png"),
      fullPage: true,
    });
    await consent.check();
    await confirm.click();
    await expect(
      page.getByText("Approval outcome is unconfirmed.", { exact: false }),
    ).toBeVisible();
    expect(grants).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "An earlier approval needs resolution",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Operator ID supplied by support", { exact: true }),
    ).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await page
      .getByRole("button", { name: "Check original approval", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "An earlier approval needs resolution",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("fixture private-secret must not be rendered"),
    ).toHaveCount(0);
    expect(grants).toBe(1);
    expect(prepared).toBe(1);
    await page
      .getByRole("button", { name: "Cancel original request", exact: true })
      .click();
    await expect(
      page.getByText(
        "Original request cancelled. A later approval of that request is blocked.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Operator ID supplied by support", { exact: true }),
    ).toBeVisible();
    expect(cancelled).toBe(1);
    expect(new Set(refs).size).toBe(1);
    expect(grants).toBe(1);
  } finally {
    await json(
      await request.patch("/api/instance/settings/experimental", {
        data: original,
      }),
    );
  }
});
