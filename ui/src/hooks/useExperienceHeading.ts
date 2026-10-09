import { useEffect, useRef } from "react";

/** Orient on entry/context change or recovery, without interrupting utilities. */
export function useExperienceHeading(
  scope: string,
  loading: boolean,
  failed: boolean,
) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (failed) {
      focused.current = null;
      return;
    }
    if (loading || !heading.current || focused.current === scope) return;
    focused.current = scope;
    if (!document.activeElement?.closest('[role="dialog"]'))
      heading.current.focus();
  }, [scope, loading, failed]);
  return heading;
}
