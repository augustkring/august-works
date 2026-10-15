import { useLayoutEffect, useRef } from "react";

/** Orient on entry/context change or recovery, without interrupting utilities. */
export function useExperienceHeading(
  scope: string,
  loading: boolean,
  failed: boolean,
) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef<{ scope: string; element: HTMLHeadingElement } | null>(null);
  useLayoutEffect(() => {
    if (failed) {
      focused.current = null;
      return;
    }
    if (loading || !heading.current || (focused.current?.scope === scope && focused.current.element === heading.current)) return;
    // Private rechecks can remove and remount the heading in the same scope.
    // The old DOM element cannot retain focus on behalf of its replacement.
    focused.current = { scope, element: heading.current };
    // An asynchronous first result must not redirect a keyboard gesture
    // already started on a utility, navigation link or other current control.
    // Layout timing also prevents a delayed passive effect from taking focus
    // after the newly rendered page is visible and interactive.
    if (!document.activeElement?.closest('[role="dialog"],button,a[href],input,select,textarea,summary,[contenteditable="true"],[role="button"]'))
      heading.current.focus();
  }, [scope, loading, failed]);
  return heading;
}
