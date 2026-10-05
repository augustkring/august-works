import { open, mkdir, rename, readFile } from "node:fs/promises";
import path from "node:path";
export async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + ".new";
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filename);
  const directory = await open(path.dirname(filename), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function loadJournal(filename) {
  try {
    const value = JSON.parse(await readFile(filename, "utf8"));
    if (value.version !== 1 || !value.cells || !value.commands)
      throw new Error("invalid_journal");
    return value;
  } catch (error) {
    if (error.code === "ENOENT")
      return { version: 1, nextProjectId: 10000, cells: {}, commands: {} };
    throw error;
  }
}
