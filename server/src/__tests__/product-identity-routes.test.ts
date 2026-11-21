import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTITY } from "@paperclipai/shared";
import { productIdentityRoutes } from "../routes/product-identity.js";

describe("public product security contact", () => {
  it("publishes the central contact as plain text without a session or tenant context", async () => {
    const app = express().use(productIdentityRoutes(() => Date.parse("2026-10-27T00:00:00Z")));
    const response = await request(app).get("/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.text).toBe(`Contact: mailto:${PRODUCT_IDENTITY.securityEmail}\nExpires: ${PRODUCT_IDENTITY.securityContactExpiresAt}\nPreferred-Languages: en, da\n`);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
  it("redirects the legacy path without using untrusted request Host as a destination", async () => {
    const app = express().use(productIdentityRoutes());
    const response = await request(app).get("/security.txt").set("Host", "attacker.invalid");
    expect(response.status).toBe(308);
    expect(response.headers.location).toBe("/.well-known/security.txt");
  });
  it("does not silently renew an expired contact publication", async () => {
    const app = express().use(productIdentityRoutes(() => Date.parse(PRODUCT_IDENTITY.securityContactExpiresAt)));
    const response = await request(app).get("/.well-known/security.txt");
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).not.toContain("Expires:");
  });
});
