/**
 * Test-only admission for mocked legacy provider dispatch.
 *
 * The production paid-transport guard denies every legacy provider dispatch
 * (brief §57.6 RT-03). Many heartbeat fixtures replace adapter.execute with a
 * mock to test what happens after a successful run. Those fixtures opt in with
 * admitMockedLegacyDispatch(); the opt-in admits only model dispatch for the
 * named mocked adapter types (codex_local by default) and every other call
 * reaches the real guard.
 *
 * Use it in a test file:
 *
 *   vi.mock("../services/native-runtime/paid-transport-admission.js", async (importOriginal) =>
 *     (await import("./helpers/mocked-legacy-paid-dispatch.js"))
 *       .withMockedLegacyDispatchAdmission(await importOriginal()));
 *
 * Native fixtures whose session backend is a test factory can opt in with
 * admitMockedNativeDispatch(providers), which admits the Native candidate and
 * launch checks for those providers only.
 *
 * Reset it in afterEach with resetMockedLegacyDispatch(). The real guard is
 * covered by server/src/services/native-runtime/legacy-paid-transport-admission.test.ts
 * and by fixtures that do not opt in.
 *
 * vi.mock does not reach a worker process that a test spawns with tsx. Such a
 * worker calls installMockedLegacyDispatchInChild() and passes the returned
 * source to its script. The worker then gets the opt-in that is current in the
 * test, and nothing more.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as PaidTransportAdmission from "../../services/native-runtime/paid-transport-admission.js";

type PaidTransportAdmissionModule = typeof PaidTransportAdmission;

const state = { adapterTypes: new Set<string>(), nativeProviders: new Set<string>() };

export function admitMockedLegacyDispatch(adapterTypes: readonly string[] = ["codex_local"]): void {
  state.adapterTypes = new Set(adapterTypes);
}

/** Admits Native candidate and launch checks for mocked Native fixtures whose
 * session backend is replaced by a test factory, for the named providers only. */
export function admitMockedNativeDispatch(providers: readonly string[]): void {
  state.nativeProviders = new Set(providers);
}

export function resetMockedLegacyDispatch(): void {
  state.adapterTypes = new Set();
  state.nativeProviders = new Set();
}

export function withMockedLegacyDispatchAdmission(actual: PaidTransportAdmissionModule): PaidTransportAdmissionModule {
  return {
    ...actual,
    withLegacyPaidTransportAdmission: <T>(
      input: Parameters<PaidTransportAdmissionModule["withLegacyPaidTransportAdmission"]>[0],
      dispatch: () => T,
    ): T =>
      state.adapterTypes.has(input.adapterType) && input.operation === "model_dispatch"
        ? dispatch()
        : actual.withLegacyPaidTransportAdmission(input, dispatch),
    assertNativePaidTransportCandidate: (input) => {
      if (!input.aiConnectionBound && state.nativeProviders.has(input.provider)) return;
      actual.assertNativePaidTransportCandidate(input);
    },
    assertNativePaidTransportAdmitted: (input) => {
      if (state.nativeProviders.has(input.provider)) return;
      actual.assertNativePaidTransportAdmitted(input);
    },
  };
}

const ACTUAL_ADMISSION_URL = new URL("../../services/native-runtime/paid-transport-admission.ts", import.meta.url).href;

/**
 * Writes module hooks into `directory` for a spawned tsx worker and returns
 * script source that installs them. The worker must run this source before it
 * imports any server module, so it imports server modules dynamically after it.
 * The worker receives only the opt-in that is current in the calling test.
 */
export async function installMockedLegacyDispatchInChild(directory: string): Promise<string> {
  const wrapperPath = path.join(directory, "mocked-paid-transport-admission.mjs");
  const hooksPath = path.join(directory, "mocked-paid-transport-admission-hooks.mjs");
  const actual = JSON.stringify(ACTUAL_ADMISSION_URL);
  await fs.writeFile(wrapperPath, [
    `export * from ${actual};`,
    `import * as actual from ${actual};`,
    `import { admitMockedLegacyDispatch, admitMockedNativeDispatch, withMockedLegacyDispatchAdmission } from ${JSON.stringify(import.meta.url)};`,
    `admitMockedLegacyDispatch(${JSON.stringify([...state.adapterTypes])});`,
    `admitMockedNativeDispatch(${JSON.stringify([...state.nativeProviders])});`,
    "const mocked = withMockedLegacyDispatchAdmission(actual);",
    "export const withLegacyPaidTransportAdmission = mocked.withLegacyPaidTransportAdmission;",
    "export const assertNativePaidTransportCandidate = mocked.assertNativePaidTransportCandidate;",
    "export const assertNativePaidTransportAdmitted = mocked.assertNativePaidTransportAdmitted;",
    "",
  ].join("\n"), "utf8");
  await fs.writeFile(hooksPath, [
    "let actualUrl; let wrapperUrl;",
    "export function initialize(data) { actualUrl = data.actualUrl; wrapperUrl = data.wrapperUrl; }",
    "export async function resolve(specifier, context, nextResolve) {",
    "  const resolved = await nextResolve(specifier, context);",
    "  return resolved.url === actualUrl && context.parentURL !== wrapperUrl",
    "    ? { ...resolved, url: wrapperUrl, shortCircuit: true } : resolved;",
    "}",
    "",
  ].join("\n"), "utf8");
  return [
    `const { register: registerMockedPaidDispatchHooks } = await import("node:module");`,
    `registerMockedPaidDispatchHooks(${JSON.stringify(pathToFileURL(hooksPath).href)}, { data: ${JSON.stringify({
      actualUrl: ACTUAL_ADMISSION_URL,
      wrapperUrl: pathToFileURL(wrapperPath).href,
    })} });`,
  ].join("\n");
}
