import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { managedNativeBrowserCases, managedNativeBrowserCohortNames } from "./managed-native-browser-cases.js";
import { registerManagedNativeBrowserCohort } from "./managed-native-browser.fixture.js";

it("routes every canonical managed Native browser case to exactly one nonempty cohort", () => {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));
  const entryFiles = readdirSync(fixtureDir).filter(file =>
    file.startsWith("native-opencode-managed-browser") && file.endsWith(".integration.test.ts")).sort();
  expect(entryFiles).toHaveLength(managedNativeBrowserCohortNames.length);
  const entryCohorts = entryFiles.map(file => {
    const content = readFileSync(join(fixtureDir, file), "utf8");
    const registrations = [...content.matchAll(/registerManagedNativeBrowserCohort\("([^\"]+)"\)/g)];
    expect(registrations, file).toHaveLength(1);
    return registrations[0]![1]!;
  });
  expect(new Set(entryCohorts).size).toBe(entryCohorts.length);
  expect(entryCohorts.sort()).toEqual([...managedNativeBrowserCohortNames].sort());
  const flattened = managedNativeBrowserCohortNames.flatMap(cohort => {
    const cases = managedNativeBrowserCases.filter(scenario => scenario.cohort === cohort);
    expect(cases.length, cohort).toBeGreaterThan(0);
    return cases;
  });
  expect(new Set(flattened).size).toBe(flattened.length);
  expect(flattened.map(scenario => scenario.label).sort()).toEqual(
    managedNativeBrowserCases.map(scenario => scenario.label).sort());
  expect(new Set(managedNativeBrowserCases.map(scenario => scenario.label)).size)
    .toBe(managedNativeBrowserCases.length);
  const standaloneLabel = "normalizes and deduplicates repository URLs in the managed Project result and card";
  const fixtureSource = readFileSync(join(fixtureDir, "managed-native-browser.fixture.ts"), "utf8");
  expect(managedNativeBrowserCases.some(scenario => scenario.label === standaloneLabel)).toBe(false);
  expect(flattened.length + 1).toBe(23);
  expect(fixtureSource.match(/if \(cohort === "core"\)\s*\{\s*it\("normalizes and deduplicates repository URLs in the managed Project result and card"/g) ?? [])
    .toHaveLength(1);
});

registerManagedNativeBrowserCohort("core");
