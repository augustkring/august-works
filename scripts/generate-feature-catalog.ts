// Emits feature-catalog.json. The default schema v1 preserves the Cloud
// harness tier contract. Pass --schema-version 2 to generate an explicit
// lifecycle-rich candidate artifact from the same catalog; external consumer
// support for v2 must be qualified before changing release defaults. The
// catalog content is derived from instance-settings schema metadata in
// packages/shared/src/feature-catalog.ts.
//
// Usage:
//   tsx scripts/generate-feature-catalog.ts --version 2026.720.0 [--schema-version 2] [--out path/to/feature-catalog.json]
//
// Without --out, the artifact is written to stdout.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { renderFeatureCatalogArtifact } from "../packages/shared/src/feature-catalog.js";

function usage(): never {
  console.error(
    "Usage: tsx scripts/generate-feature-catalog.ts --version <catalogVersion> [--schema-version 1|2] [--out <file>]",
  );
  process.exit(1);
}

let version = "";
let outPath = "";
let schemaVersion: 1 | 2 = 1;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  switch (args[i]) {
    case "--version":
      version = args[++i] ?? "";
      break;
    case "--out":
      outPath = args[++i] ?? "";
      break;
    case "--schema-version": {
      const value = args[++i] ?? "";
      if (value !== "1" && value !== "2") usage();
      schemaVersion = Number(value) as 1 | 2;
      break;
    }
    case "-h":
    case "--help":
      usage();
      break;
    default:
      console.error(`Unknown argument: ${args[i]}`);
      usage();
  }
}

if (version.trim().length === 0) {
  console.error("Error: --version is required and must be non-empty.");
  usage();
}

const rendered = renderFeatureCatalogArtifact(version, schemaVersion);

if (outPath) {
  const target = resolve(outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rendered, "utf8");
  console.error(`Wrote feature catalog for version ${version} to ${target}`);
} else {
  process.stdout.write(rendered);
}
