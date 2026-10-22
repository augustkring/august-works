import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";

const uiRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("PWA install mode", () => {
  it("uses the approved customer identity before the application module loads", () => {
    const manifest = JSON.parse(readFileSync(resolve(uiRoot, "public/site.webmanifest"), "utf8"));
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");
    expect(manifest.name).toBe(PRODUCT_IDENTITY.productName);
    expect(manifest.short_name).toBe(PRODUCT_IDENTITY.productShortName);
    expect(html).toContain(`<title>${PRODUCT_IDENTITY.productName}</title>`);
    expect(html).toContain(`name="apple-mobile-web-app-title" content="${PRODUCT_IDENTITY.productShortName}"`);
    expect(html).not.toMatch(/Paperclip|August Works/);
  });
  it("opens home-screen launches with browser controls visible", () => {
    const manifest = JSON.parse(readFileSync(resolve(uiRoot, "public/site.webmanifest"), "utf8")) as {
      display?: string;
    };
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");

    expect(manifest.display).toBe("browser");
    expect(html).not.toContain('name="mobile-web-app-capable"');
    expect(html).not.toContain('name="apple-mobile-web-app-capable"');
    expect(html).not.toContain('name="apple-mobile-web-app-status-bar-style"');
  });

  it("fetches the manifest with credentials so authenticating proxies can serve it", () => {
    const html = readFileSync(resolve(uiRoot, "index.html"), "utf8");

    // Browsers fetch <link rel="manifest"> in "omit credentials" mode unless
    // the link opts in. Behind an authenticating reverse proxy (e.g. a
    // managed-hosting front door), the cookie-less request is rejected on
    // every page load.
    expect(html).toContain('rel="manifest" href="/site.webmanifest" crossorigin="use-credentials"');
  });
});
