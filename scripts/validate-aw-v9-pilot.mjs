import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizePilot } from "../evals/aw-v9/pilot-harness.mjs";

const fail = () => { throw new Error("V9 pilot validation failed; inspect the owned protocol/observation artifacts"); };
async function readOwnedJson(path, limit) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit || (info.mode & 0o077) !== 0 ||
      typeof process.getuid === "function" && info.uid !== process.getuid()) fail();
    const data = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(data, "utf8") > limit) fail();
    return JSON.parse(data);
  } finally { await handle.close(); }
}

/** Operator invoked only; accepts existing private manual artifacts and writes
 * an aggregate receipt. It collects no session, transport, participant or page. */
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 4 || !/^[a-f0-9]{64}$/.test(args[2])) fail();
  const [protocolPath, observationPath, expectedDigest, outputPath] = args.map((arg, index) => index === 2 ? arg : resolve(arg));
  if (outputPath === protocolPath || outputPath === observationPath) fail();
  try {
    const plan = await readOwnedJson(protocolPath, 262144), observations = await readOwnedJson(observationPath, 16777216);
    const result = summarizePilot(plan, observations, expectedDigest);
    const output = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await output.writeFile(JSON.stringify(result, null, 2) + "\n", "utf8"); await output.sync(); }
    finally { await output.close(); }
    process.stdout.write(`V9 pilot artifact validated: ${result.phase}, ${result.execution}; GA is not certified\n`);
    return result;
  } catch { fail(); }
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  main().catch(() => { process.stderr.write("V9 pilot validation failed; no source excerpts were logged\n"); process.exitCode = 1; });
