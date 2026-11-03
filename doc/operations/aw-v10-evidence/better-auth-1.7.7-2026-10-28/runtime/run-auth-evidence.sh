#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR=/workspace/blentera-v10
EVIDENCE_DIR="$ROOT_DIR/doc/operations/aw-v10-evidence/better-auth-1.7.7-2026-10-28"
PINNED_PNPM=/workspace/v10-preparation/pinned-bin/pnpm
VITEST_CONFIG="$EVIDENCE_DIR/runtime/vitest.config.mjs"
NODE_LOADER="$EVIDENCE_DIR/runtime/node-import-loader.mjs"

cd "$ROOT_DIR"
mkdir -p "$EVIDENCE_DIR/runtime/logs"
LOG_DIR="$EVIDENCE_DIR/runtime/logs"

git rev-parse HEAD > "$LOG_DIR/tested-revision.pretest.txt"
node --version > "$LOG_DIR/node-version.pretest.txt"
"$PINNED_PNPM" --version > "$LOG_DIR/pnpm-version.pretest.txt"

source_files=(
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  server/package.json
  ui/package.json
  server/src/auth/better-auth.ts
  server/src/auth/enterprise-auth-plugins.ts
  server/src/auth/enterprise-identity-bridge.ts
  server/src/auth/native-two-factor.ts
  server/src/__tests__/better-auth.test.ts
  server/src/__tests__/v6-saas-auth.integration.test.ts
  server/src/__tests__/v7-enterprise-scim.integration.test.ts
  server/src/__tests__/v7-enterprise-identity-bridge.test.ts
  server/src/__tests__/native-two-factor.integration.test.ts
  server/src/__tests__/better-auth-credential-signup.integration.test.ts
  server/src/__tests__/fixtures/v7-idp-certificate.pem
  packages/db/src/schema/auth.ts
  packages/db/src/migrations/0558_better_auth_issuer_compatibility.sql
  packages/db/src/migrations/meta/0558_snapshot.json
  packages/db/src/migrations/meta/_journal.json
  packages/db/src/better-auth-account-issuer-migration.test.ts
  patches/@better-auth__scim@1.7.7.patch
)
sha256sum "${source_files[@]}" > "$LOG_DIR/source-pins.pretest.sha256"
sha256sum "$VITEST_CONFIG" "$NODE_LOADER" > "$LOG_DIR/resolver-loader-pins.pretest.sha256"
sha256sum \
  /tmp/better-auth-1.7.7.tgz \
  /tmp/better-auth-core-1.7.7.tgz \
  /tmp/better-auth-passkey-1.7.7.tgz \
  /tmp/blentera-scim-1.7.7.tgz \
  /tmp/better-auth-sso-1.7.7.tgz \
  /tmp/better-auth-drizzle-adapter-1.7.7.tgz \
  /tmp/better-auth-kysely-adapter-1.7.7.tgz \
  /tmp/better-auth-memory-adapter-1.7.7.tgz \
  /tmp/better-auth-mongo-adapter-1.7.7.tgz \
  /tmp/better-auth-prisma-adapter-1.7.7.tgz \
  /tmp/better-auth-telemetry-1.7.7.tgz \
  /tmp/better-fetch-fetch-1.3.2.tgz \
  > "$LOG_DIR/tarball-integrity.pretest.sha256"

set +e
"$PINNED_PNPM" audit --prod --audit-level high --json \
  > "$LOG_DIR/prod-audit.json" 2> "$LOG_DIR/prod-audit.stderr.log"
AUDIT_RC=$?
printf '%s\n' "$AUDIT_RC" > "$LOG_DIR/prod-audit.exit"

NODE_OPTIONS="--import=$NODE_LOADER" \
  /workspace/blentera-v10/server/node_modules/.bin/vitest run \
  --config "$VITEST_CONFIG" \
  src/__tests__/better-auth.test.ts \
  src/__tests__/v6-saas-auth.integration.test.ts \
  src/__tests__/v7-enterprise-scim.integration.test.ts \
  src/__tests__/v7-enterprise-identity-bridge.test.ts \
  src/__tests__/native-two-factor.integration.test.ts \
  src/__tests__/better-auth-credential-signup.integration.test.ts \
  > "$LOG_DIR/auth-six-suite.log" 2>&1
AUTH_RC=$?
printf '%s\n' "$AUTH_RC" > "$LOG_DIR/auth-six-suite.exit"

(cd packages/db && "$PINNED_PNPM" run typecheck) \
  > "$LOG_DIR/db-typecheck.log" 2>&1
DB_TYPECHECK_RC=$?
printf '%s\n' "$DB_TYPECHECK_RC" > "$LOG_DIR/db-typecheck.exit"

(cd packages/db && ./node_modules/.bin/vitest run src/better-auth-account-issuer-migration.test.ts) \
  > "$LOG_DIR/db-account-migration.log" 2>&1
DB_MIGRATION_RC=$?
printf '%s\n' "$DB_MIGRATION_RC" > "$LOG_DIR/db-account-migration.exit"

set -e
if (( AUDIT_RC != 0 || AUTH_RC != 0 || DB_TYPECHECK_RC != 0 || DB_MIGRATION_RC != 0 )); then
  exit 1
fi
