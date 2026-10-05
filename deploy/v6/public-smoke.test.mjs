import { test } from "node:test";
import assert from "node:assert/strict";
import { publicSmoke } from "./public-smoke.mjs";
test("public smoke checks auth and origin denial without recording cookies or response content", async () => {
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, "error");
    if (options.headers?.Origin)
      return new Response("private response", { status: 403 });
    if (url.endsWith("/api/companies"))
      return new Response("private response", { status: 401 });
    if (url.endsWith("/auth"))
      return new Response("private response", {
        headers: {
          "content-type": "text/html",
          "set-cookie": "private-cookie",
        },
      });
    return Response.json({ status: "ok" });
  };
  const report = await publicSmoke("https://app.example.test", fetcher);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 4);
  assert.ok(!JSON.stringify(report).includes("private"));
  await assert.rejects(() => publicSmoke("http://app.example.test", fetcher));
  await assert.rejects(() =>
    publicSmoke("https://app.example.test/?token=private", fetcher),
  );
  const failed = await publicSmoke(
    "https://app.example.test",
    async () => new Response("wrong", { status: 200 }),
  );
  assert.equal(failed.passed, false);
});
