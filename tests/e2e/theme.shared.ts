import type { Page } from "@playwright/test";

/** Wait for the app's actual finite theme transitions before inspecting colors.
 * The native autofill rule deliberately keeps Chrome's background transition
 * alive for 100,000 seconds; that hold is not a theme settling animation.
 * Keep animations running, including reduced-motion behavior, as shipped.
 */
export async function settleTheme(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const themeAnimations = document.getAnimations().filter((animation) => {
      const effect = animation.effect;
      const timing = effect?.getComputedTiming();
      if (!timing || !Number.isFinite(Number(timing.endTime))) return false;
      if (
        animation instanceof CSSTransition &&
        animation.transitionProperty === "background-color" &&
        timing.activeDuration === 100_000_000 &&
        effect instanceof KeyframeEffect &&
        effect.target instanceof Element &&
        effect.target.matches("input, textarea, select")
      )
        return false;
      return true;
    });
    // A style flush can cancel an SVG color transition after enumeration.
    // Reading .finished on that now-idle animation creates a new promise that
    // never settles. Observe its actual terminal state instead; cancellation
    // and completion both mean there is no remaining transition to inspect.
    await new Promise<void>((resolve) => {
      const observe = () => {
        if (themeAnimations.every(animation => animation.playState === "finished" || animation.playState === "idle")) resolve();
        else requestAnimationFrame(observe);
      };
      observe();
    });
  });
}
