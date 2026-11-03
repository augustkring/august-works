import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runner = resolve(root, "cli/node_modules/tsx/dist/cli.mjs");
const generator = resolve(root, "scripts/generate-v10-capability-projection.ts");
const result = spawnSync(process.execPath, [runner, generator, "--check"], { cwd: root, encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "V10 capability projection is stale.\n");
  process.exit(result.status ?? 1);
}
process.stdout.write("V10 capability projection matches its catalog inputs.\n");
