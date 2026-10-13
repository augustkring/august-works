# Product updates cannot cover governance navigation

Current PR CI failed the V7 authenticated browser journey because the floating
announcement image intercepted clicks on the AI Governance link. The failure
log identifies the actual overlapping announcement subtree, not a missing
permission or a slower governance API.

Product updates now use an initially collapsed native disclosure in the shell's
normal flow. Expanding the bounded panel reserves layout space; the update no
longer floats over the sidebar or main controls. Keyboard disclosure and current
announcement dismissal retain the original owner and identity/modal/toast gates.
The summary is localized in EN/DA, and card action/dismiss targets are at least
44 CSS pixels. Theme, feed authority and governance controls are unchanged.

The actual previously failing built Chromium authenticated journey passed. Its
public announcement response fixture keeps an update visible, opens it with
Enter and then clicks the real governance link without forced pointer events or
discarding the announcement. The original authenticated discovery/readiness/
governance/company-scope assertions remain. Nine announcement component cases,
UI typecheck and token gates passed. This is software evidence; human
assistive-technology and full V9 acceptance remain separate. References: supplied
UX, UI, universal design, frontend and verification playbooks.
