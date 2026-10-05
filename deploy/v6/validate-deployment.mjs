import { readFile } from "node:fs/promises";
const env = process.env;
for (const name of ["AW_CONTROL_IMAGE", "AW_CADDY_IMAGE"])
  if (!/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(env[name] ?? ""))
    throw Error(name + " must be digest-pinned");
for (const name of ["AW_PRIMARY_HOST", "AW_LEGACY_HOST"])
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(env[name] ?? "") ||
    !env[name].includes(".")
  )
    throw Error(name + " must be a DNS hostname");
const platform = await readFile("/etc/august-works/platform.env", "utf8");
if (
  !/^AW_DEPLOYMENT_PROFILE=saas$/m.test(platform) ||
  !/^HOST=127\.0\.0\.1$/m.test(platform) ||
  !/^TRUST_PROXY=loopback$/m.test(platform)
)
  throw Error("Deployment requires SaaS profile and loopback-only proxy trust");
if (!/^AW_PUBLIC_APP_ORIGIN=https:\/\//m.test(platform))
  throw Error("HTTPS public application origin required");
process.stdout.write(
  "Deployment admission configuration validated; no secrets printed.\n",
);
