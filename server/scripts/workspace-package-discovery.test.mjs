import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { discoverWorkspacePackagePaths } from "../../scripts/workspace-package-discovery.mjs";

it("uses declared/excluded packages and does not inspect inaccessible generated or private directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-workspace-declaration-"));
  const privateDirectory = path.join(root, "server", "private-fixture");
  const generatedDirectory = path.join(root, "server", "ui-dist");
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture-root", private: true }));
    await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n  - "!packages/excluded"\n  - server\n');
    for (const [relative, name] of [["server", "@fixture/server"], ["packages/shared", "@fixture/shared"], ["packages/excluded", "@fixture/excluded"], ["server/nested-fixture", "@fixture/non-workspace"]]) {
      await mkdir(path.join(root, relative), { recursive: true });
      await writeFile(path.join(root, relative, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    }
    for (const directory of [privateDirectory, generatedDirectory]) {
      await mkdir(directory); await writeFile(path.join(directory, "package.json"), "UNREADABLE PRIVATE CANARY"); await chmod(directory, 0);
    }
    const discovered = discoverWorkspacePackagePaths(root);
    expect([...discovered.keys()].sort()).toEqual(["@fixture/server", "@fixture/shared"]);
    expect(discovered.get("@fixture/shared")).toBe(path.join(root, "packages/shared"));
    // The fixture owner restores access solely to prove the bytes stayed intact.
    await chmod(privateDirectory, 0o700); await chmod(generatedDirectory, 0o700);
    expect(await readFile(path.join(privateDirectory, "package.json"), "utf8")).toBe("UNREADABLE PRIVATE CANARY");
  } finally {
    await chmod(privateDirectory, 0o700).catch(() => {}); await chmod(generatedDirectory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
