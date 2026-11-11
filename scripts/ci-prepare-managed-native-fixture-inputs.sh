set -euo pipefail
artifact_dir="$RUNNER_TEMP/aw-v4-managed-native-prerequisites"
provider_pack="$RUNNER_TEMP/paperclip-native-provider-pack"
(cd "$artifact_dir" && sha256sum --check provider-pack.sha256)
test "$(cat "$artifact_dir/source-commit.txt")" = "$(git rev-parse HEAD)"
mkdir -p "$provider_pack"
tar -xzf "$artifact_dir/provider-pack.tar.gz" -C "$provider_pack"
test -f "$provider_pack/provider-pack.json"
test -x "$provider_pack/dist/bin/paperclip-runnerd"
echo "PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH=$provider_pack" >> "$GITHUB_ENV"
echo "PAPERCLIP_RUNNER_BINARY=$provider_pack/dist/bin/paperclip-runnerd" >> "$GITHUB_ENV"

archive="$artifact_dir/openshell-prover-x86_64-unknown-linux-musl.tar.gz"
echo "e1c9db66ae459850cab43765d7ad569effe2ac0a338c902a1b895d0cc361fbb0  $archive" | sha256sum --check
test "$(tar -tzf "$archive")" = openshell-prover
prover_dir="$RUNNER_TEMP/managed-native-openshell-prover-v0.1.2"
mkdir -m 700 "$prover_dir"
tar -xzf "$archive" -C "$prover_dir" -- openshell-prover
prover="$prover_dir/openshell-prover"
echo "3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1  $prover" | sha256sum --check
test -x "$prover"
echo "AW_V7_OPENSHELL_PROVER=$prover" >> "$GITHUB_ENV"

node --input-type=module - "$provider_pack" "$GITHUB_ENV" <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { accessSync, appendFileSync, constants, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
const [pack, environment] = process.argv.slice(2);
const root = realpathSync(pack);
const manifest = JSON.parse(readFileSync(resolve(root, "provider-pack.json"), "utf8"));
const expected = "sha256:513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080";
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert.equal(manifest.schema, "paperclip-runner/remote-provider-pack/v1");
assert.deepEqual(manifest.payload.target, { platform: "linux", architecture: "x64" });
assert.equal(manifest.payload.pins.opencode, "1.18.32");
const artifact = manifest.payload.artifacts.opencodeExecutable;
assert.equal(artifact.path, "node_modules/opencode-ai/bin/opencode.exe");
assert.equal(artifact.sha256, expected);
const artifactPath = resolve(root, artifact.path);
const sourceMetadata = lstatSync(artifactPath);
assert.ok(sourceMetadata.isFile() && !sourceMetadata.isSymbolicLink());
const binary = realpathSync(artifactPath);
assert.ok(binary.startsWith(root + sep), "OpenCode must remain inside the verified pack");
const metadata = lstatSync(binary);
assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
assert.equal(metadata.uid, process.getuid());
assert.equal(metadata.mode & 0o022, 0);
accessSync(binary, constants.X_OK);
assert.equal("sha256:" + createHash("sha256").update(readFileSync(binary)).digest("hex"), expected);
appendFileSync(environment, `PAPERCLIP_QUALIFIED_OPENCODE_BINARY=${binary}\n`);
NODE
