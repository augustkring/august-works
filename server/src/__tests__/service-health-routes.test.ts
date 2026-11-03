import express from "express";
import request from "supertest";
import { expect, it } from "vitest";
import { PRODUCT_IDENTITY } from "@paperclipai/shared";
import { serviceHealthRoutes } from "../routes/service-health.js";

it("keeps public status discovery independent of account and tenant authentication", async () => {
  const app = express().use(serviceHealthRoutes({}));
  const response = await request(app).get("/api/service-status");
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ state: "unconfigured", statusUrl: PRODUCT_IDENTITY.statusOrigin });
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(() => serviceHealthRoutes({ BLENTERA_STATUSPAGE_ENABLED: "yes" })).toThrow("must be true or false");
});
