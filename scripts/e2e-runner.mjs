import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCli = path.join(repoRoot, "node_modules/@playwright/test/cli.js");
const args = process.argv.slice(2);

function run(config, specArgs = []) {
  const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", config, ...specArgs], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// CI shards pass explicit spec paths and stay in the local_trusted lane. The
// no-argument local aggregate also runs the authenticated chat journey, whose
// comment writes require a real Human session.
const defaultStatus = run("tests/e2e/playwright.config.ts", args);
if (defaultStatus !== 0 || args.length > 0) process.exit(defaultStatus);
process.exit(run("tests/e2e/aw-v10-agent-chat.config.ts"));
