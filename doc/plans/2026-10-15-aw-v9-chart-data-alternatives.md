# Native activity chart data alternatives

Implement the V9-082 nonvisual alternative for the shared activity charts used
by dashboard and Agent detail surfaces. Run activity, success rate, task priority
and task status receive native expandable data tables from the same bounded
already-authorized data. Tables have named captions, column and row headers,
exact ISO dates, keyboard-reachable horizontal scroll regions and English/Danish
labels. No new query, external sink, export, storage or interpretation owner is
introduced. Chart data inherits the parent's Native admission and withdrawal.

Keep recovered runs separate in the activity table, and include them in the
existing success-rate numerator. Show no-runs days explicitly instead of implying
a zero-percent outcome. Preserve supplied unknown status categories as escaped
text and a counted series rather than omitting them from both the chart and its
alternative. Failure reasons remain the already-visible bounded Native codes;
no arbitrary HTML rendering is introduced.

Apply the UI playbook's semantic-table and reflow guidance, the accessibility
requirements of the master brief and DESIGN.md token constraints. Use native
`details`, `summary` and table semantics; no ARIA grid or new motion is needed.

The focused UI/locale suite passes 15 cases; UI typecheck and token gates pass.
The added browser case must verify keyboard opening and region focus, exact
values, 320px containment, both themes and automated WCAG checks on the built
host. Its aggregate is an explicit software fixture over a disposable Native
company; it does not claim actual run outcomes, manual assistive-technology,
representative usability or complete V9-082 coverage of every chart/generative
host. Full build and current-artifact browser verification are pending.
