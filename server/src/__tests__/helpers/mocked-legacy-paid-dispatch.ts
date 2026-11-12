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
 */
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
