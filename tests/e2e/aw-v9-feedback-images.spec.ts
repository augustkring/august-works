import { createRequire } from "node:module";
import { expect, test, type APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { registerEnglishAccountLocaleIsolation } from "./account-locale-isolation";

registerEnglishAccountLocaleIsolation(test);
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
async function json(response: APIResponse) {
  expect(response.ok(), `${response.status()}: ${await response.text()}`).toBe(true); return response.json();
}
// Built customer UI, original Native feedback create/read, and explicitly scoped
// software image transport. The actual scan/byte/storage/authority owners are
// independently exercised by migrated Native HTTP tests. No deployed AV proof.
test("selected images survive an unknown transport reply through read-only status and hide during original account recheck", async ({ page, request }, info) => {
  const flags = await json(await request.get("/api/instance/settings/experimental"));
  const company = await json(await request.post("/api/companies", { data: { name: "Disposable selected-image browser fixture" } }));
  const base = `/api/companies/${company.id}/customer-feedback`, session = await json(await request.get("/api/auth/get-session"));
  const expectedUserId = encodeURIComponent(session.user.id);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAIAAADJUWIXAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWNgYPiPikjjAwBp8hPtBUNYegAAAABJRU5ErkJggg==", "base64");
  let writes = 0, binaryReads = 0, receipt: { id: string; feedbackId: string } | undefined;
  let holdSession = false, releaseSession: (() => void) | undefined;
  const image = { id: randomUUID(), companyId: company.id, feedbackId: "", status: "ready", mediaType: "image/png",
    byteSize: bytes.length, createdAt: "2026-10-11T00:00:00Z", deletedAt: null };
  await page.route("**/api/auth/get-session", async route => {
    if (holdSession) await new Promise<void>(resolve => { releaseSession = resolve; });
    await route.fulfill({ json: session });
  });
  await page.route("**/api/customer-feedback/policy", async route => {
    const response = await route.fetch(), policy = await json(response);
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
      ...policy, attachments: { ...policy.attachments, enabled: true, reason: "validation_required" },
    } });
  });
  await page.route(`**${base}?**`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch(); receipt = await json(response); image.feedbackId = receipt!.id;
    await route.fulfill({ response });
  });
  await page.route(`**${base}/*/images**`, async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.searchParams.get("expectedUserId")).toBe(session.user.id);
    expect(receipt).toBeDefined(); expect(url.pathname).toContain(`/${receipt!.id}/images`);
    if (request.method() === "POST") {
      writes++; expect(writes).toBe(1);
      expect(request.headers()["x-aw-feedback-request-key"]).toMatch(/^[a-f0-9-]{36}$/);
      const multipart = request.postDataBuffer()!;
      expect(multipart.toString()).toContain('filename="image.png"');
      expect(multipart.toString()).not.toContain("private-local-selected-name.png");
      expect(multipart.includes(bytes)).toBe(true);
      // Exact scoped software receipt exists, but its first ACK is lost.
      return route.abort("failed");
    }
    if (url.pathname.endsWith("/images")) return route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: [image] });
    expect(url.pathname.endsWith(`/${image.id}`)).toBe(true); binaryReads++;
    return route.fulfill({ headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" }, body: bytes });
  });
  try {
    await json(await request.patch("/api/instance/settings/experimental", { data: {
      experience_projection_v9: true, progressive_shell_v9: true, home_v9: true,
      ambient_commands_v9: true, customer_feedback_v9: true,
    } }));
    await page.goto(`/${company.issuePrefix}/dashboard`);
    const trigger = page.getByRole("region", { name: "Global utilities", exact: true })
      .getByRole("button", { name: "Feedback", exact: true });
    await expect(trigger).toBeEnabled(); await trigger.focus(); await trigger.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Category", exact: true })).toBeFocused();
    await dialog.getByRole("textbox").first().fill("Owned selected-image browser feedback");
    await expect(dialog.locator('input[type="file"]')).toBeEnabled();
    const choose = dialog.getByRole("button", { name: "Choose images", exact: true });
    const firstChooser = page.waitForEvent("filechooser"); await choose.focus(); await choose.press("Enter");
    await (await firstChooser).setFiles({ name: "private-local-selected-name.png", mimeType: "image/png", buffer: bytes });
    await expect(dialog.getByRole("img", { name: "Selected image 1", exact: true })).toBeVisible();
    await expect(dialog).toContainText("private-local-selected-name.png"); expect(writes).toBe(0); expect(binaryReads).toBe(0);
    const remove = dialog.getByRole("button", { name: "Remove selected image 1", exact: true });
    await remove.focus(); await remove.press("Enter"); await expect(dialog.getByRole("img")).toHaveCount(0);
    const nextChooser = page.waitForEvent("filechooser"); await choose.focus(); await choose.press("Enter");
    await (await nextChooser).setFiles({ name: "private-local-selected-name.png", mimeType: "image/png", buffer: bytes });
    const send = dialog.getByRole("button", { name: "Send feedback", exact: true }); await send.focus(); await send.press("Enter");
    await expect(dialog).toContainText("Some selected images could not be confirmed"); await expect(dialog).toContainText(receipt!.feedbackId);
    expect(writes).toBe(1); expect(binaryReads).toBe(0);
    const view = dialog.getByRole("button", { name: "View image", exact: true }); await view.focus(); await view.press("Enter");
    const shown = dialog.getByRole("img", { name: "Attached feedback image", exact: true }); await expect(shown).toBeVisible();
    expect(binaryReads).toBe(1); expect(writes).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 }); await page.addScriptTag({ path: axePath });
    expect(await page.evaluate(async () => (await (window as unknown as { axe: { run(scope: string): Promise<{ violations: unknown[] }> } }).axe.run('[role="dialog"]')).violations)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("v9-selected-feedback-image-mobile.png"), fullPage: true });
    await page.clock.setFixedTime(new Date(Date.now() + 31_000)); holdSession = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await expect.poll(() => releaseSession !== undefined).toBe(true); await expect(shown).toHaveCount(0);
    await expect(dialog).not.toContainText(receipt!.feedbackId);
    holdSession = false; releaseSession!(); await expect(dialog).toContainText(receipt!.feedbackId);
    expect(binaryReads).toBe(1); expect(writes).toBe(1);
    const native = await json(await request.get(`${base}/${receipt!.id}?expectedUserId=${expectedUserId}`));
    expect(native.body).toBe("Owned selected-image browser feedback");
    expect(await json(await request.get(`${base}?expectedUserId=${expectedUserId}`))).toHaveLength(1);
  } finally {
    holdSession = false; releaseSession?.();
    await json(await request.patch("/api/instance/settings/experimental", { data: flags }));
    await json(await request.delete(`/api/companies/${company.id}`));
  }
});
