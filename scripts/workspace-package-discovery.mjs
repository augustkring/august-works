import { execFileSync } from "node:child_process";
import path from "node:path";

/** Use the package manager's declared workspace graph. Recursive filesystem
 * scans can cross build outputs, private runtime data and excluded fixtures. */
export function discoverWorkspacePackagePaths(rootDir) {
  const root = path.resolve(rootDir);
  const entry = process.env.npm_execpath;
  const executable = entry ? process.execPath : "pnpm";
  const args = [...(entry ? [entry] : []), "list", "--recursive", "--depth=-1", "--json"];
  const output = execFileSync(executable, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const projects = JSON.parse(output);
  if (!Array.isArray(projects)) throw new Error("Invalid declared workspace graph");
  const packagePaths = new Map();
  for (const project of projects) {
    if (!project || typeof project.name !== "string" || !project.name || typeof project.path !== "string")
      throw new Error("Invalid declared workspace package");
    const directory = path.resolve(project.path);
    const relative = path.relative(root, directory);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("Declared workspace package is outside the repository");
    if (!relative) continue;
    if (packagePaths.has(project.name)) throw new Error("Duplicate declared workspace package name");
    packagePaths.set(project.name, directory);
  }
  return packagePaths;
}
