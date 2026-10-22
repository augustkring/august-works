import { useLayoutEffect, useRef } from "react";
import { PRODUCT_IDENTITY } from "@paperclipai/shared/product-identity";
import en from "../i18n/experience/en.json";
import da from "../i18n/experience/da.json";

/** Works above the router and providers, including a failed localization provider.
 * Never accepts error prose, resource references or a command to retry. */
export function ErrorRecoverySurface({ scope, onBack }: {
  scope: "app" | "page";
  onBack?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = (document.documentElement.lang.toLowerCase().split("-")[0] === "da" ? da : en).errorRecovery;
  const Region = scope === "app" ? "main" : "section";
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  return (
    <Region className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10" aria-labelledby="error-recovery-heading">
      <h1 id="error-recovery-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold">{copy[scope]}</h1>
      <p className="text-sm text-muted-foreground">{copy.explanation}</p>
      <p className="text-sm text-muted-foreground">{copy.unknownOutcome}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {onBack && <button type="button" className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium focus-visible:outline focus-visible:outline-ring" onClick={onBack}>{copy.back}</button>}
        <button type="button" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline focus-visible:outline-ring" onClick={() => window.location.reload()}>{copy.reload}</button>
      </div>
      <p className="text-sm text-muted-foreground">{copy.supportExplanation}</p>
      <a href={`mailto:${PRODUCT_IDENTITY.supportEmail}`} className="inline-flex min-h-11 items-center underline focus-visible:outline focus-visible:outline-ring">{copy.support}</a>
    </Region>
  );
}
