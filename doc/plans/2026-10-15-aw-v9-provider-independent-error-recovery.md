# V9 provider-independent render-error recovery

## Problem and reference requirements

Brief sections 34, 46 and 84 require a usable recovery path, truthful unknown
outcomes, private diagnostics and localized accessible controls. Existing route
and root boundaries printed arbitrary exception messages in customer UI and in
their own console calls. They had English-only recovery and no support route.
The root boundary must continue to work when router or localization providers
fail. UI playbook state/recovery guidance and WR-00 truth/localization rules apply.

## Implementation

- Share a context-independent surface using the retained EN/DA dictionaries and
  the document's current language. Do not depend on router, query or translation
  providers. Native buttons keep recovery available above those providers.
- Keep the exception in the existing governed capture path, with its original
  component context. Do not put arbitrary exception prose in the rendered page
  or the boundaries' own console arguments. React's development logging remains
  separately owned. Boundary state needs only a failure boolean; do not stringify
  an untrusted thrown value to render recovery.
- Focus the recovery heading; use token-based, 44px controls with visible focus
  and a wrapping footer. Preserve route-change reset and browser Back.
- Explain possible loss of unsaved changes and that the crash does not resolve
  a preceding write. Reload never retries a mutation in this surface.
- Link directly to the existing support address without prefilled content or
  an automatic report. Keep feedback and security/privacy workflows separate.

## Verification and limits

The initial affected five suites passed all 27 cases. Final verification after
the boolean-state cleanup and private-error canary passes all 28 cases. Tests cover
existing capture, route reset, effect/render errors and provider-free EN/DA
focus, Back, plain mailto and unknown-outcome copy. Token and source gates pass.
This closes the concrete render-error exposure/recovery gap. It does not qualify
all domain recovery, manual assistive technology or representative human use.
