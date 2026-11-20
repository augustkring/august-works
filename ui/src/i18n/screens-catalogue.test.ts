import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import experienceDa from "./experience/da.json";
import experienceEn from "./experience/en.json";
import { validateLocaleMessages } from "./locale-validation";

type Tree = { [key: string]: string | Tree };
const enScreens = (experienceEn as unknown as { screens: Tree }).screens;
const daScreens = (experienceDa as unknown as { screens: Tree }).screens;

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.set(`${prefix}${key}`, value);
    else for (const [k, v] of flatten(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

// Terms that are written the same in English and Danish (or are product names).
const SAME_IN_DANISH = new Set([
  "Status", "ID", "Type", "Chat", "Logo", "Board", "Sandbox", "Adapter", "DevOps", "Designer", "Researcher",
  "Backlog", "Dansk", "English", "Mine", "{{value}} tokens", "adapter: {{type}}", "{{count}} agent", "via {{name}}", "Tokens {{value}}", "Upload",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("screens catalogue (I18N-DA1)", () => {
  const en = flatten(enScreens);
  const da = flatten(daScreens);

  it("has a Danish entry for every English entry and no extras", () => {
    expect(validateLocaleMessages(experienceDa, experienceEn)).toEqual([]);
    expect([...en.keys()].filter((key) => !da.has(key))).toEqual([]);
    expect([...da.keys()].filter((key) => !en.has(key))).toEqual([]);
  });

  it("does not leave English text in the Danish catalogue", () => {
    const untranslated = [...en].filter(([key, value]) => {
      const danish = da.get(key);
      return danish === value && /[A-Za-z]{3,}/.test(value) && !SAME_IN_DANISH.has(value);
    });
    expect(untranslated.map(([key, value]) => `${key}: ${value}`)).toEqual([]);
  });

  it("defines every screens key that source code looks up", () => {
    const known = new Set(en.keys());
    const has = (key: string) => known.has(key) || known.has(`${key}_one`) || known.has(`${key}_other`);
    const missing: string[] = [];
    for (const file of sourceFiles(join(__dirname, ".."))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\("screens\.([A-Za-z0-9_.]+)"/g)) {
        if (!has(match[1]!)) missing.push(`${file}: screens.${match[1]}`);
      }
      for (const match of text.matchAll(/\bscreenText\("([A-Za-z0-9_.]+)"/g)) {
        if (!has(match[1]!)) missing.push(`${file}: screens.${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
