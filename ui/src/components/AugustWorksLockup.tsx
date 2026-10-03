import type { HTMLAttributes } from "react";

interface AugustWorksLockupProps extends HTMLAttributes<HTMLSpanElement> {
  title?: string;
}

/**
 * Official August Works lockup, sourced from the approved Drive logo package.
 * The two original SVGs preserve the correct mark and wordmark in both themes.
 */
export function AugustWorksLockup({
  className,
  title = "August Works",
  ...props
}: AugustWorksLockupProps) {
  return (
    <span className={className} {...props}>
      <img
        src="/brands/august-works/inline-black.svg"
        alt={title}
        className="h-full w-auto dark:hidden"
      />
      <img
        src="/brands/august-works/inline-white.svg"
        alt=""
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
}
