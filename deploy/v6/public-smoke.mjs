import { pathToFileURL } from "node:url";

/** Read-only public probes. The report contains status and timing, never response bodies or cookies. */
export async function publicSmoke(origin, fetcher = fetch) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw Error("Exact public HTTPS origin required");
  const checks = [];
  for (const probe of [
    { name: "health", path: "/api/health", expected: [200], json: true },
    { name: "login", path: "/auth", expected: [200], html: true },
    {
      name: "anonymous-company-denied",
      path: "/api/companies",
      expected: [401, 403],
    },
    {
      name: "foreign-browser-origin-denied",
      path: "/api/health",
      expected: [403],
      headers: { Origin: "https://synthetic-untrusted.invalid" },
    },
  ]) {
    const started = performance.now();
    let status = null,
      passed = false;
    try {
      const response = await fetcher(origin + probe.path, {
        headers: probe.headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      status = response.status;
      passed = probe.expected.includes(status);
      if (probe.json) passed &&= (await response.json()).status === "ok";
      if (probe.html)
        passed &&= Boolean(
          response.headers.get("content-type")?.includes("text/html"),
        );
      await response.body?.cancel().catch(() => {});
    } catch {
      passed = false;
    }
    checks.push({
      name: probe.name,
      status,
      passed,
      durationMs: Math.round(performance.now() - started),
    });
  }
  return {
    format: "aw-public-smoke-v1",
    origin,
    observedAt: new Date().toISOString(),
    passed: checks.every((check) => check.passed),
    checks,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await publicSmoke(process.env.AW_PUBLIC_APP_ORIGIN);
  process.stdout.write(JSON.stringify(report) + "\n");
  if (!report.passed) process.exitCode = 1;
}
