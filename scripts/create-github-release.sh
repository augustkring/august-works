#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./release-lib.sh
. "$REPO_ROOT/scripts/release-lib.sh"

dry_run=false
version=""
notes_file_override=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/create-github-release.sh <version> [--dry-run] [--notes-file PATH]

Examples:
  ./scripts/create-github-release.sh 2026.318.0
  ./scripts/create-github-release.sh 2026.318.0 --dry-run
  ./scripts/create-github-release.sh 2026.318.0 --notes-file /tmp/stable-notes.md

Notes:
  - Run this after pushing the stable tag.
  - Resolves the git remote automatically.
  - In GitHub Actions, origin is used explicitly.
  - If the release already exists, this script updates its title and notes.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --notes-file)
      shift
      if [ $# -eq 0 ]; then
        echo "Error: --notes-file requires a path." >&2
        exit 1
      fi
      notes_file_override="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [ -n "$version" ]; then
        echo "Error: only one version may be provided." >&2
        exit 1
      fi
      version="$1"
      ;;
  esac
  shift
done

if [ -z "$version" ]; then
  usage
  exit 1
fi

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be a stable calendar version like 2026.318.0." >&2
  exit 1
fi

tag="v$version"
notes_file="$REPO_ROOT/releases/${tag}.md"
if [ -n "$notes_file_override" ]; then
  notes_file="$notes_file_override"
fi
if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ -z "${PUBLISH_REMOTE:-}" ] && git_remote_exists origin; then
  PUBLISH_REMOTE=origin
fi
PUBLISH_REMOTE="$(resolve_release_remote)"
if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required to create GitHub releases." >&2
  exit 1
fi

GITHUB_REPO="$(github_repo_from_remote "$PUBLISH_REMOTE" || true)"
if [ -z "$GITHUB_REPO" ]; then
  echo "Error: could not determine GitHub repository from remote $PUBLISH_REMOTE." >&2
  exit 1
fi

if [ ! -f "$notes_file" ]; then
  echo "Error: release notes file not found at $notes_file." >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse "$tag" >/dev/null 2>&1; then
  echo "Error: local git tag $tag does not exist." >&2
  exit 1
fi

# Both catalog assets are derived from the checked-out sources. Keep the
# existing tier-only v1 asset intact for the Cloud harness and publish
# lifecycle-rich v2 separately until that external consumer is qualified.
# Generate both from the exact commit the release tag points at, with no local
# edits, so their release identity cannot drift from the tagged source.
tag_commit="$(git -C "$REPO_ROOT" rev-parse "$tag^{commit}")"
head_commit="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [ "$head_commit" != "$tag_commit" ]; then
  echo "Error: HEAD ($head_commit) does not match tag $tag ($tag_commit). Check out the release tag before generating the feature catalog." >&2
  exit 1
fi
if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
  echo "Error: working tree has uncommitted changes. The feature catalog must be generated from the pristine release commit." >&2
  exit 1
fi

catalog_dir="$(mktemp -d)"
trap 'rm -rf "$catalog_dir"' EXIT
catalog_file="$catalog_dir/feature-catalog.json"
lifecycle_catalog_file="$catalog_dir/feature-catalog-lifecycle.json"
node "$REPO_ROOT/cli/node_modules/tsx/dist/cli.mjs" \
  "$REPO_ROOT/scripts/generate-feature-catalog.ts" \
  --version "$version" \
  --out "$catalog_file"
node "$REPO_ROOT/cli/node_modules/tsx/dist/cli.mjs" \
  "$REPO_ROOT/scripts/generate-feature-catalog.ts" \
  --version "$version" \
  --schema-version 2 \
  --out "$lifecycle_catalog_file"

if [ "$dry_run" = true ]; then
  echo "[dry-run] gh release create $tag -R $GITHUB_REPO --title $tag --notes-file $notes_file"
  echo "[dry-run] gh release upload $tag -R $GITHUB_REPO --clobber $catalog_file $lifecycle_catalog_file"
  exit 0
fi

tag_ref="refs/tags/$tag"
if ! remote_tag_listing="$(git -C "$REPO_ROOT" ls-remote --exit-code --tags "$PUBLISH_REMOTE" "$tag_ref" "$tag_ref^{}" 2>/dev/null)"; then
  echo "Error: remote tag $tag was not found on $PUBLISH_REMOTE. Push the release commit and tag first." >&2
  exit 1
fi
remote_tag_commit="$(awk -v ref="$tag_ref" '$2 == ref "^{}" { peeled = $1 } $2 == ref { direct = $1 } END { print peeled != "" ? peeled : direct }' <<< "$remote_tag_listing")"
if [ "$remote_tag_commit" != "$tag_commit" ]; then
  echo "Error: remote tag $tag ($remote_tag_commit) does not match the local release source $tag_commit on $PUBLISH_REMOTE." >&2
  exit 1
fi

if gh release view "$tag" -R "$GITHUB_REPO" >/dev/null 2>&1; then
  gh release edit "$tag" -R "$GITHUB_REPO" --title "$tag" --notes-file "$notes_file"
  echo "Updated GitHub Release $tag"
else
  gh release create "$tag" -R "$GITHUB_REPO" --title "$tag" --notes-file "$notes_file"
  echo "Created GitHub Release $tag"
fi

gh release upload "$tag" -R "$GITHUB_REPO" --clobber "$catalog_file" "$lifecycle_catalog_file"
echo "Uploaded feature-catalog.json and feature-catalog-lifecycle.json to GitHub Release $tag"
