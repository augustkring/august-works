# Capability lifecycle notice focused verification

- Test command: `pnpm exec vitest run server/src/services/experience/product-notices.test.ts ui/src/components/CapabilityLifecycleNotices.test.tsx`
- Workspace: `/workspace/v10-dep-qualification`
- Result: 10 tests passed across 2 files.
- `vitest.stdout.txt` is an explicit transcription of the successful tool output; the runner streamed output and did not create a raw test log.
- `source-pins.json` records the copied and SHA-256-verified source snapshot taken after acquiring `/workspace/v10-preparation/v10-pg-tests.lock`.
- `snapshot.log` records the source-copy result. `syntax.log` records parsing of 805 files with Vitest Vite/Oxc.
- Verification was focused source-level evidence. It does not establish hosted deployment, customer use, external provider facts, or release qualification.
