import { ExperienceOverloadError } from "./projection.js";
let activeRequests = 0;
const MAX_HOME_REQUESTS = 4;
/** Includes authority/context and final revocation checks, not only reader fan-out. */
export async function withExperienceAdmission<T>(
  work: (signal: AbortSignal, remainingMs: () => number) => Promise<T>,
  options: { signal?: AbortSignal; deadlineMs?: number } = {},
): Promise<T> {
  if (activeRequests >= MAX_HOME_REQUESTS)
    throw new ExperienceOverloadError("Home admission is full");
  const controller = new AbortController(),
    deadline = Math.max(1, Math.min(1500, options.deadlineMs ?? 1500)),
    started = Date.now();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  activeRequests++;
  const pending = Promise.resolve()
    .then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal, () =>
        Math.max(1, deadline - (Date.now() - started)),
      );
    })
    .finally(() => {
      activeRequests--;
    });
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        new ExperienceOverloadError(
          "Home could not complete within its deadline",
        ),
      );
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  const timer = setTimeout(abort, deadline);
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
