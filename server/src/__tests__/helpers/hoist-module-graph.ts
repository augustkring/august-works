/**
 * Register stable mocks and load their actual module graph once during module
 * collection. Call with top-level await before declaring tests or suites.
 *
 * Cold transformation is module initialization. Loading it in beforeAll charges
 * that CPU work to a setup timeout and can skip every behavior under CPU load.
 * Per-test mock resets and cache clearing remain each caller's responsibility.
 * Do not reset and re-import the graph for each test.
 */
export async function hoistModuleGraph<T>(
  registerMocks: () => void,
  loadGraph: () => Promise<T>,
): Promise<{ readonly value: T }> {
  registerMocks();
  const graph = await loadGraph();
  return {
    get value(): T {
      return graph;
    },
  };
}
