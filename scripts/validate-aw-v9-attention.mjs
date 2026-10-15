import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOwnedJson } from "./validate-aw-v9-pilot.mjs";
import { summarizeAttention } from "../evals/aw-v9/attention-harness.mjs";

const fail = () => { throw new Error("V9 attention evaluation failed; inspect the owned protocol/observation artifacts"); };
/** Explicit offline processing of existing private artifacts. No session,
 * message, participant, provider or production event is collected or contacted. */
export async function main(args = process.argv.slice(2)) {
  if (typeof constants.O_NOFOLLOW !== "number" || typeof process.getuid !== "function") fail();
  if (args.length !== 4 || !/^[a-f0-9]{64}$/.test(args[2])) fail();
  const [protocolPath, observationPath, digest, outputPath] = args.map((arg, index) => index === 2 ? arg : resolve(arg));
  if (outputPath === protocolPath || outputPath === observationPath) fail();
  try {
    const plan = await readOwnedJson(protocolPath, 262144), observations = await readOwnedJson(observationPath, 16777216);
    const result = summarizeAttention(plan, observations, digest);
    const output = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await output.writeFile(JSON.stringify(result, null, 2) + "\n", "utf8"); await output.sync(); }
    finally { await output.close(); }
    process.stdout.write(`V9 attention sample validated: ${result.execution}; population recall and GA are not certified\n`);
    return result;
  } catch { fail(); }
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  main().catch(() => { process.stderr.write("V9 attention evaluation failed; no source excerpts were logged\n"); process.exitCode = 1; });
