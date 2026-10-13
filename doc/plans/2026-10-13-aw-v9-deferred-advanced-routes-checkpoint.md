# Load advanced domains at their admitted route

Advanced V5/V7 and V8 page modules now use React lazy loading in both Original
route variants. Security, enterprise, packages, playbooks, portfolio, skills
and runtime administration, and business analysis/planning pages load when their
admitted route renders. Existing feature gates stay outside the deferred leaf.
The existing route Suspense boundary covers loading without remounting the
application shell. Its accessible loading label is localized in English/Danish.
Direct links, current routing and canonical domain owners are retained.

The built initial JavaScript asset changed from 7,281.02 kB (1,924.74 kB gzip)
on the preceding exact full-build artifact to 6,809.83 kB (1,823.41 kB gzip).
That is approximately 6.5% less uncompressed entry code and 5.3% less gzip data;
it is not an overall responsiveness or hosted performance result. Separate
planning and metrics chunks were produced. Other existing static imports still
keep a substantial shared entry; no universal bundle limit is inferred.

## Verification

The three existing route suites passed 29 cases and affected UI types passed.
UI build, token gates, module boundaries and diff checks passed. The built
software fixture observed no planning/metrics chunk or planning data request
on the initial dashboard with the corresponding features disabled, then exactly
one planning chunk request when the admitted route opened. The metrics chunk
remained unloaded; direct page reload also worked. The test attached actual local
navigation timings as observations, without a fabricated percentile or SLA.

The first four-case browser run passed both actual native planning journeys and
the saved conversation preview, and failed the new fixture because the existing
shell and content both expose that page heading. The corrected fixture scopes
its assertion to main content and passed. It waits for the actual asynchronous
planning request before assessing data admission. No production heading behavior
or assertion about hidden advanced data was weakened.

The preceding `45c225ceba11e801d28c2cf27a097dac9f5a6b91` artifact passed the exact
full 35-workspace build with Source clean before/after. This later change was
checked with affected UI build/types/tests; full default tests and full V9
completion remain pending. References: V9 §41/V9-076 and supplied frontend,
performance, accessibility, UI/UX and verification playbooks.
